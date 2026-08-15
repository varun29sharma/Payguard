package com.payguard.fraud_engine.model;

import java.util.HashMap;
import java.util.Map;

/**
 * Per-request rule configuration, sent by the Node.js server alongside each
 * transaction. Lets operators tune the engine at runtime (no redeploy):
 *   - enabled:  false skips the rule entirely for this scoring pass,
 *   - score:    overrides the rule's default severity (null = use default),
 *   - parameters: rule-specific thresholds (e.g. {"minAmount": 250000}).
 *
 * The engine stays a pure, stateless scorer — config travels with every
 * request, so a fleet of engine instances can never serve stale settings.
 */
public class RuleConfig {
    private String ruleName;
    private boolean enabled = true;
    private Integer score; // null = rule default
    private Map<String, Object> parameters = new HashMap<>();

    public RuleConfig() {
    }

    public RuleConfig(String ruleName, boolean enabled, Integer score, Map<String, Object> parameters) {
        this.ruleName = ruleName;
        this.enabled = enabled;
        this.score = score;
        if (parameters != null) this.parameters = parameters;
    }

    public String getRuleName() { return ruleName; }
    public void setRuleName(String ruleName) { this.ruleName = ruleName; }

    public boolean isEnabled() { return enabled; }
    public void setEnabled(boolean enabled) { this.enabled = enabled; }

    public Integer getScore() { return score; }
    public void setScore(Integer score) { this.score = score; }

    public Map<String, Object> getParameters() { return parameters; }
    public void setParameters(Map<String, Object> parameters) {
        this.parameters = parameters != null ? parameters : new HashMap<>();
    }

    /** Rule severity override, falling back to the rule's built-in default. */
    public int scoreOrDefault(int defaultScore) {
        return score != null ? score : defaultScore;
    }

    public double doubleParam(String key, double def) {
        Object v = parameters.get(key);
        if (v instanceof Number) return ((Number) v).doubleValue();
        if (v instanceof String) {
            try { return Double.parseDouble((String) v); } catch (NumberFormatException e) { return def; }
        }
        return def;
    }

    public int intParam(String key, int def) {
        Object v = parameters.get(key);
        if (v instanceof Number) return ((Number) v).intValue();
        if (v instanceof String) {
            try { return (int) Math.round(Double.parseDouble((String) v)); } catch (NumberFormatException e) { return def; }
        }
        return def;
    }

    public long longParam(String key, long def) {
        Object v = parameters.get(key);
        if (v instanceof Number) return ((Number) v).longValue();
        if (v instanceof String) {
            try { return Math.round(Double.parseDouble((String) v)); } catch (NumberFormatException e) { return def; }
        }
        return def;
    }

    public boolean boolParam(String key, boolean def) {
        Object v = parameters.get(key);
        if (v instanceof Boolean) return (Boolean) v;
        if (v instanceof String) return Boolean.parseBoolean((String) v);
        return def;
    }
}
