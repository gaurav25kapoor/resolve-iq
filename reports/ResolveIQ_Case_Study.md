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

Within a 72-hour take-home assignment, I did not attempt to automate the whole support operation. I focused on the investigation-to-handoff boundary because it is practical to implement, observable to measure, and directly connected to the 173 recorded insufficient-information and configuration returns.

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

Adoption and assignment create ownership; the checklist makes investigation visible; notes and evidence make the work auditable; retrieval helps an agent find patterns without treating historical outcomes as a diagnosis; and the handoff schema gives Engineering a consistent starting point while keeping the decision with a human.

The implementation includes Platform Admin, Support Manager, Engineering Manager, and Support Agent personas. Role and client-scope checks run on the backend. Proposed checklists require Operations approval; a support agent cannot submit against an unapproved or incomplete mandatory checklist.

No real application screenshots are included in this case study. The repository contains no verified screenshot set that I could use without creating a misleading representation of the product.

<!-- PAGE BREAK -->

## 3. How the solution works

The frontend is React 19 with TypeScript, Tailwind CSS, Recharts, and Lucide icons. Express and TypeScript expose the REST API. PostgreSQL on Render stores the immutable baseline and live activity through Drizzle ORM. Authentication supports demo credentials and Firebase Google SSO; authorization is enforced in the API.

The data model separates `historical_tickets` from `workflow_tickets`, checklist results, AI analyses, escalations, and audit logs. Historical rows preserve all 20 source fields and are never overwritten. A workflow ticket links to a historical ticket; notes, evidence, checks, handoffs, outcomes, and audit entries live in the live tables. Historical and live analytics remain separate.

The AI path is hybrid and reviewable:

1. The agent submits a ticket investigation request.
2. Deterministic TF-IDF unigrams/bigrams score category, description, and priority, selecting 20 candidates.
3. When configured, `gemini-embedding-2` reranks those candidates by cosine similarity and returns six; vectors are cached in PostgreSQL.
4. The selected records provide descriptions, outcomes, escalation status, handoff counts, and resolution times.
5. `gemini-4-hydrogen` produces structured diagnosis, suggested steps, uncertainty, and draft handoff fields.
6. The agent reviews the output; the UI separates historical facts from recommendations.
7. Without Gemini, deterministic TF-IDF and synthesis fallback keep the workflow operational.

The prompt prohibits invented logs, root causes, or historical transcripts because the CSV records outcomes, not the missing steps. AI output is assistance, not verified fact; the agent must still perform checks, attach evidence, and satisfy backend validation.

Data integrity was verified against the CSV and after a second seed run: 1,444 tickets, 191 clients, all 20 source fields, 20/20 foreign keys, and 23/23 indexes matched. There were no orphan references, duplicate IDs, normalized-field or analytics mismatches. The second import was identical, and test cleanup left zero workflow, checklist-result, escalation, AI-analysis, or ticket-linked audit rows.

API verification covered all five demo logins, historical analytics, and 403 responses for unauthorized checklist approval, manager escalation attempts, and an out-of-scope ticket. The workflow test covered adoption, assignment, checks, notes, AI analysis, escalation, duplicate prevention, Engineering review, return-to-L1, re-escalation, analytics, and audit logging; synthetic records were removed. This is API/integration evidence, not full browser automation; the retained test report records that interactive browser automation was unavailable.

Limitations are intentional: one open snapshot cannot prove backlog movement; absent investigation transcripts mean returns are not all assumed avoidable; AI quality has not yet been evaluated on labelled retrieval data; Gemini availability changes the mode; and the product has not demonstrated an operational improvement in production.

<!-- PAGE BREAK -->

## 4. Measuring success and the next four weeks

The primary success measure should be first-pass Engineering handoff acceptance rate: the share of escalations Engineering can accept without returning them to L1 for missing information or configuration checks. This is more useful than counting escalations, because fewer escalations could also mean under-escalation.

Supporting measures are insufficient-information and configuration-return rates; checklist adoption and completion; time to first Engineering action; median resolution time split by escalation; reopened tickets; open-ticket count tracked as a time series; and CSAT coverage and score with missing values kept separate.

These are proposed, not achieved, pilot targets: establish a Week 1 baseline; reduce first-pass returns by 15%; reach 80% checklist completion; capture first-action timestamps for 95% of handoffs; and report CSAT coverage without imputing blanks. Revise them after baseline review.

### Four-week plan

**Week 1 — Pilot readiness.** Validate usability with Support and Engineering, test role and client permissions, confirm checklist ownership and approval, and record the baseline for handoff acceptance, return reasons, and time to first action.

**Week 2 — Instrumentation.** Add or verify timestamps for handoff submission and first Engineering action. Standardise return reasons and capture whether the returned work was resubmitted. Review the first live workflow records for missing fields or confusing checklist guidance.

**Week 3 — Retrieval evaluation.** Build a labelled set of historical ticket pairs or relevance judgements. Compare TF-IDF-only, embedding-only, and hybrid retrieval using a clear metric such as top-six recall or judged relevance. Inspect failure cases by category rather than relying only on an aggregate score.

**Week 4 — Decision.** Compare pilot results with baseline, review the quality of accepted and returned handoffs, and decide whether to expand, revise, or stop. Expansion should depend on evidence that the workflow improves handoff quality without creating unacceptable checklist overhead.

I deliberately did not build autonomous closure, escalation without human approval, microservices, fabricated investigations, or advanced automation before collecting evidence. The first version makes decisions visible before removing people from the loop.

ResolveIQ gives L1 a structured investigation path and Engineering a consistent, auditable handoff. The four-week plan must still prove whether it improves acceptance, reduces return loops, and helps the open-ticket workload.

