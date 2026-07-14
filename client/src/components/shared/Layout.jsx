import { useState, useEffect, useRef } from 'react';
import { Toaster, toast } from 'react-hot-toast';
import Sidebar from './Sidebar';
import { getSocket } from '../../api/socket';

export default function Layout({ children }) {
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const s = getSocket();

    s.on('connect',    () => setConnected(true));
    s.on('disconnect', () => setConnected(false));
    setConnected(s.connected);

    // Global fraud alert toast — shown on every page
    const handleAlert = ({ alert, transaction }) => {
      const score  = alert?.fraudScore || transaction?.fraudScore || 0;
      const userId = alert?.userId || transaction?.userId || '?';
      const rule   = alert?.rulesTriggered?.[0]?.ruleName?.replace(/_/g, ' ') || 'FRAUD';
      const isBlocked = transaction?.fraudStatus === 'blocked';

      toast.custom((t) => (
        <div className={`flex items-start gap-3 bg-bg-card border rounded-xl px-4 py-3 shadow-xl transition-all ${isBlocked ? 'border-red-500/40' : 'border-amber-500/40'} ${t.visible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2'}`}
             style={{ minWidth: 280, maxWidth: 340 }}>
          <span className="text-xl mt-0.5">{isBlocked ? '🚨' : '⚠️'}</span>
          <div className="flex-1">
            <div className={`text-sm font-semibold ${isBlocked ? 'text-red-400' : 'text-amber-400'}`}>
              {isBlocked ? 'Transaction Blocked' : 'Flagged for Review'}
            </div>
            <div className="text-xs text-text-sec mt-0.5">
              User <span className="text-text-pri font-mono">{userId}</span> · Score{' '}
              <span className={`font-mono font-semibold ${isBlocked ? 'text-red-400' : 'text-amber-400'}`}>{score}</span>
            </div>
            <div className="text-[10px] text-text-muted mt-0.5 uppercase tracking-wide">{rule}</div>
          </div>
        </div>
      ), { duration: 6000, position: 'top-right' });
    };

    const handleCampaign = (campaign) => {
      toast.custom((t) => (
        <div className={`flex items-start gap-3 bg-bg-card border border-purple-500/40 rounded-xl px-4 py-3 shadow-xl max-w-sm transition-all ${t.visible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2'}`}>
          <span className="text-xl mt-0.5">🔴</span>
          <div className="flex-1">
            <div className="text-sm font-semibold text-purple-400">Campaign Detected</div>
            <div className="text-xs text-text-sec mt-0.5">{campaign.title}</div>
            <div className="text-[10px] text-text-muted mt-0.5">
              {campaign.alertCount} alerts · {campaign.affectedUsers?.length} users
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
    <div className="flex h-screen bg-bg-primary overflow-hidden">
      <Sidebar connected={connected} />
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
      <Toaster />
    </div>
  );
}
