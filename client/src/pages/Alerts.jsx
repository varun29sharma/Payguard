import { useState, useEffect, useRef } from 'react';
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
import { getSocket } from '../api/socket';

const RULE_LABELS = {
  VELOCITY_RULE:           { label: 'VELOCITY_CHK',     color: 'text-red-400 bg-red-500/10 border-red-500'    },
  ENUMERATION_ATTACK_RULE: { label: 'ENUM_ATTACK',      color: 'text-purple-400 bg-purple-500/10 border-purple-500' },
  AMOUNT_THRESHOLD_RULE:   { label: 'AMT_THRESH',       color: 'text-amber-400 bg-amber-500/10 border-amber-500'  },
  GEOGRAPHIC_ANOMALY_RULE: { label: 'GEO_ANOMALY',      color: 'text-blue-400 bg-blue-500/10 border-blue-500'   },
  NEW_DEVICE_RULE:         { label: 'NEW_DEVICE',       color: 'text-orange-400 bg-orange-500/10 border-orange-500' },
  NIGHT_OWL_RULE:          { label: 'NIGHT_OWL',        color: 'text-brand bg-brand-dim border-brand' },
  BLOCK_LIST:              { label: 'BLOCK_LST_HIT',    color: 'text-red-500 bg-red-500/20 border-red-500 font-bold'    },
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

  const scoreColor = alert.fraudScore >= 70 ? 'border-red-500'
                   : alert.fraudScore >= 40 ? 'border-amber-500'
                   : 'border-brand';

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
    <div className={`pixel-box border-2 ${scoreColor} relative overflow-hidden mb-4`}>
      {/* Tape mark visual */}
      <div className={`absolute top-0 right-0 w-12 h-12 bg-bg-card border-b-2 border-l-2 ${scoreColor} flex items-center justify-center font-vt text-xl font-bold`}>
        !
      </div>
      
      <div className="p-5">
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <h3 className="text-xl font-vt text-text-pri tracking-widest">ID:{alert.userId}</h3>
            <StatusBadge status={alert.status} />
            <FraudScore score={alert.fraudScore} />
          </div>
          
          <div className="flex flex-wrap gap-4 text-xs font-mono text-text-sec bg-bg-secondary p-2 border border-border-dim w-fit">
            {alert.amount && <span className="text-brand">AMT: ₹{Number(alert.amount).toLocaleString()}</span>}
            {alert.merchantId && <span>MERCH: {alert.merchantId}</span>}
            {alert.location?.city && <span>LOC: {alert.location.city}</span>}
            <span>TIME: {new Date(alert.createdAt).toLocaleTimeString()}</span>
          </div>
        </div>

        {/* Rules */}
        {alert.rulesTriggered?.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {alert.rulesTriggered.map((r, i) => {
              const meta = RULE_LABELS[r.ruleName] || { label: r.ruleName, color: 'text-text-sec border-text-muted bg-bg-primary' };
              return (
                <div key={i} className={`text-[10px] px-2 py-1 border-2 font-pixel tracking-widest flex items-center gap-2 ${meta.color}`}>
                  <span>{meta.label}</span>
                  <span className="opacity-70 font-mono">SCR:{r.score}</span>
                </div>
              );
            })}
          </div>
        )}

        {/* Actions */}
        <div className="mt-5 pt-4 border-t-2 border-border-dim flex flex-wrap gap-3 items-center">
          {isOpen ? (
            <>
              <button onClick={() => act('resolve')} disabled={loading} className="pixel-btn px-3 py-2 flex items-center gap-2 text-green-400 border-green-500/50 hover:bg-green-500/10 text-xs">
                <CheckCircle size={14} /> CLR_ALERT
              </button>
              <button onClick={() => act('false_positive')} disabled={loading} className="pixel-btn px-3 py-2 flex items-center gap-2 text-text-sec text-xs">
                <XCircle size={14} /> FALSE_POS
              </button>
              <button onClick={() => act('block_user', { reason: `Score ${alert.fraudScore}` })} disabled={loading} className="pixel-btn px-3 py-2 flex items-center gap-2 text-red-400 border-red-500/50 hover:bg-red-500/10 text-xs">
                <UserX size={14} /> BLK_USR
              </button>
              {alert.deviceId && alert.deviceId !== 'unknown' && (
                <button onClick={() => act('block_device', { reason: `Score ${alert.fraudScore}` })} disabled={loading} className="pixel-btn px-3 py-2 flex items-center gap-2 text-orange-400 border-orange-500/50 hover:bg-orange-500/10 text-xs">
                  <Smartphone size={14} /> BLK_DEV
                </button>
              )}
              <button onClick={() => setShowEscModal(true)} disabled={loading} className="pixel-btn px-3 py-2 flex items-center gap-2 text-purple-400 border-purple-500/50 hover:bg-purple-500/10 text-xs">
                <AlertTriangle size={14} /> ESCALATE
              </button>
            </>
          ) : (
            <div className="text-xs font-mono text-text-muted">
              {alert.resolvedBy && `[RESOLVED_BY: ${alert.resolvedBy}]`}
              {alert.escalatedBy && `[ESCALATED_BY: ${alert.escalatedBy}]`}
            </div>
          )}
          
          <button onClick={loadTimeline} disabled={loadingTl} className="pixel-btn px-3 py-2 ml-auto flex items-center gap-2 text-brand border-brand/50 text-xs">
            {loadingTl ? 'WAIT...' : 'GET_TIMELINE'}
            {expanded ? <ChevronUp size={14}/> : <ChevronDown size={14}/>}
          </button>
        </div>
      </div>

      {/* Escalate Modal */}
      {showEscModal && (
        <div className="p-4 border-t-2 border-purple-500/50 bg-purple-500/5">
          <div className="text-sm font-pixel text-purple-400 tracking-widest mb-2">ESCALATION_REASON:</div>
          <textarea
            value={escNotes} onChange={e => setEscNotes(e.target.value)}
            className="w-full bg-bg-primary border-2 border-purple-500/50 p-3 text-xs font-mono text-text-pri focus:outline-none focus:border-purple-400 resize-none h-20"
            placeholder="ENTER REASON..."
          />
          <div className="flex gap-3 mt-3">
            <button onClick={() => act('escalate')} disabled={loading} className="pixel-btn px-4 py-2 text-purple-400 border-purple-500 text-xs">CONFIRM</button>
            <button onClick={() => setShowEscModal(false)} className="pixel-btn px-4 py-2 text-text-sec text-xs">CANCEL</button>
          </div>
        </div>
      )}

      {/* Timeline */}
      {expanded && timeline && (
        <div className="border-t-2 border-border-dim bg-bg-secondary p-5">
          <div className="text-sm font-pixel text-text-sec tracking-widest mb-4">TIMELINE_24H</div>
          
          <div className="flex gap-6 mb-4 font-mono text-xs border border-border-dim p-3 bg-bg-card">
            <div><span className="text-text-muted">TOT_TXN:</span> <span className="text-text-pri">{timeline.summary?.total}</span></div>
            <div><span className="text-text-muted">FLAGGED:</span> <span className="text-amber-400">{timeline.summary?.flagged}</span></div>
            <div><span className="text-text-muted">SPENT:</span> <span className="text-brand">₹{timeline.summary?.totalAmount}</span></div>
          </div>
          
          <div className="space-y-2 max-h-48 overflow-y-auto pr-2">
            {timeline.data?.map((t, i) => (
              <div key={i} className={`flex items-center gap-4 p-2 border-l-2 text-xs font-mono ${t.fraudStatus !== 'clear' ? 'border-red-500 bg-red-500/5' : 'border-border-mid bg-bg-card'}`}>
                <span className="text-text-muted">{new Date(t.timestamp).toLocaleTimeString()}</span>
                <span className="text-text-sec w-24 truncate">{t.merchantId}</span>
                <span className="text-brand w-20">₹{t.amount}</span>
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
    { key: 'open',           label: `OPEN [${counts.open || 0}]` },
    { key: 'escalated',      label: 'ESCALATED' },
    { key: 'resolved',       label: 'RESOLVED'  },
    { key: 'false_positive', label: 'FALSE_POS' },
    { key: 'all',            label: `ALL [${counts.total || 0}]` },
  ];

  return (
    <Layout>
      <div className="p-6 max-w-[1000px] mx-auto">
        <div className="pixel-box border-amber-500 p-5 mb-6 flex items-center justify-between bg-bg-card">
          <div className="flex items-center gap-4">
            <ShieldAlert size={32} className="text-amber-500" />
            <div>
              <h1 className="text-2xl font-vt text-amber-500 tracking-widest text-shadow-pixel">REVIEW_DEPT</h1>
              <div className="text-xs font-mono text-text-sec mt-1">AWAITING ANALYST TRIAGE</div>
            </div>
          </div>
          <button onClick={() => load()} className="pixel-btn px-4 py-2 text-text-pri text-xs flex items-center gap-2">
            SYNC
          </button>
        </div>

        <div className="flex gap-2 mb-6 flex-wrap border-b-2 border-border-dim pb-4">
          {TABS.map(t => (
            <button key={t.key} onClick={() => { setFilter(t.key); load(t.key); }}
              className={`pixel-btn px-4 py-2 text-xs transition-all ${filter === t.key ? 'pixel-btn-brand' : 'text-text-sec'}`}>
              {t.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="space-y-4">{Array.from({length:4}).map((_,i) => <SkeletonAlertCard key={i} />)}</div>
        ) : alerts.length === 0 ? (
          <div className="pixel-box p-12 text-center border-border-dim text-text-muted font-vt text-xl flex flex-col items-center">
            <CheckCircle size={40} className="mb-4 text-border-hi" />
            QUEUE_CLEAR. NO_ALERTS_FOUND.
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
