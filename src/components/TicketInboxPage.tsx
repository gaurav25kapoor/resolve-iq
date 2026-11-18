import React, { useCallback, useEffect, useState } from 'react';
import { ArrowRight, Check, Search, UserPlus } from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import { apiRequest } from '../lib/api.ts';
import type { TicketListItem } from '../types/index.ts';

interface SupportAgentOption {
  id: number;
  name: string;
  email: string;
  designation: string;
  agentAlias: string | null;
  hasGlobalClientAccess: boolean;
}

interface TicketInboxPageProps {
  onOpenTicket: (ticketId: string) => void;
}

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

export function TicketInboxPage({ onOpenTicket }: TicketInboxPageProps) {
  const { user } = useAuth();
  const [tickets, setTickets] = useState<TicketListItem[]>([]);
  const [agents, setAgents] = useState<SupportAgentOption[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('ALL');
  const [priority, setPriority] = useState('ALL');
  const [status, setStatus] = useState('ALL');
  const [adoptedFilter, setAdoptedFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [actionMsg, setActionMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(
    null
  );
  const [assigningTicketId, setAssigningTicketId] = useState<string | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<number | ''>('');
  const [busyTicketId, setBusyTicketId] = useState<string | null>(null);

  const canAdoptOrAssign =
    user?.role === 'support_manager' || user?.role === 'platform_admin';

  const loadTickets = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: '20',
        q,
        category,
        priority,
        status,
        adopted: adoptedFilter,
      });
      const res = await apiRequest<{
        tickets: TicketListItem[];
        total: number;
        page: number;
        totalPages: number;
      }>(`/api/tickets?${params.toString()}`);
      setTickets(res.tickets);
      setTotal(res.total);
      setTotalPages(Math.max(1, res.totalPages));
    } catch (err) {
      setActionMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to load tickets.',
      });
    } finally {
      setLoading(false);
    }
  }, [page, q, category, priority, status, adoptedFilter]);

  useEffect(() => {
    loadTickets();
  }, [loadTickets]);

  useEffect(() => {
    apiRequest<{ agents: SupportAgentOption[] }>('/api/agents')
      .then((res) => {
        setAgents(res.agents);
        if (res.agents[0]) setSelectedAgentId(res.agents[0].id);
      })
      .catch(() => {});
  }, []);

  const handleAdopt = async (ticketId: string) => {
    setBusyTicketId(ticketId);
    setActionMsg(null);
    try {
      await apiRequest(`/api/tickets/${ticketId}/adopt`, { method: 'POST' });
      setActionMsg({
        type: 'ok',
        text: `${ticketId} adopted into ResolveIQ live workflow. Assign an agent to begin investigation.`,
      });
      await loadTickets();
    } catch (err) {
      setActionMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'Adoption failed.',
      });
    } finally {
      setBusyTicketId(null);
    }
  };

  const handleAssignSubmit = async (ticketId: string) => {
    if (!selectedAgentId) return;
    setBusyTicketId(ticketId);
    setActionMsg(null);
    try {
      await apiRequest(`/api/tickets/${ticketId}/assign`, {
        method: 'POST',
        body: JSON.stringify({ assignedUserId: Number(selectedAgentId) }),
      });
      setAssigningTicketId(null);
      setActionMsg({
        type: 'ok',
        text: `Assigned ${ticketId} to Support Agent.`,
      });
      await loadTickets();
    } catch (err) {
      setActionMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'Assignment failed.',
      });
    } finally {
      setBusyTicketId(null);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-display font-bold text-slate-900">
            Support Ticket Inbox
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Immutable RideOps historical records ({total.toLocaleString()} matching) with ResolveIQ adoption & agent assignment controls.
          </p>
        </div>
      </div>

      {actionMsg && (
        <div
          className={`p-3 rounded-md text-xs border ${
            actionMsg.type === 'ok'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-rose-50 border-rose-200 text-rose-800'
          }`}
        >
          {actionMsg.text}
        </div>
      )}

      {/* Filter Bar */}
      <div className="bg-white border border-slate-200 rounded-lg p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
        <div className="lg:col-span-2 relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            value={q}
            onChange={(e) => {
              setPage(1);
              setQ(e.target.value);
            }}
            placeholder="Search SUP-ID, client, description..."
            className="w-full pl-9 pr-3 py-1.5 text-sm border border-slate-300 rounded-md focus:outline-none focus:border-indigo-500"
          />
        </div>

        <select
          value={category}
          onChange={(e) => {
            setPage(1);
            setCategory(e.target.value);
          }}
          className="px-2.5 py-1.5 text-sm border border-slate-300 rounded-md bg-white"
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c === 'ALL' ? 'All Categories' : c}
            </option>
          ))}
        </select>

        <select
          value={priority}
          onChange={(e) => {
            setPage(1);
            setPriority(e.target.value);
          }}
          className="px-2.5 py-1.5 text-sm border border-slate-300 rounded-md bg-white"
        >
          <option value="ALL">All Priorities</option>
          <option value="P1">P1 — Critical</option>
          <option value="P2">P2 — High</option>
          <option value="P3">P3 — Medium</option>
          <option value="P4">P4 — Low</option>
        </select>

        <select
          value={status}
          onChange={(e) => {
            setPage(1);
            setStatus(e.target.value);
          }}
          className="px-2.5 py-1.5 text-sm border border-slate-300 rounded-md bg-white"
        >
          <option value="ALL">All Historical Statuses</option>
          <option value="OPEN_ANY">Open Snapshot (48)</option>
          <option value="Open - with L1">Open - with L1</option>
          <option value="Open - with Engineering">Open - with Engineering</option>
          <option value="Closed">Closed</option>
        </select>

        <select
          value={adoptedFilter}
          onChange={(e) => {
            setPage(1);
            setAdoptedFilter(e.target.value);
          }}
          className="px-2.5 py-1.5 text-sm border border-slate-300 rounded-md bg-white"
        >
          <option value="all">All Adoption States</option>
          <option value="adopted">Adopted in ResolveIQ</option>
          <option value="unadopted">Not Yet Adopted</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <th className="py-2.5 px-4">Ticket</th>
                <th className="py-2.5 px-4">Client</th>
                <th className="py-2.5 px-4">Category & Issue</th>
                <th className="py-2.5 px-4">Historical Outcome</th>
                <th className="py-2.5 px-4">ResolveIQ Workflow</th>
                <th className="py-2.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-sm">
              {loading ? (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-slate-500">
                    Loading tickets...
                  </td>
                </tr>
              ) : tickets.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-slate-500">
                    No tickets match the current filters or client scope.
                  </td>
                </tr>
              ) : (
                tickets.map((t) => (
                  <tr key={t.ticketId} className="hover:bg-slate-50/70 align-top">
                    <td className="py-3 px-4 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => onOpenTicket(t.ticketId)}
                        className="font-mono font-semibold text-indigo-600 hover:text-indigo-800 cursor-pointer"
                      >
                        {t.ticketId}
                      </button>
                      <div className="text-xs text-slate-500 font-mono mt-0.5">
                        {t.priority} · {t.channel}
                      </div>
                      <div className="text-[11px] text-slate-400 font-mono">
                        {t.createdAtRaw}
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-medium text-slate-900">{t.clientName}</div>
                      <div className="text-xs text-slate-500 font-mono">
                        {t.clientId} · {t.clientTier}
                      </div>
                    </td>
                    <td className="py-3 px-4 max-w-md">
                      <div className="text-xs font-semibold text-slate-700">
                        {t.category}
                      </div>
                      <div className="text-sm text-slate-800 mt-0.5 line-clamp-2">
                        {t.description}
                      </div>
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap text-xs">
                      <div className="text-slate-800 font-medium">{t.historicalStatus}</div>
                      <div className="text-slate-500 mt-0.5">
                        {t.escalatedToEng
                          ? `Esc (${t.engHandoffs}x) · ${t.engOutcome || 'Open'}`
                          : 'L1 Only'}
                      </div>
                      <div className="text-slate-400 font-mono">
                        Hist Agent: {t.historicalAssignedAgent}
                      </div>
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap text-xs">
                      {t.workflow ? (
                        <div>
                          <div className="font-semibold text-indigo-700 capitalize">
                            {t.workflow.investigationStatus.replace(/_/g, ' ')}
                          </div>
                          <div className="text-slate-600 mt-0.5">
                            {t.workflow.assignedUserName
                              ? `Assigned: ${t.workflow.assignedUserName}`
                              : 'Unassigned'}
                          </div>
                        </div>
                      ) : (
                        <span className="text-slate-400">Historical only</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <div className="inline-flex flex-col items-end gap-1.5">
                        <div className="inline-flex items-center gap-1.5">
                          {canAdoptOrAssign && !t.workflow && (
                            <button
                              type="button"
                              disabled={busyTicketId === t.ticketId}
                              onClick={() => handleAdopt(t.ticketId)}
                              className="px-2.5 py-1 rounded-md bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700 disabled:opacity-50 cursor-pointer"
                            >
                              Adopt
                            </button>
                          )}

                          {canAdoptOrAssign && t.workflow && (
                            <button
                              type="button"
                              onClick={() =>
                                setAssigningTicketId(
                                  assigningTicketId === t.ticketId ? null : t.ticketId
                                )
                              }
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-slate-300 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
                            >
                              <UserPlus className="w-3.5 h-3.5" />
                              {t.workflow.assignedUserId ? 'Reassign' : 'Assign'}
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => onOpenTicket(t.ticketId)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
                          >
                            Open
                            <ArrowRight className="w-3 h-3" />
                          </button>
                        </div>

                        {assigningTicketId === t.ticketId && (
                          <div className="flex items-center gap-1.5 mt-1">
                            <select
                              value={selectedAgentId}
                              onChange={(e) => setSelectedAgentId(Number(e.target.value))}
                              className="px-2 py-1 text-xs border border-slate-300 rounded-md bg-white"
                            >
                              {agents.map((a) => (
                                <option key={a.id} value={a.id}>
                                  {a.name} ({a.email})
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              disabled={busyTicketId === t.ticketId}
                              onClick={() => handleAssignSubmit(t.ticketId)}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700 cursor-pointer"
                            >
                              <Check className="w-3 h-3" />
                              Save
                            </button>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="px-4 py-3 border-t border-slate-200 flex items-center justify-between text-xs text-slate-600">
          <div className="font-mono tabular-nums">
            Page {page} of {totalPages} · {total.toLocaleString()} total tickets
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="px-2.5 py-1 rounded border border-slate-300 bg-white disabled:opacity-40 cursor-pointer"
            >
              Previous
            </button>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="px-2.5 py-1 rounded border border-slate-300 bg-white disabled:opacity-40 cursor-pointer"
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
