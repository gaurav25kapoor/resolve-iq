import React, { useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext.tsx';
import { LoginView } from './components/LoginView.tsx';
import { Sidebar, type NavPageId } from './components/Sidebar.tsx';
import { OverviewPage } from './components/OverviewPage.tsx';
import { TicketInboxPage } from './components/TicketInboxPage.tsx';
import { InvestigationsListPage } from './components/InvestigationsListPage.tsx';
import { InvestigationWorkspace } from './components/InvestigationWorkspace.tsx';
import { AIAssistantPage } from './components/AIAssistantPage.tsx';
import { EngineeringPage } from './components/EngineeringPage.tsx';
import { AnalyticsPage } from './components/AnalyticsPage.tsx';
import { AdminPage } from './components/AdminPage.tsx';

function ResolveIQShell() {
  const { user, loading } = useAuth();
  const [activePage, setActivePage] = useState<NavPageId>('overview');
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center text-sm text-slate-500">
        Loading ResolveIQ...
      </div>
    );
  }

  if (!user) {
    return <LoginView />;
  }

  const handleNavigate = (page: NavPageId) => {
    setSelectedTicketId(null);
    setActivePage(page);
  };

  const handleOpenTicket = (ticketId: string) => {
    setSelectedTicketId(ticketId);
    setActivePage('investigations');
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <Sidebar
        activePage={activePage}
        onNavigate={handleNavigate}
        mobileOpen={mobileOpen}
        onToggleMobile={() => setMobileOpen((v) => !v)}
      />

      <main className="lg:pl-64">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          {selectedTicketId ? (
            <InvestigationWorkspace
              ticketId={selectedTicketId}
              onBack={() => setSelectedTicketId(null)}
            />
          ) : activePage === 'overview' ? (
            <OverviewPage onNavigate={handleNavigate} />
          ) : activePage === 'inbox' ? (
            <TicketInboxPage onOpenTicket={handleOpenTicket} />
          ) : activePage === 'my-tickets' ? (
            <InvestigationsListPage mineOnly={true} onOpenTicket={handleOpenTicket} />
          ) : activePage === 'investigations' ? (
            <InvestigationsListPage mineOnly={false} onOpenTicket={handleOpenTicket} />
          ) : activePage === 'ai-assistant' ? (
            <AIAssistantPage onOpenTicket={handleOpenTicket} />
          ) : activePage === 'engineering' ? (
            <EngineeringPage onOpenTicket={handleOpenTicket} />
          ) : activePage === 'analytics' ? (
            <AnalyticsPage />
          ) : (
            <AdminPage />
          )}
        </div>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <ResolveIQShell />
    </AuthProvider>
  );
}
