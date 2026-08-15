import { useState, useEffect, useRef } from 'react';
import {
  UserX, Smartphone, AlertTriangle,
  CheckCircle, XCircle, ChevronDown, ChevronUp
} from 'lucide-react';
import Layout from '../components/shared/Layout';
import StatusBadge from '../components/shared/StatusBadge';
import FraudScore from '../components/shared/FraudScore';
import { SkeletonAlertCard } from '../components/shared/Skeleton';
import api from '../api/axiosConfig';
import { getSocket } from '../api/socket';

const DARK_CHIP = {
  red:    'dark:text-red-300 dark:border-red-800 dark:bg-red-950/40',
  purple: 'dark:text-purple-300 dark:border-purple-800 dark:bg-purple-950/40',
  amber:  'dark:text-amber-300 dark:border-amber-800 dark:bg-amber-950/40',
  blue:   'dark:text-blue-300 dark:border-blue-800 dark:bg-blue-950/40',
  orange: 'dark:text-orange-300 dark:border-orange-800 dark:bg-orange-950/40',
};

const RULE_LABELS = {
  VELOCITY_RULE:           { label: 'VELOCITY',     color: `text-red-700 border-red-300 bg-red-50 ${DARK_CHIP.red}` },
  ENUMERATION_ATTACK_RULE: { label: 'ENUMERATION',  color: `text-purple-700 border-purple-300 bg-purple-50 ${DARK_CHIP.purple}` },
  AMOUNT_THRESHOLD_RULE:   { label: 'AMOUNT',       color: `text-amber-700 border-amber-300 bg-amber-50 ${DARK_CHIP.amber}` },
  GEOGRAPHIC_ANOMALY_RULE: { label: 'GEO ANOMALY',  color: `text-blue-700 border-blue-300 bg-blue-50 ${DARK_CHIP.blue}` },
  NEW_DEVICE_RULE:         { label: 'NEW DEVICE',   color: `text-orange-700 border-orange-300 bg-orange-50 ${DARK_CHIP.orange}` },
  NIGHT_OWL_RULE:          { label: 'NIGHT OWL',    color: 'text-ink border-hairline-strong bg-paper' },
  BLOCK_LIST:              { label: 'BLOCKLIST',    color: 'text-accent border-accent/40 bg-accent/5' },
};

function AlertCard({ alert, onUpdate }) {
  const [expanded,  setExpanded]  = useState(false);
  const [loading,   setLoading]   = useState(false);
  const [showEscModal, setShowEscModal] = useState(false);
  const [escNotes,  setEscNotes]  = useState('');
  const [timeline,  setTimeline]  = useState(null);
  const [loadingTl, setLoadingTl] = useState(false);

  const isOpen = alert.status === 'open';

  const scoreColor = alert.fraudScore >= 70 ? 'border-accent'
                   : alert.fraudScore >= 40 ? 'border-amber-400'
                   : 'border-hairline-strong';

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
    <div className={`card border-l-2 ${scoreColor}`}>
      <div className="p-6">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <h3 className="text-xl font-bold tracking-tight font-mono">ID: {alert.userId}</h3>
          <StatusBadge status={alert.status} />
          <FraudScore score={alert.fraudScore} />
          <div className="flex flex-wrap gap-x-5 gap-y-1 ml-auto text-xs font-mono text-ink-soft">
            {alert.amount && <span>AMT: ₹{Number(alert.amount).toLocaleString()}</span>}
            {alert.merchantId && <span>MERCH: {alert.merchantId}</span>}
            {alert.location?.city && <span>LOC: {alert.location.city}</span>}
            <span>TIME: {new Date(alert.createdAt).toLocaleTimeString()}</span>
          </div>
        </div>

        {/* Rules */}
        {alert.rulesTriggered?.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {alert.rulesTriggered.map((r, i) => {
              const meta = RULE_LABELS[r.ruleName] || { label: r.ruleName, color: 'text-muted border-hairline-strong bg-paper' };
              return (
                <div key={i} className={`tag ${meta.color}`}>
                  {meta.label}
                  <span className="ml-2 opacity-70">SCR: {r.score}</span>
                </div>
              );
            })}
          </div>
        )}

        {/* Actions */}
        <div className="mt-6 pt-5 border-t border-hairline flex flex-wrap gap-3 items-center">
          {isOpen ? (
            <>
              <button onClick={() => act('resolve')} disabled={loading} className="btn btn-ghost btn-sm text-green-700 border-green-300 hover:bg-green-50 hover:border-green-600 hover:text-green-800 dark:text-green-300 dark:border-green-800 dark:hover:bg-green-950/40">
                <CheckCircle size={13} /> Resolve
              </button>
              <button onClick={() => act('false_positive')} disabled={loading} className="btn btn-ghost btn-sm">
                <XCircle size={13} /> False positive
              </button>
              <button onClick={() => act('block_user', { reason: `Score ${alert.fraudScore}` })} disabled={loading} className="btn btn-sm btn-accent">
                <UserX size={13} /> Block user
              </button>
              {alert.deviceId && alert.deviceId !== 'unknown' && (
                <button onClick={() => act('block_device', { reason: `Score ${alert.fraudScore}` })} disabled={loading} className="btn btn-sm">
                  <Smartphone size={13} /> Block device
                </button>
              )}
              <button onClick={() => setShowEscModal(true)} disabled={loading} className="btn btn-ghost btn-sm text-purple-700 border-purple-300 hover:bg-purple-50 hover:border-purple-600 hover:text-purple-800 dark:text-purple-300 dark:border-purple-800 dark:hover:bg-purple-950/40">
                <AlertTriangle size={13} /> Escalate
              </button>
            </>
          ) : (
            <div className="text-xs font-mono text-muted">
              {alert.resolvedBy && `[RESOLVED BY: ${alert.resolvedBy}]`}
              {alert.escalatedBy && `[ESCALATED BY: ${alert.escalatedBy}]`}
            </div>
          )}

          <button onClick={loadTimeline} disabled={loadingTl} className="btn btn-ghost btn-sm ml-auto">
            {loadingTl ? 'Loading…' : 'Timeline (24h)'}
            {expanded ? <ChevronUp size={13}/> : <ChevronDown size={13}/>}
          </button>
        </div>
      </div>

      {/* Escalate Modal */}
      {showEscModal && (
        <div className="p-5 border-t border-accent/30 bg-accent/5">
          <div className="label text-accent mb-2">Escalation reason</div>
          <textarea
            value={escNotes} onChange={e => setEscNotes(e.target.value)}
            className="input resize-none h-20"
            placeholder="Why is this being escalated?"
          />
          <div className="flex gap-3 mt-3">
            <button onClick={() => act('escalate')} disabled={loading} className="btn btn-sm btn-accent">Confirm</button>
            <button onClick={() => setShowEscModal(false)} className="btn btn-sm btn-ghost">Cancel</button>
          </div>
        </div>
      )}

      {/* Timeline */}
      {expanded && timeline && (
        <div className="border-t border-hairline bg-paper p-6">
          <div className="label mb-4">Timeline — 24h</div>

          <div className="flex gap-8 mb-4 font-mono text-xs border border-hairline p-3 bg-card">
            <div><span className="label mr-2">Total</span> <span className="font-semibold">{timeline.summary?.total}</span></div>                <div><span className="label mr-2">Flagged</span> <span className="font-semibold text-amber-600 dark:text-amber-400">{timeline.summary?.flagged}</span></div>
            <div><span className="label mr-2">Spent</span> <span className="font-semibold tabular-nums">₹{timeline.summary?.totalAmount}</span></div>
          </div>

          <div className="space-y-1 max-h-48 overflow-y-auto">
            {timeline.data?.map((t, i) => (
              <div key={i} className={`flex items-center gap-4 p-2 text-xs font-mono border-l-2 ${t.fraudStatus !== 'clear' ? 'border-accent bg-accent/5' : 'border-hairline'}`}>
                <span className="text-muted">{new Date(t.timestamp).toLocaleTimeString()}</span>
                <span className="text-ink-soft w-24 truncate">{t.merchantId}</span>
                <span className="font-semibold w-20 tabular-nums">₹{t.amount}</span>
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
      const [openR, allR] = await Promise.all([
        api.get('/alerts?status=open&limit=1'),
        api.get('/alerts?status=all&limit=1'),
      ]);
      setCounts({ open: openR.data.pagination?.total || 0, total: allR.data.pagination?.total || 0 });
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional initial fetch of the queue
  useEffect(() => { load(); }, []);

  useEffect(() => {
    socketRef.current = getSocket();
    const s = socketRef.current;
    const handleNewAlert = ({ alert }) => {
      if (filter === 'open' || filter === 'all') setAlerts(prev => [alert, ...prev]);
      setCounts(prev => ({ ...prev, open: (prev.open||0)+1, total: (prev.total||0)+1 }));
    };
    const handleAlertUpdated = (updated) => setAlerts(prev => prev.map(a => a._id === updated._id ? { ...a, ...updated } : a));

    s.on('new-fraud-alert', handleNewAlert);
    s.on('alert-updated', handleAlertUpdated);
    return () => { s.off('new-fraud-alert', handleNewAlert); s.off('alert-updated', handleAlertUpdated); };
  }, [filter]);

  const handleUpdate = (id, action) => {
    const sm = { resolve: 'resolved', false_positive: 'false_positive', escalate: 'escalated', block_user: 'resolved', block_device: 'resolved' };
    setAlerts(prev => prev.map(a => a._id === id ? { ...a, status: sm[action] || a.status } : a));
  };

  const TABS = [
    { key: 'open',           label: `Open [${counts.open || 0}]` },
    { key: 'escalated',      label: 'Escalated' },
    { key: 'resolved',       label: 'Resolved'  },
    { key: 'false_positive', label: 'False positives' },
    { key: 'all',            label: `All [${counts.total || 0}]` },
  ];

  return (
    <Layout>
      <div className="p-10 max-w-[1000px] mx-auto">
        <div className="mb-10">
          <div className="label mb-2">02 — Alerts</div>
          <h1 className="text-5xl font-black tracking-tight leading-none">Triage queue</h1>
          <div className="mt-3 font-mono text-xs uppercase tracking-wider text-muted">Awaiting analyst review</div>
        </div>

        <div className="flex gap-8 mb-8 flex-wrap border-b border-hairline">
          {TABS.map(t => (
            <button key={t.key} onClick={() => { setFilter(t.key); load(t.key); }}
              className={`pb-3 font-semibold text-sm uppercase tracking-wide transition-colors -mb-px ${
                filter === t.key ? 'text-ink border-b-2 border-ink' : 'text-muted hover:text-ink'
              }`}>
              {t.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="space-y-4">{Array.from({length:4}).map((_,i) => <SkeletonAlertCard key={i} />)}</div>
        ) : alerts.length === 0 ? (
          <div className="border border-hairline p-16 text-center text-muted font-mono text-sm uppercase tracking-wider">
            Queue clear. No alerts found.
          </div>
        ) : (
          <div className="space-y-4">
            {alerts.map(a => <AlertCard key={a._id} alert={a} onUpdate={handleUpdate} />)}
          </div>
        )}
      </div>
    </Layout>
  );
}
