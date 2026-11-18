# ResolveIQ AI Similarity Retrieval & Diagnosis Design

## Hybrid Retrieval Pipeline (`src/server/ai.ts`)

1. **Candidate Corpus**: Queries all historical RideOps tickets (`historical_tickets`, excluding the target ticket itself).
2. **Stage 1 — Deterministic TF-IDF + Bigram Cosine Prefilter**:
   - Tokenizes `category + description + priority`, removes stop words, constructs unigrams + bigrams, computes corpus-wide IDF weights, and scores cosine similarity with a calibrated category alignment factor.
   - Selects the top 20 candidates.
3. **Stage 2 — Gemini Semantic Embedding Reranker (`gemini-embedding-2`)**:
   - When `GEMINI_API_KEY` is configured on the server, generates vector embeddings via `@google/genai` (`ai.models.embedContent`) for the target ticket and caches embeddings in `historical_tickets.embedding_json` (PostgreSQL `jsonb`).
   - Re-ranks the shortlist by exact cosine similarity and returns the top 6 matches.
   - If `GEMINI_API_KEY` is absent or an API call fails, gracefully falls back to Stage 1 TF-IDF cosine scores so all workflows remain operational.

---

## Grounded Contextual Diagnosis & Handoff Drafting

1. **Prompt Grounding**:
   - Supplies `gemini-4-hydrogen` with ONLY the target ticket metadata, live ResolveIQ investigation notes/checklist progress (if adopted), and the 6 retrieved historical matches (including `ticket_id`, `description`, `escalated_to_eng`, `eng_outcome`, `eng_handoffs`, and `resolution_hours`).
   - Enforces strict JSON schema output (`diagnosisSummary`, `suggestedSteps`, `confidenceNote`, `draftHandoff`).
2. **Hallucination & Uncertainty Guardrails**:
   - Prompts explicitly forbid fabricating L1 diagnostic transcripts, logs, or root causes absent from the CSV.
   - All recommended troubleshooting actions are explicitly prefixed/labeled as **AI-recommended (not yet executed)**.
   - Whenever retrieved matches include `Insufficient info - returned to L1` or `Config issue - returned to L1`, the synthesis explicitly highlights those return risks so L1 verifies configuration and attaches concrete evidence before escalating.
3. **Fallback Mode (`deterministic-evidence-fallback`)**:
   - Without a Gemini API key, ResolveIQ produces a structured pattern summary directly from the retrieved similarity matches and populates a clean `draftHandoff` template.
4. **Auditability**:
   - Every AI analysis run is persisted in `ai_analyses` and logged in `audit_logs` (`AI_INVESTIGATION_RUN`) with its retrieval method and synthesis mode.
