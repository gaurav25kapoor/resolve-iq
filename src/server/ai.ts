import { GoogleGenAI, Type } from '@google/genai';
import { eq, ne } from 'drizzle-orm';
import { db } from '../db/index.ts';
import type { DraftHandoffPayload, SimilarTicketItem } from '../db/schema.ts';
import {
  aiAnalyses,
  checklistItems,
  diagnosticChecklists,
  historicalTickets,
  investigationCheckResults,
  workflowTickets,
} from '../db/schema.ts';

const GEMINI_CHAT_MODEL = 'gemini-4-hydrogen';
const GEMINI_EMBED_MODEL = 'gemini-embedding-2';

const STOP_WORDS = new Set([
  'the',
  'a',
  'an',
  'for',
  'to',
  'in',
  'on',
  'of',
  'and',
  'or',
  'is',
  'are',
  'was',
  'were',
  'be',
  'with',
  'not',
  'by',
  'from',
  'after',
  'last',
  'mins',
  'new',
  'still',
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s/]+/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !STOP_WORDS.has(t));
}

function buildBigrams(tokens: string[]): string[] {
  const grams: string[] = [...tokens];
  for (let i = 0; i < tokens.length - 1; i++) {
    grams.push(`${tokens[i]}_${tokens[i + 1]}`);
  }
  return grams;
}

function computeCosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function getGenAIClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY' || apiKey.trim() === '') {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      // Keep the documented deterministic path responsive when Gemini is
      // unavailable or blocked by the local network; do not retry indefinitely.
      timeout: 15_000,
      retryOptions: { attempts: 1 },
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

async function computeTfIdfSimilarTickets(
  targetTicket: typeof historicalTickets.$inferSelect,
  candidates: Array<typeof historicalTickets.$inferSelect>,
  topK: number
): Promise<SimilarTicketItem[]> {
  const targetTokens = buildBigrams(
    tokenize(`${targetTicket.category} ${targetTicket.description} ${targetTicket.priority}`)
  );

  // Compute document frequency across candidate corpus
  const docFreq = new Map<string, number>();
  const candidateTokenSets: Array<Map<string, number>> = [];

  for (const cand of candidates) {
    const tokens = buildBigrams(
      tokenize(`${cand.category} ${cand.description} ${cand.priority}`)
    );
    const tf = new Map<string, number>();
    const seen = new Set<string>();
    for (const tok of tokens) {
      tf.set(tok, (tf.get(tok) ?? 0) + 1);
      if (!seen.has(tok)) {
        seen.add(tok);
        docFreq.set(tok, (docFreq.get(tok) ?? 0) + 1);
      }
    }
    candidateTokenSets.push(tf);
  }

  const N = Math.max(candidates.length, 1);
  const targetTf = new Map<string, number>();
  for (const tok of targetTokens) {
    targetTf.set(tok, (targetTf.get(tok) ?? 0) + 1);
  }

  const targetVec = new Map<string, number>();
  let targetNormSq = 0;
  for (const [tok, freq] of targetTf.entries()) {
    const idf = Math.log((N + 1) / ((docFreq.get(tok) ?? 0) + 1)) + 1;
    const weight = (1 + Math.log(freq)) * idf;
    targetVec.set(tok, weight);
    targetNormSq += weight * weight;
  }
  const targetNorm = Math.sqrt(targetNormSq) || 1;

  const scored: SimilarTicketItem[] = candidates.map((cand, idx) => {
    const candTf = candidateTokenSets[idx];
    let dot = 0;
    let candNormSq = 0;
    for (const [tok, freq] of candTf.entries()) {
      const idf = Math.log((N + 1) / ((docFreq.get(tok) ?? 0) + 1)) + 1;
      const w = (1 + Math.log(freq)) * idf;
      candNormSq += w * w;
      const tw = targetVec.get(tok);
      if (tw !== undefined) {
        dot += tw * w;
      }
    }
    const candNorm = Math.sqrt(candNormSq) || 1;
    let sim = dot / (targetNorm * candNorm);

    // Light calibrated structural alignment bonus without overriding textual match
    if (cand.category === targetTicket.category) {
      sim = Math.min(0.99, sim * 0.8 + 0.2);
    } else {
      sim = sim * 0.8;
    }

    return {
      ticketId: cand.ticketId,
      similarityScore: Math.round(sim * 1000) / 1000,
      category: cand.category,
      priority: cand.priority,
      clientName: cand.clientName,
      clientTier: cand.clientTier,
      description: cand.description,
      escalatedToEng: cand.escalatedToEng,
      engOutcome: cand.engOutcome,
      engHandoffs: cand.engHandoffs,
      resolutionHours: cand.resolutionHours,
      csatScore: cand.csatScore,
      status: cand.status,
    };
  });

  scored.sort((a, b) => b.similarityScore - a.similarityScore);
  return scored.slice(0, topK);
}

async function tryGeminiEmbeddingRerank(
  targetTicket: typeof historicalTickets.$inferSelect,
  candidates: Array<typeof historicalTickets.$inferSelect>,
  preliminaryTop: SimilarTicketItem[],
  topK: number
): Promise<{ items: SimilarTicketItem[]; method: string } | null> {
  const ai = getGenAIClient();
  if (!ai) return null;

  try {
    const shortlistIds = new Set(preliminaryTop.map((t) => t.ticketId));
    const shortlist = candidates.filter((c) => shortlistIds.has(c.ticketId));

    const targetText = `Category: ${targetTicket.category} | Priority: ${targetTicket.priority} | Issue: ${targetTicket.description}`;
    const targetRes = await ai.models.embedContent({
      model: GEMINI_EMBED_MODEL,
      contents: targetText,
    });
    const targetVec = targetRes.embeddings?.[0]?.values;
    if (!targetVec || targetVec.length === 0) return null;

    const missingVecRecords = shortlist.filter(
      (c) => !Array.isArray(c.embeddingJson) || c.embeddingJson.length === 0
    );

    if (missingVecRecords.length > 0) {
      const texts = missingVecRecords.map(
        (c) => `Category: ${c.category} | Priority: ${c.priority} | Issue: ${c.description}`
      );
      const batchRes = await ai.models.embedContent({
        model: GEMINI_EMBED_MODEL,
        contents: texts,
      });

      const returnedEmbeddings = batchRes.embeddings ?? [];
      for (let i = 0; i < missingVecRecords.length; i++) {
        const vec = returnedEmbeddings[i]?.values;
        if (vec && vec.length > 0) {
          missingVecRecords[i].embeddingJson = vec;
          await db
            .update(historicalTickets)
            .set({ embeddingJson: vec })
            .where(eq(historicalTickets.ticketId, missingVecRecords[i].ticketId));
        }
      }
    }

    const reranked: SimilarTicketItem[] = shortlist.map((cand) => {
      const fallbackScore =
        preliminaryTop.find((p) => p.ticketId === cand.ticketId)?.similarityScore ?? 0;
      const vec = cand.embeddingJson;
      const sim =
        Array.isArray(vec) && vec.length === targetVec.length
          ? Math.round(computeCosineSimilarity(targetVec, vec) * 1000) / 1000
          : fallbackScore;
      return {
        ticketId: cand.ticketId,
        similarityScore: sim,
        category: cand.category,
        priority: cand.priority,
        clientName: cand.clientName,
        clientTier: cand.clientTier,
        description: cand.description,
        escalatedToEng: cand.escalatedToEng,
        engOutcome: cand.engOutcome,
        engHandoffs: cand.engHandoffs,
        resolutionHours: cand.resolutionHours,
        csatScore: cand.csatScore,
        status: cand.status,
      };
    });

    reranked.sort((a, b) => b.similarityScore - a.similarityScore);
    return {
      items: reranked.slice(0, topK),
      method: `gemini-embedding-2 + tfidf-prefilter`,
    };
  } catch (err) {
    console.warn('Gemini embedding fallback to TF-IDF:', err);
    return null;
  }
}

export interface InvestigationAssistantResult {
  ticketId: string;
  retrievalMethod: string;
  aiSynthesisMode: 'gemini-4-hydrogen' | 'deterministic-evidence-fallback';
  similarTickets: SimilarTicketItem[];
  diagnosisSummary: string;
  suggestedSteps: string[];
  draftHandoff: DraftHandoffPayload;
  confidenceNote: string;
  historicalPatternStats: {
    sampleCount: number;
    escalatedCount: number;
    fixedCount: number;
    insufficientInfoCount: number;
    configReturnCount: number;
    duplicateCount: number;
    notABugCount: number;
  };
}

export async function runAiInvestigation(params: {
  ticketId: string;
  actorUserId: number;
  customQuery?: string;
}): Promise<InvestigationAssistantResult> {
  const targetRows = await db
    .select()
    .from(historicalTickets)
    .where(eq(historicalTickets.ticketId, params.ticketId))
    .limit(1);

  const target = targetRows[0];
  if (!target) {
    throw new Error(`Ticket ${params.ticketId} not found.`);
  }

  // Gather live workflow context if adopted
  const wfRows = await db
    .select()
    .from(workflowTickets)
    .where(eq(workflowTickets.ticketId, params.ticketId))
    .limit(1);
  const workflow = wfRows[0] ?? null;

  let completedChecksSummary = 'No live ResolveIQ checklist items completed yet.';
  if (workflow) {
    const checklistRows = await db
      .select()
      .from(diagnosticChecklists)
      .where(eq(diagnosticChecklists.category, target.category))
      .limit(1);
    if (checklistRows[0]) {
      const items = await db
        .select()
        .from(checklistItems)
        .where(eq(checklistItems.checklistId, checklistRows[0].id));
      const results = await db
        .select()
        .from(investigationCheckResults)
        .where(eq(investigationCheckResults.workflowTicketId, workflow.id));
      const resMap = new Map(results.map((r) => [r.checklistItemId, r]));
      const lines = items.map((it) => {
        const res = resMap.get(it.id);
        return `- ${it.label}: ${res?.result ?? 'pending'}${res?.notes ? ` (${res.notes})` : ''}`;
      });
      completedChecksSummary = lines.join('\n');
    }
  }

  const allCandidates = await db
    .select()
    .from(historicalTickets)
    .where(ne(historicalTickets.ticketId, params.ticketId));

  const queryTarget = params.customQuery?.trim()
    ? { ...target, description: `${target.description} ${params.customQuery.trim()}` }
    : target;

  const tfidfShortlist = await computeTfIdfSimilarTickets(queryTarget, allCandidates, 20);
  const embeddingResult = await tryGeminiEmbeddingRerank(
    queryTarget,
    allCandidates,
    tfidfShortlist,
    6
  );

  const similarTickets = embeddingResult
    ? embeddingResult.items
    : tfidfShortlist.slice(0, 6);
  const retrievalMethod = embeddingResult
    ? embeddingResult.method
    : 'tfidf-bigram-cosine-similarity';

  const escalatedMatches = similarTickets.filter((t) => t.escalatedToEng);
  const fixedCount = similarTickets.filter((t) => t.engOutcome === 'Fixed').length;
  const insufficientInfoCount = similarTickets.filter(
    (t) => t.engOutcome === 'Insufficient info - returned to L1'
  ).length;
  const configReturnCount = similarTickets.filter(
    (t) => t.engOutcome === 'Config issue - returned to L1'
  ).length;
  const duplicateCount = similarTickets.filter(
    (t) => t.engOutcome === 'Duplicate of known issue'
  ).length;
  const notABugCount = similarTickets.filter(
    (t) => t.engOutcome === 'Not a bug - how-to'
  ).length;

  const patternStats = {
    sampleCount: similarTickets.length,
    escalatedCount: escalatedMatches.length,
    fixedCount,
    insufficientInfoCount,
    configReturnCount,
    duplicateCount,
    notABugCount,
  };

  // Build deterministic baseline synthesis (guaranteed available even without Gemini API key)
  const topIds = similarTickets.slice(0, 3).map((t) => t.ticketId).join(', ');
  let diagnosisSummary = `Retrieved ${similarTickets.length} semantically similar historical tickets (top matches: ${topIds}) in "${target.category}". Among these similar records, ${escalatedMatches.length} were escalated to Engineering (${fixedCount} Fixed, ${insufficientInfoCount} returned for insufficient info, ${configReturnCount} returned as configuration issues, ${duplicateCount} marked duplicate). Historical records lack L1 diagnostic transcripts, so verify configuration and telemetry checks before escalating.`;

  let suggestedSteps: string[] = [
    `AI-recommended (not yet executed): Reproduce or verify "${target.description}" using the approved ${target.category} checklist and log exact timestamps (IST).`,
    configReturnCount > 0
      ? `AI-recommended (not yet executed): Check client-level configuration settings first — ${configReturnCount} of ${similarTickets.length} similar historical tickets were returned to L1 as configuration issues.`
      : `AI-recommended (not yet executed): Verify client account tier (${target.clientTier}) settings and recent rule changes.`,
    insufficientInfoCount > 0
      ? `AI-recommended (not yet executed): Attach concrete IDs, screenshots, and payload/error traces — ${insufficientInfoCount} similar historical escalations were returned for insufficient information.`
      : `AI-recommended (not yet executed): Document expected vs observed behavior and reproduction frequency before engineering handoff.`,
  ];

  let draftHandoff: DraftHandoffPayload = {
    problemSummary: `[${target.ticketId}] ${target.category} — ${target.description} (Client: ${target.clientName}, ${target.clientTier}, ${target.priority})`,
    businessImpact: `${target.priority} operational impact reported via ${target.channel} by ${target.clientName} (${target.clientTier} tier).`,
    expectedBehavior: `Standard ${target.category} workflow completes accurately without operational interruption for ${target.clientName}.`,
    actualBehavior: `${target.description}${workflow?.investigationNotes ? ` | L1 observation: ${workflow.investigationNotes}` : ''}`,
    stepsPerformed: workflow
      ? `Completed approved checklist checks:\n${completedChecksSummary}`
      : 'Pending L1 investigation checklist execution in ResolveIQ.',
    diagnosticEvidence: workflow?.evidenceSummary
      ? `${workflow.evidenceSummary} | Historical precedent cited: ${topIds}`
      : `Historical precedent cited: ${topIds}. Attach trip/employee/export IDs and error trace before final submission.`,
  };

  let confidenceNote = `Grounded on ${similarTickets.length} retrieved historical tickets via ${retrievalMethod}. Note: Historical CSV records contain one-line descriptions and final engineering verdicts, not original L1 troubleshooting transcripts; treat recommendations as investigative guidance rather than confirmed root cause.`;
  let aiSynthesisMode: 'gemini-4-hydrogen' | 'deterministic-evidence-fallback' =
    'deterministic-evidence-fallback';

  const ai = getGenAIClient();
  if (ai) {
    try {
      const prompt = `You are an L1/L2 Support Investigation Copilot for RideOps (corporate employee transportation SaaS).
Strictly analyze the current ticket and ONLY the retrieved historical evidence below.
IMPORTANT GUARDRAILS:
- Do NOT claim historical root causes beyond what is stated in descriptions and eng_outcome fields.
- Explicitly mark all suggested steps as AI-recommended (not yet completed).
- If similar tickets show "Insufficient info - returned to L1" or "Config issue - returned to L1", explicitly warn the agent what evidence or config checks are needed.
- Never fabricate logs, trip IDs, or engineering ticket fixes.

Current Ticket:
- ID: ${target.ticketId}
- Category: ${target.category}
- Priority: ${target.priority}
- Client: ${target.clientName} (${target.clientTier})
- Channel: ${target.channel}
- Description: ${target.description}
- Agent Custom Focus: ${params.customQuery || 'None'}

Current Live ResolveIQ Investigation Notes:
${workflow?.investigationNotes || 'None recorded yet'}

Current Checklist Status:
${completedChecksSummary}

Retrieved Similar Historical Tickets:
${similarTickets
  .map(
    (s) =>
      `* ${s.ticketId} (sim=${s.similarityScore}): "${s.description}" | Escalated=${s.escalatedToEng ? 'Yes' : 'No'} | Outcome=${s.engOutcome ?? 'N/A'} | Handoffs=${s.engHandoffs} | ResHrs=${s.resolutionHours ?? 'Open'}`
  )
  .join('\n')}`;

      const response = await ai.models.generateContent({
        model: GEMINI_CHAT_MODEL,
        contents: prompt,
        config: {
          temperature: 0.2,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              diagnosisSummary: { type: Type.STRING },
              suggestedSteps: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
              confidenceNote: { type: Type.STRING },
              draftHandoff: {
                type: Type.OBJECT,
                properties: {
                  problemSummary: { type: Type.STRING },
                  businessImpact: { type: Type.STRING },
                  expectedBehavior: { type: Type.STRING },
                  actualBehavior: { type: Type.STRING },
                  stepsPerformed: { type: Type.STRING },
                  diagnosticEvidence: { type: Type.STRING },
                },
                required: [
                  'problemSummary',
                  'businessImpact',
                  'expectedBehavior',
                  'actualBehavior',
                  'stepsPerformed',
                  'diagnosticEvidence',
                ],
              },
            },
            required: [
              'diagnosisSummary',
              'suggestedSteps',
              'confidenceNote',
              'draftHandoff',
            ],
          },
        },
      });

      const rawText = response.text;
      if (rawText) {
        const parsed = JSON.parse(rawText) as {
          diagnosisSummary: string;
          suggestedSteps: string[];
          confidenceNote: string;
          draftHandoff: DraftHandoffPayload;
        };
        diagnosisSummary = parsed.diagnosisSummary || diagnosisSummary;
        if (Array.isArray(parsed.suggestedSteps) && parsed.suggestedSteps.length > 0) {
          suggestedSteps = parsed.suggestedSteps;
        }
        confidenceNote = parsed.confidenceNote || confidenceNote;
        if (parsed.draftHandoff) {
          draftHandoff = parsed.draftHandoff;
        }
        aiSynthesisMode = 'gemini-4-hydrogen';
      }
    } catch (err) {
      console.warn('Gemini diagnosis generation fallback to deterministic synthesis:', err);
    }
  }

  // Persist AI analysis record in PostgreSQL for auditability
  await db.insert(aiAnalyses).values({
    workflowTicketId: workflow?.id ?? null,
    ticketId: target.ticketId,
    retrievalMethod: `${retrievalMethod} (${aiSynthesisMode})`,
    similarTicketsJson: similarTickets,
    diagnosisSummary,
    suggestedStepsJson: suggestedSteps,
    draftHandoffJson: draftHandoff,
    confidenceNote,
    createdByUserId: params.actorUserId,
  });

  return {
    ticketId: target.ticketId,
    retrievalMethod,
    aiSynthesisMode,
    similarTickets,
    diagnosisSummary,
    suggestedSteps,
    draftHandoff,
    confidenceNote,
    historicalPatternStats: patternStats,
  };
}
