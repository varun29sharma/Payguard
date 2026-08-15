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

    public static Builder builder() { return new Builder(); }

    public static class Builder {
        private int score;
        private String status;
        private List<RuleResult> rulesTriggered;

        public Builder score(int score) { this.score = score; return this; }
        public Builder status(String status) { this.status = status; return this; }
        public Builder rulesTriggered(List<RuleResult> rulesTriggered) { this.rulesTriggered = rulesTriggered; return this; }
        public FraudResult build() { return new FraudResult(score, status, rulesTriggered); }
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
