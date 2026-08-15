import { useState, useEffect } from 'react';
import { Toaster, toast } from 'react-hot-toast';
import Sidebar from './Sidebar';
import { getSocket } from '../../api/socket';

export default function Layout({ children }) {
  const [connected, setConnected] = useState(() => getSocket().connected);

  useEffect(() => {
    const s = getSocket();

    s.on('connect',    () => setConnected(true));
    s.on('disconnect', () => setConnected(false));

    const handleAlert = ({ alert, transaction }) => {
      const score  = alert?.fraudScore || transaction?.fraudScore || 0;
      const userId = alert?.userId || transaction?.userId || '?';
      const rule   = alert?.rulesTriggered?.[0]?.ruleName?.replace(/_/g, ' ') || 'FRAUD';
      const isBlocked = transaction?.fraudStatus === 'blocked';

      toast.custom((t) => (
        <div className={`bg-card border ${isBlocked ? 'border-accent' : 'border-hairline-strong'} p-4 flex items-start gap-4 transition-all ${t.visible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2'}`}
             style={{ minWidth: 320 }}>
          <div className={`text-2xl font-bold leading-none mt-0.5 ${isBlocked ? 'text-accent' : 'text-ink'}`}>!</div>
          <div className="flex-1">
            <div className="text-[13px] font-semibold uppercase tracking-wide">
              {isBlocked ? 'Transaction blocked' : 'Transaction flagged'}
            </div>
            <div className="text-xs text-ink-soft mt-1 font-mono">
              USR: {userId} &nbsp;|&nbsp; SCORE: <span className={isBlocked ? 'text-accent' : ''}>{score}</span>
            </div>
            <div className="text-[11px] text-muted mt-1 uppercase font-mono">{rule}</div>
          </div>
        </div>
      ), { duration: 6000, position: 'top-right' });
    };

    const handleCampaign = (campaign) => {
      toast.custom((t) => (
        <div className={`bg-card border border-accent p-4 flex items-start gap-4 transition-all ${t.visible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2'}`}>
          <div className="text-2xl font-bold leading-none mt-0.5 text-accent">C</div>
          <div className="flex-1">
            <div className="text-[13px] font-semibold uppercase tracking-wide text-accent">Campaign detected</div>
            <div className="text-xs text-ink-soft mt-1 font-mono">{campaign.title}</div>
            <div className="text-[11px] text-muted mt-1 uppercase font-mono">
              ALERTS: {campaign.alertCount} &nbsp;|&nbsp; TARGETS: {campaign.affectedUsers?.length}
            </div>
          </div>
        </div>
      ), { duration: 8000, position: 'top-right' });
    };

    s.on('new-fraud-alert', handleAlert);
    s.on('blocked-transaction', handleAlert);
    s.on('new-campaign', handleCampaign);

    return () => {
      s.off('new-fraud-alert', handleAlert);
      s.off('blocked-transaction', handleAlert);
      s.off('new-campaign', handleCampaign);
    };
  }, []);

  return (
    <div className="flex h-screen bg-paper overflow-hidden">
      <Sidebar connected={connected} />
      <main className="flex-1 overflow-y-auto relative">
        {children}
      </main>
      <Toaster />
    </div>
  );
}
