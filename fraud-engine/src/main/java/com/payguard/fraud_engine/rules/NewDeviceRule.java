package com.payguard.fraud_engine.rules;

import com.payguard.fraud_engine.model.FraudResult;
import com.payguard.fraud_engine.model.RuleConfig;
import com.payguard.fraud_engine.model.TransactionRequest;
import org.springframework.stereotype.Component;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

/**
 * NEW_DEVICE_RULE — flags a user transacting from a device they have never
 * used before. First-use-on-a-new-device is a strong signal for account
 * takeover (attacker logs in from their own hardware). The device is
 * remembered after the first sighting so subsequent transactions from the
 * same device don't re-trigger.
 */
@Component
public class NewDeviceRule implements FraudRule {

    // userId -> set of deviceIds that user has been seen using.
    private final Map<String, Set<String>> knownDevices = new ConcurrentHashMap<>();
    private static final int DEFAULT_SCORE = 55;

    @Override
    public Optional<FraudResult.RuleResult> evaluate(TransactionRequest txn, RuleConfig config) {
        int score = config.scoreOrDefault(DEFAULT_SCORE);
        String deviceId = txn.getDeviceId();
        if (deviceId == null || deviceId.isBlank() || deviceId.equalsIgnoreCase("unknown")) {
            return Optional.empty();
        }

        Set<String> devices = knownDevices.computeIfAbsent(txn.getUserId(), k -> ConcurrentHashMap.newKeySet());
        boolean isNew = devices.add(deviceId); // add() returns true only if not already present
        if (!isNew) return Optional.empty();

        return Optional.of(FraudResult.RuleResult.builder()
                .ruleName(getRuleName())
                .score(score)
                .reason(String.format("First transaction from device %s for user %s", deviceId, txn.getUserId()))
                .build());
    }

    @Override
    public String getRuleName() {
        return "NEW_DEVICE_RULE";
    }
}
