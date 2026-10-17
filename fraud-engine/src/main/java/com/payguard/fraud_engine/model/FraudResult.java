package com.payguard.fraud_engine.model;

import java.util.List;

/**
 * Plain-Java DTO (no Lombok) so the build works on any JDK without
 * annotation-processing constraints. Kept the builder() static factory so
 * the existing rule call sites (FraudResult.RuleResult.builder()...build())
 * compile unchanged.
 */
public class FraudResult {
    private int score; // 0-100
    private String status; // "clear", "review", "blocked"
    private List<RuleResult> rulesTriggered;

    // --- ML shadow fields (Phase 1) -------------------------------------
    // The model's opinion is RECORDED, not acted upon: `status` is still the
    // rules' decision. This is what makes a live A/B possible with zero risk,
    // and it mirrors the existing `scoringEngine` honesty pattern.
    /** Calibrated P(fraud), or null when the model was not available/applicable. */
    private Double mlProbability;
    /** Artefact version that produced the score (e.g. "1"). */
    private String mlVersion;
    /** "model" | "fallback" | "disabled" — never silently absent. */
    private String mlEngine;
    /** Per-feature w_i * x_i terms, sorted by |contribution|, top N. */
    private List<MlContribution> mlContributions;

    public FraudResult() {
    }

    public FraudResult(int score, String status, List<RuleResult> rulesTriggered) {
        this.score = score;
        this.status = status;
        this.rulesTriggered = rulesTriggered;
    }

    public int getScore() { return score; }
    public void setScore(int score) { this.score = score; }

    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }

    public List<RuleResult> getRulesTriggered() { return rulesTriggered; }
    public void setRulesTriggered(List<RuleResult> rulesTriggered) { this.rulesTriggered = rulesTriggered; }

    public Double getMlProbability() { return mlProbability; }
    public void setMlProbability(Double mlProbability) { this.mlProbability = mlProbability; }

    public String getMlVersion() { return mlVersion; }
    public void setMlVersion(String mlVersion) { this.mlVersion = mlVersion; }

    public String getMlEngine() { return mlEngine; }
    public void setMlEngine(String mlEngine) { this.mlEngine = mlEngine; }

    public List<MlContribution> getMlContributions() { return mlContributions; }
    public void setMlContributions(List<MlContribution> mlContributions) { this.mlContributions = mlContributions; }

    public static Builder builder() { return new Builder(); }

    public static class Builder {
        private int score;
        private String status;
        private List<RuleResult> rulesTriggered;
        private Double mlProbability;
        private String mlVersion;
        private String mlEngine;
        private List<MlContribution> mlContributions;

        public Builder score(int score) { this.score = score; return this; }
        public Builder status(String status) { this.status = status; return this; }
        public Builder rulesTriggered(List<RuleResult> rulesTriggered) { this.rulesTriggered = rulesTriggered; return this; }
        public Builder mlProbability(Double mlProbability) { this.mlProbability = mlProbability; return this; }
        public Builder mlVersion(String mlVersion) { this.mlVersion = mlVersion; return this; }
        public Builder mlEngine(String mlEngine) { this.mlEngine = mlEngine; return this; }
        public Builder mlContributions(List<MlContribution> mlContributions) { this.mlContributions = mlContributions; return this; }
        public FraudResult build() {
            FraudResult r = new FraudResult(score, status, rulesTriggered);
            r.mlProbability = mlProbability;
            r.mlVersion = mlVersion;
            r.mlEngine = mlEngine;
            r.mlContributions = mlContributions;
            return r;
        }
    }

    /** One feature's exact contribution {@code w_i * x_i} to the linear score. */
    public static class MlContribution {
        private String feature;
        private double value;
        private double weight;
        private double contribution;

        public MlContribution() {
        }

        public MlContribution(String feature, double value, double weight, double contribution) {
            this.feature = feature;
            this.value = value;
            this.weight = weight;
            this.contribution = contribution;
        }

        public String getFeature() { return feature; }
        public void setFeature(String feature) { this.feature = feature; }

        public double getValue() { return value; }
        public void setValue(double value) { this.value = value; }

        public double getWeight() { return weight; }
        public void setWeight(double weight) { this.weight = weight; }

        public double getContribution() { return contribution; }
        public void setContribution(double contribution) { this.contribution = contribution; }
    }

    public static class RuleResult {
        private String ruleName;
        private int score;
        private String reason;

        public RuleResult() {
        }

        public RuleResult(String ruleName, int score, String reason) {
            this.ruleName = ruleName;
            this.score = score;
            this.reason = reason;
        }

        public String getRuleName() { return ruleName; }
        public void setRuleName(String ruleName) { this.ruleName = ruleName; }

        public int getScore() { return score; }
        public void setScore(int score) { this.score = score; }

        public String getReason() { return reason; }
        public void setReason(String reason) { this.reason = reason; }

        public static Builder builder() { return new Builder(); }

        public static class Builder {
            private String ruleName;
            private int score;
            private String reason;

            public Builder ruleName(String ruleName) { this.ruleName = ruleName; return this; }
            public Builder score(int score) { this.score = score; return this; }
            public Builder reason(String reason) { this.reason = reason; return this; }
            public RuleResult build() { return new RuleResult(ruleName, score, reason); }
        }
    }
}
