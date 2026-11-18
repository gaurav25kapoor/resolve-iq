import React, { useCallback, useEffect, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { apiRequest } from '../lib/api.ts';
import type { HistoricalAnalyticsData, LiveAnalyticsData } from '../types/index.ts';

const CATEGORIES = [
  'ALL',
  'Roster / booking not syncing',
  'Live tracking / GPS incorrect',
  'Report export failing',
  'Cab delay / no-show complaint',
  'How-to / feature request',
  'Login / access issue',
  'OTP / boarding issue',
  'Billing / invoice discrepancy',
  'Employee address / geocode change',
  'Driver / vehicle compliance docs',
];

export function AnalyticsPage() {
  const [historical, setHistorical] = useState<HistoricalAnalyticsData | null>(null);
  const [live, setLive] = useState<LiveAnalyticsData | null>(null);
  const [category, setCategory] = useState('ALL');
  const [clientTier, setClientTier] = useState('ALL');
  const [channel, setChannel] = useState('ALL');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ category, clientTier, channel });
      const [histRes, liveRes] = await Promise.all([
        apiRequest<HistoricalAnalyticsData>(
          `/api/analytics/historical?${params.toString()}`
        ),
        apiRequest<LiveAnalyticsData>('/api/analytics/live'),
      ]);
      setHistorical(histRes);
      setLive(liveRes);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load analytics.');
    } finally {
      setLoading(false);
    }
  }, [category, clientTier, channel]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (loading) {
    return <div className="py-10 text-sm text-slate-500">Computing analytics...</div>;
  }

  if (error || !historical || !live) {
    return (
      <div className="p-4 rounded-lg bg-rose-50 border border-rose-200 text-sm text-rose-700">
        {error || 'Analytics unavailable.'}
      </div>
    );
  }

  const { kpis } = historical;

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-display font-bold text-slate-900">
            Operational & Escalation Intelligence
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Evidence-based diagnosis of RideOps historical tickets separated from live ResolveIQ application outcomes.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-md bg-white"
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c === 'ALL' ? 'All Categories' : c}
              </option>
            ))}
          </select>
          <select
            value={clientTier}
            onChange={(e) => setClientTier(e.target.value)}
            className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-md bg-white"
          >
            <option value="ALL">All Tiers</option>
            <option value="Enterprise">Enterprise</option>
            <option value="Mid-market">Mid-market</option>
            <option value="SMB">SMB</option>
          </select>
          <select
            value={channel}
            onChange={(e) => setChannel(e.target.value)}
            className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-md bg-white"
          >
            <option value="ALL">All Channels</option>
            <option value="Email">Email</option>
            <option value="Client portal">Client portal</option>
            <option value="Phone">Phone</option>
            <option value="WhatsApp">WhatsApp</option>
          </select>
        </div>
      </div>

      {/* KPI Definitions & Snapshot Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-xs text-slate-500">Filtered Tickets</div>
          <div className="text-xl font-mono font-bold tabular-nums text-slate-900 mt-1">
            {kpis.totalTickets.toLocaleString()}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            {kpis.uniqueClients} unique clients
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-xs text-slate-500">Open Snapshot (Sep 30)</div>
          <div className="text-xl font-mono font-bold tabular-nums text-slate-900 mt-1">
            {kpis.openSnapshotCount}
          </div>
          <div className="text-[11px] text-slate-500 mt-1 font-mono">
            {kpis.openWithL1} L1 · {kpis.openWithEng} Eng (single snapshot)
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-xs text-slate-500">Escalated to Engineering</div>
          <div className="text-xl font-mono font-bold tabular-nums text-indigo-700 mt-1">
            {kpis.escalationRate}%
          </div>
          <div className="text-[11px] text-slate-500 mt-1 font-mono">
            {kpis.escalatedCount} tickets · {kpis.multiHandoffCount} multi-handoff
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-xs text-slate-500">Resolution Time (Median / P90)</div>
          <div className="text-xl font-mono font-bold tabular-nums text-slate-900 mt-1">
            {kpis.resolutionTimeStats.overallMedianHours ?? '—'}h /{' '}
            {kpis.resolutionTimeStats.overallP90Hours ?? '—'}h
          </div>
          <div className="text-[11px] text-slate-500 mt-1 font-mono">
            Mean {kpis.resolutionTimeStats.overallMeanHours ?? '—'}h (closed only)
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-xs text-slate-500">CSAT Average & Coverage</div>
          <div className="text-xl font-mono font-bold tabular-nums text-slate-900 mt-1">
            {kpis.avgCsat ?? '—'} / 5.0
          </div>
          <div className="text-[11px] text-slate-500 mt-1 font-mono">
            {kpis.csatRatedCount} rated ({kpis.csatCoveragePct}% · blanks excluded)
          </div>
        </div>
      </div>

      {/* Charts: Resolution Distribution + CSAT vs Resolution Time */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <div className="mb-3">
            <h2 className="text-sm font-display font-semibold text-slate-900">
              Resolution Time Distribution (Closed Tickets)
            </h2>
            <p className="text-xs text-slate-500">
              Non-escalated median: {kpis.resolutionTimeStats.nonEscalatedMedianHours ?? '—'}h vs Escalated median: {kpis.resolutionTimeStats.escalatedMedianHours ?? '—'}h
            </p>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={historical.resolutionTimeDistribution}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="bucket" tick={{ fontSize: 12, fill: '#475569' }} />
                <YAxis tick={{ fontSize: 12, fill: '#475569' }} />
                <Tooltip />
                <Bar dataKey="nonEscalated" name="Non-Escalated" fill="#94a3b8" radius={[3, 3, 0, 0]} />
                <Bar dataKey="escalated" name="Escalated to Eng" fill="#4f46e5" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <div className="mb-3">
            <h2 className="text-sm font-display font-semibold text-slate-900">
              CSAT & Escalation Share by Resolution Duration Bucket
            </h2>
            <p className="text-xs text-slate-500">
              Descriptive association only (correlation does not establish causation; blank CSAT excluded).
            </p>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={historical.csatByResolutionBucket}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="bucket" tick={{ fontSize: 12, fill: '#475569' }} />
                <YAxis yAxisId="left" domain={[0, 5]} tick={{ fontSize: 12, fill: '#475569' }} />
                <YAxis yAxisId="right" orientation="right" unit="%" tick={{ fontSize: 12, fill: '#475569' }} />
                <Tooltip />
                <Bar yAxisId="right" dataKey="escalatedSharePct" name="Escalated Share %" fill="#cbd5e1" radius={[3, 3, 0, 0]} />
                <Line yAxisId="left" type="monotone" dataKey="avgCsat" name="Avg CSAT (1-5)" stroke="#4f46e5" strokeWidth={2} dot={{ r: 4 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Category Escalation & Return Breakdown Table */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200">
          <h2 className="text-sm font-display font-semibold text-slate-900">
            Category Volume, Escalation Rates & Return Reasons
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Live tracking / GPS incorrect (55.7%) and Roster / booking not syncing (50.9%) drive the highest escalation concentrations.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[11px] uppercase tracking-wider text-slate-500">
                <th className="py-2.5 px-4">Category</th>
                <th className="py-2.5 px-4 text-right">Total</th>
                <th className="py-2.5 px-4 text-right">Escalated</th>
                <th className="py-2.5 px-4 text-right">Esc. Rate</th>
                <th className="py-2.5 px-4 text-right">Insufficient Info</th>
                <th className="py-2.5 px-4 text-right">Config Returns</th>
                <th className="py-2.5 px-4 text-right">Median Res.</th>
                <th className="py-2.5 px-4 text-right">Avg CSAT (n)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 font-mono tabular-nums">
              {historical.categoryBreakdown.map((c) => (
                <tr key={c.category} className="hover:bg-slate-50">
                  <td className="py-2.5 px-4 font-sans font-medium text-slate-900">
                    {c.category}
                  </td>
                  <td className="py-2.5 px-4 text-right">{c.total}</td>
                  <td className="py-2.5 px-4 text-right">{c.escalated}</td>
                  <td className="py-2.5 px-4 text-right font-semibold text-indigo-700">
                    {c.escalationRate}%
                  </td>
                  <td className="py-2.5 px-4 text-right text-amber-700">
                    {c.insufficientInfoReturns}
                  </td>
                  <td className="py-2.5 px-4 text-right text-amber-700">
                    {c.configReturns}
                  </td>
                  <td className="py-2.5 px-4 text-right">
                    {c.medianResolutionHours !== null ? `${c.medianResolutionHours}h` : '—'}
                  </td>
                  <td className="py-2.5 px-4 text-right">
                    {c.avgCsat !== null ? `${c.avgCsat} (${c.csatCount})` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Priority + Client Tier + Live ResolveIQ Separation */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-3">
          <h3 className="text-sm font-display font-semibold text-slate-900">
            Priority Distribution
          </h3>
          <div className="divide-y divide-slate-100 text-xs font-mono tabular-nums">
            {historical.priorityDistribution.map((p) => (
              <div key={p.priority} className="py-2 flex items-center justify-between">
                <span className="font-semibold text-slate-900">{p.priority}</span>
                <span className="text-slate-600">
                  {p.total} tickets · {p.escalationRate}% esc ·{' '}
                  {p.medianResolutionHours !== null ? `${p.medianResolutionHours}h med` : '—'}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-3">
          <h3 className="text-sm font-display font-semibold text-slate-900">
            Client Tier & Channel Mix
          </h3>
          <div className="divide-y divide-slate-100 text-xs font-mono tabular-nums">
            {historical.clientTierDistribution.map((t) => (
              <div key={t.tier} className="py-2 flex items-center justify-between">
                <span className="font-sans font-medium text-slate-900">{t.tier}</span>
                <span className="text-slate-600">
                  {t.total} ({t.escalationRate}% esc)
                </span>
              </div>
            ))}
            {historical.channelDistribution.map((ch) => (
              <div key={ch.channel} className="py-2 flex items-center justify-between">
                <span className="font-sans text-slate-600">{ch.channel}</span>
                <span className="text-slate-700">{ch.count}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-3">
          <h3 className="text-sm font-display font-semibold text-slate-900">
            Live ResolveIQ Activity (Separate)
          </h3>
          <div className="divide-y divide-slate-100 text-xs font-mono tabular-nums">
            <div className="py-2 flex justify-between">
              <span className="font-sans text-slate-600">Adopted Workflows</span>
              <span className="font-semibold text-slate-900">{live.adoptedTotal}</span>
            </div>
            <div className="py-2 flex justify-between">
              <span className="font-sans text-slate-600">Assigned to Agents</span>
              <span className="font-semibold text-slate-900">{live.assignedTotal}</span>
            </div>
            <div className="py-2 flex justify-between">
              <span className="font-sans text-slate-600">Checklists Approved</span>
              <span className="font-semibold text-slate-900">
                {live.checklistGovernance.approved} / {live.checklistGovernance.total}
              </span>
            </div>
            <div className="py-2 flex justify-between">
              <span className="font-sans text-slate-600">Live Escalations Submitted</span>
              <span className="font-semibold text-slate-900">
                {live.escalationsSummary.totalSubmissions}
              </span>
            </div>
            <div className="py-2 flex justify-between">
              <span className="font-sans text-slate-600">Returned to L1 (Live)</span>
              <span className="font-semibold text-amber-700">
                {live.escalationsSummary.returnedToL1}
              </span>
            </div>
            <div className="py-2 flex justify-between">
              <span className="font-sans text-slate-600">Outcomes Recorded (Live)</span>
              <span className="font-semibold text-emerald-700">
                {live.escalationsSummary.outcomeRecorded}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Top Clients Table */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200">
          <h2 className="text-sm font-display font-semibold text-slate-900">
            Top 15 Corporate Clients by Ticket Volume
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[11px] uppercase tracking-wider text-slate-500">
                <th className="py-2 px-4">Client</th>
                <th className="py-2 px-4">Tier</th>
                <th className="py-2 px-4 text-right">Tickets</th>
                <th className="py-2 px-4 text-right">Escalated</th>
                <th className="py-2 px-4 text-right">Esc. Rate</th>
                <th className="py-2 px-4 text-right">Open (Sep 30)</th>
                <th className="py-2 px-4 text-right">Avg CSAT</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 font-mono tabular-nums">
              {historical.topClients.map((cl) => (
                <tr key={cl.clientId} className="hover:bg-slate-50">
                  <td className="py-2 px-4 font-sans font-medium text-slate-900">
                    {cl.clientName}{' '}
                    <span className="font-mono text-slate-400">({cl.clientId})</span>
                  </td>
                  <td className="py-2 px-4 font-sans text-slate-600">{cl.clientTier}</td>
                  <td className="py-2 px-4 text-right">{cl.total}</td>
                  <td className="py-2 px-4 text-right">{cl.escalated}</td>
                  <td className="py-2 px-4 text-right">{cl.escalationRate}%</td>
                  <td className="py-2 px-4 text-right">{cl.openCount}</td>
                  <td className="py-2 px-4 text-right">
                    {cl.avgCsat !== null ? cl.avgCsat : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
