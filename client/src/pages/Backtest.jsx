import { useState } from 'react';
import toast from 'react-hot-toast';
import api from '../api/axiosConfig';
import Layout from '../components/shared/Layout';
import StatusBadge from '../components/shared/StatusBadge';
import { RULE_META, RULE_ORDER } from '../utils/ruleMeta';

const WINDOWS = [
  { hours: 24,  label: 'Last 24 hours' },
  { hours: 168, label: 'Last 7 days' },
  { hours: 720, label: 'Last 30 days' },
];
const LIMITS = [200, 500, 1000, 2000];

const deltaClass = (n) => (n > 0 ? 'text-accent' : n < 0 ? 'text-ink' : 'text-muted');
const signed = (n) => (n > 0 ? `+${n}` : `${n}`);

export default function Backtest() {
  const [ruleName, setRuleName] = useState('AMOUNT_THRESHOLD_RULE');
  const [enabled, setEnabled] = useState(true);
  const [score, setScore] = useState('');
  const [params, setParams] = useState({});
  const [windowHours, setWindowHours] = useState(24);
  const [limit, setLimit] = useState(500);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);

  const meta = RULE_META[ruleName];

  // Switching rules resets the form so stale thresholds never leak across rules.
  const changeRule = (r) => {
    setRuleName(r);
    setParams({});
    setScore('');
    setEnabled(true);
  };

  const run = async () => {
    setRunning(true);
    setResult(null);
    try {
      const changes = { enabled, parameters: {} };
      if (score !== '') changes.score = Number(score);
      Object.entries(params).forEach(([k, v]) => {
        if (v !== '') changes.parameters[k] = Number(v);
      });
      const { data } = await api.post('/backtest', { ruleName, changes, windowHours, limit });
      setResult(data);
      toast.success(`Backtest complete — ${data.meta.sampleSize} transactions replayed`);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Backtest failed');
    } finally {
      setRunning(false);
    }
  };

  const paramField = (p) => (
    <div key={p.key}>
      <label className="label block mb-1">{p.label}</label>
      <input
        type={p.type} step={p.step}
        value={params[p.key] ?? ''}
        onChange={e => setParams(prev => ({ ...prev, [p.key]: e.target.value }))}
        className="input font-mono"
        disabled={!enabled}
      />
    </div>
  );

  return (
    <Layout>
      <div className="max-w-5xl">
        <div className="label mb-6">01 — Replay harness</div>
        <h1 className="text-4xl md:text-5xl font-black tracking-tight mb-4">Backtest</h1>
        <p className="text-ink-soft max-w-xl leading-relaxed mb-8">
          Replay real historical transactions through a proposed rule change and
          see what would have been flagged, blocked or missed — before you deploy it.
          Each run uses fresh, isolated engine state.
        </p>

        {/* Control panel */}
        <div className="border border-hairline bg-card p-6 mb-8">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-5">
            <div>
              <label className="label block mb-1">Rule</label>
              <select value={ruleName} onChange={e => changeRule(e.target.value)} className="input font-mono">
                {RULE_ORDER.map(r => (
                  <option key={r} value={r}>{r.replace(/_RULE$/, '').replace(/_/g, ' ')}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label block mb-1">Proposed state</label>
              <button
                onClick={() => setEnabled(v => !v)}
                className={`font-mono text-[11px] uppercase tracking-wider px-3 py-2.5 border w-full text-left ${
                  enabled ? 'border-ink text-ink' : 'border-hairline-strong text-muted'
                }`}
              >
                {enabled ? 'Enabled — click to disable' : 'Disabled — click to enable'}
              </button>
            </div>
            <div>
              <label className="label block mb-1">Severity score (blank = default)</label>
              <input
                type="number" min={0} max={100}
                value={score}
                onChange={e => setScore(e.target.value)}
                className="input font-mono"
                disabled={!enabled}
              />
            </div>
            <div>
              <label className="label block mb-1">Window</label>
              <select value={windowHours} onChange={e => setWindowHours(Number(e.target.value))} className="input font-mono">
                {WINDOWS.map(w => <option key={w.hours} value={w.hours}>{w.label}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-5 mt-5">
            {meta.params.map(paramField)}
            <div>
              <label className="label block mb-1">Sample size</label>
              <select value={limit} onChange={e => setLimit(Number(e.target.value))} className="input font-mono">
                {LIMITS.map(l => <option key={l} value={l}>{l} transactions</option>)}
              </select>
            </div>
            <div className="flex items-end">
              <button onClick={run} disabled={running} className="btn px-8 w-full md:w-auto">
                {running ? 'Replaying…' : 'Run backtest'}
              </button>
            </div>
          </div>
        </div>

        {result && (
          <>
            {/* Headline delta */}
            <div className="border border-hairline bg-card px-6 py-5 mb-6 flex flex-wrap items-center gap-x-8 gap-y-2">
              <div>
                <div className="label mb-1">Flagged — before → after</div>
                <div className="text-2xl font-black">
                  {result.baseline.flagged}
                  <span className="text-muted font-normal text-lg mx-2">→</span>
                  {result.candidate.flagged}
                  <span className={`ml-3 font-mono text-sm ${deltaClass(result.candidate.flagged - result.baseline.flagged)}`}>
                    {signed(result.candidate.flagged - result.baseline.flagged)}
                  </span>
                </div>
              </div>
              <div>
                <div className="label mb-1">Blocked — before → after</div>
                <div className="text-2xl font-black">
                  {result.baseline.blocked}
                  <span className="text-muted font-normal text-lg mx-2">→</span>
                  {result.candidate.blocked}
                  <span className={`ml-3 font-mono text-sm ${deltaClass(result.candidate.blocked - result.baseline.blocked)}`}>
                    {signed(result.candidate.blocked - result.baseline.blocked)}
                  </span>
                </div>
              </div>
              <div>
                <div className="label mb-1">Avg score — before → after</div>
                <div className="text-2xl font-black">
                  {result.baseline.avgScore}
                  <span className="text-muted font-normal text-lg mx-2">→</span>
                  {result.candidate.avgScore}
                </div>
              </div>
              <div className="ml-auto text-right">
                <div className="label mb-1">Sample</div>
                <div className="font-mono text-sm text-muted">
                  {result.meta.sampleSize} txns · {result.meta.durationMs}ms
                </div>
              </div>
            </div>

            {/* Deltas + FP proxy */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-6">
              <div className="border border-hairline bg-card p-5">
                <div className="label mb-3">Would newly flag</div>
                <div className="text-3xl font-black">{result.deltas.newlyFlagged}</div>
                <div className="text-xs text-muted mt-1 font-mono">clear → flagged under candidate</div>
              </div>
              <div className="border border-hairline bg-card p-5">
                <div className="label mb-3">Would stop flagging</div>
                <div className="text-3xl font-black">{result.deltas.unFlagged}</div>
                <div className="text-xs text-muted mt-1 font-mono">flagged → clear under candidate</div>
              </div>
              <div className="border border-hairline bg-card p-5">
                <div className="label mb-3">Analyst-confirmed false positives (of candidate flags)</div>
                <div className="text-3xl font-black">{result.falsePositive.confirmedFalsePositive}</div>
                <div className="text-xs text-muted mt-1 font-mono">
                  {result.falsePositive.confirmedTrue} confirmed true · {result.falsePositive.unlabeled} unlabeled
                </div>
              </div>
            </div>

            {/* Per-rule comparison */}
            <div className="border border-hairline bg-card mb-6">
              <div className="px-6 py-4 border-b border-hairline flex items-center justify-between">
                <h2 className="text-sm font-bold uppercase tracking-wide">Rule triggers — baseline vs candidate</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-hairline bg-paper">
                      <th className="px-6 py-3 text-[11px] font-mono text-muted uppercase tracking-wider">Rule</th>
                      <th className="px-6 py-3 text-[11px] font-mono text-muted uppercase tracking-wider">Baseline</th>
                      <th className="px-6 py-3 text-[11px] font-mono text-muted uppercase tracking-wider">Candidate</th>
                      <th className="px-6 py-3 text-[11px] font-mono text-muted uppercase tracking-wider">Δ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {RULE_ORDER.map(r => {
                      const b = result.baseline.byRule[r] || 0;
                      const c = result.candidate.byRule[r] || 0;
                      return (
                        <tr key={r} className="border-b border-hairline last:border-0">
                          <td className={`px-6 py-3 text-xs font-mono ${r === ruleName ? 'text-accent font-bold' : 'text-ink-soft'}`}>
                            {r.replace(/_RULE$/, '').replace(/_/g, ' ')}{r === ruleName ? ' ← edited' : ''}
                          </td>
                          <td className="px-6 py-3 text-sm font-mono">{b}</td>
                          <td className="px-6 py-3 text-sm font-mono">{c}</td>
                          <td className={`px-6 py-3 text-sm font-mono ${deltaClass(c - b)}`}>{signed(c - b)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Transaction table */}
            <div className="border border-hairline bg-card">
              <div className="px-6 py-4 border-b border-hairline flex items-center justify-between">
                <h2 className="text-sm font-bold uppercase tracking-wide">Per-transaction outcome</h2>
                <span className="label">showing {result.transactions.length} of {result.meta.sampleSize}</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-hairline bg-paper">
                      {['User', 'Amount', 'Recorded', 'Baseline replay', 'Candidate', 'Label'].map(h => (
                        <th key={h} className="px-6 py-3 text-[11px] font-mono text-muted uppercase tracking-wider">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.transactions.map(t => (
                      <tr key={t.transactionId} className="border-b border-hairline last:border-0">
                        <td className="px-6 py-3 font-mono text-xs">{t.userId}</td>
                        <td className="px-6 py-3 font-mono text-sm">₹{t.amount.toLocaleString('en-IN')}</td>
                        <td className="px-6 py-3"><StatusBadge status={t.recordedStatus} /></td>
                        <td className="px-6 py-3"><StatusBadge status={t.baselineStatus} /></td>
                        <td className="px-6 py-3">
                          <span className="inline-flex items-center gap-2">
                            <StatusBadge status={t.candidateStatus} />
                            {t.candidateRules.length > 0 && (
                              <span className="font-mono text-[10px] text-muted uppercase tracking-wider">
                                {t.candidateRules.join(', ')}
                              </span>
                            )}
                          </span>
                        </td>
                        <td className="px-6 py-3 font-mono text-[11px] uppercase tracking-wider text-muted">
                          {t.label ? (t.label === 'false_positive' ? <span className="text-accent">False positive</span> : t.label) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}
