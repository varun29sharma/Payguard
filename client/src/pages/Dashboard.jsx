import { useState, useEffect, useRef } from 'react';
import { getSocket } from '../api/socket';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend
} from 'recharts';
import { RefreshCcw, ChevronDown, ChevronUp, Terminal, Activity } from 'lucide-react';
import Layout from '../components/shared/Layout';
import StatCard from '../components/shared/StatCard';
import StatusBadge from '../components/shared/StatusBadge';
import FraudScore from '../components/shared/FraudScore';
import { SkeletonRow, SkeletonCard } from '../components/shared/Skeleton';
import api from '../api/axiosConfig';

import receptionistIdle from '../assets/pixel/receptionist_idle.png';
import receptionistAlert from '../assets/pixel/receptionist_alert.png';

const PIE_COLORS = { clear: '#00ffcc', review: '#f59e0b', blocked: '#ef4444' };

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="pixel-box p-3 font-mono border-brand text-xs">
      <div className="text-text-sec mb-1">T:{label}</div>
      <div className="text-brand font-bold">VOL:{payload[0].value}</div>
    </div>
  );
};

function RuleTag({ rule }) {
  const colors = {
    VELOCITY_RULE:           'text-red-400 border-red-500 bg-red-500/10',
    ENUMERATION_ATTACK_RULE: 'text-purple-400 border-purple-500 bg-purple-500/10',
    AMOUNT_THRESHOLD_RULE:   'text-amber-400 border-amber-500 bg-amber-500/10',
    GEOGRAPHIC_ANOMALY_RULE: 'text-blue-400 border-blue-500 bg-blue-500/10',
    NEW_DEVICE_RULE:         'text-orange-400 border-orange-500 bg-orange-500/10',
    NIGHT_OWL_RULE:          'text-brand border-brand bg-brand-dim',
    BLOCK_LIST:              'text-red-500 border-red-500 bg-red-500/20 font-bold',
  };
  const cls = colors[rule] || 'text-text-sec border-text-muted bg-bg-primary';
  return (
    <span className={`text-[10px] px-1.5 py-0.5 border uppercase font-pixel tracking-widest ${cls}`}>
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
        className={`border-b-2 border-border-dim cursor-pointer transition-colors hover:bg-border-dim/50
          ${isNew ? 'bg-brand/20 animate-pulse-fast' : ''}
          ${txn.fraudStatus === 'blocked' ? 'border-l-4 border-l-red-500' : ''}
          ${txn.fraudStatus === 'review'  ? 'border-l-4 border-l-amber-500' : ''}
          ${txn.fraudStatus === 'clear'   ? 'border-l-4 border-l-brand' : ''}
        `}
      >
        <td className="px-4 py-3 text-xs text-text-sec font-mono whitespace-nowrap">
          {new Date(txn.timestamp).toLocaleTimeString()}
        </td>
        <td className="px-4 py-3 text-sm font-mono text-text-pri">{txn.userId}</td>
        <td className="px-4 py-3 text-sm font-pixel tracking-widest text-text-sec uppercase">{txn.merchantId}</td>
        <td className="px-4 py-3 text-sm font-mono text-brand">
          ₹{Number(txn.amount).toLocaleString()}
        </td>
        <td className="px-4 py-3">
          <FraudScore score={txn.fraudScore} />
        </td>
        <td className="px-4 py-3">
          <StatusBadge status={txn.fraudStatus} />
        </td>
        <td className="px-4 py-3 text-text-muted text-right">
          {expanded ? <ChevronUp size={16} className="inline" /> : <ChevronDown size={16} className="inline" />}
        </td>
      </tr>

      {expanded && (
        <tr className="bg-bg-secondary border-b-2 border-border-mid">
          <td colSpan={7} className="p-4">
            <div className="pixel-box p-3 border-border-hi">
              <div className="flex flex-wrap gap-6 text-xs font-mono mb-3">
                <div><span className="text-text-muted">DEV:</span> <span className="text-text-pri">{txn.deviceId || 'UNKNOWN'}</span></div>
                <div><span className="text-text-muted">LOC:</span> <span className="text-text-pri">{txn.location?.city || 'UNKNOWN'}</span></div>
                <div><span className="text-text-muted">TXN_ID:</span> <span className="text-text-muted">{txn.transactionId}</span></div>
              </div>
              {txn.rulesTriggered?.length > 0 && (
                <div className="border-t border-border-dim pt-3">
                  <span className="text-text-muted text-[10px] uppercase font-pixel tracking-widest block mb-2">VIO_RULES:</span>
                  <div className="flex flex-wrap gap-2">
                    {txn.rulesTriggered.map((r, i) => (
                      <div key={i} className="flex items-center gap-2 bg-bg-primary px-2 py-1 border border-border-dim">
                        <RuleTag rule={r.ruleName} />
                        <span className="text-[10px] text-text-muted font-mono">{r.reason || `SCR:${r.score}`}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
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
  const socketRef = useRef(null);

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

  useEffect(() => {
    socketRef.current = getSocket();
    const s = socketRef.current;

    const handleNewTransaction = (txn) => {
      setTransactions(prev => [txn, ...prev].slice(0, 50));
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
    { name: 'CLEAR',   value: stats.clear   || 0, color: PIE_COLORS.clear   },
    { name: 'REVIEW',  value: stats.review  || 0, color: PIE_COLORS.review  },
    { name: 'BLOCKED', value: stats.blocked || 0, color: PIE_COLORS.blocked },
  ] : [];

  return (
    <Layout>
      <div className="p-6 max-w-[1400px] mx-auto">
        
        {/* Header Block */}
        <div className="pixel-box p-4 mb-6 border-brand bg-bg-card2 flex items-center justify-between">
          <div className="flex items-center gap-6">
            {/* Avatar */}
            <div className={`w-20 h-20 border-2 ${isAlert ? 'border-red-500 bg-red-500/20' : 'border-brand bg-brand-dim'} relative overflow-hidden flex-shrink-0 shadow-[2px_2px_0_0_#000]`}>
              <img 
                src={isAlert ? receptionistAlert : receptionistIdle} 
                className={`w-full h-full object-cover ${isAlert ? 'animate-shake' : 'animate-bob'}`} 
                style={{ imageRendering: 'pixelated' }}
                alt="Receptionist"
                onError={(e) => { e.target.style.display='none' }}
              />
              <div className="absolute inset-0 bg-[linear-gradient(transparent_50%,rgba(0,0,0,0.4)_50%)] bg-[length:100%_4px] pointer-events-none" />
            </div>
            
            <div>
              <h1 className="text-3xl font-vt text-brand tracking-widest text-shadow-pixel flex items-center gap-2">
                <Terminal size={24} />
                MAIN_OPERATIONS_HUB
              </h1>
              <div className="text-sm font-pixel text-text-sec uppercase tracking-widest flex items-center gap-2 mt-1">
                STATUS: <span className={isAlert ? 'text-red-400 animate-blink' : 'text-brand'}>{isAlert ? 'ALERT CONDITION RED' : 'NOMINAL'}</span>
              </div>
            </div>
          </div>
          
          <button onClick={refresh} className="pixel-btn px-4 py-2 flex items-center gap-2 text-text-pri text-sm">
            <RefreshCcw size={14} />
            SYNC DATA
          </button>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
          {loading ? (
            Array.from({length:4}).map((_,i) => <SkeletonCard key={i} />)
          ) : (<>
            <StatCard label="TOTAL_TXN" value={stats?.total || 0}       accent="brand"  icon="T" />
            <StatCard label="FLAGGED"   value={stats?.flagged || 0}      accent="amber"  icon="!" />
            <StatCard label="BLOCKED"   value={stats?.blocked || 0}      accent="red"    icon="X" />
            <StatCard label="AVG_SCORE" value={stats?.avgFraudScore || 0} accent="purple" icon="S" sub="OF 100" />
          </>)}
        </div>

        {/* Charts & Rules */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 mb-6">
          {/* Main Chart */}
          <div className="xl:col-span-2 pixel-box p-5 border-border-mid relative">
            <div className="absolute top-0 right-0 bg-brand text-bg-primary text-[10px] font-pixel px-2 py-1 tracking-widest">LIVE_DATA</div>
            <h2 className="text-lg font-vt text-text-pri tracking-widest mb-4 flex items-center gap-2">
              <Activity size={16} className="text-brand" />
              TXN_VOLUME_HISTORY
            </h2>
            {chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={chartData} margin={{ top: 5, right: 0, bottom: 0, left: -20 }}>
                  <defs>
                    <linearGradient id="brandGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="var(--color-brand)" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="var(--color-brand)" stopOpacity={0}    />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="hour" tick={{ fontSize: 10, fill: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)' }} axisLine={false} tickLine={false} />
                  <Tooltip content={<CustomTooltip />} />
                  <Area type="step" dataKey="count" stroke="var(--color-brand)" strokeWidth={2} fill="url(#brandGrad)" dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[200px] flex items-center justify-center font-pixel text-text-muted text-sm tracking-widest uppercase">
                AWAITING INPUT...
              </div>
            )}
          </div>

          <div className="flex flex-col gap-6">
            {/* Pie Chart */}
            <div className="pixel-box p-5 border-border-mid flex-1">
              <h2 className="text-lg font-vt text-text-pri tracking-widest mb-2">STATUS_DIST</h2>
              {pieData.some(d => d.value > 0) ? (
                <div className="h-[140px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={pieData} cx="50%" cy="50%" innerRadius={40} outerRadius={60}
                           paddingAngle={2} dataKey="value" stroke="none">
                        {pieData.map((entry, i) => (
                          <Cell key={i} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={{ backgroundColor: 'var(--color-bg-card)', border: '2px solid var(--color-border-mid)', borderRadius: 0, fontFamily: 'var(--font-mono)' }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="h-[140px] flex items-center justify-center font-pixel text-text-muted text-xs">NO_DATA</div>
              )}
              <div className="flex justify-center gap-3 mt-2">
                {pieData.map(d => (
                  <div key={d.name} className="flex items-center gap-1 text-[10px] font-mono">
                    <div className="w-2 h-2" style={{ backgroundColor: d.color }}></div>
                    <span style={{ color: d.color }}>{d.name}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Rule breakdown mini */}
            {ruleData.length > 0 && (
              <div className="pixel-box p-4 border-border-mid">
                <h2 className="text-sm font-vt text-text-pri tracking-widest mb-3">RULE_TRIGGERS</h2>
                <div className="space-y-2">
                  {ruleData.slice(0,3).map((r) => {
                    const max = ruleData[0]?.count || 1;
                    const pct = Math.round((r.count / max) * 100);
                    return (
                      <div key={r._id} className="flex flex-col gap-1">
                        <div className="flex justify-between text-[10px] font-mono">
                          <span className="text-text-sec truncate w-32">{r._id?.replace(/_RULE$/, '')}</span>
                          <span className="text-text-pri">{r.count}</span>
                        </div>
                        <div className="h-1 bg-bg-primary w-full">
                          <div className="h-full bg-brand" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Live feed terminal */}
        <div className="pixel-box border-border-mid overflow-hidden">
          <div className="bg-border-mid px-4 py-2 flex items-center justify-between">
            <h2 className="text-base font-vt text-text-pri tracking-widest">TXN_TERMINAL</h2>
            <div className="flex items-center gap-2 text-xs font-pixel text-brand">
              <span className="w-2 h-2 bg-brand animate-pulse-fast"></span>
              MONITORING
            </div>
          </div>

          <div className="overflow-x-auto bg-bg-card">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b-2 border-border-mid bg-bg-secondary">
                  {['TIMESTAMP', 'USR_ID', 'MERCHANT', 'AMT(INR)', 'SCORE', 'STATUS', 'SYS'].map(h => (
                    <th key={h} className="px-4 py-3 text-xs font-pixel text-text-muted tracking-widest">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  Array.from({length:8}).map((_,i) => <SkeletonRow key={i} cols={7} />)
                ) : transactions.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-16 text-center text-text-muted font-vt text-xl">
                    SYSTEM IDLE. AWAITING INPUT.
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
