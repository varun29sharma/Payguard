import React, { useEffect, useState } from 'react'
import Layout from '../components/Layout'
import LoadingSkeleton from '../components/LoadingSkeleton'
import api from '../api/axiosConfig'
import toast from 'react-hot-toast'
import { useSocket } from '../hooks/useSocket'
import StatusBadge from '../components/StatusBadge'

const FILTERS = ['all','open','resolved','false_positive']

export default function Alerts(){
  const [alerts, setAlerts] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const socket = useSocket()

  useEffect(()=>{
    let mounted = true
    async function load(){
      setLoading(true)
      try{
        const ok = await import('../utils/probeBackend').then(m=>m.probeBackend())
        if(!ok) throw new Error('Backend unreachable')
        const res = await api.get('/alerts')
        if(!mounted) return
        setAlerts(res.data.data || [])
      }catch(err){
        toast.error(err.message || 'Failed to load alerts')
        setAlerts([])
      }finally{ if(mounted) setLoading(false) }
    }
    load()
    return ()=> { mounted = false }
  },[])

  useEffect(()=>{
    if(!socket) return
    const handler = (payload) => {
      const alert = payload.alert || payload
      setAlerts(prev => [alert, ...prev])
    }
    socket.on('new-fraud-alert', handler)
    return ()=> socket.off('new-fraud-alert', handler)
  },[socket])

  async function resolveAlert(alertId, newStatus){
    const prev = alerts.slice()
    setAlerts(a => a.map(x => x._id === alertId ? ({...x, status: newStatus}) : x))
    try{
      await api.patch(`/alerts/${alertId}/resolve`, { status: newStatus })
      toast.success('Alert updated')
    }catch(err){
      setAlerts(prev)
      toast.error('Failed to update alert')
    }
  }

  const visible = alerts.filter(a => filter === 'all' ? true : a.status === filter)

  return (
    <Layout>
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          {FILTERS.map(f=> (
            <button key={f} onClick={()=> setFilter(f)} className={`px-3 py-1 rounded-lg ${filter===f ? 'bg-[var(--bg-card)] border-l-4 border-brand' : 'border border-[#1e1e2e] text-[var(--text-secondary)]'}`}>
              {f.replace('_',' ')}
            </button>
          ))}
        </div>

        <div className="card p-4">
          {loading ? <LoadingSkeleton lines={3} /> : (
            visible.length === 0 ? (
              <div className="text-center py-12 text-[var(--text-secondary)]">
                <div className="text-2xl mb-2">🔍</div>
                <div className="font-medium">No alerts found</div>
                <div className="text-sm">Try a different filter or check back later.</div>
              </div>
            ) : (
              <div className="space-y-3">
                {visible.map(alert => (
                  <div key={alert._id} className="p-3 border border-[#1e1e2e] rounded-lg flex justify-between items-start">
                    <div>
                      <div className="flex items-center gap-4">
                        <div className="w-1 h-12 rounded-md" style={{ background: alert.fraudScore > 70 ? '#ef4444' : alert.fraudScore > 40 ? '#f59e0b' : '#22c55e' }} />
                        <div>
                          <div className="font-semibold">User: {alert.userId} <span className="text-sm text-[var(--text-secondary)]">• {new Date(alert.createdAt).toLocaleString()}</span></div>
                          <div className="text-sm text-[var(--text-secondary)]">Transaction: {alert.transaction?.amount ? `Rs. ${alert.transaction.amount}` : '—'}</div>
                          <div className="mt-2 text-sm">
                            Rules: {(alert.rulesTriggered||[]).map((r,i)=> (
                              <span key={i} className="text-xs mr-2">{r.ruleName} ({r.score})</span>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <StatusBadge status={alert.status} />
                      <div className="flex gap-2">
                        {alert.status !== 'resolved' && <button onClick={()=> resolveAlert(alert._id, 'resolved')} className="px-3 py-1 bg-green-600 text-black rounded-lg">Resolve ✓</button>}
                        {alert.status !== 'false_positive' && <button onClick={()=> resolveAlert(alert._id, 'false_positive')} className="px-3 py-1 border border-[#1e1e2e] text-[var(--text-secondary)] rounded-lg">Mark False Positive ✗</button>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )
          )}
        </div>
      </div>
    </Layout>
  )
}
