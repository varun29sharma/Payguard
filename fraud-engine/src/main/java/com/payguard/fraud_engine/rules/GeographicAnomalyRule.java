package com.payguard.fraud_engine.rules;

import com.payguard.fraud_engine.model.FraudResult;
import com.payguard.fraud_engine.model.RuleConfig;
import com.payguard.fraud_engine.model.TransactionRequest;
import org.springframework.stereotype.Component;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

/**
 * GEOGRAPHIC_ANOMALY_RULE — detects "impossible travel": a single user
 * transacting from two different cities within a short window. This is the
 * signature of NFC relay fraud / card sharing, where a card's data is
 * replayed from a geographically distant location moments after a legitimate
 * transaction.
 */
@Component
public class GeographicAnomalyRule implements FraudRule {

    // userId -> list of recent (city, timestamp) sightings, sliding window.
    private final Map<String, List<Sighting>> userSightings = new ConcurrentHashMap<>();
    // Built-in defaults — overridable via RuleConfig parameter `windowMinutes` and score.
    private static final long DEFAULT_WINDOW_MINUTES = 120;
    private static final int DEFAULT_SCORE = 80;

    private static final class Sighting {
        final String city;
        final Instant at;
        Sighting(String city, Instant at) { this.city = city; this.at = at; }
    }

    @Override
    public Optional<FraudResult.RuleResult> evaluate(TransactionRequest txn, RuleConfig config) {
        long windowMinutes = config.longParam("windowMinutes", DEFAULT_WINDOW_MINUTES);
        int score = config.scoreOrDefault(DEFAULT_SCORE);

        String city = cityOf(txn);
        if (city == null) return Optional.empty();

        String userId = txn.getUserId();
        Instant now = txn.getTimeStamp() != null ? txn.getTimeStamp() : Instant.now();

        List<Sighting> sightings = userSightings.computeIfAbsent(userId, k -> new ArrayList<>());
        synchronized (sightings) {
            sightings.removeIf(s -> s.at.isBefore(now.minusSeconds(windowMinutes * 60)));
            sightings.add(new Sighting(city, now));

            if (sightings.size() >= 2) {
                Set<String> cities = new HashSet<>();
                for (Sighting s : sightings) cities.add(s.city);
                if (cities.size() >= 2) {
                    return Optional.of(FraudResult.RuleResult.builder()
                            .ruleName(getRuleName())
                            .score(score)
                            .reason(String.format("User %s transacted from %d different cities within %d minutes — impossible travel / relay pattern",
                                    userId, cities.size(), windowMinutes))
                            .build());
                }
            }
        }
        return Optional.empty();
    }

    private String cityOf(TransactionRequest txn) {
        Map<String, Object> location = txn.getLocation();
        if (location == null) return null;
        Object city = location.get("city");
        if (city == null) return null;
        String s = city.toString().trim();
        return s.isEmpty() || s.equalsIgnoreCase("unknown") ? null : s;
    }

    @Override
    public String getRuleName() {
        return "GEOGRAPHIC_ANOMALY_RULE";
    }
}
