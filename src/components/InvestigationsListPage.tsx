import React, { useEffect, useState } from 'react';
import { ArrowRight, ClipboardCheck } from 'lucide-react';
import { apiRequest } from '../lib/api.ts';

interface InvestigationRow {
  workflowId: number;
  ticketId: string;
  category: string;
  priority: string;
  clientName: string;
  clientTier: string;
  description: string;
  investigationStatus: string;
  adoptedByName: string;
  assignedUserName: string | null;
  checklistStatus: string;
  checklistTotalItems: number;
  checklistCompletedItems: number;
  latestEscalationStatus: string | null;
  latestEngOutcome: string | null;
  updatedAt: string;
}

interface InvestigationsListPageProps {
  mineOnly: boolean;
  onOpenTicket: (ticketId: string) => void;
}

export function InvestigationsListPage({
  mineOnly,
  onOpenTicket,
}: InvestigationsListPageProps) {
  const [rows, setRows] = useState<InvestigationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    apiRequest<{ investigations: InvestigationRow[] }>(
      `/api/investigations?mine=${mineOnly ? 'true' : 'false'}`
    )
      .then((res) => setRows(res.investigations))
      .catch((err) =>
        setError(err instanceof Error ? err.message : 'Failed to load investigations.')
      )
      .finally(() => setLoading(false));
  }, [mineOnly]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-display font-bold text-slate-900">
          {mineOnly ? 'My Assigned Tickets' : 'Active ResolveIQ Investigations'}
        </h1>
        <p className="text-sm text-slate-500 mt-0.5">
          {mineOnly
            ? 'Tickets currently assigned to you for structured checklist execution and evidence gathering.'
            : 'All tickets adopted from the RideOps dataset into live ResolveIQ workflows.'}
        </p>
      </div>

      {error && (
        <div className="p-3 rounded-md bg-rose-50 border border-rose-200 text-xs text-rose-700">
          {error}
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <th className="py-2.5 px-4">Ticket</th>
                <th className="py-2.5 px-4">Client & Category</th>
                <th className="py-2.5 px-4">Assignee</th>
                <th className="py-2.5 px-4">Checklist Progress</th>
                <th className="py-2.5 px-4">Status / Outcome</th>
                <th className="py-2.5 px-4 text-right">Workspace</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-sm">
              {loading ? (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-slate-500">
                    Loading investigations...
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-500">
                    <ClipboardCheck className="w-6 h-6 text-slate-300 mx-auto mb-2" />
                    {mineOnly
                      ? 'No tickets are currently assigned to you. A Support Lead can adopt and assign tickets from Ticket Inbox.'
                      : 'No tickets have been adopted into ResolveIQ yet. Open Ticket Inbox to adopt a ticket.'}
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.workflowId} className="hover:bg-slate-50/70 align-top">
                    <td className="py-3 px-4 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => onOpenTicket(r.ticketId)}
                        className="font-mono font-semibold text-indigo-600 hover:text-indigo-800 cursor-pointer"
                      >
                        {r.ticketId}
                      </button>
                      <div className="text-xs font-mono text-slate-500">{r.priority}</div>
                    </td>
                    <td className="py-3 px-4 max-w-md">
                      <div className="text-xs font-semibold text-slate-700">
                        {r.clientName} ({r.clientTier}) · {r.category}
                      </div>
                      <div className="text-sm text-slate-800 mt-0.5 line-clamp-2">
                        {r.description}
                      </div>
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap text-xs">
                      <div className="font-medium text-slate-800">
                        {r.assignedUserName || 'Unassigned'}
                      </div>
                      <div className="text-slate-400">Adopted by {r.adoptedByName}</div>
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap text-xs">
                      <div className="font-mono tabular-nums text-slate-800">
                        {r.checklistCompletedItems} / {r.checklistTotalItems} checks
                      </div>
                      <div
                        className={`mt-0.5 ${
                          r.checklistStatus === 'approved'
                            ? 'text-emerald-700'
                            : 'text-amber-700'
                        }`}
                      >
                        Checklist: {r.checklistStatus.replace(/_/g, ' ')}
                      </div>
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap text-xs">
                      <div className="font-semibold text-indigo-700 capitalize">
                        {r.investigationStatus.replace(/_/g, ' ')}
                      </div>
                      {r.latestEngOutcome && (
                        <div className="text-slate-600 mt-0.5">{r.latestEngOutcome}</div>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => onOpenTicket(r.ticketId)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700 cursor-pointer"
                      >
                        Investigate
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
