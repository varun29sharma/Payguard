package com.payguard.fraud_engine.rules;

import com.payguard.fraud_engine.model.FraudResult;
import com.payguard.fraud_engine.model.RuleConfig;
import com.payguard.fraud_engine.model.TransactionRequest;
import org.springframework.stereotype.Component;
import java.util.*;
import java.time.Instant;
import java.util.concurrent.ConcurrentHashMap;

@Component
public class EnumerationAttackRule implements FraudRule{
    private final Map<String, List<Instant>> microTxnMap = new ConcurrentHashMap<>();
    // Built-in defaults — overridable via RuleConfig parameters
    // (microAmountThreshold, maxMicroTxns, windowSeconds) and score.
    private static final double DEFAULT_MICRO_AMOUNT_THRESHOLD = 50;
    private static final int DEFAULT_MAX_MICRO_TXNS = 8;
    private static final long DEFAULT_WINDOW_SECONDS = 1800;
    private static final int DEFAULT_SCORE = 75;

    @Override
    public Optional<FraudResult.RuleResult> evaluate(TransactionRequest txn, RuleConfig config){
        double microThreshold = config.doubleParam("microAmountThreshold", DEFAULT_MICRO_AMOUNT_THRESHOLD);
        int maxMicroTxns = config.intParam("maxMicroTxns", DEFAULT_MAX_MICRO_TXNS);
        long windowSeconds = config.longParam("windowSeconds", DEFAULT_WINDOW_SECONDS);
        int score = config.scoreOrDefault(DEFAULT_SCORE);

        if (txn.getAmount() > microThreshold) return Optional.empty();
        String userId = txn.getUserId();
        Instant now = txn.getTimeStamp() != null ? txn.getTimeStamp() : Instant.now();
        microTxnMap.putIfAbsent(userId,new ArrayList<>());
        List<Instant> timestamps = microTxnMap.get(userId);

        timestamps.removeIf(t -> t.isBefore(now.minusSeconds(windowSeconds)));
        timestamps.add(now);

        if(timestamps.size() >= maxMicroTxns){
            return Optional.of(FraudResult.RuleResult.builder()
                    .ruleName(getRuleName())
                    .score(score)
                    .reason(String.format("%d micro-transactions in %d mins - enumeration pattern", timestamps.size(), windowSeconds / 60))
                    .build());
        }
        return Optional.empty();
    }

    @Override
    public String getRuleName(){
        return  "ENUMERATION_ATTACK_RULE";
    }
}
