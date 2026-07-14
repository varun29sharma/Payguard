import { useState, useEffect } from 'react';
import { Toaster, toast } from 'react-hot-toast';
import Sidebar from './Sidebar';
import { getSocket } from '../../api/socket';
import bgTile from '../../assets/pixel/bg_tile.png';

export default function Layout({ children }) {
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const s = getSocket();

    s.on('connect',    () => setConnected(true));
    s.on('disconnect', () => setConnected(false));
    setConnected(s.connected);

    const handleAlert = ({ alert, transaction }) => {
      const score  = alert?.fraudScore || transaction?.fraudScore || 0;
      const userId = alert?.userId || transaction?.userId || '?';
      const rule   = alert?.rulesTriggered?.[0]?.ruleName?.replace(/_/g, ' ') || 'FRAUD';
      const isBlocked = transaction?.fraudStatus === 'blocked';

      toast.custom((t) => (
        <div className={`pixel-box p-3 shadow-[4px_4px_0_0_#000] flex items-start gap-3 transition-all ${isBlocked ? 'border-red-500 bg-red-500/10' : 'border-amber-500 bg-amber-500/10'} ${t.visible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2'}`}
             style={{ minWidth: 300 }}>
          <div className={`w-8 h-8 flex items-center justify-center border-2 ${isBlocked ? 'border-red-500 text-red-500' : 'border-amber-500 text-amber-500'} bg-bg-card flex-shrink-0 font-vt text-xl`}>
            !
          </div>
          <div className="flex-1 font-pixel">
            <div className={`text-base tracking-widest ${isBlocked ? 'text-red-400' : 'text-amber-400'}`}>
              {isBlocked ? 'SYS: BLOCKED' : 'SYS: FLAGGED'}
            </div>
            <div className="text-xs font-mono text-text-pri mt-1">
              USR: {userId} | SCR: <span className={isBlocked ? 'text-red-400' : 'text-amber-400'}>{score}</span>
            </div>
            <div className="text-[10px] text-text-muted mt-1 uppercase font-mono bg-bg-card inline-block px-1 border border-border-dim">{rule}</div>
          </div>
        </div>
      ), { duration: 6000, position: 'top-right' });
    };

    const handleCampaign = (campaign) => {
      toast.custom((t) => (
        <div className={`pixel-box border-purple-500 bg-purple-500/10 p-3 shadow-[4px_4px_0_0_#000] flex items-start gap-3 transition-all ${t.visible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2'}`}>
          <div className="w-8 h-8 flex items-center justify-center border-2 border-purple-500 bg-bg-card text-purple-500 flex-shrink-0 font-vt text-xl">
            C
          </div>
          <div className="flex-1 font-pixel">
            <div className="text-base tracking-widest text-purple-400">CAMPAIGN DETECTED</div>
            <div className="text-xs font-mono text-text-pri mt-1">{campaign.title}</div>
            <div className="text-[10px] text-text-muted mt-1 font-mono">
              ALERTS: {campaign.alertCount} | TARGETS: {campaign.affectedUsers?.length}
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
    <div className="flex h-screen bg-bg-primary overflow-hidden relative"
         style={{ backgroundImage: `url(${bgTile})`, backgroundRepeat: 'repeat', backgroundSize: '128px 128px', backgroundBlendMode: 'multiply' }}>
      <div className="crt-overlay"></div>
      <Sidebar connected={connected} />
      <main className="flex-1 overflow-y-auto relative z-10">
        {children}
      </main>
      <Toaster />
    </div>
  );
}
