import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import api from '../api/axiosConfig';
import Layout from '../components/shared/Layout';
import { SkeletonCard } from '../components/shared/Skeleton';

const REASONS = [
  { value: 'fraud',                label: 'Fraud' },
  { value: 'unauthorized',         label: 'Unauthorized transaction' },
  { value: 'stolen_card',          label: 'Stolen card' },
  { value: 'account_takeover',     label: 'Account takeover' },
  { value: 'duplicate',            label: 'Duplicate charge' },
  { value: 'not_received',         label: 'Goods not received' },
  { value: 'product_not_as_described', label: 'Not as described' },
  { value: 'other',                label: 'Other' },
];
const STATUSES = ['open', 'won', 'lost', 'closed'];

const shortId = (id) => (id && id.length > 12 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id);

export default function Disputes() {
  const [form, setForm] = useState({ transactionId: '', reason: 'fraud', status: 'open', notes: '' });
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [report, setReport] = useState(null);
  const [disputes, setDisputes] = useState([]);

  const load = async () => {
    try {
      const [det, list] = await Promise.all([
        api.get('/disputes/detection'),
        api.get('/disputes?limit=30'),
      ]);
      setReport(det.data.data);
      setDisputes(list.data.data || []);
    } catch (err) {
      console.error('Load disputes failed:', err.message);
    } finally {
      setLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional initial fetch of the dispute ledger
  useEffect(() => { load(); }, []);

  const handleChange = (e) => setForm(f => ({ ...f, [e.target.name]: e.target.value }));

  const ingest = async (e) => {
    e.preventDefault();
    if (!form.transactionId.trim()) { toast.error('transactionId is required'); return; }
    setSubmitting(true);
    try {
      const { data } = await api.post('/disputes', {
        transactionId: form.transactionId.trim(),
        reason: form.reason,
        status: form.status,
        notes: form.notes.trim() || undefined,
      });
      const t = data.data.transaction;
      toast.success(
        data.data.dispute.fraudConfirmed
          ? `Confirmed fraud — ${t.userId} was scored ${t.fraudStatus} (${t.fraudScore}) at the time`
          : 'Dispute recorded (non-fraud reason — not labelled)',
      );
      setForm(f => ({ ...f, transactionId: '', notes: '' }));
      await load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Ingest failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Layout>
      <div className="max-w-5xl">
        <div className="label mb-6">01 — Dispute loop</div>
        <h1 className="text-4xl md:text-5xl font-black tracking-tight mb-4">Confirmed fraud</h1>
        <p className="text-ink-soft max-w-xl leading-relaxed mb-8">
          Ingest a chargeback or dispute to label a transaction as confirmed
          fraud — external ground truth. The report below then answers: of the
          fraud we now know about, what did each rule actually catch at scoring time?
        </p>

        {/* Ingest form */}
        <div className="border border-hairline bg-card p-6 mb-8">
          <div className="label mb-4">Ingest dispute</div>
          <form onSubmit={ingest} className="grid grid-cols-1 md:grid-cols-4 gap-5">
            <div className="md:col-span-1">
              <label className="label block mb-1">Transaction id</label>
              <input
                name="transactionId" value={form.transactionId} onChange={handleChange}
                placeholder="uuid from live feed" className="input font-mono" required
              />
            </div>
            <div>
              <label className="label block mb-1">Reason</label>
              <select name="reason" value={form.reason} onChange={handleChange} className="input font-mono">
                {REASONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
            <div>
              <label className="label block mb-1">Status</label>
              <select name="status" value={form.status} onChange={handleChange} className="input font-mono">
                {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="label block mb-1">Notes</label>
              <input name="notes" value={form.notes} onChange={handleChange} placeholder="optional" className="input" />
            </div>
            <div className="md:col-span-4 flex justify-end">
              <button type="submit" disabled={submitting} className="btn px-8">
                {submitting ? 'Recording…' : 'Ingest dispute'}
              </button>
            </div>
          </form>
          <div className="text-[11px] font-mono text-muted mt-4 leading-relaxed">
            Fraud-type reasons (fraud / unauthorized / stolen card / account takeover) and
            <span className="text-ink-soft"> lost </span>
            disputes label the transaction as confirmed fraud. Other reasons are recorded but not labelled.
          </div>
        </div>

        {/* Detection report */}
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5"><SkeletonCard /><SkeletonCard /><SkeletonCard /></div>
        ) : report && report.total > 0 ? (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-6">
              <div className="border border-hairline bg-card p-5">
                <div className="label mb-3">Confirmed fraud</div>
                <div className="text-3xl font-black">{report.total}</div>
                <div className="text-xs text-muted mt-1 font-mono">transactions labelled by disputes</div>
              </div>
              <div className="border border-hairline bg-card p-5">
                <div className="label mb-3">Caught at scoring time</div>
                <div className="text-3xl font-black">
                  {report.caught}
                  <span className="text-base font-mono text-muted ml-2">{report.detectionRate}%</span>
                </div>
                <div className="text-xs text-muted mt-1 font-mono">avg score {report.avgScoreCaught}/100</div>
              </div>
              <div className="border border-hairline bg-card p-5">
                <div className="label mb-3">Missed (scored clear)</div>
                <div className="text-3xl font-black text-accent">{report.missed}</div>
                <div className="text-xs text-muted mt-1 font-mono">avg score {report.avgScoreMissed}/100 at the time</div>
              </div>
            </div>

            {/* Per-rule detection */}
            <div className="border border-hairline bg-card mb-6">
              <div className="px-6 py-4 border-b border-hairline flex items-center justify-between">
                <h2 className="text-sm font-bold uppercase tracking-wide">Per-rule detection rates</h2>
                <span className="label">of {report.total} confirmed-fraud transactions</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-hairline bg-paper">
                      {['Rule', 'Caught', 'Detection rate', ''].map(h => (
                        <th key={h} className="px-6 py-3 text-[11px] font-mono text-muted uppercase tracking-wider">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {report.rules.map(r => (
                      <tr key={r.ruleName} className="border-b border-hairline last:border-0">
                        <td className="px-6 py-3 text-xs font-mono">
                          {r.ruleName.replace(/_RULE$/, '').replace(/_/g, ' ')}
                        </td>
                        <td className="px-6 py-3 font-mono text-sm">{r.caught}</td>
                        <td className="px-6 py-3 font-mono text-sm">{r.detectionRate}%</td>
                        <td className="px-6 py-3 w-48">
                          <div className="h-1.5 bg-hairline">
                            <div className="h-full bg-ink" style={{ width: `${r.detectionRate}%` }} />
                          </div>
                        </td>
                      </tr>
                    ))}
                    {report.rules.length === 0 && (
                      <tr><td colSpan={4} className="px-6 py-8 text-center text-muted font-mono text-sm uppercase tracking-wider">
                        No rules triggered on any confirmed-fraud transaction — everything was missed
                      </td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        ) : (
          <div className="border border-hairline bg-card p-16 text-center mb-6">
            <div className="label mb-2">No confirmed fraud yet</div>
            <div className="text-muted font-mono text-sm">
              Ingest a dispute above to start measuring detection.
            </div>
          </div>
        )}

        {/* Recent disputes */}
        <div className="border border-hairline bg-card">
          <div className="px-6 py-4 border-b border-hairline">
            <h2 className="text-sm font-bold uppercase tracking-wide">Recent disputes</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-hairline bg-paper">
                  {['Transaction', 'Reason', 'Status', 'Fraud confirmed', 'Filed by', 'Filed'].map(h => (
                    <th key={h} className="px-6 py-3 text-[11px] font-mono text-muted uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {disputes.map(d => (
                  <tr key={d._id} className="border-b border-hairline last:border-0">
                    <td className="px-6 py-3 font-mono text-xs">{shortId(d.transactionId)}</td>
                    <td className="px-6 py-3 text-sm">{d.reason.replace(/_/g, ' ')}</td>
                    <td className="px-6 py-3 font-mono text-xs uppercase">{d.status}</td>
                    <td className="px-6 py-3">
                      {d.fraudConfirmed
                        ? <span className="text-accent font-mono text-[11px] uppercase tracking-wider">Yes</span>
                        : <span className="text-muted font-mono text-[11px] uppercase tracking-wider">No</span>}
                    </td>
                    <td className="px-6 py-3 font-mono text-xs">{d.filedBy}</td>
                    <td className="px-6 py-3 font-mono text-xs text-muted">
                      {new Date(d.createdAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
                {disputes.length === 0 && (
                  <tr><td colSpan={6} className="px-6 py-8 text-center text-muted font-mono text-sm uppercase tracking-wider">
                    No disputes ingested yet
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Layout>
  );
}
