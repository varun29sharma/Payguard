import React, { useEffect, useMemo, useState } from 'react'
import Layout from '../components/Layout'
import StatCard from '../components/StatCard'
import StatusBadge from '../components/StatusBadge'
import LoadingSkeleton from '../components/LoadingSkeleton'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts'
import toast from 'react-hot-toast'
import api from '../api/axiosConfig'
import { useSocket } from '../hooks/useSocket'

function formatHourLabel(ts){
  const d = new Date(ts)
  return d.getHours().toString().padStart(2,'0') + ':00'
}

export default function Dashboard(){
  const [stats, setStats] = useState(null)
  const [transactions, setTransactions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState(null)
  const socket = useSocket()

  useEffect(()=>{
    let mounted = true
    async function load(){
      setError('')
      setLoading(true)
      try{
        const ok = await import('../utils/probeBackend').then(m=>m.probeBackend())
        if(!ok){
          throw new Error('Backend unreachable')
        }
        const s = await api.get('/transactions/stats')
        const list = await api.get('/transactions?page=1&limit=50')
        if(!mounted) return
        setStats(s.data)
        setTransactions(list.data.data || [])
      }catch(err){
        const msg = err.response?.data?.message || err.message || 'Failed to load dashboard data'
        setError(msg)
        toast.error(msg)
      }finally{ if(mounted) setLoading(false) }
    }
    load()
    return ()=> { mounted = false }
  },[])

  useEffect(()=>{
    if(!socket) return

    const onNewTx = (tx) => {
      tx._isNew = true
      setTransactions(prev => [tx, ...prev].slice(0,50))
      setStats(prev => prev ? ({...prev, total: (prev.total||0)+1}) : prev)
      setTimeout(()=>{
        setTransactions(prev => prev.map(t => t._id === tx._id ? ({...t, _isNew:false}) : t))
      }, 600)
    }

    const onFraud = (payload) => {
      const alert = payload.alert || payload
      const tx = payload.transaction || payload.transaction
      const status = alert?.status || tx?.fraudStatus || 'review'
      const userId = alert?.userId || tx?.userId || 'unknown'
      const score = alert?.fraudScore || tx?.fraudScore || 0
      const ruleName = (alert?.rulesTriggered && alert.rulesTriggered[0]?.ruleName) || (tx?.rulesTriggered && tx.rulesTriggered[0]?.ruleName) || ''
      const icon = status === 'blocked' ? '🚨' : '⚠️'
      toast(`${icon} [${status.toUpperCase()}]: User ${userId} | Score: ${score} | ${ruleName}`, { duration:6000, position: 'top-right' })
      setStats(prev => prev ? ({...prev, flagged: (prev.flagged||0) + (status === 'review' ? 1 : 0), blocked: (prev.blocked||0) + (status === 'blocked' ? 1 : 0) }) : prev)
      // prepend alert transaction if present
      if(tx){ tx._isNew = true; setTransactions(prev => [tx, ...prev].slice(0,50)); setTimeout(()=>{
        setTransactions(prev => prev.map(t => t._id === tx._id ? ({...t, _isNew:false}) : t))
      },600)}
    }

    socket.on('new-transaction', onNewTx)
    socket.on('new-fraud-alert', onFraud)

    return ()=>{
      socket.off('new-transaction', onNewTx)
      socket.off('new-fraud-alert', onFraud)
    }
  },[socket])

  const chartData = useMemo(()=>{
    // aggregate by hour for last 12 entries
    const map = {}
    transactions.slice().reverse().forEach(tx =>{
      const key = formatHourLabel(tx.timestamp || tx.createdAt || Date.now())
      map[key] = (map[key] || 0) + 1
    })
    return Object.keys(map).map(k=>({ name: k, count: map[k] }))
  },[transactions])

  const pieData = useMemo(()=>{
    if(!stats) return []
    return [
      { name: 'Clear', value: stats.clear || Math.max(0, (stats.total||0) - ((stats.flagged||0)+(stats.blocked||0))), color: '#22c55e' },
      { name: 'Review', value: stats.flagged || 0, color: '#f59e0b' },
      { name: 'Blocked', value: stats.blocked || 0, color: '#ef4444' },
    ]
  },[stats])

  return (
    <Layout>
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <StatCard title="Total Transactions" value={stats?.total || 0} topColor="bg-brand" />
          <StatCard title="Flagged (review)" value={stats?.flagged || 0} topColor="bg-amber-500" />
          <StatCard title="Blocked" value={stats?.blocked || 0} topColor="bg-red-500" />
          <StatCard title="Avg Fraud Score" value={Math.round(stats?.avgFraudScore || 0)} topColor="bg-purple-500" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 card p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                <div className="font-semibold">Live Transaction Volume</div>
              </div>
            </div>
            <div style={{ height: 220 }}>
              {loading ? <LoadingSkeleton lines={3} /> : (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="colorTx" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#00d4b8" stopOpacity={0.6} />
                        <stop offset="100%" stopColor="#00d4b8" stopOpacity={0.05} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="name" stroke="#8888a8" />
                    <YAxis stroke="#8888a8" />
                    <Tooltip />
                    <Area type="monotone" dataKey="count" stroke="#00d4b8" fillOpacity={1} fill="url(#colorTx)" />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          <div className="card p-4">
            <div className="font-semibold mb-3">Fraud Breakdown</div>
            {loading ? <LoadingSkeleton lines={3} /> : (
              <div style={{ height: 220 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={pieData} dataKey="value" innerRadius={50} outerRadius={80}>
                      {pieData.map((entry, idx) => (
                        <Cell key={idx} fill={entry.color} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </div>

        <div className="card p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="font-semibold">Live Transaction Feed</div>
            <div className="text-sm text-[var(--text-secondary)]">Live</div>
          </div>

          {loading ? <LoadingSkeleton lines={5} /> : error ? (
            <div className="p-6 text-center">
              <div className="text-red-400 mb-2">{error}</div>
              <button onClick={() => {
                setError(''); setLoading(true); // re-run effect by calling api directly
                (async ()=>{
                  try{
                    const s = await api.get('/transactions/stats')
                    const list = await api.get('/transactions?page=1&limit=50')
                    setStats(s.data)
                    setTransactions(list.data.data || [])
                    setError('')
                  }catch(err){
                    setError(err.response?.data?.message || 'Failed to load dashboard data')
                  }finally{ setLoading(false) }
                })()
              }} className="px-4 py-2 border border-[#1e1e2e] rounded-lg">Retry</button>
            </div>
          ) : (
            <div className="overflow-auto">
              <table className="w-full table-auto">
                <thead>
                  <tr className="text-left text-[var(--text-secondary)]">
                    <th className="p-2">Time</th>
                    <th className="p-2">User ID</th>
                    <th className="p-2">Merchant</th>
                    <th className="p-2">Amount</th>
                    <th className="p-2">Fraud Score</th>
                    <th className="p-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map(tx => (
                    <tr key={tx._id} className={`${tx._isNew ? 'animate-slide-in' : ''} border-t border-[#1e1e2e]`} onClick={()=> setExpanded(expanded === tx._id ? null : tx._id)}>
                      <td className="p-2 text-sm">{new Date(tx.timestamp || tx.createdAt).toLocaleTimeString()}</td>
                      <td className="p-2 text-sm">{tx.userId}</td>
                      <td className="p-2 text-sm">{tx.merchantId}</td>
                      <td className="p-2 text-sm">{tx.currency} {tx.amount}</td>
                      <td className="p-2 text-sm font-semibold" style={{ color: tx.fraudScore < 40 ? '#22c55e' : tx.fraudScore < 70 ? '#f59e0b' : '#ef4444' }}>{tx.fraudScore}</td>
                      <td className="p-2"><StatusBadge status={tx.fraudStatus} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {expanded && (
                <div className="mt-3 card p-3">
                  <div className="font-medium mb-2">Rules Triggered</div>
                  <ul className="text-sm text-[var(--text-secondary)]">
                    {(transactions.find(t=>t._id===expanded)?.rulesTriggered || []).map((r, i)=> (
                      <li key={i}>{r.ruleName} ({r.score}) — {r.reason}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </Layout>
  )
}