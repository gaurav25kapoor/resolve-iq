import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  CheckCircle2,
  ClipboardList,
  Plus,
  Send,
  Sparkles,
  Trash2,
  UserPlus,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import { apiRequest } from '../lib/api.ts';
import type {
  AiAnalysisResponse,
  EvidenceRef,
  FullTicketDetail,
} from '../types/index.ts';

interface SupportAgentOption {
  id: number;
  name: string;
  email: string;
}

interface InvestigationWorkspaceProps {
  ticketId: string;
  onBack: () => void;
}

export function InvestigationWorkspace({
  ticketId,
  onBack,
}: InvestigationWorkspaceProps) {
  const { user } = useAuth();
  const [detail, setDetail] = useState<FullTicketDetail | null>(null);
  const [agents, setAgents] = useState<SupportAgentOption[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<number | ''>('');
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Editable checklist state
  const [checkDraft, setCheckDraft] = useState<
    Record<number, { result: 'pending' | 'pass' | 'fail' | 'na'; notes: string; evidenceRef: string }>
  >({});

  // Editable notes & evidence state
  const [notes, setNotes] = useState('');
  const [evidenceSummary, setEvidenceSummary] = useState('');
  const [evidenceRefs, setEvidenceRefs] = useState<EvidenceRef[]>([]);
  const [newRefLabel, setNewRefLabel] = useState('');
  const [newRefType, setNewRefType] = useState('Log / Trace ID');
  const [newRefValue, setNewRefValue] = useState('');

  // AI Assistant state
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState<AiAnalysisResponse | null>(null);
  const [customAiQuery, setCustomAiQuery] = useState('');

  // Escalation handoff form state
  const [problemSummary, setProblemSummary] = useState('');
  const [businessImpact, setBusinessImpact] = useState('');
  const [expectedBehavior, setExpectedBehavior] = useState('');
  const [actualBehavior, setActualBehavior] = useState('');
  const [stepsPerformed, setStepsPerformed] = useState('');
  const [diagnosticEvidence, setDiagnosticEvidence] = useState('');
  const [saving, setSaving] = useState(false);

  const loadDetail = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiRequest<FullTicketDetail>(`/api/tickets/${ticketId}`);
      setDetail(res);
      if (res.checklist) {
        const draft: typeof checkDraft = {};
        for (const it of res.checklist.items) {
          draft[it.id] = {
            result: it.result,
            notes: it.notes,
            evidenceRef: it.evidenceRef,
          };
        }
        setCheckDraft(draft);
      }
      if (res.workflow) {
        setNotes(res.workflow.investigationNotes || '');
        setEvidenceSummary(res.workflow.evidenceSummary || '');
        setEvidenceRefs(res.workflow.evidenceRefs || []);
        if (res.workflow.assignedUserId) {
          setSelectedAgentId(res.workflow.assignedUserId);
        }
      }
      if (res.latestAiAnalysis && !aiResult) {
        const d = res.latestAiAnalysis.draftHandoffJson;
        if (!problemSummary && d) {
          setProblemSummary(d.problemSummary || '');
          setBusinessImpact(d.businessImpact || '');
          setExpectedBehavior(d.expectedBehavior || '');
          setActualBehavior(d.actualBehavior || '');
          setStepsPerformed(d.stepsPerformed || '');
          setDiagnosticEvidence(d.diagnosticEvidence || '');
        }
      }
    } catch (err) {
      setBanner({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to load ticket.',
      });
    } finally {
      setLoading(false);
    }
  }, [ticketId]);

  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  useEffect(() => {
    apiRequest<{ agents: SupportAgentOption[] }>('/api/agents')
      .then((res) => {
        setAgents(res.agents);
        if (!selectedAgentId && res.agents[0]) {
          setSelectedAgentId(res.agents[0].id);
        }
      })
      .catch(() => {});
  }, []);

  if (loading) {
    return <div className="text-sm text-slate-500 py-8">Loading investigation workspace...</div>;
  }

  if (!detail) {
    return (
      <div className="space-y-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>
        <div className="p-4 rounded-lg bg-rose-50 border border-rose-200 text-sm text-rose-700">
          {banner?.text || 'Ticket not found or inaccessible.'}
        </div>
      </div>
    );
  }

  const { historical, workflow, checklist, escalations, auditTrail } = detail;
  const canAdoptOrAssign =
    user?.role === 'support_manager' || user?.role === 'platform_admin';
  const isAssignedAgent =
    user?.role === 'support_agent' &&
    workflow !== null &&
    workflow.assignedUserId === user.id;

  const checklistApproved = checklist?.status === 'approved';
  const mandatoryAllDone =
    checklist?.items
      .filter((i) => i.isMandatory)
      .every((i) => {
        const val = checkDraft[i.id]?.result ?? i.result;
        return val !== 'pending';
      }) ?? false;

  const activeEscalation = escalations.find(
    (e) => e.status === 'submitted' || e.status === 'under_review'
  );

  const handleAdopt = async () => {
    setSaving(true);
    setBanner(null);
    try {
      await apiRequest(`/api/tickets/${ticketId}/adopt`, { method: 'POST' });
      setBanner({ type: 'ok', text: `${ticketId} adopted into ResolveIQ.` });
      await loadDetail();
    } catch (err) {
      setBanner({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to adopt ticket.',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleAssign = async () => {
    if (!selectedAgentId) return;
    setSaving(true);
    setBanner(null);
    try {
      await apiRequest(`/api/tickets/${ticketId}/assign`, {
        method: 'POST',
        body: JSON.stringify({ assignedUserId: Number(selectedAgentId) }),
      });
      setBanner({ type: 'ok', text: `Ticket assigned to agent.` });
      await loadDetail();
    } catch (err) {
      setBanner({
        type: 'err',
        text: err instanceof Error ? err.message : 'Assignment failed.',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveChecklist = async () => {
    if (!checklist) return;
    setSaving(true);
    setBanner(null);
    try {
      const payload = checklist.items.map((it) => ({
        checklistItemId: it.id,
        result: checkDraft[it.id]?.result ?? it.result,
        notes: checkDraft[it.id]?.notes ?? '',
        evidenceRef: checkDraft[it.id]?.evidenceRef ?? '',
      }));
      await apiRequest(`/api/investigations/${ticketId}/checklist`, {
        method: 'PUT',
        body: JSON.stringify({ items: payload }),
      });
      setBanner({ type: 'ok', text: 'Checklist results saved to PostgreSQL.' });
      await loadDetail();
    } catch (err) {
      setBanner({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to save checklist.',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveNotes = async (markResolvedL1 = false) => {
    setSaving(true);
    setBanner(null);
    try {
      await apiRequest(`/api/investigations/${ticketId}/notes`, {
        method: 'PUT',
        body: JSON.stringify({
          investigationNotes: notes,
          evidenceSummary,
          evidenceRefs,
          markResolvedL1,
        }),
      });
      setBanner({
        type: 'ok',
        text: markResolvedL1
          ? 'Ticket marked as Resolved at L1.'
          : 'Investigation notes & evidence saved.',
      });
      await loadDetail();
    } catch (err) {
      setBanner({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to save notes.',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleAddEvidenceRef = () => {
    if (!newRefLabel.trim() || !newRefValue.trim()) return;
    setEvidenceRefs((prev) => [
      ...prev,
      {
        label: newRefLabel.trim(),
        type: newRefType,
        value: newRefValue.trim(),
        addedBy: user?.name || 'Agent',
        addedAt: new Date().toISOString(),
      },
    ]);
    setNewRefLabel('');
    setNewRefValue('');
  };

  const handleRunAi = async () => {
    setAiLoading(true);
    setBanner(null);
    try {
      const res = await apiRequest<AiAnalysisResponse>(`/api/ai/investigate/${ticketId}`, {
        method: 'POST',
        body: JSON.stringify({ customQuery: customAiQuery }),
      });
      setAiResult(res);
    } catch (err) {
      setBanner({
        type: 'err',
        text: err instanceof Error ? err.message : 'AI assistant failed.',
      });
    } finally {
      setAiLoading(false);
    }
  };

  const applyDraftHandoff = (draft: AiAnalysisResponse['draftHandoff']) => {
    setProblemSummary(draft.problemSummary);
    setBusinessImpact(draft.businessImpact);
    setExpectedBehavior(draft.expectedBehavior);
    setActualBehavior(draft.actualBehavior);
    setStepsPerformed(draft.stepsPerformed);
    setDiagnosticEvidence(draft.diagnosticEvidence);
    setBanner({
      type: 'ok',
      text: 'AI handoff draft applied to escalation form. Verify all fields before submitting.',
    });
  };

  const handleSubmitEscalation = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setBanner(null);
    try {
      await apiRequest('/api/escalations', {
        method: 'POST',
        body: JSON.stringify({
          ticketId,
          problemSummary,
          businessImpact,
          expectedBehavior,
          actualBehavior,
          stepsPerformed,
          diagnosticEvidence,
        }),
      });
      setBanner({
        type: 'ok',
        text: 'Evidence-backed engineering escalation submitted to Engineering queue.',
      });
      await loadDetail();
    } catch (err) {
      setBanner({
        type: 'err',
        text: err instanceof Error ? err.message : 'Escalation submission failed.',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-slate-300 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back
          </button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-display font-bold font-mono text-slate-900">
                {historical.ticketId}
              </h1>
              <span className="text-xs text-slate-500">
                {historical.priority} · {historical.category} · {historical.clientName} ({historical.clientTier})
              </span>
            </div>
            <p className="text-sm text-slate-700 mt-0.5">{historical.description}</p>
          </div>
        </div>

        {/* Adoption & Assignment Header Controls */}
        <div className="flex flex-wrap items-center gap-2">
          {!workflow && canAdoptOrAssign && (
            <button
              type="button"
              disabled={saving}
              onClick={handleAdopt}
              className="px-3 py-1.5 rounded-md bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700 cursor-pointer"
            >
              Adopt into ResolveIQ
            </button>
          )}
          {workflow && canAdoptOrAssign && (
            <div className="flex items-center gap-1.5">
              <select
                value={selectedAgentId}
                onChange={(e) => setSelectedAgentId(Number(e.target.value))}
                className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-md bg-white"
              >
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={saving}
                onClick={handleAssign}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md border border-slate-300 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                <UserPlus className="w-3.5 h-3.5" />
                {workflow.assignedUserId ? 'Reassign' : 'Assign Agent'}
              </button>
            </div>
          )}
        </div>
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

      {/* Historical vs Live Summary Strip */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Immutable Historical CSV Record
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
            <div>
              <div className="text-slate-400">Created (IST)</div>
              <div className="font-mono text-slate-800">{historical.createdAtRaw}</div>
            </div>
            <div>
              <div className="text-slate-400">Channel</div>
              <div className="text-slate-800">{historical.channel}</div>
            </div>
            <div>
              <div className="text-slate-400">Historical Agent</div>
              <div className="text-slate-800">{historical.assignedAgent}</div>
            </div>
            <div>
              <div className="text-slate-400">Historical Status</div>
              <div className="text-slate-800 font-medium">{historical.status}</div>
            </div>
            <div>
              <div className="text-slate-400">Historical Escalation</div>
              <div className="text-slate-800">
                {historical.escalatedToEng
                  ? `${historical.engTicketId} (${historical.engHandoffs}x · ${historical.engOutcome})`
                  : 'No'}
              </div>
            </div>
            <div>
              <div className="text-slate-400">Resolution / CSAT</div>
              <div className="font-mono text-slate-800">
                {historical.resolutionHours !== null ? `${historical.resolutionHours}h` : 'Open'} ·{' '}
                {historical.csatScore !== null ? `CSAT ${historical.csatScore}/5` : 'No CSAT'}
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Live ResolveIQ Investigation Status
          </div>
          {workflow ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
              <div>
                <div className="text-slate-400">Workflow Status</div>
                <div className="font-semibold text-indigo-700 capitalize">
                  {workflow.investigationStatus.replace(/_/g, ' ')}
                </div>
              </div>
              <div>
                <div className="text-slate-400">Adopted By</div>
                <div className="text-slate-800">{workflow.adoptedByName}</div>
              </div>
              <div>
                <div className="text-slate-400">Assigned Investigator</div>
                <div className="text-slate-800 font-medium">
                  {workflow.assignedUserName || 'Unassigned'}
                </div>
              </div>
              <div>
                <div className="text-slate-400">Checklist Governance</div>
                <div
                  className={`font-medium ${
                    checklistApproved ? 'text-emerald-700' : 'text-amber-700'
                  }`}
                >
                  {checklist ? checklist.status.replace(/_/g, ' ') : 'Missing'}
                </div>
              </div>
              <div>
                <div className="text-slate-400">Live Escalations</div>
                <div className="font-mono text-slate-800">{escalations.length} submission(s)</div>
              </div>
              <div>
                <div className="text-slate-400">Last Updated</div>
                <div className="font-mono text-slate-700">
                  {new Date(workflow.updatedAt).toLocaleString()}
                </div>
              </div>
            </div>
          ) : (
            <p className="text-xs text-slate-500 py-2">
              This ticket is currently historical-only. Support Lead (Meera) or Platform Admin (Ritika) must adopt and assign it before L1 investigation steps can be recorded.
            </p>
          )}
        </div>
      </div>

      {/* Main Workspace Columns */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Left 7 cols: Checklist + Notes + Evidence + Escalation Form */}
        <div className="xl:col-span-7 space-y-6">
          {/* Diagnostic Checklist */}
          <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
              <div>
                <div className="flex items-center gap-2">
                  <ClipboardList className="w-4 h-4 text-indigo-600" />
                  <h2 className="text-sm font-display font-semibold text-slate-900">
                    {checklist?.title || `Diagnostic Checklist — ${historical.category}`}
                  </h2>
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  {checklist?.description}
                </p>
              </div>
              {checklist && (
                <span
                  className={`shrink-0 text-xs font-mono font-medium ${
                    checklist.status === 'approved'
                      ? 'text-emerald-700'
                      : checklist.status === 'rejected'
                        ? 'text-rose-700'
                        : 'text-amber-700'
                  }`}
                >
                  {checklist.status.replace(/_/g, ' ').toUpperCase()} (v{checklist.version})
                </span>
              )}
            </div>

            {checklist?.isProposedDemo && checklist.status !== 'approved' && (
              <div className="p-3 rounded-md bg-amber-50 border border-amber-200 text-xs text-amber-800 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <div>
                  <strong>Proposed Demonstration Checklist (Requires Operations Approval):</strong>{' '}
                  The Case Study does not prescribe official RideOps diagnostic procedures. Platform Admin (Ritika) must approve this checklist in the Admin panel before Support Agents can record checks or submit engineering escalations.
                </div>
              </div>
            )}

            {checklist && (
              <div className="divide-y divide-slate-200">
                {checklist.items.map((item) => {
                  const draft = checkDraft[item.id] ?? {
                    result: item.result,
                    notes: item.notes,
                    evidenceRef: item.evidenceRef,
                  };
                  const canEdit = isAssignedAgent && checklistApproved;

                  return (
                    <div key={item.id} className="py-3.5 space-y-2">
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                        <div>
                          <div className="text-sm font-medium text-slate-900">
                            {item.sortOrder}. {item.label}{' '}
                            {item.isMandatory && (
                              <span className="text-xs font-mono text-rose-600">*</span>
                            )}
                          </div>
                          <div className="text-xs text-slate-500 mt-0.5">{item.guidance}</div>
                        </div>
                        <div className="inline-flex rounded-md border border-slate-200 overflow-hidden shrink-0">
                          {(['pass', 'fail', 'na'] as const).map((opt) => (
                            <button
                              key={opt}
                              type="button"
                              disabled={!canEdit}
                              onClick={() =>
                                setCheckDraft((prev) => ({
                                  ...prev,
                                  [item.id]: { ...draft, result: opt },
                                }))
                              }
                              className={`px-2.5 py-1 text-xs font-medium uppercase cursor-pointer disabled:opacity-50 ${
                                draft.result === opt
                                  ? opt === 'pass'
                                    ? 'bg-emerald-600 text-white'
                                    : opt === 'fail'
                                      ? 'bg-rose-600 text-white'
                                      : 'bg-slate-700 text-white'
                                  : 'bg-white text-slate-600 hover:bg-slate-50'
                              }`}
                            >
                              {opt}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <input
                          type="text"
                          disabled={!canEdit}
                          value={draft.notes}
                          onChange={(e) =>
                            setCheckDraft((prev) => ({
                              ...prev,
                              [item.id]: { ...draft, notes: e.target.value },
                            }))
                          }
                          placeholder="Step observation / finding..."
                          className="px-2.5 py-1.5 text-xs border border-slate-200 rounded-md disabled:bg-slate-50"
                        />
                        <input
                          type="text"
                          disabled={!canEdit}
                          value={draft.evidenceRef}
                          onChange={(e) =>
                            setCheckDraft((prev) => ({
                              ...prev,
                              [item.id]: { ...draft, evidenceRef: e.target.value },
                            }))
                          }
                          placeholder="Evidence reference (Trip ID / Log / Screenshot ID)"
                          className="px-2.5 py-1.5 text-xs font-mono border border-slate-200 rounded-md disabled:bg-slate-50"
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {isAssignedAgent && checklistApproved && (
              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  disabled={saving}
                  onClick={handleSaveChecklist}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700 disabled:opacity-50 cursor-pointer"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Save Checklist Results
                </button>
              </div>
            )}
          </div>

          {/* Investigation Notes & Evidence */}
          {workflow && (
            <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
              <h2 className="text-sm font-display font-semibold text-slate-900">
                L1 Investigation Notes & Evidence Attachments
              </h2>

              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Investigation Notes
                  </label>
                  <textarea
                    rows={3}
                    disabled={!isAssignedAgent}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Summarize what you tested, client config verified, and reproduction outcomes..."
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md disabled:bg-slate-50"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Diagnostic Evidence Summary
                  </label>
                  <input
                    type="text"
                    disabled={!isAssignedAgent}
                    value={evidenceSummary}
                    onChange={(e) => setEvidenceSummary(e.target.value)}
                    placeholder="e.g., Trip ID TRP-88219 telemetry stalled 18 mins; app build v4.12.1 confirmed"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md disabled:bg-slate-50"
                  />
                </div>

                {/* Structured Evidence Items */}
                <div className="space-y-2">
                  <div className="text-xs font-medium text-slate-700">
                    Evidence References ({evidenceRefs.length})
                  </div>
                  {evidenceRefs.map((ref, idx) => (
                    <div
                      key={`${ref.label}-${idx}`}
                      className="flex items-center justify-between gap-2 px-3 py-2 rounded-md bg-slate-50 border border-slate-200 text-xs"
                    >
                      <div className="min-w-0">
                        <span className="font-semibold text-slate-800">{ref.label}</span>
                        <span className="text-slate-400"> · {ref.type} · </span>
                        <span className="font-mono text-slate-700">{ref.value}</span>
                      </div>
                      {isAssignedAgent && (
                        <button
                          type="button"
                          onClick={() =>
                            setEvidenceRefs((prev) => prev.filter((_, i) => i !== idx))
                          }
                          className="text-slate-400 hover:text-rose-600 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  ))}

                  {isAssignedAgent && (
                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 pt-1">
                      <input
                        type="text"
                        value={newRefLabel}
                        onChange={(e) => setNewRefLabel(e.target.value)}
                        placeholder="Label (e.g. Telemetry Log)"
                        className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-md"
                      />
                      <select
                        value={newRefType}
                        onChange={(e) => setNewRefType(e.target.value)}
                        className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-md bg-white"
                      >
                        <option>Log / Trace ID</option>
                        <option>Screenshot Ref</option>
                        <option>Trip / Roster ID</option>
                        <option>HAR / HTTP Status</option>
                      </select>
                      <input
                        type="text"
                        value={newRefValue}
                        onChange={(e) => setNewRefValue(e.target.value)}
                        placeholder="ID or URL"
                        className="px-2.5 py-1.5 text-xs font-mono border border-slate-300 rounded-md"
                      />
                      <button
                        type="button"
                        onClick={handleAddEvidenceRef}
                        className="inline-flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-md border border-slate-300 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Add Evidence
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {isAssignedAgent && (
                <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-slate-100">
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => handleSaveNotes(true)}
                    className="px-3 py-1.5 rounded-md border border-slate-300 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
                  >
                    Resolve at L1
                  </button>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => handleSaveNotes(false)}
                    className="px-3.5 py-1.5 rounded-md bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700 cursor-pointer"
                  >
                    Save Notes & Evidence
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Engineering Escalation Submission Form */}
          {workflow && (
            <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-display font-semibold text-slate-900">
                    Evidence-Backed Engineering Handoff
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Only the assigned Support Agent can escalate after completing an Operations-approved checklist.
                  </p>
                </div>
                <div className="text-xs font-mono text-slate-600">
                  {checklistApproved && mandatoryAllDone && notes.trim().length >= 10
                    ? 'Validation: Ready'
                    : 'Validation: Incomplete'}
                </div>
              </div>

              {activeEscalation ? (
                <div className="p-3 rounded-md bg-indigo-50 border border-indigo-200 text-xs text-indigo-800">
                  Handoff #{activeEscalation.handoffNumber} is currently{' '}
                  <strong>{activeEscalation.status.replace(/_/g, ' ')}</strong>. Duplicate escalation submissions are blocked until Engineering completes review.
                </div>
              ) : isAssignedAgent ? (
                <form onSubmit={handleSubmitEscalation} className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Problem Summary
                      </label>
                      <input
                        type="text"
                        required
                        value={problemSummary}
                        onChange={(e) => setProblemSummary(e.target.value)}
                        className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-md"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Business Impact
                      </label>
                      <input
                        type="text"
                        required
                        value={businessImpact}
                        onChange={(e) => setBusinessImpact(e.target.value)}
                        className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-md"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Expected Behavior
                      </label>
                      <input
                        type="text"
                        required
                        value={expectedBehavior}
                        onChange={(e) => setExpectedBehavior(e.target.value)}
                        className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-md"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Actual Observed Behavior
                      </label>
                      <input
                        type="text"
                        required
                        value={actualBehavior}
                        onChange={(e) => setActualBehavior(e.target.value)}
                        className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-md"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      L1 Diagnostic Steps Performed
                    </label>
                    <textarea
                      rows={2}
                      required
                      value={stepsPerformed}
                      onChange={(e) => setStepsPerformed(e.target.value)}
                      className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-md"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Diagnostic Evidence (IDs, Logs, Config Verified)
                    </label>
                    <textarea
                      rows={2}
                      required
                      value={diagnosticEvidence}
                      onChange={(e) => setDiagnosticEvidence(e.target.value)}
                      className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-md"
                    />
                  </div>
                  <div className="flex justify-end">
                    <button
                      type="submit"
                      disabled={saving}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700 disabled:opacity-50 cursor-pointer"
                    >
                      <Send className="w-3.5 h-3.5" />
                      Submit Engineering Escalation
                    </button>
                  </div>
                </form>
              ) : (
                <div className="text-xs text-slate-500">
                  {user?.role === 'support_manager' || user?.role === 'engineering_manager'
                    ? 'Managers cannot submit support escalations (RBAC enforced).'
                    : 'Only the assigned Support Agent can submit an escalation for this ticket.'}
                </div>
              )}

              {/* Existing Escalations History */}
              {escalations.length > 0 && (
                <div className="pt-3 border-t border-slate-200 space-y-3">
                  <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Escalation Handoff History
                  </div>
                  {escalations.map((esc) => (
                    <div
                      key={esc.id}
                      className="p-3 rounded-md bg-slate-50 border border-slate-200 space-y-1.5 text-xs"
                    >
                      <div className="flex items-center justify-between font-medium text-slate-900">
                        <span>
                          Handoff #{esc.handoffNumber} · Submitted by {esc.submittedByName}
                        </span>
                        <span className="font-mono text-indigo-700">
                          {esc.engOutcome || esc.status.replace(/_/g, ' ')}
                        </span>
                      </div>
                      <div className="text-slate-700">{esc.problemSummary}</div>
                      {esc.returnReason && (
                        <div className="text-amber-800 bg-amber-50 p-2 rounded border border-amber-200">
                          <strong>Return Reason:</strong> {esc.returnReason}
                        </div>
                      )}
                      {esc.engNotes && (
                        <div className="text-slate-600">
                          <strong>Engineering Notes ({esc.reviewedByName}):</strong> {esc.engNotes}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right 5 cols: AI Investigation Copilot + Audit Trail */}
        <div className="xl:col-span-5 space-y-6">
          <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Bot className="w-4 h-4 text-indigo-600" />
                <h2 className="text-sm font-display font-semibold text-slate-900">
                  AI Investigation Assistant
                </h2>
              </div>
              <span className="text-[11px] font-mono text-slate-500">
                Historical Retrieval
              </span>
            </div>

            <div className="space-y-2">
              <input
                type="text"
                value={customAiQuery}
                onChange={(e) => setCustomAiQuery(e.target.value)}
                placeholder="Optional focus (e.g., frozen GPS after driver shift change)..."
                className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-md"
              />
              <button
                type="button"
                disabled={aiLoading}
                onClick={handleRunAi}
                className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-md bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700 disabled:opacity-50 cursor-pointer"
              >
                <Sparkles className="w-3.5 h-3.5" />
                {aiLoading
                  ? 'Retrieving similar historical cases...'
                  : 'Diagnose & Retrieve Similar Historical Tickets'}
              </button>
            </div>

            {aiResult && (
              <div className="space-y-4 pt-2 border-t border-slate-200 text-xs">
                <div className="text-[11px] font-mono text-slate-500">
                  Method: {aiResult.retrievalMethod} · Synthesis: {aiResult.aiSynthesisMode}
                </div>

                <div>
                  <div className="font-semibold text-slate-800 mb-1">
                    Historical Pattern Diagnosis
                  </div>
                  <p className="text-slate-700 leading-relaxed">{aiResult.diagnosisSummary}</p>
                </div>

                <div>
                  <div className="font-semibold text-slate-800 mb-1">
                    AI-Recommended Next Steps (Not Yet Executed)
                  </div>
                  <ul className="space-y-1 list-disc pl-4 text-slate-700">
                    {aiResult.suggestedSteps.map((st, idx) => (
                      <li key={idx}>{st}</li>
                    ))}
                  </ul>
                </div>

                <div className="p-2.5 rounded bg-slate-50 border border-slate-200 text-slate-600">
                  <strong>Evidence Scope & Uncertainty:</strong> {aiResult.confidenceNote}
                </div>

                <div>
                  <div className="font-semibold text-slate-800 mb-1.5">
                    Similar Historical Tickets ({aiResult.similarTickets.length})
                  </div>
                  <div className="divide-y divide-slate-200 border border-slate-200 rounded-md">
                    {aiResult.similarTickets.map((st) => (
                      <div key={st.ticketId} className="p-2.5 space-y-0.5">
                        <div className="flex items-center justify-between font-mono">
                          <span className="font-semibold text-indigo-700">{st.ticketId}</span>
                          <span className="text-slate-500">
                            sim {(st.similarityScore * 100).toFixed(0)}% ·{' '}
                            {st.engOutcome || (st.escalatedToEng ? 'Escalated' : 'L1 Closed')}
                          </span>
                        </div>
                        <div className="text-slate-700">{st.description}</div>
                        <div className="text-[11px] text-slate-500 font-mono">
                          {st.clientName} ({st.clientTier}) · {st.engHandoffs} handoffs ·{' '}
                          {st.resolutionHours !== null ? `${st.resolutionHours}h` : 'Open'}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {isAssignedAgent && (
                  <button
                    type="button"
                    onClick={() => applyDraftHandoff(aiResult.draftHandoff)}
                    className="w-full py-2 px-3 rounded-md border border-indigo-300 bg-indigo-50 text-indigo-700 font-medium hover:bg-indigo-100 cursor-pointer"
                  >
                    Apply AI Draft to Escalation Handoff Form
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Audit Trail */}
          <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-3">
            <h2 className="text-sm font-display font-semibold text-slate-900">
              Ticket Audit Trail
            </h2>
            {auditTrail.length === 0 ? (
              <p className="text-xs text-slate-500">No live ResolveIQ events recorded yet for this ticket.</p>
            ) : (
              <div className="divide-y divide-slate-100 text-xs">
                {auditTrail.map((log) => (
                  <div key={log.id} className="py-2">
                    <div className="flex items-center justify-between">
                      <span className="font-mono font-semibold text-slate-800">
                        {log.actionType}
                      </span>
                      <span className="font-mono text-[11px] text-slate-400">
                        {new Date(log.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <div className="text-slate-600 mt-0.5">
                      {log.actorName} ({log.actorRole})
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
