package com.payguard.fraud_engine.service;

import com.payguard.fraud_engine.model.*;
import com.payguard.fraud_engine.rules.FraudRule;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import java.util.*;

@Service
public class FraudScoringService {

    private final List<FraudRule> rules;
    /**
     * Null in backtests on purpose: the tasting room exists to evaluate RULE
     * changes, so replaying the model there would confuse two different
     * questions. Live scoring gets it injected.
     */
    private final LogisticModelScorer modelScorer;

    /** Backtest / unit-test constructor — no ML shadow scoring. */
    public FraudScoringService(List<FraudRule> rules) {
        this(rules, null);
    }

    @Autowired
    public FraudScoringService(List<FraudRule> rules, LogisticModelScorer modelScorer) {
        this.rules = rules;
        this.modelScorer = modelScorer;
    }

    public FraudResult score(TransactionRequest txn) {
        List<FraudResult.RuleResult> triggered = new ArrayList<>();
        for (FraudRule rule : rules) {
            RuleConfig config = resolveConfig(txn, rule.getRuleName());
            // A rule explicitly disabled in the per-request config is skipped
            // entirely — its stateful window does not even advance.
            if (!config.isEnabled()) continue;
            rule.evaluate(txn, config).ifPresent(triggered::add);
        }

        int finalScore = triggered.isEmpty() ? 0 : (int) triggered.stream()
                .mapToInt(FraudResult.RuleResult::getScore)
                .average()
                .orElse(0);

        String status;
        if (finalScore >= 70) status = "blocked";
        else if (finalScore >= 40) status = "review";
        else status = "clear";

        FraudResult result = FraudResult.builder()
                .score(finalScore)
                .status(status)
                .rulesTriggered(triggered)
                .build();
        attachMlShadowScore(result, txn);
        return result;
    }

    /**
     * Records the model's opinion on every transaction WITHOUT letting it
     * decide. This is the shadow-mode deployment: a live A/B on real traffic at
     * zero risk, which is how models are actually shipped at serious companies
     * and a stronger signal than the model itself.
     *
     * Three honest states, never a silent zero:
     *   "model"    — scored, and `mlProbability` is calibrated
     *   "skipped"  — model present but this request carried no usable features
     *   "fallback" — no model loaded; says so the way `scoringEngine` does
     */
    private void attachMlShadowScore(FraudResult result, TransactionRequest txn) {
        if (modelScorer == null || !modelScorer.isAvailable()) {
            result.setMlEngine("fallback");
            return;
        }
        Optional<MlScore> scored = modelScorer.score(txn.getFeatures());
        if (scored.isEmpty()) {
            result.setMlEngine("skipped");
            return;
        }
        MlScore ml = scored.get();
        result.setMlProbability(ml.getProbability());
        result.setMlVersion(ml.getVersion());
        result.setMlEngine(ml.getEngine());
        result.setMlContributions(ml.getContributions());
    }

    /**
     * Finds the per-request config for a rule. Never returns null: absent
     * config means "run with built-in defaults", which rules can rely on.
     */
    private RuleConfig resolveConfig(TransactionRequest txn, String ruleName) {
        if (txn.getRules() != null) {
            for (RuleConfig c : txn.getRules()) {
                if (c != null && ruleName.equals(c.getRuleName())) return c;
            }
        }
        return new RuleConfig(ruleName, true, null, null);
    }
}