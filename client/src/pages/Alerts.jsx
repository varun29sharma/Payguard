import { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import {
  ShieldAlert, UserX, Smartphone, AlertTriangle,
  CheckCircle, XCircle, ChevronDown, ChevronUp,
  Clock, DollarSign, MapPin, Cpu
} from 'lucide-react';
import Layout from '../components/shared/Layout';
import StatusBadge from '../components/shared/StatusBadge';
import FraudScore from '../components/shared/FraudScore';
import { SkeletonAlertCard } from '../components/shared/Skeleton';
import api from '../api/axiosConfig';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:3000';

const RULE_LABELS = {
  VELOCITY_RULE:           { label: 'Velocity',           color: 'text-red-400    bg-red-500/10    border-red-500/20'    },
  ENUMERATION_ATTACK_RULE: { label: 'Enumeration Attack', color: 'text-purple-400 bg-purple-500/10 border-purple-500/20' },
  AMOUNT_THRESHOLD_RULE:   { label: 'Amount Threshold',   color: 'text-amber-400  bg-amber-500/10  border-amber-500/20'  },
  GEOGRAPHIC_ANOMALY_RULE: { label: 'Geo Anomaly',        color: 'text-blue-400   bg-blue-500/10   border-blue-500/20'   },
  NEW_DEVICE_RULE:         { label: 'New Device',         color: 'text-orange-400 bg-orange-500/10 border-orange-500/20' },
  NIGHT_OWL_RULE:          { label: 'Night Owl',          color: 'text-indigo-400 bg-indigo-500/10 border-indigo-500/20' },
  BLOCK_LIST:              { label: 'Block List',         color: 'text-red-300    bg-red-500/15    border-red-500/30'    },
};

function AlertCard({ alert, onUpdate }) {
  const [expanded,  setExpanded]  = useState(false);
  const [loading,   setLoading]   = useState(false);
  const [showEscModal, setShowEscModal] = useState(false);
  const [escNotes,  setEscNotes]  = useState('');
  const [timeline,  setTimeline]  = useState(null);
  const [loadingTl, setLoadingTl] = useState(false);

  const txn = alert.transaction;
  const isOpen = alert.status === 'open';

  const scoreColor = alert.fraudScore >= 70 ? 'border-l-red-500'
                   : alert.fraudScore >= 40 ? 'border-l-amber-500'
                   : 'border-l-green-500';

  const act = async (action, extra = {}) => {
    setLoading(true);
    try {
      let res;
      if (action === 'resolve')        res = await api.patch(`/alerts/${alert._id}/resolve`, { status: 'resolved' });
      if (action === 'false_positive') res = await api.patch(`/alerts/${alert._id}/resolve`, { status: 'false_positive' });
      if (action === 'block_user')     res = await api.post(`/alerts/${alert._id}/block-user`, extra);
      if (action === 'block_device')   res = await api.post(`/alerts/${alert._id}/block-device`, extra);
      if (action === 'escalate') {
        res = await api.post(`/alerts/${alert._id}/escalate`, { notes: escNotes });
        setShowEscModal(false);
      }
      if (res?.data?.success) onUpdate(alert._id, action, res.data.data);
    } catch (err) {
      console.error(err.response?.data?.message || err.message);
    } finally {
      setLoading(false);
    }
  };

  const loadTimeline = async () => {
    if (timeline) { setExpanded(e => !e); return; }
    setLoadingTl(true);
    try {
      const { data } = await api.get(`/transactions/timeline/${alert.userId}?hours=24`);
      setTimeline(data);
      setExpanded(true);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingTl(false);
    }
  };

  return (
    <div className={`bg-bg-card border border-border-dim border-l-4 ${scoreColor} rounded-xl overflow-hidden`}>
      <div className="p-5">
        {/* Top row */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex-1">
            <div className="flex items-center gap-2 flex-wrap mb-1.5">
              <span className="text-sm font-bold text-text-pri font-mono">{alert.userId}</span>
              <StatusBadge status={alert.status} />
              <FraudScore score={alert.fraudScore} showBar />
            </div>
            <div className="flex flex-wrap gap-3 text-xs text-text-muted">
              {alert.amount && (
                <span className="flex items-center gap-1">
                  <DollarSign size={11} />
                  ₹{Number(alert.amount).toLocaleString()}
                </span>
              )}
              {alert.merchantId && (
                <span className="flex items-center gap-1">
                  <Cpu size={11} />
                  {alert.merchantId}
                </span>
              )}
              {alert.location?.city && (
                <span className="flex items-center gap-1">
                  <MapPin size={11} />
                  {alert.location.city}
                </span>
              )}
              <span className="flex items-center gap-1">
                <Clock size={11} />
                {new Date(alert.createdAt).toLocaleString()}
              </span>
            </div>
          </div>
        </div>

        {/* Rules triggered */}
        {alert.rulesTriggered?.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-4">
            {alert.rulesTriggered.map((r, i) => {
              const meta = RULE_LABELS[r.ruleName] || { label: r.ruleName, color: 'text-slate-400 bg-slate-500/10 border-slate-500/20' };
              return (
                <div key={i} className={`text-[10px] px-2 py-1 rounded border flex items-center gap-1.5 ${meta.color}`}>
                  <span className="font-semibold">{meta.label}</span>
                  <span className="opacity-60">score {r.score}</span>
                  {r.reason && <span className="opacity-50 hidden md:inline">· {r.reason}</span>}
                </div>
              );
            })}
          </div>
        )}

        {/* Action buttons — only for open alerts */}
        {isOpen ? (
          <div className="flex flex-wrap gap-2">
            <button onClick={() => act('resolve')} disabled={loading}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-green-500/10 border border-green-500/30 text-green-400 rounded-lg hover:bg-green-500/15 transition-all disabled:opacity-50">
              <CheckCircle size={12} />
              Resolve
            </button>
            <button onClick={() => act('false_positive')} disabled={loading}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 border border-border-dim text-text-muted rounded-lg hover:border-border-mid transition-all disabled:opacity-50">
              <XCircle size={12} />
              False Positive
            </button>
            <button onClick={() => act('block_user', { reason: `High fraud score: ${alert.fraudScore}` })} disabled={loading}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-red-500/10 border border-red-500/30 text-red-400 rounded-lg hover:bg-red-500/15 transition-all disabled:opacity-50">
              <UserX size={12} />
              Block User
            </button>
            {alert.deviceId && alert.deviceId !== 'unknown' && (
              <button onClick={() => act('block_device', { reason: `Device associated with fraud score: ${alert.fraudScore}` })} disabled={loading}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-orange-500/10 border border-orange-500/30 text-orange-400 rounded-lg hover:bg-orange-500/15 transition-all disabled:opacity-50">
                <Smartphone size={12} />
                Block Device
              </button>
            )}
            <button onClick={() => setShowEscModal(true)} disabled={loading}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-purple-500/10 border border-purple-500/30 text-purple-400 rounded-lg hover:bg-purple-500/15 transition-all disabled:opacity-50">
              <AlertTriangle size={12} />
              Escalate to PERC
            </button>
            <button onClick={loadTimeline} disabled={loadingTl}
              className="flex items-center gap-1 text-xs text-text-muted hover:text-text-sec ml-auto transition-all">
              {loadingTl ? '...' : (expanded ? <ChevronUp size={12}/> : <ChevronDown size={12}/>)}
              User Timeline
            </button>
          </div>
        ) : (
          <div className="text-xs text-text-muted">
            {alert.resolvedBy && `Resolved by ${alert.resolvedBy}`}
            {alert.escalatedBy && `Escalated by ${alert.escalatedBy}${alert.escalationNotes ? ` — "${alert.escalationNotes}"` : ''}`}
          </div>
        )}
      </div>

      {/* Escalation modal */}
      {showEscModal && (
        <div className="px-5 pb-4 border-t border-border-dim pt-3 bg-purple-500/5">
          <div className="text-xs font-semibold text-purple-400 mb-2">Escalate to PERC Investigation</div>
          <textarea
            value={escNotes} onChange={e => setEscNotes(e.target.value)}
            placeholder="Describe why this is a novel pattern or high-priority threat..."
            className="w-full bg-bg-primary border border-border-dim rounded-lg px-3 py-2 text-xs text-text-pri placeholder-text-muted focus:border-purple-500/50 focus:outline-none resize-none"
            rows={3}
          />
          <div className="flex gap-2 mt-2">
            <button onClick={() => act('escalate')} disabled={loading}
              className="text-xs px-3 py-1.5 bg-purple-500/20 border border-purple-500/40 text-purple-400 rounded-lg hover:bg-purple-500/25 transition-all">
              Confirm Escalation
            </button>
            <button onClick={() => setShowEscModal(false)}
              className="text-xs px-3 py-1.5 border border-border-dim text-text-muted rounded-lg">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* User timeline */}
      {expanded && timeline && (
        <div className="border-t border-border-dim px-5 py-4 bg-bg-secondary">
          <div className="text-xs font-semibold text-text-sec mb-3 uppercase tracking-widest">
            User Timeline — last 24h
          </div>
          <div className="flex items-center gap-4 mb-3">
            {[
              ['Total txns', timeline.summary?.total],
              ['Flagged', timeline.summary?.flagged],
              ['Total spent', `₹${Number(timeline.summary?.totalAmount||0).toLocaleString()}`],
              ['Avg score', timeline.summary?.avgScore],
            ].map(([lbl, val]) => (
              <div key={lbl} className="text-center">
                <div className="text-xs text-text-muted">{lbl}</div>
                <div className="text-sm font-bold text-text-pri font-mono">{val}</div>
              </div>
            ))}
          </div>
          <div className="space-y-1.5 max-h-48 overflow-y-auto">
            {timeline.data?.map((t, i) => (
              <div key={i} className={`flex items-center gap-3 px-3 py-2 rounded-lg text-xs ${t.fraudStatus !== 'clear' ? 'bg-red-500/5 border border-red-500/10' : 'bg-bg-card'}`}>
                <span className="text-text-muted font-mono w-16 flex-shrink-0">{new Date(t.timestamp).toLocaleTimeString()}</span>
                <span className="text-text-sec flex-1">{t.merchantId}</span>
                <span className="text-text-pri font-semibold">₹{Number(t.amount).toLocaleString()}</span>
                <FraudScore score={t.fraudScore} />
                <StatusBadge status={t.fraudStatus} size="xs" />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function Alerts() {
  const [alerts,  setAlerts]  = useState([]);
  const [filter,  setFilter]  = useState('open');
  const [loading, setLoading] = useState(true);
  const [counts,  setCounts]  = useState({});
  const socketRef = useRef(null);

  const load = async (status = filter) => {
    setLoading(true);
    try {
      const { data } = await api.get(`/alerts?status=${status}&limit=50`);
      setAlerts(data.data || []);

      // Load counts for tab badges
      const [openR, allR] = await Promise.all([
        api.get('/alerts?status=open&limit=1'),
        api.get('/alerts?status=all&limit=1'),
      ]);
      setCounts({
        open:      openR.data.pagination?.total || 0,
        total:     allR.data.pagination?.total  || 0,
      });
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    socketRef.current = io(SOCKET_URL);
    const s = socketRef.current;

    s.on('new-fraud-alert', ({ alert }) => {
      if (filter === 'open' || filter === 'all') {
        setAlerts(prev => [alert, ...prev]);
      }
      setCounts(prev => ({ ...prev, open: (prev.open||0)+1, total: (prev.total||0)+1 }));
    });

    s.on('alert-updated', (updated) => {
      setAlerts(prev => prev.map(a => a._id === updated._id ? { ...a, ...updated } : a));
    });

    return () => s.disconnect();
  }, [filter]);

  const handleUpdate = (id, action) => {
    const statusMap = {
      resolve: 'resolved', false_positive: 'false_positive',
      escalate: 'escalated', block_user: 'resolved', block_device: 'resolved'
    };
    setAlerts(prev => prev.map(a =>
      a._id === id ? { ...a, status: statusMap[action] || a.status } : a
    ));
  };

  const handleFilterChange = (f) => { setFilter(f); load(f); };

  const TABS = [
    { key: 'open',           label: `Open (${counts.open || 0})` },
    { key: 'escalated',      label: 'Escalated' },
    { key: 'resolved',       label: 'Resolved'  },
    { key: 'false_positive', label: 'False Positives' },
    { key: 'all',            label: `All (${counts.total || 0})` },
  ];

  return (
    <Layout>
      <div className="p-6">
        <div className="flex items-start justify-between mb-6">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <ShieldAlert size={18} className="text-brand" />
              <h1 className="text-xl font-bold text-text-pri">Alert Workbench</h1>
            </div>
            <p className="text-sm text-text-muted">
              Review flagged transactions · Block users and devices · Escalate novel patterns to PERC
            </p>
          </div>
          <button onClick={() => load(filter)}
            className="text-xs text-text-sec border border-border-dim rounded-lg px-3 py-1.5 hover:border-border-mid transition-all">
            Refresh
          </button>
        </div>

        {/* Filter tabs */}
        <div className="flex gap-1.5 mb-6 flex-wrap border-b border-border-dim pb-4">
          {TABS.map(t => (
            <button key={t.key} onClick={() => handleFilterChange(t.key)}
              className={`text-xs px-3 py-1.5 rounded-lg border transition-all
                ${filter === t.key ? 'bg-brand text-black border-brand font-semibold' : 'border-border-dim text-text-sec hover:border-border-mid hover:text-text-pri'}`}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Alert list */}
        {loading ? (
          <div className="space-y-4">{Array.from({length:4}).map((_,i) => <SkeletonAlertCard key={i} />)}</div>
        ) : alerts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <ShieldAlert size={40} className="text-text-muted mb-3" />
            <div className="text-text-sec font-medium mb-1">No alerts in this category</div>
            <div className="text-xs text-text-muted">Run the simulator to generate fraud alerts</div>
          </div>
        ) : (
          <div className="space-y-4">
            {alerts.map(alert => (
              <AlertCard key={alert._id} alert={alert} onUpdate={handleUpdate} />
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
