import { useState, useEffect, useRef } from 'react';
import { Cpu, Send, Play, Square, Zap } from 'lucide-react';
import Layout from '../components/shared/Layout';
import StatusBadge from '../components/shared/StatusBadge';
import FraudScore from '../components/shared/FraudScore';
import api from '../api/axiosConfig';
import { getSocket } from '../api/socket';

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
    case 'enumeration': return { ...base, userId: 'USER_1', amount: Math.random() * 10 + 1 };
    case 'velocity':    return { ...base, userId: 'USER_2', amount: Math.floor(Math.random() * 5000) + 500 };
    case 'high_amount': return { ...base, amount: Math.floor(Math.random() * 200000) + 50000 };
    case 'new_device':  return { ...base, deviceId: `NEW_DEVICE_${Date.now()}`, amount: Math.floor(Math.random() * 30000) + 15000 };
    default:            return { ...base, amount: Math.floor(Math.random() * 20000) + 100 };
  }
};

const BURST_SCENARIOS = [
  { id: 'mixed', label: 'MIXED_REALITY', count: 30, delay: 400, pattern: (i) => i % 5 === 0 ? ['enumeration','velocity','high_amount','new_device'][i%4] : null },
  { id: 'enumeration_wave', label: 'ENUM_WAVE', count: 20, delay: 300, pattern: () => 'enumeration' },
  { id: 'account_takeover', label: 'ATO_BURST', count: 15, delay: 250, pattern: () => 'velocity' },
  { id: 'relay_fraud', label: 'RELAY_SIM', count: 10, delay: 600, pattern: () => 'new_device' },
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
      try { await api.post('/transactions', randomTxn(sc.pattern(i))); } catch (err) {}
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
    } catch (err) {} finally { setManualLoading(false); }
  };

  const pct = total > 0 ? Math.round((progress / total) * 100) : 0;

  return (
    <Layout>
      <div className="p-6 max-w-[1200px] mx-auto">
        <div className="pixel-box border-blue-500 p-5 mb-6 flex items-center gap-4 bg-bg-card">
          <Cpu size={32} className="text-blue-500" />
          <div>
            <h1 className="text-2xl font-vt text-blue-400 tracking-widest text-shadow-pixel">WORKBENCH_SIM</h1>
            <div className="text-xs font-mono text-text-sec mt-1">GENERATE SYNTHETIC TXN DATA</div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Burst Panel */}
          <div className="pixel-box border-border-mid p-5">
            <h2 className="text-lg font-vt tracking-widest text-brand mb-4 flex items-center gap-2">
              <Zap size={16}/> BURST_GENERATOR
            </h2>
            
            <div className="space-y-3 mb-6">
              {BURST_SCENARIOS.map(sc => (
                <label key={sc.id} className={`flex items-center justify-between p-3 border-2 cursor-pointer transition-colors ${scenario === sc.id ? 'border-brand bg-brand-dim' : 'border-border-dim hover:border-border-mid bg-bg-primary'}`}>
                  <div className="flex items-center gap-3">
                    <input type="radio" name="scenario" checked={scenario === sc.id} onChange={() => setScenario(sc.id)} className="w-4 h-4 accent-brand" />
                    <span className="font-pixel text-sm tracking-widest">{sc.label}</span>
                  </div>
                  <span className="font-mono text-xs text-text-muted">COUNT: {sc.count}</span>
                </label>
              ))}
            </div>

            <div className="border-t-2 border-border-dim pt-5 mb-5">
              <div className="flex justify-between font-mono text-xs mb-2 text-text-sec">
                <span>PROGRESS:</span> <span>{progress}/{total}</span>
              </div>
              <div className="h-4 bg-bg-primary border-2 border-border-mid w-full p-0.5">
                <div className="h-full bg-brand" style={{ width: `${pct}%` }} />
              </div>
            </div>

            <div className="flex gap-3">
              <button onClick={runBurst} disabled={running} className="pixel-btn pixel-btn-brand flex-1 py-3 text-sm flex justify-center items-center gap-2">
                {running ? 'EXECUTING...' : 'INIT_BURST'}
              </button>
              {running && <button onClick={() => stopRef.current = true} className="pixel-btn px-4 text-red-500 border-red-500">HALT</button>}
            </div>
            
            <div className="grid grid-cols-4 gap-2 mt-5 text-center font-mono">
              <div className="border border-border-dim p-2 bg-bg-primary"><div className="text-text-muted text-[10px]">SENT</div><div className="text-text-pri">{liveCounts.sent}</div></div>
              <div className="border border-green-500/30 p-2 bg-green-500/5"><div className="text-green-500 text-[10px]">CLR</div><div className="text-green-400">{liveCounts.clear}</div></div>
              <div className="border border-amber-500/30 p-2 bg-amber-500/5"><div className="text-amber-500 text-[10px]">REV</div><div className="text-amber-400">{liveCounts.review}</div></div>
              <div className="border border-red-500/30 p-2 bg-red-500/5"><div className="text-red-500 text-[10px]">BLK</div><div className="text-red-400">{liveCounts.blocked}</div></div>
            </div>
          </div>

          {/* Manual Panel */}
          <div className="pixel-box border-border-mid p-5">
            <h2 className="text-lg font-vt tracking-widest text-purple-400 mb-4 flex items-center gap-2">
              <Send size={16}/> MANUAL_ENTRY
            </h2>
            
            <div className="space-y-4 mb-6 font-mono text-sm">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] text-text-muted mb-1">USER_ID</label>
                  <select value={manualForm.userId} onChange={e=>setManualForm(f=>({...f,userId:e.target.value}))} className="w-full bg-bg-primary border-2 border-border-mid p-2 text-text-pri focus:border-brand outline-none">
                    {USERS.map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] text-text-muted mb-1">MERCHANT</label>
                  <select value={manualForm.merchantId} onChange={e=>setManualForm(f=>({...f,merchantId:e.target.value}))} className="w-full bg-bg-primary border-2 border-border-mid p-2 text-text-pri focus:border-brand outline-none">
                    {MERCHANTS.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
              </div>
              
              <div>
                <label className="block text-[10px] text-text-muted mb-1">AMOUNT (INR)</label>
                <input type="number" value={manualForm.amount} onChange={e=>setManualForm(f=>({...f,amount:e.target.value}))} placeholder="0.00" className="w-full bg-bg-primary border-2 border-border-mid p-2 text-text-pri focus:border-brand outline-none" />
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] text-text-muted mb-1">CITY</label>
                  <select value={manualForm.city} onChange={e=>setManualForm(f=>({...f,city:e.target.value}))} className="w-full bg-bg-primary border-2 border-border-mid p-2 text-text-pri focus:border-brand outline-none">
                    {CITIES.map(c => <option key={c.city} value={c.city}>{c.city}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] text-text-muted mb-1">DEVICE</label>
                  <select value={manualForm.deviceId} onChange={e=>setManualForm(f=>({...f,deviceId:e.target.value}))} className="w-full bg-bg-primary border-2 border-border-mid p-2 text-text-pri focus:border-brand outline-none">
                    {[...DEVICES, 'NEW_DEVICE_X'].map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
              </div>
            </div>

            <button onClick={sendManual} disabled={manualLoading||!manualForm.amount} className="pixel-btn w-full py-3 text-purple-400 border-purple-500/50 hover:border-purple-400 mb-5">
              {manualLoading ? 'SCORING...' : 'TRANSMIT'}
            </button>

            {manualResult && (
              <div className="border-t-2 border-border-dim pt-4">
                <div className="text-[10px] font-pixel text-text-muted tracking-widest mb-2">SCORE_RESULT:</div>
                <div className="flex gap-4 items-center">
                  <FraudScore score={manualResult.fraudScore} />
                  <StatusBadge status={manualResult.fraudStatus} />
                </div>
              </div>
            )}
          </div>
        </div>

        {recentTxns.length > 0 && (
          <div className="mt-6 pixel-box border-border-mid overflow-hidden">
            <div className="bg-border-mid px-4 py-2 font-vt text-text-pri tracking-widest">LIVE_OUTPUT</div>
            <div className="bg-bg-primary p-2 flex flex-col gap-1 font-mono text-xs">
              {recentTxns.map((t,i) => (
                <div key={i} className="flex gap-4 p-2 border-b border-border-dim">
                  <span className="text-text-muted">{new Date(t.timestamp).toLocaleTimeString()}</span>
                  <span className="text-brand w-20">₹{t.amount}</span>
                  <span className="text-text-sec flex-1 truncate">{t.merchantId}</span>
                  <span className={t.fraudStatus==='blocked'?'text-red-400':t.fraudStatus==='review'?'text-amber-400':'text-green-400'}>
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
