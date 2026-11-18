import React, { useCallback, useEffect, useState } from 'react';
import { Check, Plus, Shield, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import { apiRequest } from '../lib/api.ts';
import type { UserRole } from '../types/index.ts';

interface ChecklistAdminRow {
  id: number;
  category: string;
  title: string;
  description: string;
  isProposedDemo: boolean;
  status: 'pending_approval' | 'approved' | 'rejected';
  version: number;
  approvedByName: string | null;
  approvedAt: string | null;
  approvalNotes: string | null;
  items: Array<{
    id: number;
    sortOrder: number;
    label: string;
    guidance: string;
    isMandatory: boolean;
    allowFailEscalation: boolean;
  }>;
}

interface AdminUserRow {
  id: number;
  email: string;
  name: string;
  designation: string;
  role: UserRole;
  hasGlobalClientAccess: boolean;
  isActive: boolean;
  clientIds: string[];
}

interface ClientOption {
  clientId: string;
  clientName: string;
  clientTier: string;
}

interface AuditRow {
  id: number;
  actorName: string;
  actorRole: string;
  actionType: string;
  entityType: string;
  entityId: string;
  ticketId: string | null;
  detailsJson: Record<string, unknown>;
  createdAt: string;
}

export function AdminPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'platform_admin';

  const [tab, setTab] = useState<'checklists' | 'users' | 'audit'>(
    isAdmin ? 'checklists' : 'audit'
  );
  const [checklists, setChecklists] = useState<ChecklistAdminRow[]>([]);
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditRow[]>([]);
  const [banner, setBanner] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [loading, setLoading] = useState(true);

  // Add item form state
  const [addingItemForId, setAddingItemForId] = useState<number | null>(null);
  const [newItemLabel, setNewItemLabel] = useState('');
  const [newItemGuidance, setNewItemGuidance] = useState('');

  // Create user state
  const [newUserName, setNewUserName] = useState('');
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserDesignation, setNewUserDesignation] = useState('Support Agent');
  const [newUserRole, setNewUserRole] = useState<UserRole>('support_agent');
  const [newUserGlobal, setNewUserGlobal] = useState(true);

  // Client scope editor state
  const [editingAccessUserId, setEditingAccessUserId] = useState<number | null>(null);
  const [scopeGlobal, setScopeGlobal] = useState(true);
  const [scopeClientIds, setScopeClientIds] = useState<string[]>([]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [clRes, logRes] = await Promise.all([
        apiRequest<{ checklists: ChecklistAdminRow[] }>('/api/checklists'),
        apiRequest<{ logs: AuditRow[] }>('/api/admin/audit-logs?limit=100'),
      ]);
      setChecklists(clRes.checklists);
      setAuditLogs(logRes.logs);

      if (isAdmin) {
        const [uRes, cRes] = await Promise.all([
          apiRequest<{ users: AdminUserRow[] }>('/api/admin/users'),
          apiRequest<{ clients: ClientOption[] }>('/api/clients'),
        ]);
        setUsers(uRes.users);
        setClients(cRes.clients);
      }
    } catch (err) {
      setBanner({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to load admin data.',
      });
    } finally {
      setLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const handleChecklistDecision = async (
    id: number,
    decision: 'approved' | 'rejected'
  ) => {
    setBanner(null);
    try {
      await apiRequest(`/api/checklists/${id}/decision`, {
        method: 'POST',
        body: JSON.stringify({
          decision,
          approvalNotes:
            decision === 'approved'
              ? 'Approved by Operations for ResolveIQ L1 investigation workflows.'
              : 'Rejected by Operations pending revision.',
        }),
      });
      setBanner({
        type: 'ok',
        text: `Checklist #${id} marked as ${decision}.`,
      });
      await loadAll();
    } catch (err) {
      setBanner({
        type: 'err',
        text: err instanceof Error ? err.message : 'Checklist decision failed.',
      });
    }
  };

  const handleAddChecklistItem = async (checklistId: number) => {
    if (!newItemLabel.trim() || !newItemGuidance.trim()) return;
    try {
      await apiRequest(`/api/checklists/${checklistId}/items`, {
        method: 'POST',
        body: JSON.stringify({
          label: newItemLabel.trim(),
          guidance: newItemGuidance.trim(),
          isMandatory: true,
          allowFailEscalation: true,
        }),
      });
      setAddingItemForId(null);
      setNewItemLabel('');
      setNewItemGuidance('');
      setBanner({ type: 'ok', text: 'Checklist step added.' });
      await loadAll();
    } catch (err) {
      setBanner({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to add step.',
      });
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setBanner(null);
    try {
      await apiRequest('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify({
          name: newUserName,
          email: newUserEmail,
          designation: newUserDesignation,
          role: newUserRole,
          hasGlobalClientAccess: newUserGlobal,
        }),
      });
      setNewUserName('');
      setNewUserEmail('');
      setBanner({ type: 'ok', text: 'User account created (default password ResolveIQ!2026).' });
      await loadAll();
    } catch (err) {
      setBanner({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to create user.',
      });
    }
  };

  const handleSaveClientScope = async () => {
    if (!editingAccessUserId) return;
    try {
      await apiRequest(`/api/admin/users/${editingAccessUserId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          hasGlobalClientAccess: scopeGlobal,
          clientIds: scopeGlobal ? [] : scopeClientIds,
        }),
      });
      setEditingAccessUserId(null);
      setBanner({ type: 'ok', text: 'User client access scope updated.' });
      await loadAll();
    } catch (err) {
      setBanner({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to update client access.',
      });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-display font-bold text-slate-900">
            Operations Governance & Audit
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Checklist approval workflow, RBAC user & client-access controls, and immutable audit trail.
          </p>
        </div>

        <div className="inline-flex rounded-md border border-slate-200 bg-white p-0.5 text-xs font-medium">
          <button
            type="button"
            onClick={() => setTab('checklists')}
            className={`px-3 py-1.5 rounded cursor-pointer ${
              tab === 'checklists'
                ? 'bg-indigo-600 text-white'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Checklists ({checklists.length})
          </button>
          {isAdmin && (
            <button
              type="button"
              onClick={() => setTab('users')}
              className={`px-3 py-1.5 rounded cursor-pointer ${
                tab === 'users'
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Users & Client Access ({users.length})
            </button>
          )}
          <button
            type="button"
            onClick={() => setTab('audit')}
            className={`px-3 py-1.5 rounded cursor-pointer ${
              tab === 'audit'
                ? 'bg-indigo-600 text-white'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Audit Trail ({auditLogs.length})
          </button>
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

      {loading ? (
        <div className="py-10 text-sm text-slate-500">Loading governance records...</div>
      ) : tab === 'checklists' ? (
        <div className="space-y-4">
          {checklists.map((cl) => (
            <div key={cl.id} className="bg-white border border-slate-200 rounded-lg p-5 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 text-xs font-mono">
                    <span className="font-semibold text-indigo-700">{cl.category}</span>
                    <span className="text-slate-300">·</span>
                    <span
                      className={`font-semibold uppercase ${
                        cl.status === 'approved'
                          ? 'text-emerald-700'
                          : cl.status === 'rejected'
                            ? 'text-rose-700'
                            : 'text-amber-700'
                      }`}
                    >
                      {cl.status.replace(/_/g, ' ')}
                    </span>
                    <span className="text-slate-300">·</span>
                    <span className="text-slate-500">v{cl.version}</span>
                  </div>
                  <h2 className="text-sm font-display font-semibold text-slate-900 mt-1">
                    {cl.title}
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">{cl.description}</p>
                  {cl.approvedByName && (
                    <div className="text-[11px] text-slate-500 mt-1">
                      Approved by {cl.approvedByName}
                    </div>
                  )}
                </div>

                {isAdmin && (
                  <div className="flex items-center gap-2 shrink-0">
                    {cl.status !== 'approved' && (
                      <button
                        type="button"
                        onClick={() => handleChecklistDecision(cl.id, 'approved')}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700 cursor-pointer"
                      >
                        <Check className="w-3.5 h-3.5" />
                        Approve Checklist
                      </button>
                    )}
                    {cl.status !== 'rejected' && (
                      <button
                        type="button"
                        onClick={() => handleChecklistDecision(cl.id, 'rejected')}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md border border-slate-300 bg-white text-xs font-medium text-slate-700 hover:bg-rose-50 hover:text-rose-700 cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                        Reject
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() =>
                        setAddingItemForId(addingItemForId === cl.id ? null : cl.id)
                      }
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-slate-300 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Add Step
                    </button>
                  </div>
                )}
              </div>

              <div className="divide-y divide-slate-100 border-t border-slate-100 text-xs">
                {cl.items.map((it) => (
                  <div key={it.id} className="py-2 flex items-start justify-between gap-4">
                    <div>
                      <span className="font-medium text-slate-800">
                        {it.sortOrder}. {it.label}
                      </span>
                      <div className="text-slate-500 mt-0.5">{it.guidance}</div>
                    </div>
                    <span className="font-mono text-[11px] text-slate-400 shrink-0">
                      {it.isMandatory ? 'Mandatory' : 'Optional'} ·{' '}
                      {it.allowFailEscalation ? 'Fail->Esc OK' : 'Fail blocks Esc'}
                    </span>
                  </div>
                ))}
              </div>

              {addingItemForId === cl.id && (
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-md grid grid-cols-1 sm:grid-cols-12 gap-2 items-center">
                  <input
                    type="text"
                    value={newItemLabel}
                    onChange={(e) => setNewItemLabel(e.target.value)}
                    placeholder="Step label..."
                    className="sm:col-span-4 px-2.5 py-1.5 text-xs border border-slate-300 rounded bg-white"
                  />
                  <input
                    type="text"
                    value={newItemGuidance}
                    onChange={(e) => setNewItemGuidance(e.target.value)}
                    placeholder="Verification guidance..."
                    className="sm:col-span-6 px-2.5 py-1.5 text-xs border border-slate-300 rounded bg-white"
                  />
                  <button
                    type="button"
                    onClick={() => handleAddChecklistItem(cl.id)}
                    className="sm:col-span-2 py-1.5 px-3 rounded bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700 cursor-pointer"
                  >
                    Save Step
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : tab === 'users' && isAdmin ? (
        <div className="space-y-6">
          <form
            onSubmit={handleCreateUser}
            className="bg-white border border-slate-200 rounded-lg p-5 grid grid-cols-1 sm:grid-cols-12 gap-3 items-end"
          >
            <div className="sm:col-span-3">
              <label className="block text-xs font-medium text-slate-700 mb-1">Name</label>
              <input
                type="text"
                required
                value={newUserName}
                onChange={(e) => setNewUserName(e.target.value)}
                placeholder="Ananya Rao"
                className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-md"
              />
            </div>
            <div className="sm:col-span-3">
              <label className="block text-xs font-medium text-slate-700 mb-1">Email</label>
              <input
                type="email"
                required
                value={newUserEmail}
                onChange={(e) => setNewUserEmail(e.target.value)}
                placeholder="ananya@rideops.io"
                className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-md"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-700 mb-1">Role</label>
              <select
                value={newUserRole}
                onChange={(e) => setNewUserRole(e.target.value as UserRole)}
                className="w-full px-2.5 py-1.5 text-sm border border-slate-300 rounded-md bg-white"
              >
                <option value="support_agent">Support Agent</option>
                <option value="support_manager">Support Manager</option>
                <option value="engineering_manager">Engineering Manager</option>
                <option value="platform_admin">Platform Admin</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Designation
              </label>
              <input
                type="text"
                required
                value={newUserDesignation}
                onChange={(e) => setNewUserDesignation(e.target.value)}
                className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-md"
              />
            </div>
            <div className="sm:col-span-2 flex items-center gap-2">
              <label className="flex items-center gap-1 text-xs text-slate-600">
                <input
                  type="checkbox"
                  checked={newUserGlobal}
                  onChange={(e) => setNewUserGlobal(e.target.checked)}
                />
                Global
              </label>
              <button
                type="submit"
                className="flex-1 py-1.5 px-3 rounded-md bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700 cursor-pointer"
              >
                Add User
              </button>
            </div>
          </form>

          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-[11px] uppercase tracking-wider text-slate-500">
                  <th className="py-2.5 px-4">User</th>
                  <th className="py-2.5 px-4">Role & Designation</th>
                  <th className="py-2.5 px-4">Client Access Scope</th>
                  <th className="py-2.5 px-4 text-right">Manage Scope</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {users.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-50">
                    <td className="py-3 px-4">
                      <div className="font-semibold text-slate-900">{u.name}</div>
                      <div className="font-mono text-slate-500">{u.email}</div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-mono text-indigo-700">{u.role}</div>
                      <div className="text-slate-600">{u.designation}</div>
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-700">
                      {u.hasGlobalClientAccess
                        ? 'Global (All 191 clients)'
                        : `Scoped (${u.clientIds.length} clients)`}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingAccessUserId(u.id);
                          setScopeGlobal(u.hasGlobalClientAccess);
                          setScopeClientIds(u.clientIds);
                        }}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-300 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
                      >
                        <Shield className="w-3.5 h-3.5" />
                        Configure Clients
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {editingAccessUserId !== null && (
            <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-display font-semibold text-slate-900">
                  Edit Client Access Scope for User #{editingAccessUserId}
                </h3>
                <button
                  type="button"
                  onClick={() => setEditingAccessUserId(null)}
                  className="text-xs text-slate-500 hover:text-slate-900 cursor-pointer"
                >
                  Cancel
                </button>
              </div>
              <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700">
                <input
                  type="checkbox"
                  checked={scopeGlobal}
                  onChange={(e) => setScopeGlobal(e.target.checked)}
                />
                Allow Global Access to All Corporate Clients
              </label>

              {!scopeGlobal && (
                <div className="max-h-56 overflow-y-auto border border-slate-200 rounded-md p-3 grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                  {clients.map((cl) => {
                    const checked = scopeClientIds.includes(cl.clientId);
                    return (
                      <label key={cl.clientId} className="flex items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setScopeClientIds((prev) => [...prev, cl.clientId]);
                            } else {
                              setScopeClientIds((prev) =>
                                prev.filter((id) => id !== cl.clientId)
                              );
                            }
                          }}
                        />
                        <span className="truncate">
                          {cl.clientName} ({cl.clientId})
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={handleSaveClientScope}
                  className="px-4 py-1.5 rounded-md bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700 cursor-pointer"
                >
                  Save Client Access
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-[11px] uppercase tracking-wider text-slate-500">
                  <th className="py-2.5 px-4">Timestamp</th>
                  <th className="py-2.5 px-4">Actor</th>
                  <th className="py-2.5 px-4">Action</th>
                  <th className="py-2.5 px-4">Ticket / Entity</th>
                  <th className="py-2.5 px-4">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {auditLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50">
                    <td className="py-2.5 px-4 font-mono text-slate-500 whitespace-nowrap">
                      {new Date(log.createdAt).toLocaleString()}
                    </td>
                    <td className="py-2.5 px-4 whitespace-nowrap">
                      <span className="font-medium text-slate-900">{log.actorName}</span>{' '}
                      <span className="font-mono text-slate-400">({log.actorRole})</span>
                    </td>
                    <td className="py-2.5 px-4 font-mono font-semibold text-indigo-700 whitespace-nowrap">
                      {log.actionType}
                    </td>
                    <td className="py-2.5 px-4 font-mono text-slate-700 whitespace-nowrap">
                      {log.ticketId || `${log.entityType}:${log.entityId}`}
                    </td>
                    <td className="py-2.5 px-4 font-mono text-slate-600 max-w-md truncate">
                      {JSON.stringify(log.detailsJson)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
