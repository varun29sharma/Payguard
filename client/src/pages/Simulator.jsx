import { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { Activity, Send, Play, Square, Zap } from 'lucide-react';
import Layout from '../components/shared/Layout';
import StatusBadge from '../components/shared/StatusBadge';
import FraudScore from '../components/shared/FraudScore';
import api from '../api/axiosConfig';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:3000';

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
    case 'enumeration':
      return { ...base, userId: 'USER_1', amount: Math.random() * 10 + 1 };
    case 'velocity':
      return { ...base, userId: 'USER_2', amount: Math.floor(Math.random() * 5000) + 500 };
    case 'high_amount':
      return { ...base, amount: Math.floor(Math.random() * 200000) + 50000 };
    case 'new_device':
      return { ...base, deviceId: `NEW_DEVICE_${Date.now()}`, amount: Math.floor(Math.random() * 30000) + 15000 };
    default:
      return { ...base, amount: Math.floor(Math.random() * 20000) + 100 };
  }
};

const BURST_SCENARIOS = [
  {
    id: 'mixed',
    label: 'Mixed Reality',
    description: '30 transactions — realistic mix of normal and fraudulent activity',
    icon: '🎲',
    count: 30,
    delay: 400,
    pattern: (i) => i % 5 === 0 ? ['enumeration','velocity','high_amount','new_device'][i % 4] : null,
  },
  {
    id: 'enumeration_wave',
    label: 'Enumeration Wave',
    description: '20 micro-transaction probes from USER_1 — triggers campaign detection',
    icon: '🔍',
    count: 20,
    delay: 300,
    pattern: () => 'enumeration',
  },
  {
    id: 'account_takeover',
    label: 'Account Takeover',
    description: '15 rapid transactions from multiple users — velocity burst',
    icon: '🌊',
    count: 15,
    delay: 250,
    pattern: () => 'velocity',
  },
  {
    id: 'relay_fraud',
    label: 'Relay Fraud Sim',
    description: '10 high-value transactions from new devices across multiple cities',
    icon: '📡',
    count: 10,
    delay: 600,
    pattern: () => 'new_device',
  },
];

export default function Simulator() {
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
  const socketRef = useRef(null);

  useEffect(() => {
    socketRef.current = io(SOCKET_URL);
    const s = socketRef.current;

    s.on('new-transaction', (txn) => {
      setRecentTxns(prev => [txn, ...prev].slice(0, 20));
      setLiveCounts(prev => ({
        ...prev,
        [txn.fraudStatus]: (prev[txn.fraudStatus] || 0) + 1,
      }));
    });

    return () => s.disconnect();
  }, []);

  const runBurst = async () => {
    const sc = BURST_SCENARIOS.find(s => s.id === scenario);
    if (!sc) return;

    setRunning(true);
    stopRef.current = false;
    setProgress(0);
    setTotal(sc.count);
    setLiveCounts({ sent:0, clear:0, review:0, blocked:0 });
    setRecentTxns([]);

    for (let i = 0; i < sc.count; i++) {
      if (stopRef.current) break;
      const fraudType = sc.pattern(i);
      const txn = randomTxn(fraudType);
      try {
        await api.post('/transactions', txn);
      } catch (err) {
        console.error('Txn failed:', err.message);
      }
      setProgress(i + 1);
      setLiveCounts(prev => ({ ...prev, sent: i + 1 }));
      await new Promise(r => setTimeout(r, sc.delay));
    }

    setRunning(false);
  };

  const stopBurst = () => { stopRef.current = true; setRunning(false); };

  const sendManual = async () => {
    setManualLoading(true);
    setManualResult(null);
    try {
      const loc = CITIES.find(c => c.city === manualForm.city) || CITIES[0];
      const { data } = await api.post('/transactions', {
        userId:     manualForm.userId,
        merchantId: manualForm.merchantId,
        amount:     parseFloat(manualForm.amount),
        location:   loc,
        deviceId:   manualForm.deviceId,
        currency:   'INR',
      });
      setManualResult(data.data);
    } catch (err) {
      console.error(err);
    } finally {
      setManualLoading(false);
    }
  };

  const pct = total > 0 ? Math.round((progress / total) * 100) : 0;

  return (
    <Layout>
      <div className="p-6 max-w-5xl">
        <div className="flex items-center gap-2 mb-1">
          <Activity size={18} className="text-brand" />
          <h1 className="text-xl font-bold text-text-pri">Transaction Simulator</h1>
        </div>
        <p className="text-sm text-text-muted mb-7">
          Generate realistic transaction patterns to test the fraud detection engine and demonstrate live features
        </p>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          {/* Burst simulator */}
          <div className="bg-bg-card border border-border-dim rounded-xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <Zap size={14} className="text-brand" />
              <h2 className="text-sm font-semibold text-text-pri">Burst Simulator</h2>
            </div>

            {/* Scenario selector */}
            <div className="space-y-2 mb-5">
              {BURST_SCENARIOS.map(sc => (
                <label key={sc.id}
                  className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all
                    ${scenario === sc.id ? 'border-brand/50 bg-brand/5' : 'border-border-dim hover:border-border-mid'}`}>
                  <input type="radio" name="scenario" value={sc.id}
                    checked={scenario === sc.id}
                    onChange={() => setScenario(sc.id)}
                    className="mt-0.5 accent-[#00d4b8]" />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span>{sc.icon}</span>
                      <span className={`text-sm font-medium ${scenario === sc.id ? 'text-brand' : 'text-text-pri'}`}>{sc.label}</span>
                      <span className="text-[10px] text-text-muted font-mono">{sc.count} txns</span>
                    </div>
                    <div className="text-xs text-text-muted mt-0.5">{sc.description}</div>
                  </div>
                </label>
              ))}
            </div>

            {/* Progress */}
            {(running || progress > 0) && (
              <div className="mb-4">
                <div className="flex justify-between text-xs text-text-muted mb-1.5">
                  <span>Progress</span>
                  <span className="font-mono">{progress}/{total}</span>
                </div>
                <div className="h-1.5 bg-border-dim rounded-full overflow-hidden">
                  <div className="h-full bg-brand rounded-full transition-all duration-300" style={{ width: `${pct}%` }} />
                </div>
              </div>
            )}

            {/* Live counters */}
            <div className="grid grid-cols-4 gap-2 mb-5">
              {[
                { key:'sent',    label:'Sent',    color:'text-text-pri'   },
                { key:'clear',   label:'Clear',   color:'text-green-400'  },
                { key:'review',  label:'Review',  color:'text-amber-400'  },
                { key:'blocked', label:'Blocked', color:'text-red-400'    },
              ].map(({ key, label, color }) => (
                <div key={key} className="bg-bg-secondary rounded-lg p-2 text-center border border-border-dim">
                  <div className={`text-lg font-bold font-mono ${color}`}>{liveCounts[key] || 0}</div>
                  <div className="text-[10px] text-text-muted">{label}</div>
                </div>
              ))}
            </div>

            <div className="flex gap-2">
              <button onClick={runBurst} disabled={running}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-brand text-black font-semibold text-sm rounded-lg hover:bg-[#00bfa6] disabled:opacity-50 disabled:cursor-not-allowed transition-all">
                {running ? (
                  <span className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full border-2 border-black/30 border-t-black animate-spin" />
                    Running...
                  </span>
                ) : (
                  <><Play size={14} /> Run Simulation</>
                )}
              </button>
              {running && (
                <button onClick={stopBurst}
                  className="flex items-center gap-1.5 px-3 py-2.5 bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-lg hover:bg-red-500/15 transition-all">
                  <Square size={12} />
                  Stop
                </button>
              )}
            </div>
          </div>

          {/* Manual transaction */}
          <div className="bg-bg-card border border-border-dim rounded-xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <Send size={14} className="text-purple-400" />
              <h2 className="text-sm font-semibold text-text-pri">Manual Transaction</h2>
            </div>

            <div className="space-y-3 mb-4">
              <div>
                <label className="block text-[10px] text-text-muted uppercase tracking-widest mb-1">User ID</label>
                <select value={manualForm.userId} onChange={e => setManualForm(f => ({...f, userId: e.target.value}))}
                  className="w-full bg-bg-primary border border-border-dim rounded-lg px-3 py-2 text-sm text-text-pri focus:border-brand focus:outline-none">
                  {USERS.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[10px] text-text-muted uppercase tracking-widest mb-1">Merchant</label>
                <select value={manualForm.merchantId} onChange={e => setManualForm(f => ({...f, merchantId: e.target.value}))}
                  className="w-full bg-bg-primary border border-border-dim rounded-lg px-3 py-2 text-sm text-text-pri focus:border-brand focus:outline-none">
                  {MERCHANTS.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[10px] text-text-muted uppercase tracking-widest mb-1">Amount (₹)</label>
                <input type="number" value={manualForm.amount} onChange={e => setManualForm(f => ({...f, amount: e.target.value}))}
                  placeholder="5000"
                  className="w-full bg-bg-primary border border-border-dim rounded-lg px-3 py-2 text-sm text-text-pri placeholder-text-muted focus:border-brand focus:outline-none" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] text-text-muted uppercase tracking-widest mb-1">City</label>
                  <select value={manualForm.city} onChange={e => setManualForm(f => ({...f, city: e.target.value}))}
                    className="w-full bg-bg-primary border border-border-dim rounded-lg px-3 py-2 text-sm text-text-pri focus:border-brand focus:outline-none">
                    {CITIES.map(c => <option key={c.city} value={c.city}>{c.city}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] text-text-muted uppercase tracking-widest mb-1">Device</label>
                  <select value={manualForm.deviceId} onChange={e => setManualForm(f => ({...f, deviceId: e.target.value}))}
                    className="w-full bg-bg-primary border border-border-dim rounded-lg px-3 py-2 text-sm text-text-pri focus:border-brand focus:outline-none">
                    {[...DEVICES, 'NEW_DEVICE_X'].map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
              </div>
            </div>

            <button onClick={sendManual} disabled={manualLoading || !manualForm.amount}
              className="w-full flex items-center justify-center gap-2 py-2.5 border border-purple-500/40 bg-purple-500/10 text-purple-400 font-semibold text-sm rounded-lg hover:bg-purple-500/15 disabled:opacity-50 disabled:cursor-not-allowed transition-all mb-4">
              {manualLoading ? <span className="w-3 h-3 rounded-full border-2 border-purple-400/30 border-t-purple-400 animate-spin" /> : <Send size={14} />}
              {manualLoading ? 'Scoring...' : 'Send Transaction'}
            </button>

            {/* Result */}
            {manualResult && (
              <div className={`rounded-lg border p-4 ${manualResult.fraudStatus === 'blocked' ? 'bg-red-500/5 border-red-500/20' : manualResult.fraudStatus === 'review' ? 'bg-amber-500/5 border-amber-500/20' : 'bg-green-500/5 border-green-500/20'}`}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-semibold text-text-pri">Fraud Engine Result</span>
                  <StatusBadge status={manualResult.fraudStatus} />
                </div>
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-xs text-text-muted">Score:</span>
                  <FraudScore score={manualResult.fraudScore} showBar />
                </div>
                {manualResult.rulesTriggered?.length > 0 && (
                  <div>
                    <div className="text-xs text-text-muted mb-1.5">Rules triggered:</div>
                    <div className="flex flex-wrap gap-1.5">
                      {manualResult.rulesTriggered.map((r, i) => (
                        <span key={i} className="text-[10px] font-mono px-2 py-0.5 bg-bg-secondary border border-border-dim rounded text-text-sec">
                          {r.ruleName.replace(/_RULE$/, '').replace(/_/g, ' ')} ({r.score})
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {manualResult.rulesTriggered?.length === 0 && (
                  <div className="text-xs text-green-400">✓ No fraud rules triggered</div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Recent transactions */}
        {recentTxns.length > 0 && (
          <div className="mt-6 bg-bg-card border border-border-dim rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-border-dim">
              <h2 className="text-sm font-semibold text-text-pri">Live Feed</h2>
            </div>
            <div className="divide-y divide-border-dim">
              {recentTxns.map((txn, i) => (
                <div key={txn._id || i} className={`flex items-center gap-4 px-5 py-2.5 text-xs new-row ${i === 0 ? 'bg-brand/3' : ''}`}>
                  <span className="text-text-muted font-mono w-16 flex-shrink-0">
                    {new Date(txn.timestamp).toLocaleTimeString()}
                  </span>
                  <span className="font-mono text-text-sec w-16">{txn.userId}</span>
                  <span className="text-text-sec flex-1">{txn.merchantId}</span>
                  <span className="text-text-pri font-semibold">₹{Number(txn.amount).toLocaleString()}</span>
                  <FraudScore score={txn.fraudScore} />
                  <StatusBadge status={txn.fraudStatus} size="xs" />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
