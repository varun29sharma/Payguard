package com.payguard.fraud_engine.rules;

import com.payguard.fraud_engine.model.FraudResult;
import com.payguard.fraud_engine.model.RuleConfig;
import com.payguard.fraud_engine.model.TransactionRequest;
import org.springframework.stereotype.Component;
import java.time.Instant;
import java.time.ZoneId;
import java.util.Optional;

/**
 * NIGHT_OWL_RULE — flags transactions that occur in the dead of night
 * (00:00–05:00 local server time). Human users rarely transact then, so a
 * burst of overnight activity is consistent with scripted bots or attackers
 * operating outside the victim's timezone. Lowest-severity rule on its own;
 * it mainly boosts scores when combined with other signals.
 */
@Component
public class NightOwlRule implements FraudRule {

    // Built-in defaults — overridable via RuleConfig parameters
    // (startHour, endHour) and score.
    private static final int DEFAULT_SCORE = 40;
    private static final int DEFAULT_NIGHT_START_HOUR = 0;
    private static final int DEFAULT_NIGHT_END_HOUR = 5;

    @Override
    public Optional<FraudResult.RuleResult> evaluate(TransactionRequest txn, RuleConfig config) {
        int score = config.scoreOrDefault(DEFAULT_SCORE);
        int startHour = config.intParam("startHour", DEFAULT_NIGHT_START_HOUR);
        int endHour = config.intParam("endHour", DEFAULT_NIGHT_END_HOUR);

        Instant ts = txn.getTimeStamp() != null ? txn.getTimeStamp() : Instant.now();
        int hour = ts.atZone(ZoneId.systemDefault()).getHour();
        if (hour < startHour || hour > endHour) return Optional.empty();

        return Optional.of(FraudResult.RuleResult.builder()
                .ruleName(getRuleName())
                .score(score)
                .reason(String.format("Transaction at %02d:00 local time — outside normal waking hours (%02d:00–%02d:00)", hour, startHour, endHour))
                .build());
    }

    @Override
    public String getRuleName() {
        return "NIGHT_OWL_RULE";
    }
}
