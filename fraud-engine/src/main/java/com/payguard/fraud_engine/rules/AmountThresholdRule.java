package com.payguard.fraud_engine.rules;

import com.payguard.fraud_engine.model.FraudResult;
import com.payguard.fraud_engine.model.RuleConfig;
import com.payguard.fraud_engine.model.TransactionRequest;
import org.springframework.stereotype.Component;
import java.util.Optional;

/**
 * AMOUNT_THRESHOLD_RULE — flags transactions whose value exceeds a hard
 * threshold (default ₹1,00,000). High-value single transactions are a
 * classic card-not-present / account-takeover payout signal, especially when
 * they break a user's normal spending profile.
 */
@Component
public class AmountThresholdRule implements FraudRule {

    // INR threshold above which a single transaction is considered high-risk.
    // Overridable per request via RuleConfig parameter `minAmount` and score.
    private static final double DEFAULT_MIN_AMOUNT = 100_000;
    private static final int DEFAULT_SCORE = 65;

    @Override
    public Optional<FraudResult.RuleResult> evaluate(TransactionRequest txn, RuleConfig config) {
        double minAmount = config.doubleParam("minAmount", DEFAULT_MIN_AMOUNT);
        int score = config.scoreOrDefault(DEFAULT_SCORE);
        if (txn.getAmount() <= minAmount) return Optional.empty();
        return Optional.of(FraudResult.RuleResult.builder()
                .ruleName(getRuleName())
                .score(score)
                .reason(String.format("Transaction amount ₹%.0f exceeds high-value threshold of ₹%.0f",
                        txn.getAmount(), minAmount))
                .build());
    }

    @Override
    public String getRuleName() {
        return "AMOUNT_THRESHOLD_RULE";
    }
}
