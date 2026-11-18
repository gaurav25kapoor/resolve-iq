import React, { useCallback, useEffect, useState } from 'react';
import { ArrowRight, CheckCircle2, RotateCcw, Wrench } from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import { apiRequest } from '../lib/api.ts';
import type { EscalationRecord } from '../types/index.ts';

const DOCUMENTED_OUTCOMES = [
  'Fixed',
  'Insufficient info - returned to L1',
  'Config issue - returned to L1',
  'Duplicate of known issue',
  'Not a bug - how-to',
  'Not reproducible',
] as const;

interface EngineeringPageProps {
  onOpenTicket: (ticketId: string) => void;
}

export function EngineeringPage({ onOpenTicket }: EngineeringPageProps) {
  const { user } = useAuth();
  const [escalations, setEscalations] = useState<EscalationRecord[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Review form state
  const [engOutcome, setEngOutcome] = useState<string>('Fixed');
  const [returnReason, setReturnReason] = useState('');
  const [engNotes, setEngNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const isEngineeringManager = user?.role === 'engineering_manager';

  const loadEscalations = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiRequest<{ escalations: EscalationRecord[] }>('/api/escalations');
      setEscalations(res.escalations);
      if (res.escalations.length > 0 && selectedId === null) {
        setSelectedId(res.escalations[0].id);
      }
    } catch (err) {
      setBanner({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to load escalations.',
      });
    } finally {
      setLoading(false);
    }
  }, [selectedId]);

  useEffect(() => {
    loadEscalations();
  }, [loadEscalations]);

  const filtered = escalations.filter((e) => {
    if (statusFilter === 'ALL') return true;
    return e.status === statusFilter;
  });

  const selected =
    filtered.find((e) => e.id === selectedId) ?? filtered[0] ?? null;

  const handleReviewAction = async (
    action: 'return_to_l1' | 'record_outcome' | 'add_note'
  ) => {
    if (!selected) return;
    setSubmitting(true);
    setBanner(null);
    try {
      await apiRequest(`/api/escalations/${selected.id}/review`, {
        method: 'POST',
        body: JSON.stringify({
          action,
          engOutcome:
            action === 'record_outcome'
              ? engOutcome
              : action === 'return_to_l1'
                ? engOutcome === 'Config issue - returned to L1'
                  ? 'Config issue - returned to L1'
                  : 'Insufficient info - returned to L1'
                : undefined,
          returnReason: action === 'return_to_l1' ? returnReason : undefined,
          engNotes,
        }),
      });
      setBanner({
        type: 'ok',
        text:
          action === 'return_to_l1'
            ? `Handoff #${selected.handoffNumber} for ${selected.ticketId} returned to L1.`
            : action === 'record_outcome'
              ? `Recorded outcome "${engOutcome}" for ${selected.ticketId}.`
              : `Engineering comment added to ${selected.ticketId}.`,
      });
      setEngNotes('');
      setReturnReason('');
      await loadEscalations();
    } catch (err) {
      setBanner({
        type: 'err',
        text: err instanceof Error ? err.message : 'Review action failed.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-display font-bold text-slate-900">
            Engineering Escalation Queue
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Evidence-backed L1→Engineering handoffs with full checklist verification, return reasons, and documented outcomes.
          </p>
        </div>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-1.5 text-sm border border-slate-300 rounded-md bg-white"
        >
          <option value="ALL">All Handoffs ({escalations.length})</option>
          <option value="submitted">Awaiting Review</option>
          <option value="under_review">Under Review</option>
          <option value="returned_to_l1">Returned to L1</option>
          <option value="outcome_recorded">Outcome Recorded</option>
        </select>
      </div>

      {banner && (
        <div
          className={`p-3 rounded-md text-xs border ${
            banner.type === 'ok'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-rose-50 border-rose-200 text-rose-800'
          }`}
        >
          {banner.text}
        </div>
      )}

      {loading ? (
        <div className="py-10 text-sm text-slate-500">Loading engineering handoffs...</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-lg p-12 text-center space-y-2">
          <Wrench className="w-7 h-7 text-slate-300 mx-auto" />
          <div className="text-sm font-medium text-slate-900">
            No engineering escalations in this queue yet
          </div>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            Support Agents submit evidence-backed escalations from their assigned Investigation Workspace after completing an Operations-approved checklist.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Queue List */}
          <div className="lg:col-span-4 bg-white border border-slate-200 rounded-lg divide-y divide-slate-200">
            {filtered.map((esc) => {
              const isSelected = selected?.id === esc.id;
              return (
                <button
                  key={esc.id}
                  type="button"
                  onClick={() => setSelectedId(esc.id)}
                  className={`w-full text-left p-4 transition-colors cursor-pointer ${
                    isSelected ? 'bg-indigo-50/70' : 'hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center justify-between text-xs font-mono">
                    <span className="font-semibold text-indigo-700">
                      {esc.ticketId} · #{esc.handoffNumber}
                    </span>
                    <span className="text-slate-500">{esc.priority}</span>
                  </div>
                  <div className="text-sm font-medium text-slate-900 mt-1 line-clamp-2">
                    {esc.problemSummary}
                  </div>
                  <div className="text-xs text-slate-500 mt-1">
                    {esc.clientName} · {esc.engOutcome || esc.status.replace(/_/g, ' ')}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Selected Handoff Inspection & Engineering Decision Panel */}
          {selected && (
            <div className="lg:col-span-8 space-y-5">
              <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2 text-xs font-mono text-slate-500">
                      <span className="font-semibold text-slate-900">
                        {selected.ticketId} (Handoff #{selected.handoffNumber})
                      </span>
                      <span>·</span>
                      <span>{selected.clientName}</span>
                      <span>·</span>
                      <span>{selected.category}</span>
                    </div>
                    <h2 className="text-base font-display font-semibold text-slate-900 mt-1">
                      {selected.problemSummary}
                    </h2>
                  </div>

                  <button
                    type="button"
                    onClick={() => onOpenTicket(selected.ticketId)}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md border border-slate-300 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 shrink-0 cursor-pointer"
                  >
                    Full Ticket
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs pt-2 border-t border-slate-100">
                  <div>
                    <div className="font-semibold text-slate-500">Business Impact</div>
                    <div className="text-slate-800 mt-0.5">{selected.businessImpact}</div>
                  </div>
                  <div>
                    <div className="font-semibold text-slate-500">Submitted By</div>
                    <div className="text-slate-800 mt-0.5">
                      {selected.submittedByName} ·{' '}
                      {new Date(selected.submittedAt).toLocaleString()}
                    </div>
                  </div>
                  <div>
                    <div className="font-semibold text-slate-500">Expected Behavior</div>
                    <div className="text-slate-800 mt-0.5">{selected.expectedBehavior}</div>
                  </div>
                  <div>
                    <div className="font-semibold text-slate-500">Actual Behavior</div>
                    <div className="text-slate-800 mt-0.5">{selected.actualBehavior}</div>
                  </div>
                  <div className="sm:col-span-2">
                    <div className="font-semibold text-slate-500">L1 Steps Performed</div>
                    <div className="text-slate-800 mt-0.5 whitespace-pre-line">
                      {selected.stepsPerformed}
                    </div>
                  </div>
                  <div className="sm:col-span-2">
                    <div className="font-semibold text-slate-500">
                      Diagnostic Evidence & L1 Notes
                    </div>
                    <div className="text-slate-800 mt-0.5">{selected.diagnosticEvidence}</div>
                    {selected.investigationNotes && (
                      <div className="text-slate-600 mt-1">
                        L1 Notes: {selected.investigationNotes}
                      </div>
                    )}
                  </div>
                </div>

                {/* Completed Checklist Inspection */}
                {selected.checklistResults && selected.checklistResults.length > 0 && (
                  <div className="pt-3 border-t border-slate-200 space-y-2">
                    <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                      Verified Checklist Results ({selected.checklistTitle})
                    </div>
                    <div className="divide-y divide-slate-100 border border-slate-200 rounded-md text-xs">
                      {selected.checklistResults.map((cr) => (
                        <div
                          key={cr.itemId}
                          className="px-3 py-2 flex items-start justify-between gap-4"
                        >
                          <div>
                            <div className="font-medium text-slate-800">{cr.label}</div>
                            {(cr.notes || cr.evidenceRef) && (
                              <div className="text-slate-500 mt-0.5 font-mono">
                                {cr.notes} {cr.evidenceRef ? `· Ref: ${cr.evidenceRef}` : ''}
                              </div>
                            )}
                          </div>
                          <span
                            className={`font-mono font-semibold uppercase shrink-0 ${
                              cr.result === 'pass'
                                ? 'text-emerald-700'
                                : cr.result === 'fail'
                                  ? 'text-rose-700'
                                  : 'text-slate-600'
                            }`}
                          >
                            {cr.result}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {selected.engOutcome && (
                  <div className="p-3 rounded-md bg-slate-50 border border-slate-200 text-xs space-y-1">
                    <div className="font-semibold text-slate-900">
                      Engineering Verdict: {selected.engOutcome}
                    </div>
                    {selected.returnReason && (
                      <div className="text-amber-800">
                        Return Reason: {selected.returnReason}
                      </div>
                    )}
                    {selected.engNotes && (
                      <div className="text-slate-700 whitespace-pre-line">
                        Notes: {selected.engNotes}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Engineering Review Action Form (Sandeep ONLY) */}
              {isEngineeringManager ? (
                <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
                  <h3 className="text-sm font-display font-semibold text-slate-900">
                    Engineering Review & Outcome Recording
                  </h3>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Documented Engineering Outcome
                      </label>
                      <select
                        value={engOutcome}
                        onChange={(e) => setEngOutcome(e.target.value)}
                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md bg-white"
                      >
                        {DOCUMENTED_OUTCOMES.map((o) => (
                          <option key={o} value={o}>
                            {o}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Return Reason (Required if Returning to L1)
                      </label>
                      <input
                        type="text"
                        value={returnReason}
                        onChange={(e) => setReturnReason(e.target.value)}
                        placeholder="e.g., Missing trip ID telemetry trace or client cutoff config check"
                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Engineering Comments / Root Cause Notes
                    </label>
                    <textarea
                      rows={3}
                      value={engNotes}
                      onChange={(e) => setEngNotes(e.target.value)}
                      placeholder="Document engineering findings, fix PR/build reference, or next steps for L1..."
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
                    />
                  </div>

                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <button
                      type="button"
                      disabled={submitting || engNotes.trim().length < 3}
                      onClick={() => handleReviewAction('add_note')}
                      className="px-3 py-1.5 rounded-md border border-slate-300 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 cursor-pointer"
                    >
                      Add Engineering Comment
                    </button>
                    <button
                      type="button"
                      disabled={
                        submitting ||
                        engNotes.trim().length < 3 ||
                        returnReason.trim().length < 5
                      }
                      onClick={() => handleReviewAction('return_to_l1')}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-amber-300 bg-amber-50 text-xs font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50 cursor-pointer"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      Return to L1
                    </button>
                    <button
                      type="button"
                      disabled={submitting || engNotes.trim().length < 3}
                      onClick={() => handleReviewAction('record_outcome')}
                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md bg-indigo-600 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50 cursor-pointer"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Record Outcome
                    </button>
                  </div>
                </div>
              ) : (
                <div className="bg-white border border-slate-200 rounded-lg p-4 text-xs text-slate-500">
                  Read-only view: Only Engineering Manager (Sandeep) can return escalations or record engineering outcomes.
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
