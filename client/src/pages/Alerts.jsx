import { useState, useEffect, useRef, useCallback } from 'react';
import {
  UserX, Smartphone, AlertTriangle,
  CheckCircle, XCircle, ChevronDown, ChevronUp,
  Clock, MessageSquare, UserPlus, RotateCcw, Send, Shield
} from 'lucide-react';
import Layout from '../components/shared/Layout';
import StatusBadge from '../components/shared/StatusBadge';
import FraudScore from '../components/shared/FraudScore';
import { SkeletonAlertCard } from '../components/shared/Skeleton';
import api from '../api/axiosConfig';
import { getSocket } from '../api/socket';

// ── Constants ──────────────────────────────────────────────────

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

const PRIORITY_COLORS = {
  P1: 'text-red-700 border-red-400 bg-red-50 dark:text-red-300 dark:border-red-700 dark:bg-red-950/50',
  P2: 'text-amber-700 border-amber-400 bg-amber-50 dark:text-amber-300 dark:border-amber-700 dark:bg-amber-950/50',
  P3: 'text-blue-700 border-blue-400 bg-blue-50 dark:text-blue-300 dark:border-blue-700 dark:bg-blue-950/50',
  P4: 'text-muted border-hairline-strong bg-paper',
};

const STATUS_TRANSITIONS = {
  open:            ['investigating', 'resolved', 'false_positive', 'escalated'],
  investigating:   ['resolved', 'false_positive', 'escalated'],
  escalated:       ['investigating', 'resolved', 'false_positive'],
  reopened:        ['investigating', 'resolved', 'false_positive', 'escalated'],
  resolved:        ['reopened'],
  false_positive:  ['reopened'],
};

const SLA_WINDOWS = { P1: 3600000, P2: 14400000, P3: 86400000, P4: 259200000 };

// ── SLA Countdown ──────────────────────────────────────────────

function SLABadge({ sla, priority, nowMs }) {
  if (!sla?.deadlineAt) return null;
  const deadline = new Date(sla.deadlineAt).getTime();
  const remaining = deadline - nowMs;
  const breached = sla.breachedAt || remaining < 0;
  const pct = SLA_WINDOWS[priority] ? Math.max(0, Math.min(100, (remaining / SLA_WINDOWS[priority]) * 100)) : 100;

  let color = 'text-green-700 dark:text-green-300';
  let bg = 'bg-green-50 border-green-300 dark:bg-green-950/40 dark:border-green-800';
  if (breached) {
    color = 'text-red-700 dark:text-red-300 font-semibold animate-pulse';
    bg = 'bg-red-50 border-red-400 dark:bg-red-950/40 dark:border-red-700';
  } else if (remaining < SLA_WINDOWS.P2) {
    color = 'text-amber-700 dark:text-amber-300';
    bg = 'bg-amber-50 border-amber-300 dark:bg-amber-950/40 dark:border-amber-700';
  }

  const fmt = (ms) => {
    if (ms < 0) return `Overdue by ${fmtTime(-ms)}`;
    return `${fmtTime(ms)} left`;
  };
  const fmtTime = (ms) => {
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    if (h > 24) return `${Math.floor(h/24)}d ${h%24}h`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  };

  return (
    <div className={`flex items-center gap-2 text-[11px] font-mono border px-2.5 py-1 ${bg} ${color}`}>
      <Clock size={11} />
      <span>{fmt(remaining)}</span>
      {!breached && (
        <div className="w-12 h-1 bg-hairline overflow-hidden ml-1">
          <div className="h-full bg-current transition-all" style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}

// ── Notes Thread ───────────────────────────────────────────────

function NotesThread({ alertId, notes = [], onNoteAdded }) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [notes.length]);

  const submit = async () => {
    if (!text.trim() || sending) return;
    setSending(true);
    try {
      const { data } = await api.post(`/alerts/${alertId}/notes`, { text: text.trim() });
      if (data.success) {
        onNoteAdded(data.data);
        setText('');
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSending(false);
    }
  };

  const noteTypeIcon = (type) => {
    switch (type) {
      case 'assignment': return <UserPlus size={10} className="text-blue-500" />;
      case 'status_change': return <RotateCcw size={10} className="text-amber-500" />;
      case 'system': return <Shield size={10} className="text-accent" />;
      default: return <MessageSquare size={10} className="text-muted" />;
    }
  };

  return (
    <div className="border-t border-hairline bg-paper">
      <div className="px-5 py-3 max-h-60 overflow-y-auto">
        {notes.length === 0 ? (
          <div className="text-xs text-muted font-mono py-2">No notes yet — start documenting this case.</div>
        ) : (
          <div className="space-y-3">
            {notes.map((note, i) => (
              <div key={note._id || i} className="flex gap-3">
                <div className="flex-shrink-0 mt-1">{noteTypeIcon(note.type)}</div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-[11px] font-semibold text-ink">{note.author}</span>
                    <span className="text-[10px] font-mono text-muted">
                      {new Date(note.createdAt).toLocaleString()}
                    </span>
                    {note.type !== 'note' && (
                      <span className="text-[9px] font-mono uppercase tracking-wider text-muted border border-hairline px-1.5 py-0.5">
                        {note.type.replace('_', ' ')}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-ink-soft leading-relaxed">{note.text}</p>
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* Note input */}
      <div className="border-t border-hairline px-5 py-3 flex gap-2">
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder="Add a note…"
          className="input flex-1 text-xs"
        />
        <button onClick={submit} disabled={!text.trim() || sending} className="btn btn-sm btn-accent px-3">
          <Send size={12} />
        </button>
      </div>
    </div>
  );
}

// ── Alert Card ─────────────────────────────────────────────────

function AlertCard({ alert, onUpdate, analysts }) {
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showCase, setShowCase] = useState(false);
  const [notes, setNotes] = useState(alert.notes || []);
  const [showEscModal, setShowEscModal] = useState(false);
  const [escNotes, setEscNotes] = useState('');
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  const isOpen = ['open', 'investigating', 'escalated', 'reopened'].includes(alert.status);
  const transitions = STATUS_TRANSITIONS[alert.status] || [];

  const scoreColor = alert.fraudScore >= 70 ? 'border-accent'
    : alert.fraudScore >= 40 ? 'border-amber-400'
    : 'border-hairline-strong';

  const act = async (action, extra = {}) => {
    setLoading(true);
    try {
      let res;
      if (action === 'resolve') res = await api.patch(`/alerts/${alert._id}/status`, { status: 'resolved' });
      if (action === 'false_positive') res = await api.patch(`/alerts/${alert._id}/status`, { status: 'false_positive' });
      if (action === 'investigating') res = await api.patch(`/alerts/${alert._id}/status`, { status: 'investigating' });
      if (action === 'reopened') res = await api.patch(`/alerts/${alert._id}/status`, { status: 'reopened' });
      if (action === 'block_user') res = await api.post(`/alerts/${alert._id}/block-user`, extra);
      if (action === 'block_device') res = await api.post(`/alerts/${alert._id}/block-device`, extra);
      if (action === 'escalate') {
        res = await api.patch(`/alerts/${alert._id}/status`, { status: 'escalated', reason: escNotes });
        setShowEscModal(false);
      }
      if (action === 'assign') {
        res = await api.post(`/alerts/${alert._id}/assign`, { assignedTo: extra.assignedTo });
      }
      if (action === 'priority') {
        res = await api.patch(`/alerts/${alert._id}/priority`, { priority: extra.priority });
      }
      if (res?.data?.success) {
        onUpdate(alert._id, action, res.data.data);
        if (res.data.data.notes) setNotes(res.data.data.notes);
      }
    } catch (err) {
      console.error(err.response?.data?.message || err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleNoteAdded = (note) => {
    setNotes(prev => [...prev, note]);
  };

  return (
    <div className={`card border-l-2 ${scoreColor}`}>
      <div className="p-6">
        {/* Top row: ID, status, priority, SLA */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mb-3">
          <h3 className="text-xl font-bold tracking-tight font-mono">ID: {alert.userId}</h3>
          <StatusBadge status={alert.status} />
          <span className={`tag text-[10px] font-mono font-bold ${PRIORITY_COLORS[alert.priority] || PRIORITY_COLORS.P3}`}>
            {alert.priority || 'P3'}
          </span>
          <FraudScore score={alert.fraudScore} />           <SLABadge sla={alert.sla} priority={alert.priority} nowMs={nowMs} />
        </div>

        {/* Meta row */}
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs font-mono text-ink-soft mb-3">
          {alert.amount && <span>AMT: ₹{Number(alert.amount).toLocaleString()}</span>}
          {alert.merchantId && <span>MERCH: {alert.merchantId}</span>}
          {alert.location?.city && <span>LOC: {alert.location.city}</span>}
          <span>TIME: {new Date(alert.createdAt).toLocaleTimeString()}</span>
          {alert.assignedTo && (
            <span className="text-blue-700 dark:text-blue-300">
              ASSIGNEE: {alert.assignedTo}
            </span>
          )}
        </div>

        {/* Rules */}
        {alert.rulesTriggered?.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-3">
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
        <div className="mt-4 pt-4 border-t border-hairline flex flex-wrap gap-2 items-center">
          {/* Status transitions */}
          {transitions.includes('investigating') && (
            <button onClick={() => act('investigating')} disabled={loading} className="btn btn-ghost btn-sm text-blue-700 border-blue-300 hover:bg-blue-50 hover:border-blue-600 dark:text-blue-300 dark:border-blue-800 dark:hover:bg-blue-950/40">
              <Clock size={12} /> Investigate
            </button>
          )}
          {transitions.includes('resolved') && (
            <button onClick={() => act('resolve')} disabled={loading} className="btn btn-ghost btn-sm text-green-700 border-green-300 hover:bg-green-50 hover:border-green-600 dark:text-green-300 dark:border-green-800 dark:hover:bg-green-950/40">
              <CheckCircle size={12} /> Resolve
            </button>
          )}
          {transitions.includes('false_positive') && (
            <button onClick={() => act('false_positive')} disabled={loading} className="btn btn-ghost btn-sm">
              <XCircle size={12} /> False positive
            </button>
          )}
          {transitions.includes('escalated') && (
            <button onClick={() => setShowEscModal(true)} disabled={loading} className="btn btn-ghost btn-sm text-purple-700 border-purple-300 hover:bg-purple-50 hover:border-purple-600 dark:text-purple-300 dark:border-purple-800 dark:hover:bg-purple-950/40">
              <AlertTriangle size={12} /> Escalate
            </button>
          )}
          {transitions.includes('reopened') && (
            <button onClick={() => act('reopened')} disabled={loading} className="btn btn-ghost btn-sm">
              <RotateCcw size={12} /> Reopen
            </button>
          )}

          {/* Block actions (only for open/investigating/escalated) */}
          {isOpen && (
            <>
              <button onClick={() => act('block_user', { reason: `Score ${alert.fraudScore}` })} disabled={loading} className="btn btn-sm btn-accent">
                <UserX size={12} /> Block user
              </button>
              {alert.deviceId && alert.deviceId !== 'unknown' && (
                <button onClick={() => act('block_device', { reason: `Score ${alert.fraudScore}` })} disabled={loading} className="btn btn-sm">
                  <Smartphone size={12} /> Block device
                </button>
              )}
            </>
          )}

          {/* Right side: assign + priority + case toggle */}
          <div className="ml-auto flex items-center gap-2">
            {/* Assign dropdown */}
            {isOpen && (
              <select
                value={alert.assignedTo || ''}
                onChange={(e) => e.target.value && act('assign', { assignedTo: e.target.value })}
                className="input text-xs py-1 px-2 w-32"
                disabled={loading}
              >
                <option value="">Assign…</option>
                {analysts.map(a => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            )}

            {/* Priority selector */}
            {isOpen && (
              <select
                value={alert.priority || 'P3'}
                onChange={(e) => act('priority', { priority: e.target.value })}
                className="input text-xs py-1 px-2 w-16"
                disabled={loading}
              >
                {['P1', 'P2', 'P3', 'P4'].map(p => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            )}

            {/* Notes / case toggle */}
            <button
              onClick={() => setShowCase(c => !c)}
              className="btn btn-ghost btn-sm"
            >
              <MessageSquare size={12} />
              {showCase ? 'Hide' : 'Case'}
              {notes.length > 0 && (
                <span className="ml-1 text-[10px] font-mono bg-hairline px-1.5">{notes.length}</span>
              )}
            </button>

            {/* Transaction timeline toggle */}
            <button
              onClick={() => setExpanded(e => !e)}
              className="btn btn-ghost btn-sm"
            >
              {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              Txn
            </button>
          </div>
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

      {/* Case panel — notes thread */}
      {showCase && (
        <NotesThread
          alertId={alert._id}
          notes={notes}
          onNoteAdded={handleNoteAdded}
        />
      )}

      {/* Transaction timeline */}
      {expanded && (
        <div className="border-t border-hairline bg-paper p-5">
          <div className="label mb-3">Transaction details</div>
          {alert.transaction ? (
            <div className="flex flex-wrap gap-x-8 gap-y-2 text-xs font-mono">
              <div><span className="label mr-2">Txn ID</span> <span className="font-medium">{alert.transaction.transactionId}</span></div>
              <div><span className="label mr-2">Amount</span> <span className="font-semibold">₹{Number(alert.transaction.amount).toLocaleString()}</span></div>
              <div><span className="label mr-2">Merchant</span> <span className="font-medium">{alert.transaction.merchantId}</span></div>
              <div><span className="label mr-2">Device</span> <span className="font-medium">{alert.transaction.deviceId || '—'}</span></div>
              <div><span className="label mr-2">IP</span> <span className="font-medium">{alert.transaction.ipAddress || '—'}</span></div>
              <div><span className="label mr-2">City</span> <span className="font-medium">{alert.transaction.location?.city || '—'}</span></div>
              <div><span className="label mr-2">Engine</span> <span className="font-medium">{alert.transaction.scoringEngine || 'engine'}</span></div>
            </div>
          ) : (
            <div className="text-xs text-muted font-mono">Transaction data not loaded</div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Stats Bar ──────────────────────────────────────────────────

function CaseStatsBar({ stats }) {
  if (!stats) return null;

  const items = [
    { label: 'Open', value: (stats.byStatus?.open || 0) + (stats.byStatus?.reopened || 0), accent: 'text-ink' },
    { label: 'Investigating', value: stats.byStatus?.investigating || 0, accent: 'text-blue-700 dark:text-blue-300' },
    { label: 'Escalated', value: stats.byStatus?.escalated || 0, accent: 'text-purple-700 dark:text-purple-300' },
    { label: 'SLA breached', value: stats.slaBreached || 0, accent: 'text-red-700 dark:text-red-300' },
    { label: 'Unassigned', value: stats.unassigned || 0, accent: 'text-amber-600 dark:text-amber-300' },
    { label: 'Avg notes', value: stats.avgNotesPerCase || 0, accent: 'text-muted' },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
      {items.map(item => (
        <div key={item.label} className="border-t-2 border-hairline pt-3">
          <div className="label mb-1">{item.label}</div>
          <div className={`text-2xl font-extrabold tracking-tight tabular-nums ${item.accent}`}>{item.value}</div>
        </div>
      ))}
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────

const ANALYSTS = ['demo@payguard.io', 'analyst@payguard.io', 'admin@payguard.io'];

export default function Alerts() {
  const [alerts, setAlerts] = useState([]);
  const [filter, setFilter] = useState('open');
  const [loading, setLoading] = useState(true);
  const [counts, setCounts] = useState({});
  const [caseStats, setCaseStats] = useState(null);
  const socketRef = useRef(null);

  const loadStats = async () => {
    try {
      const { data } = await api.get('/alerts/stats/cases');
      if (data.success) setCaseStats(data.data);
    } catch (err) {
      console.error('Case stats load error:', err.message);
    }
  };

  const load = useCallback(async (status = filter) => {
    setLoading(true);
    try {
      const { data } = await api.get(`/alerts?status=${status}&limit=50`);
      setAlerts(data.data || []);
      const [openR, allR] = await Promise.all([
        api.get('/alerts?status=open&limit=1'),
        api.get('/alerts?status=all&limit=1'),
      ]);
      setCounts({ open: openR.data.pagination?.total || 0, total: allR.data.pagination?.total || 0 });
      await loadStats();
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps -- intentional initial fetch
  useEffect(() => { load(); }, []);

  useEffect(() => {
    socketRef.current = getSocket();
    const s = socketRef.current;
    const handleNewAlert = ({ alert }) => {
      if (filter === 'open' || filter === 'all') setAlerts(prev => [alert, ...prev]);
      setCounts(prev => ({ ...prev, open: (prev.open || 0) + 1, total: (prev.total || 0) + 1 }));
      loadStats();
    };
    const handleAlertUpdated = (updated) => {
      setAlerts(prev => prev.map(a => a._id === updated._id ? { ...a, ...updated } : a));
      loadStats();
    };
    const handleSlaBreached = () => loadStats();

    s.on('new-fraud-alert', handleNewAlert);
    s.on('alert-updated', handleAlertUpdated);
    s.on('sla-breached', handleSlaBreached);
    return () => {
      s.off('new-fraud-alert', handleNewAlert);
      s.off('alert-updated', handleAlertUpdated);
      s.off('sla-breached', handleSlaBreached);
    };
  }, [filter]);

  const handleUpdate = (id, action, data) => {
    setAlerts(prev => prev.map(a => a._id === id ? { ...a, ...data } : a));
    loadStats();
  };

  const TABS = [
    { key: 'open', label: `Open [${counts.open || 0}]` },
    { key: 'investigating', label: 'Investigating' },
    { key: 'escalated', label: 'Escalated' },
    { key: 'resolved', label: 'Resolved' },
    { key: 'false_positive', label: 'False positives' },
    { key: 'all', label: `All [${counts.total || 0}]` },
  ];

  return (
    <Layout>
      <div className="p-10 max-w-[1100px] mx-auto">
        <div className="mb-10">
          <div className="label mb-2">02 — Alerts</div>
          <h1 className="text-5xl font-black tracking-tight leading-none">Case management</h1>
          <div className="mt-3 font-mono text-xs uppercase tracking-wider text-muted">
            Investigate, assign, resolve — every decision tracked
          </div>
        </div>

        {/* Stats */}
        <CaseStatsBar stats={caseStats} />

        {/* Tabs */}
        <div className="flex gap-6 mb-8 flex-wrap border-b border-hairline">
          {TABS.map(t => (
            <button key={t.key} onClick={() => { setFilter(t.key); load(t.key); }}
              className={`pb-3 font-semibold text-sm uppercase tracking-wide transition-colors -mb-px ${
                filter === t.key ? 'text-ink border-b-2 border-ink' : 'text-muted hover:text-ink'
              }`}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Alert list */}
        {loading ? (
          <div className="space-y-4">{Array.from({ length: 4 }).map((_, i) => <SkeletonAlertCard key={i} />)}</div>
        ) : alerts.length === 0 ? (
          <div className="border border-hairline p-16 text-center text-muted font-mono text-sm uppercase tracking-wider">
            Queue clear. No alerts found.
          </div>
        ) : (
          <div className="space-y-4">
            {alerts.map(a => (
              <AlertCard key={a._id} alert={a} onUpdate={handleUpdate} analysts={ANALYSTS} />
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
