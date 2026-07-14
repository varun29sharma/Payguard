import { useState, useEffect, useRef } from 'react';
import { Zap, Users, DollarSign, Clock, ChevronDown, ChevronUp, ShieldOff, Eye, Network } from 'lucide-react';
import Layout from '../components/shared/Layout';
import StatusBadge from '../components/shared/StatusBadge';
import { SkeletonAlertCard } from '../components/shared/Skeleton';
import api from '../api/axiosConfig';
import { getSocket } from '../api/socket';

const CAMPAIGN_META = {
  DEVICE_FINGERPRINT:    { label: 'DEVICE_FINGERPRINT', color: 'border-orange-500 bg-orange-500/5', accent: 'text-orange-400' },
  MERCHANT_CLUSTER:      { label: 'MERCHANT_SCAM_NET',  color: 'border-red-500 bg-red-500/5',       accent: 'text-red-400'    },
  ENUMERATION_CAMPAIGN:  { label: 'CARD_ENUMERATION',   color: 'border-purple-500 bg-purple-500/5', accent: 'text-purple-400' },
  RELAY_FRAUD:           { label: 'NFC_RELAY_FRAUD',    color: 'border-blue-500 bg-blue-500/5',     accent: 'text-blue-400'   },
  ACCOUNT_TAKEOVER_WAVE: { label: 'ATO_WAVE',           color: 'border-amber-500 bg-amber-500/5',   accent: 'text-amber-400'  },
};

function CampaignCard({ campaign, onStatusChange }) {
  const [expanded,  setExpanded]  = useState(false);
  const [updating,  setUpdating]  = useState(false);
  const meta = CAMPAIGN_META[campaign.type] || { color: 'border-border-mid bg-bg-card', label: campaign.type, accent: 'text-text-sec' };

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

  const timeAgo = (date) => {
    const diff = Date.now() - new Date(date).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return '<1m';
    if (m < 60) return `${m}m`;
    return `${Math.floor(m/60)}h`;
  };

  return (
    <div className={`pixel-box border-2 ${meta.color} mb-4 relative`}>
      <div className={`absolute top-0 right-0 px-3 py-1 font-vt text-sm border-b-2 border-l-2 ${meta.color} bg-bg-primary ${meta.accent}`}>
        TYPE: {meta.label}
      </div>
      
      <div className="p-5">
        <h3 className={`text-2xl font-vt tracking-widest mb-3 ${meta.accent} text-shadow-pixel max-w-[80%]`}>{campaign.title}</h3>
        <div className="flex gap-2 mb-4">
          <StatusBadge status={campaign.severity} />
          <StatusBadge status={campaign.status} />
        </div>
        
        <p className="text-xs font-mono text-text-sec mb-5 max-w-2xl bg-bg-primary p-3 border border-border-dim">
          {campaign.description}
        </p>

        <div className="flex flex-wrap gap-6 font-mono text-xs text-text-pri mb-5">
          <div><span className="text-text-muted">AFFECTED:</span> {campaign.affectedUsers?.length || 0}</div>
          <div><span className="text-text-muted">ALERTS:</span> {campaign.alertCount}</div>
          <div><span className="text-text-muted">EXPOSURE:</span> <span className="text-red-400">₹{campaign.totalAmount}</span></div>
          <div><span className="text-text-muted">T_MINUS:</span> {timeAgo(campaign.detectedAt)}</div>
        </div>

        {/* Action Panel */}
        {campaign.status === 'active' && (
          <div className="flex gap-3 border-t-2 border-border-dim pt-4">
            <button onClick={() => handleStatus('investigating')} disabled={updating} className="pixel-btn px-4 py-2 text-amber-400 border-amber-500/50 text-xs">
              INVESTIGATE
            </button>
            <button onClick={() => handleStatus('contained')} disabled={updating} className="pixel-btn px-4 py-2 text-green-400 border-green-500/50 text-xs">
              MARK_CONTAINED
            </button>
            <button onClick={() => handleStatus('dismissed')} disabled={updating} className="pixel-btn px-4 py-2 text-text-sec text-xs">
              DISMISS
            </button>
            <button onClick={() => setExpanded(!expanded)} className="pixel-btn px-4 py-2 text-brand border-brand/50 text-xs ml-auto">
              {expanded ? 'HIDE_DATA' : 'SHOW_DATA'}
            </button>
          </div>
        )}
      </div>

      {expanded && (
        <div className="p-5 border-t-2 border-border-dim bg-bg-secondary">
          <div className="text-xs font-pixel text-text-muted uppercase tracking-widest mb-2">SHARED_ATTRIBUTES</div>
          <div className="font-mono text-xs text-brand bg-bg-card border border-brand/30 p-2 inline-block mb-4">
            {campaign.commonAttribute?.key}: {campaign.commonAttribute?.value}
          </div>
          
          <div className="text-xs font-pixel text-text-muted uppercase tracking-widest mb-2">TARGET_VECTORS</div>
          <div className="flex flex-wrap gap-2">
            {campaign.affectedUsers?.map(u => (
              <span key={u} className="font-mono text-[10px] bg-bg-card border border-border-dim px-2 py-1 text-text-pri">{u}</span>
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
      <div className="p-6 max-w-[1200px] mx-auto">
        
        <div className="pixel-box border-purple-500 p-5 mb-6 bg-bg-card flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Network size={32} className="text-purple-500" />
            <div>
              <h1 className="text-2xl font-vt text-purple-400 tracking-widest text-shadow-pixel">INTEL_ROOM</h1>
              <div className="text-xs font-mono text-text-sec mt-1">PERC-ALIGNED THREAT CAMPAIGNS</div>
            </div>
          </div>
          <button onClick={() => load(filter)} className="pixel-btn px-4 py-2 text-xs text-text-pri">SYNC_NETWORK</button>
        </div>

        {stats && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <div className="pixel-box p-4 border-red-500 bg-bg-card">
              <div className="text-xs font-pixel text-text-muted mb-1">ACTIVE_CAMP</div>
              <div className="text-3xl font-vt text-red-500">{stats.total||0}</div>
            </div>
            <div className="pixel-box p-4 border-orange-500 bg-bg-card">
              <div className="text-xs font-pixel text-text-muted mb-1">CRITICAL</div>
              <div className="text-3xl font-vt text-orange-400">{stats.critical||0}</div>
            </div>
            <div className="pixel-box p-4 border-purple-500 bg-bg-card">
              <div className="text-xs font-pixel text-text-muted mb-1">VECTORS</div>
              <div className="text-3xl font-vt text-purple-400">{stats.data?.length||0}</div>
            </div>
            <div className="pixel-box p-4 border-amber-500 bg-bg-card">
              <div className="text-xs font-pixel text-text-muted mb-1">NET_EXPOSURE</div>
              <div className="text-2xl font-vt text-amber-400 mt-1">₹{stats.data?.reduce((s,d)=>s+d.totalAmount,0)||0}</div>
            </div>
          </div>
        )}

        <div className="flex gap-2 mb-6 border-b-2 border-border-dim pb-4">
          {FILTERS.map(f => (
            <button key={f} onClick={() => { setFilter(f); load(f); }}
              className={`pixel-btn px-4 py-2 text-xs uppercase ${filter === f ? 'pixel-btn-brand' : 'text-text-sec'}`}>
              {f}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="space-y-4">{Array.from({length:3}).map((_,i)=><SkeletonAlertCard key={i}/>)}</div>
        ) : campaigns.length === 0 ? (
          <div className="pixel-box p-16 text-center border-border-dim font-vt text-xl text-text-muted">
            NO_CAMPAIGNS_DETECTED. ALL_CLEAR.
          </div>
        ) : (
          <div>{campaigns.map(c => <CampaignCard key={c._id} campaign={c} onStatusChange={(id,st)=>setCampaigns(p=>p.map(x=>x._id===id?{...x,status:st}:x))} />)}</div>
        )}
      </div>
    </Layout>
  );
}
