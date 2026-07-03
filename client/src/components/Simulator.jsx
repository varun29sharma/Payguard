import React, { useState, useEffect } from 'react'
import Layout from './Layout'
import api from '../api/axiosConfig'
import toast from 'react-hot-toast'
import { useSocket } from '../hooks/useSocket'

const USERS = Array.from({length:20}).map((_,i)=> `USER_${i+1}`)
const MERCHANTS = ['MERCH_A','MERCH_B','MERCH_C','MERCH_D','MERCH_E']

export default function Simulator(){
  const [mode, setMode] = useState('burst')
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState(0)
  const [sent, setSent] = useState(0)
  const [clearCount, setClearCount] = useState(0)
  const [reviewCount, setReviewCount] = useState(0)
  const [blockedCount, setBlockedCount] = useState(0)
  const [manual, setManual] = useState({ userId: USERS[0], merchantId: MERCHANTS[0], amount: 1000, currency: 'INR', city: 'Mumbai', deviceId: 'WEB_1' })
  const [manualResult, setManualResult] = useState(null)
  const socket = useSocket()

  useEffect(()=>{
    if(!socket) return
    const onTx = (tx) => {
      setSent(s => s + 1)
      if(tx.fraudStatus === 'blocked'){
        setBlockedCount(c => c+1)
        flash('blocked')
      }else if(tx.fraudStatus === 'review'){
        setReviewCount(c => c+1)
      }else{
        setClearCount(c => c+1)
      }
    }
    socket.on('new-transaction', onTx)
    return ()=> socket.off('new-transaction', onTx)
  },[socket])

  function flash(kind){
    // small visual flash can be implemented via CSS class toggles — simplified here
  }

  async function runBurst(){
    // quick backend availability check
    try{
      await api.get('/transactions?page=1&limit=1')
    }catch(err){
      toast.error('Backend unavailable. Cannot run burst.');
      return
    }
    setRunning(true)
    setProgress(0)
    setSent(0); setClearCount(0); setReviewCount(0); setBlockedCount(0)
    const total = 30
    for(let i=0;i<total;i++){
      const isFraud = ((i+1) % 5) === 0
      const payload = {
        userId: `USER_${Math.ceil(Math.random()*20)}`,
        merchantId: MERCHANTS[Math.floor(Math.random()*MERCHANTS.length)],
        amount: isFraud ? 50000 : Math.floor(Math.random()*5000)+50,
        currency: 'INR',
        location: { city: ['Mumbai','Delhi','Bangalore'][Math.floor(Math.random()*3)], lat:0, lng:0 },
        deviceId: `DEVICE_${Math.floor(Math.random()*1000)}`
      }
      try{
        await api.post('/transactions', payload)
      }catch(err){
        // ignore individual failures
      }
      setProgress(Math.round(((i+1)/total)*100))
      await new Promise(r=> setTimeout(r,400))
    }
    setRunning(false)
    toast.success('Burst complete')
  }

  async function sendManual(e){
    e.preventDefault()
    setManualResult(null)
    // check backend available
    try{
      await api.get('/transactions?page=1&limit=1')
    }catch(err){
      toast.error('Backend unavailable. Cannot send transaction.')
      return
    }
    try{
      const payload = {
        userId: manual.userId,
        merchantId: manual.merchantId,
        amount: Number(manual.amount),
        currency: manual.currency,
        location: { city: manual.city },
        deviceId: manual.deviceId
      }
      const res = await api.post('/transactions', payload)
      setManualResult(res.data.data)
    }catch(err){
      toast.error('Failed to send transaction')
    }
  }

  return (
    <Layout>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Simulator</h2>
          <div className="flex gap-2">
            <button onClick={()=> setMode('burst')} className={`px-3 py-1 rounded-lg ${mode==='burst' ? 'bg-[var(--bg-card)] border-l-4 border-brand' : 'border border-[#1e1e2e]'}`}>Burst</button>
            <button onClick={()=> setMode('manual')} className={`px-3 py-1 rounded-lg ${mode==='manual' ? 'bg-[var(--bg-card)] border-l-4 border-brand' : 'border border-[#1e1e2e]'}`}>Manual</button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 card p-4">
            {mode === 'burst' ? (
              <div>
                <div className="mb-3">Burst simulator fires 30 transactions (400ms interval). Every 5th is high-value to simulate fraud.</div>
                <button onClick={runBurst} disabled={running} className="w-full py-3 bg-brand text-black font-semibold rounded-lg">
                  {running ? 'Running...' : 'Fire 30 transactions'}
                </button>
                <div className="w-full bg-[#0b0b0f] h-3 rounded mt-3 border border-[#1e1e2e]"><div style={{ width: `${progress}%` }} className="h-3 bg-brand rounded" /></div>
              </div>
            ) : (
              <form onSubmit={sendManual} className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <select value={manual.userId} onChange={e=> setManual({...manual, userId: e.target.value})} className="p-2 input-base">
                    {USERS.map(u=> <option key={u} value={u}>{u}</option>)}
                  </select>
                  <select value={manual.merchantId} onChange={e=> setManual({...manual, merchantId: e.target.value})} className="p-2 input-base">
                    {MERCHANTS.map(m=> <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <input className="p-2 input-base" type="number" value={manual.amount} onChange={e=> setManual({...manual, amount: e.target.value})} />
                  <select className="p-2 input-base" value={manual.city} onChange={e=> setManual({...manual, city: e.target.value})}>
                    <option>Mumbai</option>
                    <option>Delhi</option>
                    <option>Bangalore</option>
                  </select>
                  <input className="p-2 input-base" value={manual.deviceId} onChange={e=> setManual({...manual, deviceId: e.target.value})} />
                </div>
                <button className="py-2 bg-brand text-black font-semibold rounded-lg" type="submit">Send Transaction</button>
                {manualResult && (
                  <div className="card p-3 mt-3">
                    <div className="font-medium mb-1">Result</div>
                    <div>Score: <span style={{ color: manualResult.fraudScore > 70 ? '#ef4444' : manualResult.fraudScore > 40 ? '#f59e0b' : '#22c55e' }}>{manualResult.fraudScore}</span></div>
                    <div>Status: {manualResult.fraudStatus}</div>
                  </div>
                )}
              </form>
            )}
          </div>

          <div className="card p-4">
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="p-3 card text-center">Sent: <div className="font-semibold">{sent}</div></div>
              <div className="p-3 card text-center">Clear: <div className="font-semibold text-green-400">{clearCount}</div></div>
              <div className="p-3 card text-center">Review: <div className="font-semibold text-amber-400">{reviewCount}</div></div>
              <div className="p-3 card text-center">Blocked: <div className="font-semibold text-red-400">{blockedCount}</div></div>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  )
}