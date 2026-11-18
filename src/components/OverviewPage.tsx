import React, { useEffect, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { AlertCircle, ArrowUpRight, CheckCircle2, Clock, Layers } from 'lucide-react';
import { apiRequest } from '../lib/api.ts';
import type { HistoricalAnalyticsData, LiveAnalyticsData } from '../types/index.ts';
import type { NavPageId } from './Sidebar.tsx';

interface OverviewPageProps {
  onNavigate: (page: NavPageId) => void;
}

export function OverviewPage({ onNavigate }: OverviewPageProps) {
  const [historical, setHistorical] = useState<HistoricalAnalyticsData | null>(null);
  const [live, setLive] = useState<LiveAnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([
      apiRequest<HistoricalAnalyticsData>('/api/analytics/historical'),
      apiRequest<LiveAnalyticsData>('/api/analytics/live'),
    ])
      .then(([histRes, liveRes]) => {
        if (!active) return;
        setHistorical(histRes);
        setLive(liveRes);
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Failed to load overview metrics.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-64 bg-slate-200 rounded animate-pulse" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-28 bg-white border border-slate-200 rounded-lg animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (error || !historical || !live) {
    return (
      <div className="p-4 rounded-lg bg-rose-50 border border-rose-200 text-sm text-rose-700">
        {error || 'Unable to load overview analytics.'}
      </div>
    );
  }

  const { kpis } = historical;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-display font-bold text-slate-900">
            Operational Overview
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Historical RideOps baseline (Jul–Sep 2026) separated from live ResolveIQ workflow execution.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onNavigate('inbox')}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-slate-300 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
          >
            Open Ticket Inbox
            <ArrowUpRight className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onNavigate('analytics')}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-indigo-600 text-xs font-medium text-white hover:bg-indigo-700 cursor-pointer"
          >
            Full Analytics
          </button>
        </div>
      </div>

      {/* Section 1: Historical Baseline KPIs (Traceable to rideops_support_tickets.csv) */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Historical Dataset Baseline · {historical.dataBoundary.source}
          </h2>
          <span className="text-xs font-mono text-slate-500">
            {kpis.uniqueClients} corporate clients
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white border border-slate-200 rounded-lg p-4">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>Historical Tickets</span>
              <Layers className="w-4 h-4 text-slate-400" />
            </div>
            <div className="text-2xl font-display font-bold font-mono tabular-nums text-slate-900 mt-2">
              {kpis.totalTickets.toLocaleString()}
            </div>
            <div className="text-xs text-slate-500 mt-1 font-mono tabular-nums">
              {kpis.closedCount.toLocaleString()} closed · {kpis.openSnapshotCount} open snapshot (Sep 30)
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-lg p-4">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>Engineering Escalation Rate</span>
              <ArrowUpRight className="w-4 h-4 text-indigo-500" />
            </div>
            <div className="text-2xl font-display font-bold font-mono tabular-nums text-slate-900 mt-2">
              {kpis.escalationRate}%
            </div>
            <div className="text-xs text-slate-500 mt-1 font-mono tabular-nums">
              {kpis.escalatedCount} escalated · {kpis.multiHandoffCount} multi-handoff
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-lg p-4">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>Rework Returns (L1 Bounce)</span>
              <AlertCircle className="w-4 h-4 text-amber-500" />
            </div>
            <div className="text-2xl font-display font-bold font-mono tabular-nums text-slate-900 mt-2">
              {(kpis.insufficientInfoShareOfEscPct + kpis.configReturnShareOfEscPct).toFixed(1)}%
            </div>
            <div className="text-xs text-slate-500 mt-1 font-mono tabular-nums">
              {kpis.insufficientInfoReturns} insufficient info · {kpis.configReturns} config returns
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-lg p-4">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>Median Resolution & CSAT</span>
              <Clock className="w-4 h-4 text-slate-400" />
            </div>
            <div className="text-2xl font-display font-bold font-mono tabular-nums text-slate-900 mt-2">
              {kpis.resolutionTimeStats.overallMedianHours ?? '—'}h
            </div>
            <div className="text-xs text-slate-500 mt-1 font-mono tabular-nums">
              Esc: {kpis.resolutionTimeStats.escalatedMedianHours}h vs Non-Esc:{' '}
              {kpis.resolutionTimeStats.nonEscalatedMedianHours}h · CSAT{' '}
              {kpis.avgCsat ?? '—'}/5 ({kpis.csatCoveragePct}% rated)
            </div>
          </div>
        </div>
      </div>

      {/* Section 2: Live ResolveIQ Workflow Activity (Strictly Separated) */}
      <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <h2 className="text-base font-display font-semibold text-slate-900">
              Live ResolveIQ Workflow Activity
            </h2>
            <p className="text-xs text-slate-500">
              {live.dataBoundary.source} · {live.dataBoundary.note}
            </p>
          </div>
          <div className="text-xs font-mono text-slate-600 tabular-nums">
            Checklists Approved: {live.checklistGovernance.approved}/{live.checklistGovernance.total} · Pending Approval: {live.checklistGovernance.pendingApproval}
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 pt-1">
          <div>
            <div className="text-xs text-slate-500">Adopted Tickets</div>
            <div className="text-xl font-mono font-semibold tabular-nums text-slate-900 mt-0.5">
              {live.adoptedTotal}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Assigned to Agents</div>
            <div className="text-xl font-mono font-semibold tabular-nums text-slate-900 mt-0.5">
              {live.assignedTotal}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Checklist Steps Recorded</div>
            <div className="text-xl font-mono font-semibold tabular-nums text-slate-900 mt-0.5">
              {live.checklistResultsSummary.pass +
                live.checklistResultsSummary.fail +
                live.checklistResultsSummary.na}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Live Escalations</div>
            <div className="text-xl font-mono font-semibold tabular-nums text-slate-900 mt-0.5">
              {live.escalationsSummary.totalSubmissions}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Eng Outcomes Recorded</div>
            <div className="text-xl font-mono font-semibold tabular-nums text-slate-900 mt-0.5">
              {live.escalationsSummary.outcomeRecorded}
            </div>
          </div>
        </div>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <div className="mb-4">
            <h3 className="text-sm font-display font-semibold text-slate-900">
              Monthly Ticket Arrivals (Intake Volume, Not Backlog Growth)
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Jul–Sep 2026 arrival volume split by engineering escalation flag.
            </p>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={historical.monthlyArrivals}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 12, fill: '#475569' }} />
                <YAxis tick={{ fontSize: 12, fill: '#475569' }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#fff',
                    borderColor: '#e2e8f0',
                    fontSize: '12px',
                  }}
                />
                <Bar
                  dataKey="nonEscalated"
                  name="Resolved / L1 Only"
                  stackId="a"
                  fill="#94a3b8"
                  radius={[0, 0, 0, 0]}
                />
                <Bar
                  dataKey="escalated"
                  name="Escalated to Engineering"
                  stackId="a"
                  fill="#4f46e5"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <div className="mb-4">
            <h3 className="text-sm font-display font-semibold text-slate-900">
              Historical Engineering Outcomes (n={kpis.escalatedCount} Escalated Tickets)
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              35.6% of escalated tickets returned to L1 for insufficient info or configuration issues.
            </p>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={historical.engineeringOutcomes}
                layout="vertical"
                margin={{ left: 20, right: 20 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11, fill: '#475569' }} />
                <YAxis
                  type="category"
                  dataKey="outcome"
                  width={185}
                  tick={{ fontSize: 11, fill: '#334155' }}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#fff',
                    borderColor: '#e2e8f0',
                    fontSize: '12px',
                  }}
                />
                <Bar dataKey="count" name="Tickets" radius={[0, 4, 4, 0]}>
                  {historical.engineeringOutcomes.map((entry) => (
                    <Cell
                      key={entry.outcome}
                      fill={
                        entry.outcome === 'Fixed'
                          ? '#4f46e5'
                          : entry.outcome.includes('returned to L1')
                            ? '#d97706'
                            : '#64748b'
                      }
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Analytical Integrity Guardrails */}
      <div className="bg-white border border-slate-200 rounded-lg p-4">
        <div className="flex items-start gap-2.5">
          <CheckCircle2 className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <div className="text-xs font-semibold text-slate-800">
              Analytical Method & Scope Disclosures
            </div>
            <ul className="text-xs text-slate-600 space-y-0.5 list-disc pl-4">
              {historical.dataBoundary.limitations.map((lim) => (
                <li key={lim}>{lim}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
