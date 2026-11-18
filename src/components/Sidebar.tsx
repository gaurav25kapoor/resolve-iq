import React from 'react';
import {
  BarChart3,
  Bot,
  ClipboardCheck,
  Inbox,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings,
  UserCheck,
  Wrench,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import type { UserRole } from '../types/index.ts';

export type NavPageId =
  | 'overview'
  | 'inbox'
  | 'my-tickets'
  | 'investigations'
  | 'ai-assistant'
  | 'engineering'
  | 'analytics'
  | 'admin';

interface SidebarProps {
  activePage: NavPageId;
  onNavigate: (page: NavPageId) => void;
  mobileOpen: boolean;
  onToggleMobile: () => void;
}

const ROLE_DISPLAY: Record<UserRole, string> = {
  platform_admin: 'Platform Admin',
  support_manager: 'Support Manager',
  engineering_manager: 'Engineering User',
  support_agent: 'Support Agent',
};

export function Sidebar({
  activePage,
  onNavigate,
  mobileOpen,
  onToggleMobile,
}: SidebarProps) {
  const { user, logout } = useAuth();
  if (!user) return null;

  const navItems: Array<{
    id: NavPageId;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    visible: boolean;
  }> = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard, visible: true },
    { id: 'inbox', label: 'Ticket Inbox', icon: Inbox, visible: true },
    {
      id: 'my-tickets',
      label: 'My Assigned Tickets',
      icon: UserCheck,
      visible: user.role === 'support_agent' || user.role === 'platform_admin',
    },
    { id: 'investigations', label: 'Investigations', icon: ClipboardCheck, visible: true },
    { id: 'ai-assistant', label: 'AI Assistant', icon: Bot, visible: true },
    { id: 'engineering', label: 'Engineering', icon: Wrench, visible: true },
    { id: 'analytics', label: 'Analytics', icon: BarChart3, visible: true },
    {
      id: 'admin',
      label: 'Admin',
      icon: Settings,
      visible:
        user.role === 'platform_admin' ||
        user.role === 'support_manager' ||
        user.role === 'engineering_manager',
    },
  ];

  const handleNav = (id: NavPageId) => {
    onNavigate(id);
    if (mobileOpen) onToggleMobile();
  };

  const sidebarBody = (
    <div className="h-full flex flex-col bg-white border-r border-slate-200 w-64">
      <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-md bg-indigo-600 text-white flex items-center justify-center font-display font-bold text-sm">
            IQ
          </div>
          <div>
            <div className="font-display font-bold text-sm text-slate-900 leading-none">
              ResolveIQ
            </div>
            <div className="text-[11px] text-slate-500 mt-1 leading-none">
              RideOps Operations
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={onToggleMobile}
          className="lg:hidden p-1 text-slate-500 hover:text-slate-900"
          aria-label="Close navigation"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {navItems
          .filter((item) => item.visible)
          .map((item) => {
            const Icon = item.icon;
            const isActive = activePage === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleNav(item.id)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-colors cursor-pointer ${
                  isActive
                    ? 'bg-indigo-50 text-indigo-700'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                <Icon
                  className={`w-4 h-4 ${isActive ? 'text-indigo-600' : 'text-slate-400'}`}
                />
                <span>{item.label}</span>
              </button>
            );
          })}
      </nav>

      {/* Bottom User Card */}
      <div className="p-3 border-t border-slate-200 space-y-3">
        <div className="px-2">
          <div className="text-sm font-semibold text-slate-900 truncate">{user.name}</div>
          <div className="text-xs text-slate-600 truncate">{user.designation}</div>
          <div className="mt-1">
            <span className="inline-flex items-center rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700">
              {ROLE_DISPLAY[user.role]}
            </span>
          </div>
          <div className="text-[11px] font-mono text-slate-500 mt-1">
            {ROLE_DISPLAY[user.role]} ·{' '}
            {user.hasGlobalClientAccess
              ? 'All Clients'
              : `${user.accessibleClientIds?.length ?? 0} Scoped Clients`}
          </div>
        </div>

        <div>
          <button
            type="button"
            onClick={() => logout()}
            className="w-full inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-rose-50 hover:text-rose-700 hover:border-rose-200 cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            Logout
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile Header */}
      <div className="lg:hidden sticky top-0 z-30 bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-md bg-indigo-600 text-white flex items-center justify-center font-display font-bold text-xs">
            IQ
          </div>
          <span className="font-display font-bold text-sm text-slate-900">ResolveIQ</span>
        </div>
        <button
          type="button"
          onClick={onToggleMobile}
          className="p-1.5 rounded-md border border-slate-200 text-slate-700"
          aria-label="Open navigation"
        >
          <Menu className="w-4 h-4" />
        </button>
      </div>

      {/* Desktop Fixed Sidebar */}
      <aside className="hidden lg:block fixed inset-y-0 left-0 z-20">{sidebarBody}</aside>

      {/* Mobile Drawer */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-40 flex">
          <div className="fixed inset-0 bg-slate-900/40" onClick={onToggleMobile} />
          <div className="relative z-10">{sidebarBody}</div>
        </div>
      )}
    </>
  );
}
