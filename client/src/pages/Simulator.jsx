import { useState, useEffect, useRef } from 'react';
import { Send, Zap } from 'lucide-react';
import Layout from '../components/shared/Layout';
import StatusBadge from '../components/shared/StatusBadge';
import FraudScore from '../components/shared/FraudScore';
import api from '../api/axiosConfig';
import { getSocket } from '../api/socket';
import useEngineHealth from '../hooks/useEngineHealth';

const USERS     = Array.from({length:20},(_,i) => `USER_${i+1}`);
const MERCHANTS = ['AMAZON_IN','FLIPKART','SWIGGY','ZOMATO','PAYTM','RAZORPAY','PHONEPE'];
const CITIES    = [
  { city:'Mumbai',    lat:19.0760, lng:72.8777 },
  { city:'Delhi',     lat:28.6139, lng:77.2090 },
  { city:'Bangalore', lat:12.9716, lng:77.5946 },
  { city:'Hyderabad', lat:17.3850, lng:78.4867 },
  { city:'Chennai',   lat:13.0827, lng:80.2707 },
];
const DEVICES = ['DEVICE_A1','DEVICE_B2','DEVICE_C3','DEVICE_D4','DEVICE_E5'];
// Mule-ring cast: victims pay the mule accounts, which forward most of it on.
// Both mules forward from the SAME device, so the detector clusters them into
// one laundering ring via shared identity.
const MULE_VICTIMS = ['USER_7','USER_9','USER_11','USER_13','USER_15'];
const MULES = ['MULE_1','MULE_2'];
const MULE_DEVICE = 'DEVICE_MULE_9';

const randomTxn = (fraudType = null) => {
  const loc  = CITIES[Math.floor(Math.random() * CITIES.length)];
  const base = {
    userId:     USERS[Math.floor(Math.random() * USERS.length)],
    merchantId: MERCHANTS[Math.floor(Math.random() * MERCHANTS.length)],
    currency:   'INR',
    location:   loc,
    deviceId:   DEVICES[Math.floor(Math.random() * DEVICES.length)],
  };
  switch (fraudType) {
    case 'enumeration': return { ...base, userId: 'USER_1', amount: Math.random() * 10 + 1 };
    case 'velocity':    return { ...base, userId: 'USER_2', amount: Math.floor(Math.random() * 5000) + 500 };
    case 'high_amount': return { ...base, amount: Math.floor(Math.random() * 200000) + 50000 };
    case 'new_device':  return { ...base, deviceId: `NEW_DEVICE_${Date.now()}`, amount: Math.floor(Math.random() * 30000) + 15000 };
    case 'mule_receive': {
      const mule = MULES[Math.floor(Math.random() * MULES.length)];
      const victim = MULE_VICTIMS[Math.floor(Math.random() * MULE_VICTIMS.length)];
      return { ...base, userId: victim, merchantId: mule, beneficiaryId: mule, amount: Math.floor(Math.random() * 14000) + 12000 };
    }
    case 'mule_forward': {
      const mule = MULES[Math.floor(Math.random() * MULES.length)];
      const beneficiary = mule === 'MULE_1' ? 'BENEFICIARY_A' : 'BENEFICIARY_B';
      return { ...base, userId: mule, merchantId: beneficiary, beneficiaryId: beneficiary, deviceId: MULE_DEVICE, amount: Math.floor(Math.random() * 15000) + 9000 };
    }
    default:            return { ...base, amount: Math.floor(Math.random() * 20000) + 100 };
  }
};

const BURST_SCENARIOS = [
  { id: 'mixed', label: 'Mixed reality', count: 30, delay: 400, pattern: (i) => i % 5 === 0 ? ['enumeration','velocity','high_amount','new_device'][i%4] : null },
  { id: 'enumeration_wave', label: 'Enumeration wave', count: 20, delay: 300, pattern: () => 'enumeration' },
  { id: 'account_takeover', label: 'Account takeover burst', count: 15, delay: 250, pattern: () => 'velocity' },
  { id: 'relay_fraud', label: 'Relay fraud simulation', count: 10, delay: 600, pattern: () => 'new_device' },
  { id: 'mule_ring', label: 'Mule ring (receive-and-forward)', count: 24, delay: 400, pattern: (i) => i < 12 ? 'mule_receive' : 'mule_forward' },
];

export default function Simulator() {
  const engine = useEngineHealth();
  const [running,   setRunning]   = useState(false);
  const [progress,  setProgress]  = useState(0);
  const [total,     setTotal]     = useState(0);
  const [scenario,  setScenario]  = useState('mixed');
  const [liveCounts,setLiveCounts]= useState({ sent:0, clear:0, review:0, blocked:0 });
  const [recentTxns,setRecentTxns]= useState([]);
  const [manualForm,setManualForm]= useState({ userId:'USER_1', merchantId:'AMAZON_IN', amount:'', city:'Mumbai', deviceId:'DEVICE_A1' });
  const [manualResult, setManualResult] = useState(null);
  const [manualLoading,setManualLoading]= useState(false);
  const stopRef   = useRef(false);

  useEffect(() => {
    const s = getSocket();
    const handleNewTxn = (txn) => {
      setRecentTxns(prev => [txn, ...prev].slice(0, 10));
      setLiveCounts(prev => ({ ...prev, [txn.fraudStatus]: (prev[txn.fraudStatus] || 0) + 1 }));
    };
    s.on('new-transaction', handleNewTxn);
    return () => s.off('new-transaction', handleNewTxn);
  }, []);

  const runBurst = async () => {
    const sc = BURST_SCENARIOS.find(s => s.id === scenario);
    if (!sc) return;
    setRunning(true); stopRef.current = false; setProgress(0); setTotal(sc.count);
    setLiveCounts({ sent:0, clear:0, review:0, blocked:0 }); setRecentTxns([]);
    for (let i = 0; i < sc.count; i++) {
      if (stopRef.current) break;
      try { await api.post('/transactions', randomTxn(sc.pattern(i))); } catch { /* non-fatal — individual burst txns may fail */ }
      setProgress(i + 1); setLiveCounts(prev => ({ ...prev, sent: i + 1 }));
      await new Promise(r => setTimeout(r, sc.delay));
    }
    setRunning(false);
  };

  const sendManual = async () => {
    setManualLoading(true); setManualResult(null);
    try {
      const loc = CITIES.find(c => c.city === manualForm.city) || CITIES[0];
      const { data } = await api.post('/transactions', { ...manualForm, amount: parseFloat(manualForm.amount), location: loc, currency: 'INR' });
      setManualResult(data.data);
    } catch { /* non-fatal — failed manual txns are just ignored */ } finally { setManualLoading(false); }
  };

  const pct = total > 0 ? Math.round((progress / total) * 100) : 0;

  return (
    <Layout>
      <div className="p-10 max-w-[1200px] mx-auto">
        <div className="flex items-start justify-between mb-10">
          <div>
            <div className="label mb-2">04 — Simulator</div>
            <h1 className="text-5xl font-black tracking-tight leading-none">Workbench</h1>
            <div className="mt-3 font-mono text-xs uppercase tracking-wider text-muted">
              Generate synthetic transactions and watch live scoring
            </div>
          </div>
          <div className="text-right">
            <div className={`font-mono text-xs uppercase tracking-wider ${engine.mode === 'engine' ? 'text-ink' : engine.mode === 'fallback' ? 'text-accent animate-blink font-semibold' : 'text-muted'}`}>
              Scoring engine: {engine.mode === 'engine' ? 'online' : engine.mode === 'fallback' ? 'fallback' : 'checking'}
            </div>
            {engine.mode === 'fallback' && (
              <div className="text-[11px] font-mono text-accent mt-1 uppercase">All output will be scored clear</div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
          {/* Burst panel */}
          <div>
            <h2 className="text-xl font-bold tracking-tight mb-5 flex items-center gap-2"><Zap size={17} className="text-accent" /> Scenario burst</h2>

            <div className="space-y-3 mb-7">
              {BURST_SCENARIOS.map(sc => (
                <label key={sc.id} className={`flex items-center justify-between p-4 border cursor-pointer transition-colors ${scenario === sc.id ? 'border-ink bg-card' : 'border-hairline hover:border-hairline-strong'}`}>
                  <div className="flex items-center gap-4">
                    <input type="radio" name="scenario" checked={scenario === sc.id} onChange={() => setScenario(sc.id)} className="accent-ink" />
                    <span className="font-semibold text-sm uppercase tracking-wide">{sc.label}</span>
                  </div>
                  <span className="font-mono text-xs text-muted">COUNT: {sc.count}</span>
                </label>
              ))}
            </div>

            <div className="mb-5">
              <div className="flex justify-between font-mono text-xs mb-2 text-ink-soft">
                <span>Progress</span> <span>{progress}/{total}</span>
              </div>
              <div className="h-[4px] bg-hairline w-full">
                <div className="h-full bg-ink transition-all" style={{ width: `${pct}%` }} />
              </div>
            </div>

            <div className="flex gap-3">
              <button onClick={runBurst} disabled={running} className="btn flex-1 py-3 text-sm">
                {running ? 'Running…' : 'Run burst'}
              </button>
              {running && <button onClick={() => stopRef.current = true} className="btn btn-accent px-5">Halt</button>}
            </div>

            <div className="grid grid-cols-4 gap-3 mt-6 text-center font-mono">
              <div className="border border-hairline p-3 bg-card"><div className="label mb-1">Sent</div><div className="text-lg font-semibold tabular-nums">{liveCounts.sent}</div></div>
              <div className="border border-hairline p-3 bg-card"><div className="label mb-1 text-green-700 dark:text-green-300">Clear</div><div className="text-lg font-semibold tabular-nums text-green-700 dark:text-green-300">{liveCounts.clear}</div></div>
              <div className="border border-hairline p-3 bg-card"><div className="label mb-1 text-amber-600 dark:text-amber-300">Review</div><div className="text-lg font-semibold tabular-nums text-amber-600 dark:text-amber-300">{liveCounts.review}</div></div>
              <div className="border border-hairline p-3 bg-card"><div className="label mb-1 text-accent">Blocked</div><div className="text-lg font-semibold tabular-nums text-accent">{liveCounts.blocked}</div></div>
            </div>
          </div>

          {/* Manual panel */}
          <div>
            <h2 className="text-xl font-bold tracking-tight mb-5 flex items-center gap-2"><Send size={16} /> Manual entry</h2>

            <div className="space-y-5 mb-7">
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <label className="label block mb-1">User</label>
                  <select value={manualForm.userId} onChange={e=>setManualForm(f=>({...f,userId:e.target.value}))} className="input">
                    {USERS.map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label block mb-1">Merchant</label>
                  <select value={manualForm.merchantId} onChange={e=>setManualForm(f=>({...f,merchantId:e.target.value}))} className="input">
                    {MERCHANTS.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className="label block mb-1">Amount (INR)</label>
                <input type="number" value={manualForm.amount} onChange={e=>setManualForm(f=>({...f,amount:e.target.value}))} placeholder="0.00" className="input" />
              </div>

              <div className="grid grid-cols-2 gap-6">
                <div>
                  <label className="label block mb-1">City</label>
                  <select value={manualForm.city} onChange={e=>setManualForm(f=>({...f,city:e.target.value}))} className="input">
                    {CITIES.map(c => <option key={c.city} value={c.city}>{c.city}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label block mb-1">Device</label>
                  <select value={manualForm.deviceId} onChange={e=>setManualForm(f=>({...f,deviceId:e.target.value}))} className="input">
                    {[...DEVICES, 'NEW_DEVICE_X'].map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
              </div>
            </div>

            <button onClick={sendManual} disabled={manualLoading||!manualForm.amount} className="btn w-full py-3 mb-6">
              {manualLoading ? 'Scoring…' : 'Transmit transaction'}
            </button>

            {manualResult && (
              <div className="border-t border-hairline pt-5">
                <div className="label mb-3">Score result</div>
                <div className="flex gap-5 items-center">
                  <FraudScore score={manualResult.fraudScore} />
                  <StatusBadge status={manualResult.fraudStatus} />
                </div>
              </div>
            )}
          </div>
        </div>

        {recentTxns.length > 0 && (
          <div className="mt-12 border border-hairline bg-card">
            <div className="px-5 py-3 border-b border-hairline font-bold tracking-tight">Live output</div>
            <div className="bg-paper p-3 flex flex-col gap-1 font-mono text-xs">
              {recentTxns.map((t,i) => (
                <div key={i} className="flex gap-4 p-2 border-b border-hairline last:border-0">
                  <span className="text-muted">{new Date(t.timestamp).toLocaleTimeString()}</span>
                  <span className="font-semibold w-24 tabular-nums">₹{t.amount}</span>
                  <span className="text-ink-soft flex-1 truncate uppercase tracking-wide">{t.merchantId}</span>
                  <span className={t.fraudStatus==='blocked'?'text-accent font-semibold':t.fraudStatus==='review'?'text-amber-600 dark:text-amber-400 font-semibold':'text-green-700 dark:text-green-300 font-semibold'}>
                    [{t.fraudStatus.toUpperCase()}]
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
