import { useState, useEffect, useRef } from 'react';
import { Zap, Users, DollarSign, Clock, ChevronDown, ChevronUp, ShieldOff, Eye } from 'lucide-react';
import Layout from '../components/shared/Layout';
import StatusBadge from '../components/shared/StatusBadge';
import { SkeletonAlertCard } from '../components/shared/Skeleton';
import api from '../api/axiosConfig';
import { getSocket } from '../api/socket';

const CAMPAIGN_META = {
  DEVICE_FINGERPRINT:    { icon: '📱', color: 'border-orange-500/40 bg-orange-500/3',  label: 'Device Fingerprint Attack',   accent: 'text-orange-400' },
  MERCHANT_CLUSTER:      { icon: '🏪', color: 'border-red-500/40 bg-red-500/3',        label: 'Scam Merchant Network',       accent: 'text-red-400'    },
  ENUMERATION_CAMPAIGN:  { icon: '🔍', color: 'border-purple-500/40 bg-purple-500/3',  label: 'Card Enumeration Campaign',   accent: 'text-purple-400' },
  RELAY_FRAUD:           { icon: '📡', color: 'border-blue-500/40 bg-blue-500/3',      label: 'NFC Relay Fraud',             accent: 'text-blue-400'   },
  ACCOUNT_TAKEOVER_WAVE: { icon: '🌊', color: 'border-amber-500/40 bg-amber-500/3',   label: 'Account Takeover Wave',       accent: 'text-amber-400'  },
};

function CampaignCard({ campaign, onStatusChange }) {
  const [expanded,  setExpanded]  = useState(false);
  const [updating,  setUpdating]  = useState(false);
  const meta = CAMPAIGN_META[campaign.type] || { icon: '⚠️', color: 'border-border-mid', label: campaign.type, accent: 'text-text-sec' };

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
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    return `${Math.floor(mins/60)}h ago`;
  };

  return (
    <div className={`border rounded-xl overflow-hidden transition-all ${meta.color}`}>
      {/* Header */}
      <div className="p-5">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-start gap-3 flex-1">
            <span className="text-2xl mt-0.5">{meta.icon}</span>
            <div className="flex-1">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <span className={`text-sm font-bold ${meta.accent}`}>{campaign.title}</span>
                <StatusBadge status={campaign.severity} size="xs" />
                <StatusBadge status={campaign.status} size="xs" />
              </div>
              <p className="text-xs text-text-sec leading-relaxed">{campaign.description}</p>
            </div>
          </div>
        </div>

        {/* Stats row */}
        <div className="flex flex-wrap gap-4 my-3 py-3 border-y border-border-dim/50">
          <div className="flex items-center gap-1.5 text-xs">
            <Users size={12} className="text-text-muted" />
            <span className="text-text-muted">Affected users:</span>
            <span className="text-text-pri font-semibold font-mono">{campaign.affectedUsers?.length || 0}</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs">
            <ShieldOff size={12} className="text-text-muted" />
            <span className="text-text-muted">Alert count:</span>
            <span className="text-text-pri font-semibold font-mono">{campaign.alertCount}</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs">
            <DollarSign size={12} className="text-text-muted" />
            <span className="text-text-muted">Total exposure:</span>
            <span className="text-text-pri font-semibold">₹{Number(campaign.totalAmount).toLocaleString()}</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs">
            <Clock size={12} className="text-text-muted" />
            <span className="text-text-muted">Detected:</span>
            <span className="text-text-pri font-mono">{timeAgo(campaign.detectedAt)}</span>
          </div>
        </div>

        {/* Affected users */}
        {campaign.affectedUsers?.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {campaign.affectedUsers.slice(0, 8).map(u => (
              <span key={u} className="text-[10px] font-mono px-2 py-0.5 bg-bg-secondary border border-border-dim rounded text-text-sec">{u}</span>
            ))}
            {campaign.affectedUsers.length > 8 && (
              <span className="text-[10px] text-text-muted px-2 py-0.5">+{campaign.affectedUsers.length - 8} more</span>
            )}
          </div>
        )}

        {/* Actions */}
        {campaign.status === 'active' && (
          <div className="flex flex-wrap gap-2 mt-3">
            <button onClick={() => handleStatus('investigating')} disabled={updating}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-amber-500/10 border border-amber-500/30 text-amber-400 rounded-lg hover:bg-amber-500/15 transition-all disabled:opacity-50">
              <Eye size={12} />
              Investigate
            </button>
            <button onClick={() => handleStatus('contained')} disabled={updating}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-green-500/10 border border-green-500/30 text-green-400 rounded-lg hover:bg-green-500/15 transition-all disabled:opacity-50">
              <ShieldOff size={12} />
              Mark Contained
            </button>
            <button onClick={() => handleStatus('dismissed')} disabled={updating}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 border border-border-dim text-text-muted rounded-lg hover:border-border-mid transition-all disabled:opacity-50">
              Dismiss
            </button>
            <button onClick={() => setExpanded(e => !e)}
              className="flex items-center gap-1 text-xs text-text-muted hover:text-text-sec ml-auto">
              {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              {expanded ? 'Less' : 'Details'}
            </button>
          </div>
        )}

        {campaign.status !== 'active' && (
          <div className="text-xs text-text-muted mt-2">
            {campaign.investigatedBy && `Actioned by: ${campaign.investigatedBy}`}
          </div>
        )}
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-5 pb-4 border-t border-border-dim/50 pt-3">
          <div className="text-xs text-text-muted mb-2 uppercase tracking-widest">Common attack attribute</div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-text-sec font-mono">{campaign.commonAttribute?.key}:</span>
            <span className="text-xs text-text-pri font-mono font-semibold">{campaign.commonAttribute?.value}</span>
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

    const handleNewCampaign = (campaign) => {
      setCampaigns(prev => [campaign, ...prev]);
      setStats(prev => prev ? { ...prev, total: (prev.total || 0) + 1 } : prev);
    };
    const handleCampaignUpdated = (updated) => {
      setCampaigns(prev => prev.map(c => c._id === updated._id ? updated : c));
    };
    s.on('new-campaign', handleNewCampaign);
    s.on('campaign-updated', handleCampaignUpdated);

    return () => {
      s.off('new-campaign', handleNewCampaign);
      s.off('campaign-updated', handleCampaignUpdated);
    };
  }, []);

  const handleFilterChange = (f) => {
    setFilter(f);
    load(f);
  };

  const handleStatusChange = (id, status) => {
    setCampaigns(prev => prev.map(c => c._id === id ? { ...c, status } : c));
  };

  const FILTERS = ['active', 'investigating', 'contained', 'dismissed', 'all'];

  return (
    <Layout>
      <div className="p-6">
        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Zap size={18} className="text-brand" />
              <h1 className="text-xl font-bold text-text-pri">Threat Intelligence</h1>
            </div>
            <p className="text-sm text-text-muted">
              Campaign-level attack detection — grouped by shared attack vector across multiple alerts
            </p>
          </div>
          <button onClick={() => load(filter)}
            className="text-xs text-text-sec border border-border-dim rounded-lg px-3 py-1.5 hover:border-border-mid transition-all">
            Refresh
          </button>
        </div>

        {/* Stats row */}
        {stats && (
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 mb-6">
            {[
              { label: 'Active Campaigns',   value: stats.total   || 0, accent: 'text-red-400',    bg: 'bg-red-500/5 border-red-500/20'    },
              { label: 'Critical',           value: stats.critical || 0, accent: 'text-orange-400', bg: 'bg-orange-500/5 border-orange-500/20'},
              { label: 'Unique Attack Types', value: stats.data?.length || 0, accent: 'text-purple-400', bg: 'bg-purple-500/5 border-purple-500/20'},
              { label: 'Total Exposure', value: `₹${Number(stats.data?.reduce((s,d)=>s+d.totalAmount,0)||0).toLocaleString()}`, accent: 'text-amber-400', bg: 'bg-amber-500/5 border-amber-500/20'},
            ].map(s => (
              <div key={s.label} className={`rounded-xl border px-4 py-3 ${s.bg}`}>
                <div className="text-xs text-text-muted mb-1">{s.label}</div>
                <div className={`text-2xl font-bold font-mono ${s.accent}`}>{s.value}</div>
              </div>
            ))}
          </div>
        )}

        {/* Visa PERC callout */}
        <div className="bg-blue-500/5 border border-blue-500/20 rounded-xl p-4 mb-6">
          <div className="flex items-start gap-3">
            <span className="text-lg">🛡️</span>
            <div>
              <div className="text-sm font-semibold text-blue-400 mb-1">PERC-Aligned Detection Engine</div>
              <div className="text-xs text-text-sec leading-relaxed">
                PayGuard's campaign detector identifies 5 attack typologies aligned with Visa's Payments Ecosystem Risk and Control (PERC) threat taxonomy:
                NFC Relay Fraud, Coordinated Card Enumeration, Scam Merchant Networks, Device Fingerprint Rings, and Account Takeover Waves.
                Campaigns are auto-detected every 60 seconds across all active fraud alerts.
              </div>
            </div>
          </div>
        </div>

        {/* Filter tabs */}
        <div className="flex gap-1.5 mb-5 flex-wrap">
          {FILTERS.map(f => (
            <button key={f} onClick={() => handleFilterChange(f)}
              className={`text-xs px-3 py-1.5 rounded-lg border capitalize transition-all
                ${filter === f ? 'bg-brand text-black border-brand font-semibold' : 'border-border-dim text-text-sec hover:border-border-mid hover:text-text-pri'}`}>
              {f}
            </button>
          ))}
        </div>

        {/* Campaign list */}
        {loading ? (
          <div className="space-y-4">{Array.from({length:3}).map((_,i) => <SkeletonAlertCard key={i} />)}</div>
        ) : campaigns.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="text-4xl mb-3">🎯</div>
            <div className="text-text-sec font-medium mb-1">No campaigns detected</div>
            <div className="text-xs text-text-muted max-w-xs">
              Run the simulator with burst mode to generate enough fraud events for campaign detection to trigger.
              Campaigns require 3+ related alerts within 60 minutes.
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {campaigns.map(c => (
              <CampaignCard key={c._id} campaign={c} onStatusChange={handleStatusChange} />
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
