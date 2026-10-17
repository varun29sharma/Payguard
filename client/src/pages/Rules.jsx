import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import api from '../api/axiosConfig';
import Layout from '../components/shared/Layout';
import { SkeletonCard } from '../components/shared/Skeleton';
import { RULE_META } from '../utils/ruleMeta';

/**
 * Rules.jsx — the rule configuration screen, plus the consistency analysis.
 *
 * The analysis answers a question the form cannot: *is this rule set even
 * satisfiable?* A rule whose condition no transaction can meet — a night window
 * that crosses midnight, tested as a plain interval — is indistinguishable from
 * a working rule on a screen like this one. It shows as enabled, it has a
 * score, it saves without error, and it never fires. The backend proves that
 * property by resolution refutation (`ml/payguard_ml/rulelogic.py`, reached via
 * the ML sidecar) and this page states the result where the operator is looking.
 *
 * Two deliberate choices here:
 *
 * 1. **The check re-runs after every successful save**, on the freshly stored
 *    config, so the warning appears the moment an operator types a window that
 *    cannot fire — not on some later page load.
 * 2. **"Checker unavailable" is rendered as its own state**, not as an empty
 *    issue list. A silent all-clear on a control that never fires is the exact
 *    failure this feature exists to prevent.
 */
export default function Rules() {
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState({});
  const [analysis, setAnalysis] = useState(null);
  const [checking, setChecking] = useState(false);

  /** Fetch the static analysis of the currently *stored* configuration. */
  const loadConsistency = async () => {
    setChecking(true);
    try {
      const { data } = await api.get('/rules/consistency');
      setAnalysis(data.data || null);
    } catch (err) {
      // The endpoint itself failed (auth, network). Say so rather than
      // implying the rule set is clean.
      setAnalysis({ available: false, reason: err.message });
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    // One sequential load: every setState here happens after an await, and the
    // rules list is painted before the analysis (which is the slower of the two,
    // because it goes through the sidecar).
    const load = async () => {
      try {
        const { data } = await api.get('/rules');
        setRules(data.data || []);
      } catch (err) {
        console.error('Load rules failed:', err.message);
      } finally {
        setLoading(false);
      }

      setChecking(true);
      try {
        const { data } = await api.get('/rules/consistency');
        setAnalysis(data.data || null);
      } catch (err) {
        // The endpoint itself failed (auth, network). Say so rather than
        // implying the rule set is clean.
        setAnalysis({ available: false, reason: err.message });
      } finally {
        setChecking(false);
      }
    };
    load();
  }, []);

  const patchRule = (ruleName, patch) => {
    setRules(prev => prev.map(r => r.ruleName === ruleName ? { ...r, ...patch } : r));
  };

  const saveRule = async (rule) => {
    setSaving(s => ({ ...s, [rule.ruleName]: true }));
    try {
      const { data } = await api.put(`/rules/${rule.ruleName}`, {
        enabled: rule.enabled,
        score: rule.score,
        parameters: rule.parameters,
      });
      patchRule(rule.ruleName, data.data);
      toast.success(`${rule.ruleName} updated — next transaction uses it`);
      // Re-analyse the stored config: an edit can create a dead window or a
      // redundant rule, and the operator should learn that immediately.
      loadConsistency();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Save failed');
    } finally {
      setSaving(s => ({ ...s, [rule.ruleName]: false }));
    }
  };

  const resetRule = (rule) => {
    // Re-fetch from server (defaults are merged there) and drop local edits.
    api.get('/rules').then(({ data }) => {
      const fresh = data.data.find(r => r.ruleName === rule.ruleName);
      if (fresh) patchRule(rule.ruleName, fresh);
    });
  };

  return (
    <Layout>
      <div className="max-w-4xl">
        <div className="label mb-6">01 — Rule config</div>
        <h1 className="text-4xl md:text-5xl font-black tracking-tight mb-4">Engine rules</h1>
        <p className="text-ink-soft max-w-xl leading-relaxed mb-2">
          Thresholds and enable/disable flags live in the database and are shipped
          with every scoring request — changes apply to the <em>next</em> transaction,
          no engine restart required.
        </p>

        <ConsistencyBanner analysis={analysis} checking={checking} onRecheck={loadConsistency} />

        <div className="mt-8 space-y-5">
          {loading ? (
            Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
          ) : rules.length === 0 ? (
            <div className="border border-hairline p-16 text-center text-muted font-mono text-sm uppercase tracking-wider">
              No rules found
            </div>
          ) : (
            rules.map(rule => {
              const meta = RULE_META[rule.ruleName] || { description: '', params: [] };
              const isSaving = saving[rule.ruleName];
              const ruleIssues = analysis?.available ? (analysis.byRule?.[rule.ruleName] || []) : [];
              return (
                <div key={rule.ruleName} className="border border-hairline bg-card">
                  {/* Header row */}
                  <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-hairline">
                    <div>
                      <div className="flex items-center gap-3 flex-wrap">
                        <span className="font-mono text-[11px] text-accent">{rule.ruleName}</span>
                        <button
                          onClick={() => patchRule(rule.ruleName, { enabled: !rule.enabled })}
                          className={`font-mono text-[10px] uppercase tracking-wider px-2 py-0.5 border ${
                            rule.enabled
                              ? 'border-ink text-ink'
                              : 'border-hairline-strong text-muted'
                          }`}
                          title="Toggle rule"
                        >
                          {rule.enabled ? 'On' : 'Off'}
                        </button>
                        {rule.isDefault && (
                          <span className="font-mono text-[10px] text-muted uppercase tracking-wider">default</span>
                        )}
                      </div>
                      <p className="text-xs text-muted mt-1.5 max-w-lg leading-relaxed">{meta.description}</p>
                    </div>
                    <button
                      onClick={() => saveRule(rule)}
                      disabled={isSaving}
                      className="btn btn-sm flex-shrink-0"
                    >
                      {isSaving ? 'Saving…' : 'Save'}
                    </button>
                  </div>

                  {/* Static-analysis findings for this rule. Rendered even while
                      a field is being edited, because the finding is about the
                      last saved config. */}
                  {ruleIssues.length > 0 && (
                    <div className={`border-t px-6 py-3 space-y-1.5 ${
                      ruleIssues.some(i => i.severity === 'error')
                        ? 'border-accent bg-paper'
                        : 'border-hairline'
                    }`}>
                      {ruleIssues.map((issue, idx) => (
                        <div key={idx} className="flex gap-2 text-xs leading-relaxed">
                          <span className={`font-mono text-[10px] uppercase tracking-wider pt-0.5 ${
                            issue.severity === 'error' ? 'text-accent' : 'text-muted'
                          }`}>
                            {issue.severity}
                          </span>
                          <span className={issue.severity === 'error' ? 'text-ink' : 'text-muted'}>
                            {issue.message}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Editable fields */}
                  <div className="px-6 py-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                    <div>
                      <label className="label block mb-1">Severity score</label>
                      <input
                        type="number" min={0} max={100} step={1}
                        value={rule.score ?? ''}
                        onChange={e => patchRule(rule.ruleName, { score: e.target.value === '' ? null : Number(e.target.value) })}
                        className="input font-mono"
                        disabled={!rule.enabled}
                      />
                    </div>
                    {meta.params.map(p => (
                      <div key={p.key}>
                        <label className="label block mb-1">{p.label}</label>
                        <input
                          type={p.type} step={p.step}
                          value={rule.parameters?.[p.key] ?? ''}
                          onChange={e => {
                            const val = e.target.value === '' ? null : Number(e.target.value);
                            patchRule(rule.ruleName, {
                              parameters: { ...rule.parameters, [p.key]: val },
                            });
                          }}
                          className="input font-mono"
                          disabled={!rule.enabled}
                        />
                      </div>
                    ))}
                    {meta.params.length === 0 && (
                      <div className="flex items-end pb-2">
                        <span className="text-xs text-muted font-mono uppercase tracking-wider">
                          No parameters
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="px-6 py-3 border-t border-hairline flex items-center justify-end">
                    <button onClick={() => resetRule(rule)} className="link-btn text-xs">
                      Reset to stored config
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </Layout>
  );
}

/**
 * ConsistencyBanner — one line about whether the rule set can actually fire.
 *
 * Three states, and the third is the point: `unavailable` must never look like
 * `healthy`. When the checker cannot run, the page says so and offers to retry.
 */
function ConsistencyBanner({ analysis, checking, onRecheck }) {
  if (!analysis) return null;

  if (!analysis.available) {
    return (
      <div className="mt-8 border border-hairline-strong bg-card px-5 py-4 flex items-start justify-between gap-4">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-wider text-muted mb-1">
            Consistency check unavailable
          </div>
          <p className="text-xs text-ink-soft leading-relaxed">
            The static rule checker (ML sidecar) did not answer
            {analysis.reason ? ` — ${analysis.reason}` : ''}. This is <em>not</em> a statement
            that the rules are valid; start the sidecar to see the analysis.
          </p>
        </div>
        <button onClick={onRecheck} disabled={checking} className="btn btn-sm flex-shrink-0">
          {checking ? 'Checking…' : 'Retry'}
        </button>
      </div>
    );
  }

  const { errors = 0, warnings = 0, checkedRules = 0, resolutionSteps = 0, method } = analysis;

  if (errors > 0) {
    return (
      <div className="mt-8 border border-accent bg-card px-5 py-4">
        <div className="font-mono text-[10px] uppercase tracking-wider text-accent mb-1">
          {errors} rule{errors === 1 ? '' : 's'} can never fire
        </div>
        <p className="text-xs text-ink-soft leading-relaxed">
          A rule whose condition no transaction satisfies is silently dead: it shows as
          enabled and never contributes evidence. The findings are listed on the affected
          rules below.
        </p>
      </div>
    );
  }

  if (warnings > 0) {
    return (
      <div className="mt-8 border border-hairline-strong bg-card px-5 py-4">
        <div className="font-mono text-[10px] uppercase tracking-wider text-ink mb-1">
          {warnings} warning{warnings === 1 ? '' : 's'}
        </div>
        <p className="text-xs text-ink-soft leading-relaxed">
          Every rule can fire, but some carry no distinct evidence — see the notes below.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-8 border border-hairline bg-card px-5 py-3 flex items-center justify-between gap-4">
      <div className="flex items-center gap-2">
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted">
          Consistency check
        </span>
        <span className="text-xs text-ink-soft">
          all {checkedRules} rules can fire
        </span>
      </div>
      <span className="font-mono text-[10px] text-muted" title={method || ''}>
        {resolutionSteps} resolution steps
      </span>
    </div>
  );
}
