import React, { useState } from 'react';
import { ArrowRight, KeyRound, ShieldCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import type { UserRole } from '../types/index.ts';

const ROLE_LABELS: Record<UserRole, string> = {
  platform_admin: 'Platform Admin',
  support_manager: 'Support Manager',
  engineering_manager: 'Engineering User',
  support_agent: 'Support Agent',
};

const ROLE_CAPABILITIES: Record<UserRole, string> = {
  platform_admin: 'Analytics · Users & Client Access · Approve Checklists · Audit Trail',
  support_manager: 'Adopt Tickets · Assign Agents · Monitor Investigations · Escalation Quality',
  engineering_manager: 'Review Handoffs · Return with Reason · Record Outcomes · Eng Notes',
  support_agent: 'Investigate Assigned · Run Checklists · AI Assistant · Submit Escalations',
};

export function LoginView() {
  const { personas, loginWithPassword, loginWithGoogle } = useAuth();
  const [email, setEmail] = useState('ritika@rideops.io');
  const [password, setPassword] = useState('ResolveIQ!2026');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await loginWithPassword(email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleQuickSignIn = async (personaEmail: string) => {
    setEmail(personaEmail);
    setPassword('ResolveIQ!2026');
    setError(null);
    setSubmitting(true);
    try {
      await loginWithPassword(personaEmail, 'ResolveIQ!2026');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogleLogin = async () => {
    setError(null);
    setSubmitting(true);
    try {
      await loginWithGoogle();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google sign-in failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <div className="w-full max-w-5xl grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Product Framing */}
        <div className="lg:col-span-7 space-y-6 pt-2">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-indigo-600 text-white flex items-center justify-center font-display font-bold text-base">
              IQ
            </div>
            <div>
              <div className="font-display font-bold text-lg text-slate-900 leading-tight">
                ResolveIQ
              </div>
              <div className="text-xs text-slate-500">
                RideOps Support Investigation & Engineering Escalation Intelligence
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <h1 className="text-3xl font-display font-bold text-slate-900 leading-tight">
              Structured ticket investigations and evidence-backed engineering handoffs.
            </h1>
            <p className="text-sm text-slate-600 leading-relaxed max-w-xl">
              ResolveIQ transforms RideOps support tickets into auditable L1 investigations,
              AI-assisted historical similarity diagnoses, and validated engineering
              escalations—reducing insufficient-information and configuration returns without
              increasing headcount.
            </p>
          </div>

          {/* Demo Personas Switchboard */}
          <div className="bg-white border border-slate-200 rounded-lg divide-y divide-slate-200">
            <div className="px-4 py-3 flex items-center justify-between">
              <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Demo Personas (Password: <span className="font-mono text-slate-800">ResolveIQ!2026</span>)
              </div>
              <span className="text-xs text-slate-500">One-click workspace entry</span>
            </div>

            {personas.map((p) => (
              <div
                key={p.id}
                className="px-4 py-3 flex items-center justify-between gap-4 hover:bg-slate-50 transition-colors"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                    <span>{p.name}</span>
                    <span className="text-slate-300">·</span>
                    <span className="text-xs font-medium text-indigo-600">
                      {p.designation}
                    </span>
                    <span className="text-slate-300">·</span>
                    <span className="text-xs font-mono text-slate-500">
                      {ROLE_LABELS[p.role]}
                    </span>
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5 truncate">
                    {p.email} · {ROLE_CAPABILITIES[p.role]}
                    {!p.hasGlobalClientAccess ? ' · Scoped client access' : ''}
                  </div>
                </div>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => handleQuickSignIn(p.email)}
                  className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 hover:border-slate-400 disabled:opacity-50 cursor-pointer"
                >
                  Enter
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Sign-in Card */}
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-lg p-6 space-y-5">
          <div>
            <h2 className="text-lg font-display font-semibold text-slate-900">
              Sign in to ResolveIQ
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              Permissions and client data scopes are enforced server-side per account.
            </p>
          </div>

          {error && (
            <div className="p-3 rounded-md bg-rose-50 border border-rose-200 text-xs text-rose-700">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Work Email
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                placeholder="name@rideops.io"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Password
              </label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-md bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 cursor-pointer"
            >
              <KeyRound className="w-4 h-4" />
              {submitting ? 'Signing in...' : 'Sign in with Credentials'}
            </button>
          </form>

          <div className="relative flex items-center py-1">
            <div className="flex-grow border-t border-slate-200" />
            <span className="shrink mx-3 text-xs text-slate-400">or</span>
            <div className="flex-grow border-t border-slate-200" />
          </div>

          <button
            type="button"
            disabled={submitting}
            onClick={handleGoogleLogin}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-md bg-white border border-slate-300 text-slate-700 text-sm font-medium hover:bg-slate-50 disabled:opacity-50 cursor-pointer"
          >
            <ShieldCheck className="w-4 h-4 text-slate-500" />
            Continue with Google SSO
          </button>
        </div>
      </div>
    </div>
  );
}
