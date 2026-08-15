import { useState, useEffect, useRef, useMemo } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import Layout from '../components/shared/Layout';
import StatusBadge from '../components/shared/StatusBadge';
import { SkeletonAlertCard } from '../components/shared/Skeleton';
import api from '../api/axiosConfig';
import { getSocket } from '../api/socket';

const CAMPAIGN_META = {
  DEVICE_FINGERPRINT:    { label: 'Device fingerprint', color: 'text-orange-700 border-orange-300 bg-orange-50 dark:text-orange-300 dark:border-orange-800 dark:bg-orange-950/40' },
  MERCHANT_CLUSTER:      { label: 'Merchant scam net',  color: 'text-accent border-accent/40 bg-accent/5' },
  ENUMERATION_CAMPAIGN:  { label: 'Card enumeration',  color: 'text-purple-700 border-purple-300 bg-purple-50 dark:text-purple-300 dark:border-purple-800 dark:bg-purple-950/40' },
  RELAY_FRAUD:           { label: 'NFC relay fraud',    color: 'text-blue-700 border-blue-300 bg-blue-50 dark:text-blue-300 dark:border-blue-800 dark:bg-blue-950/40' },
  ACCOUNT_TAKEOVER_WAVE: { label: 'Account takeover',   color: 'text-amber-700 border-amber-300 bg-amber-50 dark:text-amber-300 dark:border-amber-800 dark:bg-amber-950/40' },
};

function CampaignCard({ campaign, index, onStatusChange }) {
  const [expanded,  setExpanded]  = useState(false);
  const [updating,  setUpdating]  = useState(false);
  const meta = CAMPAIGN_META[campaign.type] || { label: campaign.type, color: 'text-muted border-hairline-strong bg-paper' };

  const handleStatus = async (status) => {
    setUpdating(true);
    try {
      await api.patch(`/campaigns/${campaign._id}/status`, { status });
      onStatusChange(campaign._id, status);
    } catch (err) {
      console.error(err);
    } finally {
      setUpdating(false);
    }
  };

  // Relative timestamps are intentionally render-time — re-renders refresh them.
  const timeAgo = useMemo(() => {
    // eslint-disable-next-line react-hooks/purity -- render-time relative clock is intentional
    const diff = Date.now() - new Date(campaign.detectedAt).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return '<1m';
    if (m < 60) return `${m}m`;
    return `${Math.floor(m/60)}h`;
  }, [campaign.detectedAt]);

  return (
    <div className="card mb-5">
      <div className="p-7">
        <div className="flex items-start gap-6">
          <div className="font-mono text-3xl font-bold text-hairline-strong leading-none pt-1 select-none">
            {String(index).padStart(2, '0')}
          </div>
          <div className="flex-1 min-w-0">
            <div className={`tag mb-3 ${meta.color}`}>{meta.label}</div>
            <h3 className="text-2xl font-black tracking-tight leading-tight">{campaign.title}</h3>
            <div className="flex gap-3 mt-3">
              <StatusBadge status={campaign.severity} />
              <StatusBadge status={campaign.status} />
            </div>

            <p className="mt-4 text-sm text-ink-soft leading-relaxed max-w-2xl border border-hairline bg-paper p-4">
              {campaign.description}
            </p>

            <div className="flex flex-wrap gap-x-8 gap-y-2 mt-5 font-mono text-xs text-ink-soft">
              <div><span className="label mr-2">Affected</span> {campaign.affectedUsers?.length || 0}</div>
              <div><span className="label mr-2">Alerts</span> {campaign.alertCount}</div>
              <div><span className="label mr-2">Exposure</span> <span className="text-accent font-semibold tabular-nums">₹{campaign.totalAmount}</span></div>
              <div><span className="label mr-2">Detected</span> {timeAgo} ago</div>
            </div>

            {campaign.status === 'active' && (
              <div className="flex gap-3 mt-6 pt-5 border-t border-hairline flex-wrap">
                <button onClick={() => handleStatus('investigating')} disabled={updating} className="btn btn-sm btn-ghost text-amber-700 border-amber-300 hover:bg-amber-50 hover:border-amber-600 hover:text-amber-800 dark:text-amber-300 dark:border-amber-800 dark:hover:bg-amber-950/40">
                  Investigate
                </button>
                <button onClick={() => handleStatus('contained')} disabled={updating} className="btn btn-sm btn-ghost text-green-700 border-green-300 hover:bg-green-50 hover:border-green-600 hover:text-green-800 dark:text-green-300 dark:border-green-800 dark:hover:bg-green-950/40">
                  Mark contained
                </button>
                <button onClick={() => handleStatus('dismissed')} disabled={updating} className="btn btn-sm btn-ghost">
                  Dismiss
                </button>
                <button onClick={() => setExpanded(!expanded)} className="btn btn-sm btn-ghost ml-auto">
                  {expanded ? 'Hide data' : 'Show data'}
                  {expanded ? <ChevronUp size={13}/> : <ChevronDown size={13}/>}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {expanded && (
        <div className="px-7 pb-7 pt-5 border-t border-hairline bg-paper">
          <div className="label mb-2">Shared attribute</div>
          <div className="font-mono text-xs text-ink bg-card border border-hairline p-2 inline-block mb-5">
            {campaign.commonAttribute?.key}: {campaign.commonAttribute?.value}
          </div>

          <div className="label mb-2">Target vectors</div>
          <div className="flex flex-wrap gap-2">
            {campaign.affectedUsers?.map(u => (
              <span key={u} className="tag text-ink-soft bg-card">{u}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function Intelligence() {
  const [campaigns, setCampaigns] = useState([]);
  const [stats,     setStats]     = useState(null);
  const [filter,    setFilter]    = useState('active');
  const [loading,   setLoading]   = useState(true);
  const socketRef = useRef(null);

  const load = async (status = filter) => {
    setLoading(true);
    try {
      const [campRes, statsRes] = await Promise.all([
        api.get(`/campaigns?status=${status}`),
        api.get('/campaigns/stats'),
      ]);
      setCampaigns(campRes.data.data || []);
      setStats(statsRes.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional initial fetch of campaigns
  useEffect(() => { load(); }, []);

  useEffect(() => {
    socketRef.current = getSocket();
    const s = socketRef.current;
    s.on('new-campaign', c => { setCampaigns(p => [c, ...p]); setStats(p => p ? {...p, total:(p.total||0)+1}:p); });
    s.on('campaign-updated', u => setCampaigns(p => p.map(c => c._id===u._id ? u : c)));
    return () => { s.off('new-campaign'); s.off('campaign-updated'); };
  }, []);

  const FILTERS = ['active', 'investigating', 'contained', 'dismissed', 'all'];

  return (
    <Layout>
      <div className="p-10 max-w-[1200px] mx-auto">
        <div className="mb-10">
          <div className="label mb-2">03 — Intel</div>
          <h1 className="text-5xl font-black tracking-tight leading-none">Threat campaigns</h1>
          <div className="mt-3 font-mono text-xs uppercase tracking-wider text-muted">Coordinated attack patterns detected automatically</div>
        </div>

        {stats && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-10 mb-10">
            <div className="border-t-2 border-ink pt-4">
              <div className="label mb-2">Active campaigns</div>
              <div className="text-4xl font-extrabold tracking-tight text-accent">{stats.total||0}</div>
            </div>
            <div className="border-t-2 border-ink pt-4">
              <div className="label mb-2">Critical</div>
              <div className="text-4xl font-extrabold tracking-tight text-accent">{stats.critical||0}</div>
            </div>
            <div className="border-t-2 border-ink pt-4">
              <div className="label mb-2">Pattern types</div>
              <div className="text-4xl font-extrabold tracking-tight">{stats.data?.length||0}</div>
            </div>
            <div className="border-t-2 border-ink pt-4">
              <div className="label mb-2">Net exposure</div>
              <div className="text-3xl font-extrabold tracking-tight tabular-nums">₹{stats.data?.reduce((s,d)=>s+d.totalAmount,0)||0}</div>
            </div>
          </div>
        )}

        <div className="flex gap-8 mb-8 flex-wrap border-b border-hairline">
          {FILTERS.map(f => (
            <button key={f} onClick={() => { setFilter(f); load(f); }}
              className={`pb-3 font-semibold text-sm uppercase tracking-wide transition-colors -mb-px ${
                filter === f ? 'text-ink border-b-2 border-ink' : 'text-muted hover:text-ink'
              }`}>
              {f}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="space-y-4">{Array.from({length:3}).map((_,i)=><SkeletonAlertCard key={i}/>)}</div>
        ) : campaigns.length === 0 ? (
          <div className="border border-hairline p-16 text-center text-muted font-mono text-sm uppercase tracking-wider">
            No campaigns detected. All clear.
          </div>
        ) : (
          <div>{campaigns.map((c, i) => <CampaignCard key={c._id} index={i + 1} campaign={c} onStatusChange={(id,st)=>setCampaigns(p=>p.map(x=>x._id===id?{...x,status:st}:x))} />)}</div>
        )}
      </div>
    </Layout>
  );
}
