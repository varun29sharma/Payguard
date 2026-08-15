import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import api from '../api/axiosConfig';
import Layout from '../components/shared/Layout';
import { SkeletonCard } from '../components/shared/Skeleton';
import { getSocket } from '../api/socket';

const shortId = (id) => (id && id.length > 12 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id);

const fmtINR = (n) => `₹${Math.round(n || 0).toLocaleString('en-IN')}`;

export default function Mules() {
  const [loading, setLoading] = useState(true);
  const [blocking, setBlocking] = useState(null);
  const [data, setData] = useState({ rings: [], stats: {} });

  const load = async () => {
    try {
      const { data } = await api.get('/mules');
      setData(data.data);
    } catch (err) {
      console.error('Load mule rings failed:', err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional initial fetch of mule rings
    load();
    const s = getSocket();
    s.on('mule-ring-new', load);
    s.on('mule-ring-updated', load);
    return () => { s.off('mule-ring-new', load); s.off('mule-ring-updated', load); };
  }, []);

  const blockRing = async (ring) => {
    if (!window.confirm(`Block ${ring.accounts.join(', ')} and everything connected to them?`)) return;
    setBlocking(ring._id);
    try {
      const { data } = await api.post(`/mules/${ring._id}/block`);
      toast.success(`Ring blocked — ${data.data.blockedCount} account(s) frozen via identity graph`);
      await load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Block failed');
    } finally {
      setBlocking(null);
    }
  };

  return (
    <Layout>
      <div className="max-w-5xl">
        <div className="label mb-6">01 — Laundering</div>
        <h1 className="text-4xl md:text-5xl font-black tracking-tight mb-4">Mule rings</h1>
        <p className="text-ink-soft max-w-xl leading-relaxed mb-8">
          Accounts that receive money from multiple senders and forward most of
          it on within 24 hours — the classic laundering pattern. Flagged
          accounts that share a device, IP or fingerprint are clustered into one
          ring; blocking a ring freezes every member through the identity graph.
        </p>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-5 mb-8">
          {[
            { label: 'Active rings', value: data.stats.active ?? 0 },
            { label: 'Flagged accounts', value: data.stats.accounts ?? 0 },
            { label: 'Total received (24h)', value: fmtINR(data.stats.totalReceived) },
            { label: 'Blocked rings', value: data.stats.blocked ?? 0 },
          ].map(s => (
            <div key={s.label} className="border border-hairline bg-card p-5">
              <div className="label mb-3">{s.label}</div>
              <div className="text-2xl font-black font-mono">{s.value}</div>
            </div>
          ))}
        </div>

        {/* Rings */}
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5"><SkeletonCard /><SkeletonCard /></div>
        ) : data.rings.length === 0 ? (
          <div className="border border-hairline bg-card p-16 text-center">
            <div className="label mb-2">No laundering rings detected</div>
            <div className="text-muted font-mono text-sm">
              Run the mule-ring scenario in the simulator — victims pay the mule, the mule forwards.
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            {data.rings.map(ring => (
              <div key={ring._id} className={`border bg-card ${ring.status === 'blocked' ? 'border-hairline-strong opacity-70' : 'border-hairline'}`}>
                {/* Header */}
                <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-hairline flex-wrap">
                  <div>
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="label">Ring {shortId(ring._id)}</span>
                      <span className={`font-mono text-[10px] uppercase tracking-wider px-2 py-0.5 border ${
                        ring.status === 'blocked'
                          ? 'border-accent text-accent'
                          : ring.status === 'open' ? 'border-ink text-ink' : 'border-hairline-strong text-muted'
                      }`}>
                        {ring.status}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-2 mt-3">
                      {ring.accounts.map(a => (
                        <span key={a} className="font-mono text-xs px-2 py-1 border border-hairline-strong bg-paper">{a}</span>
                      ))}
                    </div>
                    {ring.sharedIdentifiers && Object.keys(ring.sharedIdentifiers).length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
                        {Object.entries(ring.sharedIdentifiers).map(([field, values]) => (
                          <span key={field} className="text-[11px] font-mono text-muted">
                            {field}: {values.join(', ')}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  {ring.status === 'open' && (
                    <button onClick={() => blockRing(ring)} disabled={blocking === ring._id} className="btn btn-accent btn-sm flex-shrink-0">
                      {blocking === ring._id ? 'Blocking…' : 'Block ring'}
                    </button>
                  )}
                </div>

                {/* Flow */}
                <div className="px-6 py-4 grid grid-cols-1 md:grid-cols-3 gap-4 border-b border-hairline">
                  <div>
                    <div className="label mb-1">Received (24h)</div>
                    <div className="text-xl font-black font-mono">{fmtINR(ring.totalReceived)}</div>
                    <div className="text-[11px] text-muted font-mono mt-1">from {ring.receivedFrom?.length || 0} distinct senders</div>
                  </div>
                  <div>
                    <div className="label mb-1">Forwarded</div>
                    <div className="text-xl font-black font-mono">{fmtINR(ring.totalForwarded)}</div>
                    <div className="text-[11px] text-muted font-mono mt-1">to {ring.forwardedTo?.length || 0} beneficiary(ies)</div>
                  </div>
                  <div>
                    <div className="label mb-1">Chain ratio</div>
                    <div className="text-xl font-black font-mono">
                      {ring.totalReceived ? Math.round((ring.totalForwarded / ring.totalReceived) * 100) : 0}%
                    </div>
                    <div className="text-[11px] text-muted font-mono mt-1">{ring.evidence?.length || 0} evidence rows</div>
                  </div>
                </div>

                {/* Evidence */}
                {ring.evidence?.length > 0 && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left">
                      <thead>
                        <tr className="border-b border-hairline bg-paper">
                          {['Leg', 'From', 'To', 'Amount', 'Time'].map(h => (
                            <th key={h} className="px-6 py-2.5 text-[10px] font-mono text-muted uppercase tracking-wider">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {ring.evidence.slice(0, 8).map(e => (
                          <tr key={e.transactionId} className="border-b border-hairline last:border-0">
                            <td className="px-6 py-2.5">
                              <span className={`font-mono text-[10px] uppercase tracking-wider ${
                                e.kind === 'receive' ? 'text-ink' : 'text-accent'
                              }`}>{e.kind}</span>
                            </td>
                            <td className="px-6 py-2.5 font-mono text-xs">{e.userId}</td>
                            <td className="px-6 py-2.5 font-mono text-xs">{e.beneficiaryId}</td>
                            <td className="px-6 py-2.5 font-mono text-xs">{fmtINR(e.amount)}</td>
                            <td className="px-6 py-2.5 font-mono text-[11px] text-muted">
                              {new Date(e.timestamp).toLocaleTimeString()}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
