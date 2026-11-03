package com.payguard.fraud_engine.service;

import com.payguard.fraud_engine.model.*;
import com.payguard.fraud_engine.rules.FraudRule;
import org.springframework.stereotype.Service;
import java.util.*;

/**
 * FraudScoringService — the one class that decides a transaction's verdict.
 *
 * Purpose in one line: run every enabled rule, take the highest score any
 * rule produced, and turn that score into a status.
 *
 * Why the HIGHEST score, not the average (the old code averaged, and that
 * was a real bug): if impossible travel alone scores 80 (blocked), adding a
 * weaker second signal like a night-time rule (40) must never pull the
 * verdict DOWN to (80+40)/2 = 60 (review). More evidence of fraud should
 * never make a transaction look safer. Each rule's score was chosen to mean
 * "this signal alone is this serious", so the strongest signal decides.
 *
 * Status bands: 0-39 = clear, 40-69 = review, 70-100 = blocked.
 */
@Service
public class FraudScoringService {

    // Spring injects every @Component that implements FraudRule
    // (the 6 rule classes in the rules/ package). Adding a new rule means
    // adding one new class — this service does not change.
    private final List<FraudRule> rules;

    public FraudScoringService(List<FraudRule> rules) {
        this.rules = rules;
    }

    /**
     * Score one transaction.
     * 1. For each rule: look up its config for this request, skip it if disabled.
     * 2. Collect the rules that fired.
     * 3. Final score = the highest fired rule's score (0 if none fired).
     * 4. Convert the score to a status using the bands above.
     */
    public FraudResult score(TransactionRequest txn) {
        List<FraudResult.RuleResult> triggered = new ArrayList<>();
        for (FraudRule rule : rules) {
            RuleConfig config = resolveConfig(txn, rule.getRuleName());
            if (!config.isEnabled()) continue; // disabled rules do not run at all
            rule.evaluate(txn, config).ifPresent(triggered::add);
        }

        int finalScore = triggered.stream()
                .mapToInt(FraudResult.RuleResult::getScore)
                .max()
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
     * Find the config for one rule inside this request. The Node server sends
     * the current config with every transaction, so a rule can be tuned or
     * disabled without restarting this engine. If a rule has no config in the
     * request, it runs enabled with its built-in defaults — never null.
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
