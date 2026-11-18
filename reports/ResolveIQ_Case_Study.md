# ResolveIQ — Improving the Support-to-Engineering Handoff at RideOps

## 1. Understanding the problem

RideOps has a support-to-engineering handoff problem, not simply a staffing problem. The historical snapshot contains 1,444 support tickets across 191 corporate clients from 2 July to 30 September 2026. Of these, 486 were escalated to Engineering. 89 escalations were returned for insufficient information and 84 for configuration issues: 173 returns, or 35.6% of escalations, where the recorded outcome sent work back to L1.

That pattern matters because an escalation can consume Engineering time without moving the customer issue forward. It also sends the support agent back into the case with a new information request. The dataset does not prove that every return was avoidable, but it does identify a practical place to improve the handoff: make the investigation and evidence expectations clearer before submission.

The volume trend adds pressure but needs careful interpretation. Monthly arrivals increased from 390 in July to 462 in August and 592 in September. That is intake growth, not proof of backlog growth. The source contains one open-ticket snapshot on 30 September, with 48 tickets open (29 with L1 and 19 with Engineering); it cannot establish how the backlog changed over time.

Resolution time also points to a coordination problem without proving a single bottleneck. Closed escalated tickets had a median resolution time of 86.78 hours, compared with 12.57 hours for non-escalated tickets. This is a descriptive difference: escalated work may be more complex, require more coordination, or arrive with less evidence. It does not demonstrate that Engineering alone causes the delay.

CSAT is incomplete. 648 tickets have a recorded score, with a mean of 3.70/5; the remaining 796 blank values were excluded rather than treated as zero. This makes the score useful as a signal, but not as a complete customer-quality measure.

The stakeholder views are consistent but different:

- Meera, Support Lead, needs visibility into adopted work and handoff quality.
- Sandeep, Engineering User, needs escalations that contain enough evidence to act on and a clear way to return incomplete work.
- Ritika, Head of Operations, needs fewer avoidable loops and better control of the open-ticket workload without immediately adding headcount.

I chose to solve the point where these concerns meet: help L1 agents perform a structured, evidence-carrying investigation before an escalation reaches Engineering.

<!-- PAGE BREAK -->

## 2. My decision and what I built

Within a 72-hour take-home assignment, I deliberately did not attempt to automate the whole support operation. I focused on the investigation-to-handoff boundary because it is narrow enough to implement, observable enough to measure, and directly connected to the 173 recorded insufficient-information and configuration returns.

ResolveIQ is an investigation and engineering handoff workspace. It keeps the historical ticket dataset as evidence, while storing new actions in separate live workflow tables. The product is intended to make the next investigation step explicit and make an escalation reviewable by someone who did not perform the original troubleshooting.

The user journey is:

1. An L1 agent searches the historical ticket inbox and opens a ticket.
2. A Support Lead adopts the ticket into the live ResolveIQ workflow and assigns it to an agent.
3. The agent reviews the ticket's category, priority, client context, status, and historical outcome.
4. The agent follows the category-specific diagnostic checklist. Check results are recorded as Pass, Fail, or N/A with notes and evidence references.
5. The agent records investigation notes and a structured evidence summary without changing the source ticket.
6. The AI Assistant retrieves similar historical incidents and presents a grounded diagnosis summary, uncertainty note, and suggested next steps.
7. The agent reviews the AI output; suggested steps are explicitly marked as recommended and not yet executed.
8. When the backend gates are satisfied, the agent submits a structured Engineering handoff covering impact, expected and actual behaviour, steps performed, and diagnostic evidence.
9. Sandeep reviews the handoff, records an engineering outcome, or returns it to L1 with a mandatory reason. A later handoff is tracked separately.

Each stage has a practical purpose. Adoption and assignment create ownership. The checklist makes category-specific investigation visible. Notes and evidence make the work auditable. Similar-ticket retrieval helps an agent find patterns without treating historical outcomes as a diagnosis. The handoff schema gives Engineering a consistent starting point, while the review step keeps the decision with a human.

The implementation includes demo personas for Platform Admin, Support Manager, Engineering Manager, and Support Agents. Role and client-scope checks run on the backend, so the interface is not the security boundary. Proposed checklists are labelled as requiring Operations approval; a support agent cannot submit against an unapproved checklist or an incomplete mandatory checklist.

No real application screenshots are included in this case study. The repository contains no verified screenshot set that I could use without creating a misleading representation of the product.

<!-- PAGE BREAK -->

## 3. How the solution works

The frontend is React 19 with TypeScript, Tailwind CSS, Recharts, and Lucide icons. An Express and TypeScript server exposes the REST API. PostgreSQL on Render stores both the immutable historical baseline and live ResolveIQ activity, accessed through Drizzle ORM. Authentication supports demo credentials and Firebase-backed Google SSO. Authorization is enforced through role checks and client-level access checks in the API.

The data model separates `historical_tickets` from `workflow_tickets`, checklist results, AI analyses, engineering escalations, and audit logs. Historical rows preserve the 20 source fields and are never overwritten by workflow actions. A workflow ticket links to a historical ticket; new notes, evidence, checks, handoffs, outcomes, and audit entries live in the live tables. Historical and live analytics are exposed as separate boundaries.

The AI path is hybrid and deliberately reviewable:

1. The agent submits a ticket investigation request.
2. Deterministic TF-IDF with unigrams and bigrams scores the historical corpus using category, description, and priority, then selects the top 20 candidates.
3. If a Gemini API key is available, `gemini-embedding-2` reranks that shortlist by vector cosine similarity and returns the top six matches. Embeddings are cached in PostgreSQL.
4. The selected historical records provide context: descriptions, categories, priorities, escalation status, outcomes, handoff counts, and resolution times.
5. `gemini-4-hydrogen` produces structured diagnosis, suggested steps, an uncertainty note, and draft handoff fields.
6. The agent reviews the result before acting. The UI distinguishes historical facts from AI recommendations.
7. If Gemini is unavailable, the deterministic TF-IDF path and evidence-based synthesis fallback keep the workflow operational.

The prompt prohibits invented logs, root causes, or historical investigation transcripts. This is important because the CSV records outcomes, not the missing steps that led to them. AI output is assistance, not verified fact; the agent still has to perform the checks, attach evidence, and satisfy backend validation.

Data integrity was verified against the source CSV and after a second seed run: 1,444 tickets were imported for 191 clients; all 20 source fields matched; there were no source-field mismatches, orphaned client references, duplicate ticket IDs, normalized-field mismatches, or analytics mismatches. The second import produced identical counts. The verification also confirmed 20/20 foreign keys, 23/23 valid indexes, and zero workflow, checklist-result, escalation, AI-analysis, or ticket-linked audit rows after cleanup of the test workflow.

The API workflow was verified with live authentication and authorization checks. All five demo personas authenticated. Historical analytics returned 1,444 tickets, 191 clients, 486 escalations, 48 open snapshot tickets, and monthly arrivals of 390, 462, and 592. Negative checks returned 403 for unauthorized checklist approval, manager escalation attempts, and a scoped user's out-of-scope ticket. The workflow test exercised adoption, assignment, checklist results, notes, AI analysis, escalation, duplicate prevention, Engineering review, return-to-L1, re-escalation, analytics, and audit logging; its synthetic records were removed afterward. This is API/integration evidence, not a claim of full browser automation: the retained test report records that no interactive browser automation was available for that verification run.

Remaining limitations are intentional. The historical dataset has one open snapshot and no investigation transcripts, so it cannot prove backlog movement or the avoidability of every return. The AI quality has not yet been evaluated on a labelled retrieval set. Gemini availability changes the retrieval and synthesis mode. The product currently demonstrates the workflow; it has not yet demonstrated an operational improvement in production.

<!-- PAGE BREAK -->

## 4. Measuring success and the next four weeks

The primary success measure should be first-pass Engineering handoff acceptance rate: the proportion of submitted escalations that Engineering can accept for investigation without returning to L1 for missing information or configuration checks. This is more useful than simply counting escalations. A lower escalation count could mean better investigation, but it could also mean under-escalation. Acceptance measures whether the handoff is useful at the point where Engineering receives it.

Supporting measures should include:

- insufficient-information return rate and configuration-return rate;
- checklist adoption, completion, and mandatory-item completion;
- time to first Engineering action;
- median resolution time, split by escalated and non-escalated work;
- reopened tickets;
- open-ticket count, tracked as a repeated time series rather than a single snapshot;
- CSAT coverage and score, reported with missing values kept separate.

The following are proposed targets for a pilot, not achieved results: establish a baseline in Week 1; reduce first-pass returns by 15% relative to that baseline by the end of the pilot; reach 80% checklist completion on eligible escalations; capture a first-action timestamp for at least 95% of Engineering handoffs; and maintain CSAT coverage reporting without imputing blanks. These targets should be revised after the team sees the baseline and the quality of the labelled data.

### Four-week plan

**Week 1 — Pilot readiness.** Validate usability with Support and Engineering, test role and client permissions, confirm checklist ownership and approval, and record the baseline for handoff acceptance, return reasons, and time to first action.

**Week 2 — Instrumentation.** Add or verify timestamps for handoff submission and first Engineering action. Standardise return reasons and capture whether the returned work was resubmitted. Review the first live workflow records for missing fields or confusing checklist guidance.

**Week 3 — Retrieval evaluation.** Build a labelled set of historical ticket pairs or relevance judgements. Compare TF-IDF-only, embedding-only, and hybrid retrieval using a clear metric such as top-six recall or judged relevance. Inspect failure cases by category rather than relying only on an aggregate score.

**Week 4 — Decision.** Compare pilot results with baseline, review the quality of accepted and returned handoffs, and decide whether to expand, revise, or stop. Expansion should depend on evidence that the workflow improves handoff quality without creating unacceptable checklist overhead.

I deliberately did not build autonomous ticket closure, automatic escalation without human approval, microservices or unnecessary infrastructure, fabricated historical investigation data, or advanced automation before collecting evidence. These omissions are part of the design: the first version should make the decision and its consequences visible before it tries to remove people from the loop.

ResolveIQ currently solves a concrete process problem: it gives L1 a structured investigation path and gives Engineering a more consistent, auditable handoff. What remains to be proven is whether that structure improves first-pass acceptance, reduces return loops, and helps the open-ticket workload over time. The next four weeks are designed to answer those questions with operational evidence rather than product claims.

