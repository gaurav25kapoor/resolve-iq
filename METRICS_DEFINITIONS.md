# ResolveIQ Metrics Definitions & Analytical Guardrails

All historical KPIs are derived deterministically from `/public/assets/aistudio/rideops_support_tickets_00617967.csv` (1,444 tickets, Jul 2 – Sep 30, 2026, IST) via `src/server/analytics.ts`.

---

## 1. Historical Dataset Metrics (Verified Counts)

| Metric | Definition & Formula | Verified Value |
| :--- | :--- | :--- |
| **Total Historical Tickets** | Count of rows in `historical_tickets` | **1,444** |
| **Unique Corporate Clients** | Distinct `client_id` values | **191** |
| **Monthly Ticket Arrivals** | Count grouped by `YYYY-MM` of `created_at` | **Jul: 390 · Aug: 462 · Sep: 592** (+51.8% intake growth) |
| **Open Ticket Snapshot** | Rows where `status != 'Closed'` as of Sep 30, 2026 pull | **48** (`29` Open - with L1, `19` Open - with Engineering) |
| **Engineering Escalation Rate** | `COUNT(escalated_to_eng = true) / Total Tickets` | **33.7%** (`486` Yes / `958` No) |
| **Insufficient Info Returns** | `eng_outcome = 'Insufficient info - returned to L1'` | **89** (`18.3%` of escalated) |
| **Configuration Returns** | `eng_outcome = 'Config issue - returned to L1'` | **84** (`17.3%` of escalated) |
| **Combined L1 Bounce Returns** | Insufficient Info + Config Returns / Escalated | **173** (`35.6%` of escalated) |
| **Other Engineering Outcomes** | Fixed (`211`, 43.4%), Duplicate (`56`, 11.5%), Not a bug (`24`, 4.9%), Not reproducible (`22`, 4.5%) | Total **486** |
| **Multi-Handoff Escalations** | `eng_handoffs > 1` (`2` handoffs: 167, `3` handoffs: 62) | **229** (`47.1%` of escalated) |
| **Resolution Time (Closed, n=1,396)** | `final_closed_at - created_at` in hours (open tickets excluded) | Overall mean **45.80h**, median **22.31h** |
| **Escalated vs Non-Escalated Resolution** | Split by `escalated_to_eng` across closed tickets | Escalated: **99.79h** mean / **86.78h** median; Non-escalated: **19.96h** mean / **12.57h** median |
| **CSAT Coverage & Average** | Non-null `csat_score` (`1–5`) count & mean (blanks excluded) | **648** rated (**44.9%** coverage), mean **3.70 / 5.0** |

### Top Escalation Categories
- `Live tracking / GPS incorrect`: **127 / 228 (55.7%)**
- `Roster / booking not syncing`: **175 / 344 (50.9%)**
- `Report export failing`: **77 / 206 (37.4%)**
- `OTP / boarding issue`: **34 / 95 (35.8%)**

---

## 2. Mandatory Analytical Limitations

1. **Single Open-Ticket Snapshot**: The dataset captures ticket `status` once on `2026-09-30`. Historical backlog growth over time cannot be calculated from this snapshot.
2. **Arrivals vs. Backlog**: Monthly arrival increases (`390 → 462 → 592`) measure new intake demand, not accumulated backlog.
3. **Missing CSAT Exclusion**: 796 tickets have blank `csat_score`. Blanks are strictly excluded from averages and never imputed as `0`.
4. **Correlation ≠ Causation**: Long resolution times and escalated tickets show lower average CSAT descriptively, which does not establish single-factor causation.
5. **No Invented Historical Activity**: Because the CSV lacks L1 investigation transcripts, ResolveIQ never fabricates historical check outcomes and never assumes 100% of configuration or insufficient-info returns were avoidable.

---

## 3. Live ResolveIQ Metrics (Separated)

Computed exclusively from `workflow_tickets`, `investigation_check_results`, `diagnostic_checklists`, and `engineering_escalations`:
- **Adopted Workflows**, **Assigned Investigations**, **Checklist Results Recorded (Pass / Fail / N/A)**, **Checklists Approved vs Pending Approval**, **Live Escalations Submitted**, **Live Returns to L1**, and **Documented Engineering Outcomes Recorded**.
