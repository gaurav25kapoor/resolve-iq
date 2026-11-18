import React, { useEffect, useState } from 'react';
import { ArrowRight, Bot, Sparkles } from 'lucide-react';
import { apiRequest } from '../lib/api.ts';
import type { AiAnalysisResponse, TicketListItem } from '../types/index.ts';

interface AIAssistantPageProps {
  onOpenTicket: (ticketId: string) => void;
}

export function AIAssistantPage({ onOpenTicket }: AIAssistantPageProps) {
  const [ticketOptions, setTicketOptions] = useState<TicketListItem[]>([]);
  const [selectedTicketId, setSelectedTicketId] = useState('SUP-10001');
  const [customQuery, setCustomQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AiAnalysisResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiRequest<{ tickets: TicketListItem[] }>('/api/tickets?page=1&pageSize=30')
      .then((res) => {
        setTicketOptions(res.tickets);
        if (res.tickets[0]) {
          setSelectedTicketId(res.tickets[0].ticketId);
        }
      })
      .catch(() => {});
  }, []);

  const handleAnalyze = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTicketId.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest<AiAnalysisResponse>(
        `/api/ai/investigate/${selectedTicketId.trim().toUpperCase()}`,
        {
          method: 'POST',
          body: JSON.stringify({ customQuery }),
        }
      );
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI analysis failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-display font-bold text-slate-900">
          AI Investigation Assistant
        </h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Semantic similarity retrieval over 1,444 historical RideOps tickets with grounded diagnosis and draft engineering handoffs.
        </p>
      </div>

      <form
        onSubmit={handleAnalyze}
        className="bg-white border border-slate-200 rounded-lg p-5 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-12 gap-4 items-end"
      >
        <div className="md:col-span-2">
          <label className="block text-xs font-medium text-slate-700 mb-1">
            Ticket ID
          </label>
          <div>
            <input
              type="text"
              value={selectedTicketId}
              onChange={(e) => setSelectedTicketId(e.target.value)}
              placeholder="SUP-10004"
              className="w-full min-w-0 px-3 py-2 text-sm font-mono border border-slate-300 rounded-md"
            />
            <select
              value={selectedTicketId}
              onChange={(e) => setSelectedTicketId(e.target.value)}
              className="hidden"
            >
              {ticketOptions.map((t) => (
                <option key={t.ticketId} value={t.ticketId}>
                  {t.ticketId} · {t.category}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="md:col-span-3">
          <label className="block text-xs font-medium text-slate-700 mb-1">
            Ticket dropdown
          </label>
          <select
            value={selectedTicketId}
            onChange={(e) => setSelectedTicketId(e.target.value)}
            className="w-full min-w-0 px-2.5 py-2 text-xs border border-slate-300 rounded-md bg-white"
          >
            {ticketOptions.map((t) => (
              <option key={t.ticketId} value={t.ticketId}>
                {t.ticketId} · {t.category}
              </option>
            ))}
          </select>
        </div>

        <div className="sm:col-span-2 md:col-span-5">
          <label className="block text-xs font-medium text-slate-700 mb-1">
            Additional Investigation Context (Optional)
          </label>
          <input
            type="text"
            value={customQuery}
            onChange={(e) => setCustomQuery(e.target.value)}
            placeholder="e.g., intermittent telemetry drop on Android v4.12 or roster cutoff mismatch..."
            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
          />
        </div>

        <div className="sm:col-span-2 md:col-span-2">
          <button
            type="submit"
            disabled={loading}
            className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-md bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 cursor-pointer"
          >
            <Sparkles className="w-4 h-4" />
            {loading ? 'Analyzing...' : 'Analyze'}
          </button>
        </div>
      </form>

      {error && (
        <div className="p-3 rounded-md bg-rose-50 border border-rose-200 text-xs text-rose-700">
          {error}
        </div>
      )}

      {!result ? (
        <div className="bg-white border border-slate-200 rounded-lg p-10 text-center space-y-2">
          <Bot className="w-7 h-7 text-indigo-500 mx-auto" />
          <div className="text-sm font-medium text-slate-900">
            Select a ticket and run semantic investigation
          </div>
          <p className="text-xs text-slate-500 max-w-lg mx-auto">
            ResolveIQ ranks historical tickets using Gemini embeddings (with TF-IDF bigram cosine fallback) and synthesizes evidence-grounded recommendations while clearly separating historical facts from suggested steps.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Diagnosis & Draft Handoff */}
          <div className="lg:col-span-7 space-y-5">
            <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-base font-display font-semibold text-slate-900">
                    Contextual Diagnosis · <span className="font-mono">{result.ticketId}</span>
                  </h2>
                  <div className="text-xs font-mono text-slate-500 mt-0.5">
                    {result.retrievalMethod} · {result.aiSynthesisMode}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onOpenTicket(result.ticketId)}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md border border-slate-300 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  Open Ticket Workspace
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>

              <p className="text-sm text-slate-700 leading-relaxed">
                {result.diagnosisSummary}
              </p>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 border-t border-slate-100 text-xs">
                <div>
                  <div className="text-slate-400">Matches Escalated</div>
                  <div className="font-mono font-semibold text-slate-900">
                    {result.historicalPatternStats.escalatedCount} /{' '}
                    {result.historicalPatternStats.sampleCount}
                  </div>
                </div>
                <div>
                  <div className="text-slate-400">Fixed by Eng</div>
                  <div className="font-mono font-semibold text-emerald-700">
                    {result.historicalPatternStats.fixedCount}
                  </div>
                </div>
                <div>
                  <div className="text-slate-400">Insufficient Info Returns</div>
                  <div className="font-mono font-semibold text-amber-700">
                    {result.historicalPatternStats.insufficientInfoCount}
                  </div>
                </div>
                <div>
                  <div className="text-slate-400">Config Returns</div>
                  <div className="font-mono font-semibold text-amber-700">
                    {result.historicalPatternStats.configReturnCount}
                  </div>
                </div>
              </div>

              <div className="space-y-1.5 pt-2 border-t border-slate-100">
                <div className="text-xs font-semibold text-slate-800">
                  AI-Recommended Next Steps (Not Yet Executed)
                </div>
                <ul className="text-xs text-slate-700 space-y-1 list-disc pl-4">
                  {result.suggestedSteps.map((s, idx) => (
                    <li key={idx}>{s}</li>
                  ))}
                </ul>
              </div>

              <div className="p-3 rounded-md bg-slate-50 border border-slate-200 text-xs text-slate-600">
                <strong>Uncertainty & Data Limitations:</strong> {result.confidenceNote}
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-3">
              <h3 className="text-sm font-display font-semibold text-slate-900">
                Draft Engineering Handoff Preview
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div>
                  <div className="font-medium text-slate-500">Problem Summary</div>
                  <div className="text-slate-800 mt-0.5">{result.draftHandoff.problemSummary}</div>
                </div>
                <div>
                  <div className="font-medium text-slate-500">Business Impact</div>
                  <div className="text-slate-800 mt-0.5">{result.draftHandoff.businessImpact}</div>
                </div>
                <div>
                  <div className="font-medium text-slate-500">Expected Behavior</div>
                  <div className="text-slate-800 mt-0.5">{result.draftHandoff.expectedBehavior}</div>
                </div>
                <div>
                  <div className="font-medium text-slate-500">Actual Behavior</div>
                  <div className="text-slate-800 mt-0.5">{result.draftHandoff.actualBehavior}</div>
                </div>
                <div className="sm:col-span-2">
                  <div className="font-medium text-slate-500">Steps Performed</div>
                  <div className="text-slate-800 mt-0.5 whitespace-pre-line">
                    {result.draftHandoff.stepsPerformed}
                  </div>
                </div>
                <div className="sm:col-span-2">
                  <div className="font-medium text-slate-500">Diagnostic Evidence</div>
                  <div className="text-slate-800 mt-0.5">
                    {result.draftHandoff.diagnosticEvidence}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Retrieved Historical Matches */}
          <div className="lg:col-span-5 bg-white border border-slate-200 rounded-lg p-5 space-y-3">
            <h3 className="text-sm font-display font-semibold text-slate-900">
              Retrieved Similar Historical Tickets
            </h3>
            <div className="divide-y divide-slate-200">
              {result.similarTickets.map((t) => (
                <div key={t.ticketId} className="py-3 space-y-1 text-xs">
                  <div className="flex items-center justify-between font-mono">
                    <button
                      type="button"
                      onClick={() => onOpenTicket(t.ticketId)}
                      className="font-semibold text-indigo-600 hover:text-indigo-800 cursor-pointer"
                    >
                      {t.ticketId}
                    </button>
                    <span className="text-slate-600">
                      Similarity {(t.similarityScore * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div className="text-slate-800 font-medium">{t.description}</div>
                  <div className="text-slate-500 font-mono">
                    {t.category} · {t.priority} · {t.clientName} ({t.clientTier})
                  </div>
                  <div className="text-slate-600 font-mono">
                    {t.escalatedToEng
                      ? `Escalated (${t.engHandoffs}x) · Outcome: ${t.engOutcome || 'Open'}`
                      : 'Not escalated (L1)'}{' '}
                    · {t.resolutionHours !== null ? `${t.resolutionHours}h` : 'Open'}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
