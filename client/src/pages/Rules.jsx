import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import api from '../api/axiosConfig';
import Layout from '../components/shared/Layout';
import { SkeletonCard } from '../components/shared/Skeleton';
import { RULE_META } from '../utils/ruleMeta';

export default function Rules() {
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState({});

  useEffect(() => {
    const load = async () => {
      try {
        const { data } = await api.get('/rules');
        setRules(data.data || []);
      } catch (err) {
        console.error('Load rules failed:', err.message);
      } finally {
        setLoading(false);
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
