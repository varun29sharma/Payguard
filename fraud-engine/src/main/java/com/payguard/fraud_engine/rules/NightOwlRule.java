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
 *
 * <h2>Wrap-around windows (bug fix)</h2>
 * The original implementation was:
 * <pre>
 *   if (hour &lt; startHour || hour &gt; endHour) return Optional.empty();
 * </pre>
 * which is a <em>plain interval</em> test. For the window an operator naturally
 * writes for a night rule — {@code startHour: 22, endHour: 5} — that requires a
 * time that is simultaneously at or after 22:00 and at or before 05:00. No hour
 * satisfies it, so the rule was <em>silently dead</em>: it showed as enabled,
 * green and configured, and never fired.
 *
 * The fix splits the two cases: when {@code startHour <= endHour} the window is
 * a plain interval; when {@code startHour > endHour} it wraps midnight, and the
 * condition is the disjunction {@code hour >= startHour || hour <= endHour}.
 * {@code startHour == endHour} stays in the interval branch on purpose — it
 * restricts the rule to that single hour, which is degenerate but well defined
 * (and no longer misread as a dead window).
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

        if (!inWindow(hour, startHour, endHour)) return Optional.empty();

        String window = startHour > endHour
                ? String.format("%02d:00–%02d:00 (crosses midnight)", startHour, endHour)
                : String.format("%02d:00–%02d:00", startHour, endHour);
        return Optional.of(FraudResult.RuleResult.builder()
                .ruleName(getRuleName())
                .score(score)
                .reason(String.format("Transaction at %02d:00 local time — outside normal waking hours (%s)", hour, window))
                .build());
    }

    /**
     * Is {@code hour} inside the configured window? A window whose start is
     * later than its end wraps midnight and is therefore a union of two
     * intervals, not one.
     *
     * <p>Package-private so a unit test can exercise the boundary hours
     * directly, without having to control the clock through a whole request.
     */
    static boolean inWindow(int hour, int startHour, int endHour) {
        if (startHour > endHour) return hour >= startHour || hour <= endHour;
        return hour >= startHour && hour <= endHour;
    }

    @Override
    public String getRuleName() {
        return "NIGHT_OWL_RULE";
    }
}
