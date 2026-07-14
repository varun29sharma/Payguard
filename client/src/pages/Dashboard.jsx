import { useState, useEffect, useRef } from 'react';
import { getSocket } from '../api/socket';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend
} from 'recharts';
import { RefreshCw, ChevronDown, ChevronUp, Activity } from 'lucide-react';
import Layout from '../components/shared/Layout';
import StatCard from '../components/shared/StatCard';
import StatusBadge from '../components/shared/StatusBadge';
import FraudScore from '../components/shared/FraudScore';
import { SkeletonRow, SkeletonCard } from '../components/shared/Skeleton';
import api from '../api/axiosConfig';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:3000';

const PIE_COLORS = { clear: '#22c55e', review: '#f59e0b', blocked: '#ef4444' };

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-bg-card border border-border-mid rounded-lg px-3 py-2 text-xs shadow-xl">
      <div className="text-text-sec mb-1">{label}</div>
      <div className="text-brand font-mono font-semibold">{payload[0].value} transactions</div>
    </div>
  );
};

function RuleTag({ rule }) {
  const colors = {
    VELOCITY_RULE:           'bg-red-500/10 text-red-400 border-red-500/20',
    ENUMERATION_ATTACK_RULE: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
    AMOUNT_THRESHOLD_RULE:   'bg-amber-500/10 text-amber-400 border-amber-500/20',
    GEOGRAPHIC_ANOMALY_RULE: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    NEW_DEVICE_RULE:         'bg-orange-500/10 text-orange-400 border-orange-500/20',
    NIGHT_OWL_RULE:          'bg-indigo-500/10 text-indigo-400 border-indigo-500/20',
    BLOCK_LIST:              'bg-red-500/15 text-red-300 border-red-500/30',
  };
  const cls = colors[rule] || 'bg-slate-500/10 text-slate-400 border-slate-500/20';
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded border font-mono ${cls}`}>
      {rule.replace(/_RULE$/, '').replace(/_/g, ' ')}
    </span>
  );
}

function TxRow({ txn, isNew }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      <tr
        onClick={() => setExpanded(e => !e)}
        className={`border-b border-border-dim cursor-pointer transition-colors hover:bg-bg-card2
          ${isNew ? 'new-row bg-brand/5' : ''}
          ${txn.fraudStatus === 'blocked' ? 'bg-red-500/3' : ''}
          ${txn.fraudStatus === 'review'  ? 'bg-amber-500/3' : ''}`}
      >
        <td className="px-4 py-3 text-xs text-text-muted font-mono whitespace-nowrap">
          {new Date(txn.timestamp).toLocaleTimeString()}
        </td>
        <td className="px-4 py-3 text-sm font-mono text-text-sec">{txn.userId}</td>
        <td className="px-4 py-3 text-sm text-text-sec">{txn.merchantId}</td>
        <td className="px-4 py-3 text-sm font-semibold text-text-pri">
          ₹{Number(txn.amount).toLocaleString()}
        </td>
        <td className="px-4 py-3">
          <FraudScore score={txn.fraudScore} showBar />
        </td>
        <td className="px-4 py-3">
          <StatusBadge status={txn.fraudStatus} />
        </td>
        <td className="px-4 py-3 text-text-muted">
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </td>
      </tr>

      {expanded && (
        <tr className="bg-bg-secondary border-b border-border-dim">
          <td colSpan={7} className="px-6 py-3">
            <div className="flex flex-wrap gap-3 text-xs">
              <div>
                <span className="text-text-muted mr-1.5">Device:</span>
                <span className="font-mono text-text-sec">{txn.deviceId || '—'}</span>
              </div>
              <div>
                <span className="text-text-muted mr-1.5">City:</span>
                <span className="text-text-sec">{txn.location?.city || '—'}</span>
              </div>
              <div>
                <span className="text-text-muted mr-1.5">Transaction ID:</span>
                <span className="font-mono text-text-muted text-[10px]">{txn.transactionId}</span>
              </div>
            </div>
            {txn.rulesTriggered?.length > 0 && (
              <div className="mt-2">
                <span className="text-text-muted text-xs mr-2">Rules triggered:</span>
                <div className="flex flex-wrap gap-2 mt-1">
                  {txn.rulesTriggered.map((r, i) => (
                    <div key={i} className="flex items-center gap-1.5">
                      <RuleTag rule={r.ruleName} />
                      <span className="text-[10px] text-text-muted">{r.reason || `score: ${r.score}`}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

export default function Dashboard() {
  const [transactions, setTransactions] = useState([]);
  const [stats,        setStats]        = useState(null);
  const [chartData,    setChartData]    = useState([]);
  const [ruleData,     setRuleData]     = useState([]);
  const [newIds,       setNewIds]       = useState(new Set());
  const [loading,      setLoading]      = useState(true);
  const [connected,    setConnected]    = useState(false);
  const socketRef = useRef(null);

  // Load initial data
  useEffect(() => {
    const load = async () => {
      try {
        const [txRes, statsRes, ruleRes] = await Promise.all([
          api.get('/transactions?limit=50'),
          api.get('/transactions/stats'),
          api.get('/transactions/rule-breakdown'),
        ]);
        setTransactions(txRes.data.data || []);
        setStats(statsRes.data);
        setRuleData(ruleRes.data.data || []);

        // Build initial hourly chart from loaded transactions
        buildChartData(txRes.data.data || []);
      } catch (err) {
        console.error('Load error:', err.message);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const buildChartData = (txns) => {
    const hourMap = {};
    txns.forEach(t => {
      const h = new Date(t.timestamp).getHours();
      const key = `${String(h).padStart(2,'0')}:00`;
      hourMap[key] = (hourMap[key] || 0) + 1;
    });
    setChartData(Object.entries(hourMap).map(([hour, count]) => ({ hour, count })).sort((a,b) => a.hour.localeCompare(b.hour)));
  };

  // WebSocket
  useEffect(() => {
    socketRef.current = getSocket();
    const s = socketRef.current;

    const handleConnect = () => setConnected(true);
    const handleDisconnect = () => setConnected(false);
    s.on('connect',    handleConnect);
    s.on('disconnect', handleDisconnect);
    setConnected(s.connected);

    const handleNewTransaction = (txn) => {
      setTransactions(prev => {
        const updated = [txn, ...prev].slice(0, 50);
        return updated;
      });
      setNewIds(prev => new Set([...prev, txn._id]));
      setTimeout(() => setNewIds(prev => { const n = new Set(prev); n.delete(txn._id); return n; }), 1500);

      setStats(prev => prev ? { ...prev, total: (prev.total || 0) + 1 } : prev);

      // Update chart
      const h = new Date(txn.timestamp).getHours();
      const key = `${String(h).padStart(2,'0')}:00`;
      setChartData(prev => {
        const idx = prev.findIndex(d => d.hour === key);
        if (idx >= 0) {
          const updated = [...prev];
          updated[idx] = { ...updated[idx], count: updated[idx].count + 1 };
          return updated;
        }
        return [...prev, { hour: key, count: 1 }].sort((a,b) => a.hour.localeCompare(b.hour));
      });
    };
    s.on('new-transaction', handleNewTransaction);

    const handleNewFraudAlert = ({ transaction }) => {
      if (!transaction) return;
      setStats(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          flagged:  transaction.fraudStatus === 'review'  ? (prev.flagged  || 0) + 1 : prev.flagged,
          blocked:  transaction.fraudStatus === 'blocked' ? (prev.blocked  || 0) + 1 : prev.blocked,
          clear:    transaction.fraudStatus === 'clear'   ? (prev.clear    || 0) + 1 : prev.clear,
        };
      });
    };
    s.on('new-fraud-alert', handleNewFraudAlert);

    return () => {
      s.off('connect', handleConnect);
      s.off('disconnect', handleDisconnect);
      s.off('new-transaction', handleNewTransaction);
      s.off('new-fraud-alert', handleNewFraudAlert);
    };
  }, []);

  const refresh = async () => {
    setLoading(true);
    try {
      const [txRes, statsRes] = await Promise.all([
        api.get('/transactions?limit=50'),
        api.get('/transactions/stats'),
      ]);
      setTransactions(txRes.data.data || []);
      setStats(statsRes.data);
      buildChartData(txRes.data.data || []);
    } finally {
      setLoading(false);
    }
  };

  const pieData = stats ? [
    { name: 'Clear',   value: stats.clear   || 0, color: PIE_COLORS.clear   },
    { name: 'Review',  value: stats.review  || 0, color: PIE_COLORS.review  },
    { name: 'Blocked', value: stats.blocked || 0, color: PIE_COLORS.blocked },
  ] : [];

  return (
    <Layout>
      <div className="p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-text-pri">Operations Dashboard</h1>
            <p className="text-sm text-text-muted mt-0.5">Real-time transaction monitoring</p>
          </div>
          <div className="flex items-center gap-3">
            <div className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border ${connected ? 'border-green-500/30 text-green-400 bg-green-500/5' : 'border-red-500/30 text-red-400 bg-red-500/5'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-green-400 animate-pulse' : 'bg-red-500'}`} />
              {connected ? 'Live' : 'Offline'}
            </div>
            <button onClick={refresh} className="flex items-center gap-1.5 text-xs text-text-sec hover:text-text-pri border border-border-dim rounded-lg px-3 py-1.5 transition-all hover:border-border-mid">
              <RefreshCw size={12} />
              Refresh
            </button>
          </div>
        </div>

        {/* Stat cards */}
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
          {loading ? (
            Array.from({length:4}).map((_,i) => <SkeletonCard key={i} />)
          ) : (<>
            <StatCard label="Total Transactions" value={stats?.total || 0}       accent="teal"   icon="📊" />
            <StatCard label="Flagged (Review)"   value={stats?.flagged || 0}      accent="amber"  icon="⚠️" />
            <StatCard label="Blocked"            value={stats?.blocked || 0}      accent="red"    icon="🚫" />
            <StatCard label="Avg Fraud Score"    value={stats?.avgFraudScore || 0} accent="purple" icon="🎯" sub="out of 100" />
          </>)}
        </div>

        {/* Charts row */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mb-6">
          {/* Area chart */}
          <div className="xl:col-span-2 bg-bg-card border border-border-dim rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-sm font-semibold text-text-pri">Transaction Volume</h2>
                <p className="text-xs text-text-muted mt-0.5">by hour today</p>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-brand">
                <Activity size={12} />
                Live updating
              </div>
            </div>
            {chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={180}>
                <AreaChart data={chartData} margin={{ top: 5, right: 5, bottom: 0, left: -20 }}>
                  <defs>
                    <linearGradient id="tealGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#00d4b8" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#00d4b8" stopOpacity={0}    />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="hour" tick={{ fontSize: 10, fill: '#4a4a6a' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: '#4a4a6a' }} axisLine={false} tickLine={false} />
                  <Tooltip content={<CustomTooltip />} />
                  <Area type="monotone" dataKey="count" stroke="#00d4b8" strokeWidth={2} fill="url(#tealGrad)" dot={false} activeDot={{ r: 4, fill: '#00d4b8' }} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[180px] flex items-center justify-center text-text-muted text-sm">
                No data yet — run the simulator to generate transactions
              </div>
            )}
          </div>

          {/* Pie chart */}
          <div className="bg-bg-card border border-border-dim rounded-xl p-5">
            <h2 className="text-sm font-semibold text-text-pri mb-1">Status Breakdown</h2>
            <p className="text-xs text-text-muted mb-4">All transactions</p>
            {pieData.some(d => d.value > 0) ? (
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie data={pieData} cx="50%" cy="50%" innerRadius={50} outerRadius={75}
                       paddingAngle={3} dataKey="value">
                    {pieData.map((entry, i) => (
                      <Cell key={i} fill={entry.color} strokeWidth={0} />
                    ))}
                  </Pie>
                  <Legend formatter={(value) => <span style={{ color: '#8888a8', fontSize: 12 }}>{value}</span>} />
                  <Tooltip contentStyle={{ background: '#16161e', border: '1px solid #2a2a3e', borderRadius: 8, fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[180px] flex items-center justify-center text-text-muted text-sm">No data yet</div>
            )}
          </div>
        </div>

        {/* Rule breakdown */}
        {ruleData.length > 0 && (
          <div className="bg-bg-card border border-border-dim rounded-xl p-5 mb-6">
            <h2 className="text-sm font-semibold text-text-pri mb-4">Rule Trigger Frequency</h2>
            <div className="space-y-2.5">
              {ruleData.map((r) => {
                const max = ruleData[0]?.count || 1;
                const pct = Math.round((r.count / max) * 100);
                return (
                  <div key={r._id} className="flex items-center gap-3">
                    <div className="w-40 text-xs font-mono text-text-sec truncate">{r._id?.replace(/_RULE$/, '').replace(/_/g, ' ')}</div>
                    <div className="flex-1 h-1.5 bg-border-dim rounded-full overflow-hidden">
                      <div className="h-full bg-brand/60 rounded-full transition-all duration-700" style={{ width: `${pct}%` }} />
                    </div>
                    <div className="w-8 text-xs text-text-muted text-right font-mono">{r.count}</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Live feed */}
        <div className="bg-bg-card border border-border-dim rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border-dim">
            <div>
              <h2 className="text-sm font-semibold text-text-pri">Live Transaction Feed</h2>
              <p className="text-xs text-text-muted mt-0.5">Click any row to expand details</p>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-text-muted">
              <span className="w-1.5 h-1.5 rounded-full bg-brand animate-pulse" />
              {transactions.length} loaded
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border-dim">
                  {['Time', 'User', 'Merchant', 'Amount', 'Score', 'Status', ''].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-[10px] text-text-muted uppercase tracking-widest font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  Array.from({length:8}).map((_,i) => <SkeletonRow key={i} cols={7} />)
                ) : transactions.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-16 text-center text-text-muted text-sm">
                    No transactions yet. Use the Simulator to generate activity.
                  </td></tr>
                ) : (
                  transactions.map(txn => (
                    <TxRow key={txn._id} txn={txn} isNew={newIds.has(txn._id)} />
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Layout>
  );
}