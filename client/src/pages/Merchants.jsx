import { useState, useEffect } from 'react';
import { Store, AlertTriangle, Shield, BarChart3, Search } from 'lucide-react';
import Layout from '../components/shared/Layout';
import { SkeletonCard } from '../components/shared/Skeleton';
import api from '../api/axiosConfig';

const TIER_STYLES = {
  low:      { color: 'text-green-700 dark:text-green-300', bg: 'bg-green-50 border-green-300 dark:bg-green-950/40 dark:border-green-800', icon: Shield },
  medium:   { color: 'text-amber-700 dark:text-amber-300', bg: 'bg-amber-50 border-amber-300 dark:bg-amber-950/40 dark:border-amber-800', icon: AlertTriangle },
  high:     { color: 'text-orange-700 dark:text-orange-300', bg: 'bg-orange-50 border-orange-300 dark:bg-orange-950/40 dark:border-orange-800', icon: AlertTriangle },
  critical: { color: 'text-red-700 dark:text-red-300', bg: 'bg-red-50 border-red-300 dark:bg-red-950/40 dark:border-red-800', icon: AlertTriangle },
};

const fmt = (n) => n == null ? '—' : typeof n === 'number' ? n.toLocaleString() : n;
const fmtCurrency = (n) => n == null ? '—' : `₹${Number(n).toLocaleString()}`;
const shortId = (id) => id && id.length > 16 ? `${id.slice(0, 12)}…` : id;

function TierBadge({ tier }) {
  const s = TIER_STYLES[tier] || TIER_STYLES.low;
  const Icon = s.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider border ${s.color} ${s.bg}`}>
      <Icon size={11} />
      {tier}
    </span>
  );
}

function RiskBar({ score }) {
  const pct = Math.min(100, score || 0);
  const color = pct >= 80 ? 'bg-red-500' : pct >= 60 ? 'bg-orange-500' : pct >= 30 ? 'bg-amber-500' : 'bg-green-500';
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-hairline-strong overflow-hidden">
        <div className={`h-full ${color} transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[11px] font-mono text-muted w-8 text-right">{pct}</span>
    </div>
  );
}

export default function Merchants() {
  const [loading, setLoading] = useState(true);
  const [merchants, setMerchants] = useState([]);
  const [stats, setStats] = useState(null);
  const [mccData, setMccData] = useState([]);
  const [selected, setSelected] = useState(null);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [listRes, statsRes, mccRes] = await Promise.all([
          api.get('/merchants'),
          api.get('/merchants/stats'),
          api.get('/merchants/mcc'),
        ]);
        if (cancelled) return;
        setMerchants(listRes.data.data || []);
        setStats(listRes.data.data);
        setMccData(mccRes.data.data || []);
        setStats(statsRes.data.data);
      } catch (err) {
        console.error('Merchants load error:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const filtered = merchants
    .filter(m => filter === 'all' || m.riskTier === filter)
    .filter(m => !search || m.merchantId.toLowerCase().includes(search.toLowerCase()) || (m.mcc || '').includes(search));

  const loadDetail = async (merchantId) => {
    try {
      const res = await api.get(`/merchants/${merchantId}`);
      setSelected(res.data.data);
    } catch (err) {
      console.error('Merchant detail error:', err);
    }
  };

  if (loading) {
    return <Layout><div className="p-8 space-y-6"><SkeletonCard /><SkeletonCard /><SkeletonCard /></div></Layout>;
  }

  return (
    <Layout>
      <div className="p-8 max-w-7xl mx-auto space-y-8">
        {/* Header */}
        <div>
          <div className="label mb-1">11 — MERCHANTS</div>
          <h1 className="text-3xl font-black tracking-tight uppercase">Merchant Risk Profiles</h1>
          <p className="text-muted text-sm mt-1 font-mono">MCC CLASSIFICATION, DISPUTE RATES, RISK TIERING, AND MERCHANT ANALYTICS</p>
        </div>

        {/* Stats Bar */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            {[
              { label: 'Total Merchants', value: fmt(stats.totalMerchants), icon: Store },
              { label: 'Avg Risk Score', value: stats.avgRiskScore?.toFixed(1), icon: BarChart3 },
              { label: 'High Risk', value: fmt(stats.highRisk), icon: AlertTriangle, accent: stats.highRisk > 0 },
              { label: 'Low Tier', value: fmt(stats.byTier?.low || 0), icon: Shield },
              { label: 'Critical', value: fmt(stats.byTier?.critical || 0), icon: AlertTriangle, accent: stats.byTier?.critical > 0 },
            ].map((s) => (
              <div key={s.label} className={`border p-4 ${s.accent ? 'border-red-400 dark:border-red-700' : 'border-hairline-strong'}`}>
                <s.icon size={14} className={s.accent ? 'text-red-600' : 'text-muted'} />
                <div className="text-2xl font-black mt-1">{s.value}</div>
                <div className="label mt-1">{s.label}</div>
              </div>
            ))}
          </div>
        )}

        {/* Filters + Search */}
        <div className="flex items-center gap-3 flex-wrap">
          {['all', 'critical', 'high', 'medium', 'low'].map(f => (
            <button key={f} onClick={() => { setFilter(f); setSelected(null); }}
              className={`btn btn-ghost btn-sm ${filter === f ? 'font-bold text-ink' : 'text-muted'}`}>
              {f === 'all' ? 'ALL' : f.toUpperCase()}
            </button>
          ))}
          <div className="flex-1" />
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search merchant or MCC…"
              className="input pl-8 text-sm w-56" />
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Merchant List */}
          <div className="lg:col-span-2 space-y-3">
            {filtered.length === 0 && (
              <div className="text-center py-12 text-muted text-sm">No merchants found.</div>
            )}
            {filtered.map(m => (
              <button key={m.merchantId}
                onClick={() => loadDetail(m.merchantId)}
                className={`w-full text-left border p-4 transition-colors hover:border-accent ${
                  selected?.merchantId === m.merchantId ? 'border-accent bg-paper' : 'border-hairline-strong'
                }`}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <Store size={16} className="text-muted" />
                    <span className="font-semibold text-sm">{shortId(m.merchantId)}</span>
                    {m.mcc && <span className="font-mono text-[11px] text-muted">MCC {m.mcc}</span>}
                  </div>
                  <TierBadge tier={m.riskTier} />
                </div>
                {m.mccCategory && (
                  <div className="text-[11px] text-muted mb-2">{m.mccCategory}</div>
                )}
                <div className="grid grid-cols-4 gap-3 text-[11px]">
                  <div><span className="text-muted">TXNS</span> <span className="font-semibold">{fmt(m.totalTransactions)}</span></div>
                  <div><span className="text-muted">VOLUME</span> <span className="font-semibold">{fmtCurrency(m.totalAmount)}</span></div>
                  <div><span className="text-muted">FLAGGED</span> <span className="font-semibold">{fmt(m.flaggedTransactions)}</span></div>
                  <div><span className="text-muted">DISPUTES</span> <span className="font-semibold">{fmt(m.totalDisputes)}</span></div>
                </div>
                <div className="mt-2"><RiskBar score={m.riskScore} /></div>
              </button>
            ))}
          </div>

          {/* Detail Panel / MCC Distribution */}
          <div className="space-y-4">
            {selected ? (
              <div className="border border-hairline-strong p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-sm">{shortId(selected.merchantId)}</h3>
                  <TierBadge tier={selected.riskTier} />
                </div>
                <div className="text-[11px] text-muted">{selected.mccCategory || 'Unknown category'} · MCC {selected.mcc || '—'}</div>

                <div className="grid grid-cols-2 gap-3 text-[11px]">
                  <div className="border border-hairline p-3">
                    <div className="text-muted mb-1">Risk Score</div>
                    <div className="text-xl font-black">{selected.riskScore}</div>
                    <RiskBar score={selected.riskScore} />
                  </div>
                  <div className="border border-hairline p-3">
                    <div className="text-muted mb-1">Dispute Rate</div>
                    <div className="text-xl font-black">{selected.disputeRate?.toFixed(2) || 0}%</div>
                    <div className="text-muted mt-1">{selected.totalDisputes || 0} total</div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 text-[11px]">
                  <div className="border border-hairline p-3">
                    <div className="text-muted mb-1">Avg Fraud Score</div>
                    <div className="text-lg font-bold">{selected.avgFraudScore?.toFixed(1) || 0}</div>
                  </div>
                  <div className="border border-hairline p-3">
                    <div className="text-muted mb-1">Max Fraud Score</div>
                    <div className="text-lg font-bold">{selected.maxFraudScore || 0}</div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 text-[11px]">
                  <div><span className="text-muted">Total Volume</span><br /><span className="font-bold">{fmtCurrency(selected.totalAmount)}</span></div>
                  <div><span className="text-muted">Unique Customers</span><br /><span className="font-bold">{fmt(selected.uniqueCustomers)}</span></div>
                  <div><span className="text-muted">Flagged</span><br /><span className="font-bold">{fmt(selected.flaggedTransactions)}</span></div>
                  <div><span className="text-muted">Blocked</span><br /><span className="font-bold">{fmt(selected.blockedTransactions)}</span></div>
                </div>

                {/* Status Distribution */}
                {selected.analytics?.statusCounts && (
                  <div>
                    <div className="label mb-2">RECENT STATUS SPLIT</div>
                    <div className="flex gap-2">
                      {Object.entries(selected.analytics.statusCounts).map(([k, v]) => v > 0 && (
                        <span key={k} className="px-2 py-1 text-[10px] font-mono border border-hairline uppercase">
                          {k} <span className="font-bold">{v}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Amount Stats */}
                {selected.analytics?.amountStats && (
                  <div>
                    <div className="label mb-2">AMOUNT DISTRIBUTION</div>
                    <div className="grid grid-cols-4 gap-2 text-[10px]">
                      {[['MIN', selected.analytics.amountStats.min], ['P50', selected.analytics.amountStats.median], ['P95', selected.analytics.amountStats.p95], ['MAX', selected.analytics.amountStats.max]].map(([l, v]) => (
                        <div key={l} className="text-center border border-hairline py-2">
                          <div className="text-muted">{l}</div>
                          <div className="font-bold">{fmtCurrency(v)}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <button onClick={() => setSelected(null)} className="btn btn-ghost btn-sm w-full">Close</button>
              </div>
            ) : (
              <div className="border border-hairline-strong p-5 space-y-4">
                <h3 className="font-bold text-sm">MCC Distribution</h3>
                {mccData.length === 0 && <div className="text-muted text-xs">No MCC data yet</div>}
                {mccData.map(m => (
                  <div key={m.mcc} className="flex items-center justify-between text-[11px] py-2 border-b border-hairline last:border-0">
                    <div>
                      <span className="font-mono font-bold">{m.mcc}</span>
                      <span className="text-muted ml-2">{m.category?.slice(0, 30)}</span>
                    </div>
                    <div className="text-right">
                      <span className="font-semibold">{m.merchantCount}</span>
                      <span className="text-muted ml-1">merchants</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Tier Breakdown */}
            {stats?.byTier && (
              <div className="border border-hairline-strong p-5 space-y-3">
                <h3 className="font-bold text-sm">Risk Tier Breakdown</h3>
                {['critical', 'high', 'medium', 'low'].map(tier => {
                  const count = stats.byTier[tier] || 0;
                  const pct = stats.totalMerchants > 0 ? Math.round((count / stats.totalMerchants) * 100) : 0;
                  return (
                    <div key={tier} className="flex items-center gap-3">
                      <TierBadge tier={tier} />
                      <div className="flex-1 h-1.5 bg-hairline-strong overflow-hidden">
                        <div className={`h-full ${tier === 'critical' ? 'bg-red-500' : tier === 'high' ? 'bg-orange-500' : tier === 'medium' ? 'bg-amber-500' : 'bg-green-500'}`} style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-[11px] font-mono w-12 text-right">{count} <span className="text-muted">({pct}%)</span></span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}
