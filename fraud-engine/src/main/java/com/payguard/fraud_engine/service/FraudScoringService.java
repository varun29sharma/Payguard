package com.payguard.fraud_engine.service;

import com.payguard.fraud_engine.model.*;
import com.payguard.fraud_engine.rules.FraudRule;
import org.springframework.stereotype.Service;
import java.util.*;

@Service
public class FraudScoringService {

    private final List<FraudRule> rules;
    public FraudScoringService(List<FraudRule> rules) {
        this.rules = rules;
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

        return FraudResult.builder()
                .score(finalScore)
                .status(status)
                .rulesTriggered(triggered)
                .build();
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