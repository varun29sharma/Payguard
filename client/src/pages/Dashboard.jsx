import { useState, useEffect, useRef } from 'react';
import { getSocket } from '../api/socket';
import useEngineHealth from '../hooks/useEngineHealth';
import { useTheme } from '../context/ThemeContext';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell
} from 'recharts';
import { RefreshCcw, ChevronDown, ChevronUp, Download } from 'lucide-react';
import Layout from '../components/shared/Layout';
import StatCard from '../components/shared/StatCard';
import StatusBadge from '../components/shared/StatusBadge';
import FraudScore from '../components/shared/FraudScore';
import { SkeletonRow, SkeletonCard } from '../components/shared/Skeleton';
import api from '../api/axiosConfig';

const PIE_COLORS = { review: '#f59e0b', blocked: '#ff3b00' };

// Chart inks follow the theme (SVG attrs can't read CSS vars directly).
const chartPalette = (isDark) => ({
  ink:  isDark ? '#f2efe8' : '#161616',
  grid: isDark ? '#2a2a26' : '#e6e4dd',
  tick: isDark ? '#8d8a80' : '#8b8b84',
  paper: isDark ? '#111110' : '#faf9f6',
});

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="card p-3 text-xs font-mono">
      <div className="label mb-1">{label}</div>
      <div className="font-semibold">{payload[0].value} txns</div>
    </div>
  );
};

const RULE_COLORS = {
  VELOCITY_RULE:           'text-red-700 border-red-300 bg-red-50 dark:text-red-300 dark:border-red-800 dark:bg-red-950/40',
  ENUMERATION_ATTACK_RULE: 'text-purple-700 border-purple-300 bg-purple-50 dark:text-purple-300 dark:border-purple-800 dark:bg-purple-950/40',
  AMOUNT_THRESHOLD_RULE:   'text-amber-700 border-amber-300 bg-amber-50 dark:text-amber-300 dark:border-amber-800 dark:bg-amber-950/40',
  GEOGRAPHIC_ANOMALY_RULE: 'text-blue-700 border-blue-300 bg-blue-50 dark:text-blue-300 dark:border-blue-800 dark:bg-blue-950/40',
  NEW_DEVICE_RULE:         'text-orange-700 border-orange-300 bg-orange-50 dark:text-orange-300 dark:border-orange-800 dark:bg-orange-950/40',
  NIGHT_OWL_RULE:          'text-ink border-hairline-strong bg-paper',
  BLOCK_LIST:              'text-accent border-accent/40 bg-accent/5',
};

function RuleTag({ rule }) {
  const cls = RULE_COLORS[rule] || 'text-muted border-hairline-strong bg-paper';
  return (
    <span className={`text-[10px] px-2 py-0.5 border font-mono uppercase tracking-wider ${cls}`}>
      {rule.replace(/_RULE$/, '').replace(/_/g, ' ')}
    </span>
  );
}

function TxRow({ txn, isNew }) {
  const [expanded, setExpanded] = useState(false);
  const isFallback = txn.scoringEngine === 'fallback';

  return (
    <>
      <tr
        onClick={() => setExpanded(e => !e)}
        className={`border-b border-hairline cursor-pointer transition-colors hover:bg-card ${
          isNew ? 'bg-accent/5' : ''
        } ${txn.fraudStatus === 'blocked' ? 'border-l-2 border-l-accent' : ''}`}
      >
        <td className="px-4 py-3 text-xs text-muted font-mono whitespace-nowrap">
          {new Date(txn.timestamp).toLocaleTimeString()}
        </td>
        <td className="px-4 py-3 text-sm font-mono font-medium">{txn.userId}</td>
        <td className="px-4 py-3 text-sm font-semibold uppercase tracking-wide text-ink-soft">{txn.merchantId}</td>
        <td className="px-4 py-3 text-sm font-mono font-semibold tabular-nums">
          ₹{Number(txn.amount).toLocaleString()}
        </td>
        <td className="px-4 py-3"><FraudScore score={txn.fraudScore} /></td>
        <td className="px-4 py-3">
          <StatusBadge status={txn.fraudStatus} />
          {isFallback && (
            <span className="ml-1.5 text-[9px] font-mono text-accent border border-accent/40 px-1 py-0.5 align-middle" title="Scored by clear fallback — fraud engine unreachable">
              FB
            </span>
          )}
        </td>
        <td className="px-4 py-3 text-muted text-right">
          {expanded ? <ChevronUp size={15} className="inline" /> : <ChevronDown size={15} className="inline" />}
        </td>
      </tr>

      {expanded && (
        <tr className="border-b border-hairline bg-paper">
          <td colSpan={7} className="p-4">
            <div className="flex flex-wrap gap-x-8 gap-y-2 text-xs font-mono mb-3">
              <div><span className="label mr-2">Device</span> <span className="font-medium">{txn.deviceId || '—'}</span></div>
              <div><span className="label mr-2">Location</span> <span className="font-medium">{txn.location?.city || '—'}</span></div>
              <div><span className="label mr-2">Txn ID</span> <span className="text-muted">{txn.transactionId}</span></div>
            </div>
            {txn.rulesTriggered?.length > 0 && (
              <div className="border-t border-hairline pt-3">
                <span className="label block mb-2">Triggered rules</span>
                <div className="flex flex-wrap gap-2">
                  {txn.rulesTriggered.map((r, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <RuleTag rule={r.ruleName} />
                      <span className="text-[10px] text-muted font-mono">{r.reason || `score ${r.score}`}</span>
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
  const [isAlert,      setIsAlert]      = useState(false);
  const engine = useEngineHealth();
  const { isDark } = useTheme();
  const socketRef = useRef(null);

  // Declared before the effects that call it (React Compiler checks order).
  function buildChartData(txns) {
    const hourMap = {};
    txns.forEach(t => {
      const h = new Date(t.timestamp).getHours();
      const key = `${String(h).padStart(2,'0')}:00`;
      hourMap[key] = (hourMap[key] || 0) + 1;
    });
    setChartData(Object.entries(hourMap).map(([hour, count]) => ({ hour, count })).sort((a,b) => a.hour.localeCompare(b.hour)));
  }

  useEffect(() => {
    const load = async () => {
      try {
        const [txRes, statsRes, ruleRes] = await Promise.all([
          api.get('/transactions?limit=30'),
          api.get('/transactions/stats'),
          api.get('/transactions/rule-breakdown'),
        ]);
        setTransactions(txRes.data.data || []);
        setStats(statsRes.data);
        setRuleData(ruleRes.data.data || []);
        buildChartData(txRes.data.data || []);
      } catch (err) {
        console.error('Load error:', err.message);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  useEffect(() => {
    socketRef.current = getSocket();
    const s = socketRef.current;

    const handleNewTransaction = (txn) => {
      setTransactions(prev => [txn, ...prev].slice(0, 30));
      setNewIds(prev => new Set([...prev, txn._id]));
      setTimeout(() => setNewIds(prev => { const n = new Set(prev); n.delete(txn._id); return n; }), 1500);

      setStats(prev => prev ? { ...prev, total: (prev.total || 0) + 1 } : prev);

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

    const handleNewFraudAlert = ({ transaction }) => {
      setIsAlert(true);
      setTimeout(() => setIsAlert(false), 4000);

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

    s.on('new-transaction', handleNewTransaction);
    s.on('new-fraud-alert', handleNewFraudAlert);

    return () => {
      s.off('new-transaction', handleNewTransaction);
      s.off('new-fraud-alert', handleNewFraudAlert);
    };
  }, []);

  const refresh = async () => {
    setLoading(true);
    try {
      const [txRes, statsRes] = await Promise.all([
        api.get('/transactions?limit=30'),
        api.get('/transactions/stats'),
      ]);
      setTransactions(txRes.data.data || []);
      setStats(statsRes.data);
      buildChartData(txRes.data.data || []);
    } finally {
      setLoading(false);
    }
  };

  const [exporting, setExporting] = useState(false);

  const downloadCsv = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const res = await api.get('/transactions/export', { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = `payguard-transactions-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('CSV export failed:', err.message);
    } finally {
      setExporting(false);
    }
  };

  const palette = chartPalette(isDark);
  const pieData = stats ? [
    { name: 'CLEAR',   value: stats.clear   || 0, color: palette.ink },
    { name: 'REVIEW',  value: stats.review  || 0, color: PIE_COLORS.review },
    { name: 'BLOCKED', value: stats.blocked || 0, color: PIE_COLORS.blocked },
  ] : [];

  return (
    <Layout>
      <div className="p-10 max-w-[1400px] mx-auto">
        {/* Header */}
        <div className="flex items-start justify-between mb-10">
          <div>
            <div className="label mb-2">01 — Operations</div>
            <h1 className="text-5xl font-black tracking-tight leading-none">
              Fraud control room
            </h1>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-1 mt-4 font-mono text-xs uppercase tracking-wider">
              <span>
                Status: <span className={isAlert ? 'text-accent animate-blink font-semibold' : 'text-ink font-semibold'}>{isAlert ? 'Alert — condition red' : 'Nominal'}</span>
              </span>
              <span>
                Scoring: <span className={engine.mode === 'fallback' ? 'text-accent animate-blink font-semibold' : engine.mode === 'engine' ? 'text-ink font-semibold' : 'text-muted'}>{engine.mode === 'engine' ? 'Engine' : engine.mode === 'fallback' ? 'Fallback — clear' : 'Checking'}</span>
              </span>
              {engine.fallbackCount > 0 && <span className="text-accent">FB: {engine.fallbackCount}</span>}
            </div>
          </div>
          <button onClick={refresh} className="btn btn-ghost btn-sm">
            <RefreshCcw size={13} />
            Sync
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-10 mb-12">
          {loading ? (
            Array.from({length:4}).map((_,i) => <SkeletonCard key={i} />)
          ) : (<>
            <StatCard label="Total transactions" value={stats?.total || 0}       accent="brand" icon="T" />
            <StatCard label="Flagged"            value={stats?.flagged || 0}      accent="amber" icon="!" />
            <StatCard label="Blocked"            value={stats?.blocked || 0}      accent="red"   icon="X" />
            <StatCard label="Avg score"          value={stats?.avgFraudScore || 0} accent="purple" icon="S" sub="of 100" />
          </>)}
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-10 mb-12">
          <div className="xl:col-span-2">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold tracking-tight">Transaction volume</h2>
              <span className="tag">Last 24h</span>
            </div>
            {chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={chartData} margin={{ top: 5, right: 0, bottom: 0, left: -18 }}>
                  <defs>
                    <linearGradient id="inkGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor={palette.ink} stopOpacity={0.12} />
                      <stop offset="95%" stopColor={palette.ink} stopOpacity={0}    />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="hour" tick={{ fontSize: 10, fill: palette.tick, fontFamily: 'JetBrains Mono' }} axisLine={{ stroke: palette.grid }} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: palette.tick, fontFamily: 'JetBrains Mono' }} axisLine={false} tickLine={false} />
                  <Tooltip content={<CustomTooltip />} />
                  <Area type="monotone" dataKey="count" stroke={palette.ink} strokeWidth={2} fill="url(#inkGrad)" dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[220px] flex items-center justify-center border border-hairline text-muted font-mono text-sm uppercase tracking-wider">
                No data yet
              </div>
            )}
          </div>

          <div className="flex flex-col gap-8">
            <div>
              <h2 className="text-xl font-bold tracking-tight mb-4">Status split</h2>
              {pieData.some(d => d.value > 0) ? (
                <div className="h-[150px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={pieData} cx="50%" cy="50%" innerRadius={45} outerRadius={70}
                           paddingAngle={2} dataKey="value" stroke={palette.paper}>
                        {pieData.map((entry, i) => (
                          <Cell key={i} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={{ backgroundColor: isDark ? '#191918' : '#fff', border: '1px solid ' + palette.grid, borderRadius: 0, fontFamily: 'JetBrains Mono', color: palette.ink }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="h-[150px] flex items-center justify-center border border-hairline text-muted font-mono text-xs uppercase">No data</div>
              )}
              <div className="flex justify-center gap-6 mt-3">
                {pieData.map(d => (
                  <div key={d.name} className="flex items-center gap-2 text-[11px] font-mono uppercase">
                    <span className="w-2.5 h-2.5" style={{ backgroundColor: d.color }} />
                    <span className="text-ink-soft">{d.name}</span>
                  </div>
                ))}
              </div>
            </div>

            {ruleData.length > 0 && (
              <div>
                <h2 className="text-xl font-bold tracking-tight mb-4">Rules triggered</h2>
                <div className="space-y-3">
                  {ruleData.slice(0,3).map((r) => {
                    const max = ruleData[0]?.count || 1;
                    const pct = Math.round((r.count / max) * 100);
                    return (
                      <div key={r._id}>
                        <div className="flex justify-between text-[11px] font-mono mb-1">
                          <span className="uppercase tracking-wide text-ink-soft">{r._id?.replace(/_RULE$/, '').replace(/_/g, ' ')}</span>
                          <span className="font-semibold tabular-nums">{r.count}</span>
                        </div>
                        <div className="h-[3px] bg-hairline w-full">
                          <div className="h-full bg-ink" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Live table */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
            <h2 className="text-xl font-bold tracking-tight">Live transactions</h2>
            <div className="flex items-center gap-4">
              <span className="text-xs font-mono text-muted uppercase tracking-wider hidden sm:inline">
                Latest 30 of {stats?.total || 0}
              </span>
              <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider">
                <span className="w-2 h-2 rounded-full bg-ink animate-pulse"></span>
                Monitoring
              </div>
              <button onClick={downloadCsv} disabled={exporting}
                className="btn btn-ghost btn-sm" title="Download all transactions as CSV">
                <Download size={13} />
                {exporting ? 'Preparing…' : 'CSV'}
              </button>
            </div>
          </div>

          <div className="overflow-x-auto bg-card border border-hairline">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-hairline bg-paper">
                  {['Time', 'User', 'Merchant', 'Amount', 'Score', 'Status', 'Sys'].map(h => (
                    <th key={h} className="px-4 py-3 text-[11px] font-mono text-muted uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  Array.from({length:8}).map((_,i) => <SkeletonRow key={i} cols={7} />)
                ) : transactions.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-16 text-center text-muted font-mono text-sm uppercase tracking-wider">
                    No transactions yet
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
