package com.payguard.fraud_engine.rules;

import com.payguard.fraud_engine.model.FraudResult;
import com.payguard.fraud_engine.model.TransactionRequest;
import org.springframework.stereotype.Component;
import java.util.*;
import java.time.Instant;
import java.util.concurrent.ConcurrentHashMap;

@Component
public class EnumerationAttackRule implements FraudRule{
    private final Map<String, List<Instant>> microTxnMap = new ConcurrentHashMap<>();
    private static final double MICRO_AMOUNT_THRESHOLD = 50;
    private static final int MAX_MICRO_TXNS = 8;
    private static final long WINDOW_MS = 1800000;

    @Override
    public Optional<FraudResult.RuleResult> evaluate(TransactionRequest txn){
        if (txn.getAmount() > MICRO_AMOUNT_THRESHOLD) return Optional.empty();
        String userId = txn.getUserId();
        Instant now = Instant.now();
        microTxnMap.putIfAbsent(userId,new ArrayList<>());
        List<Instant> timestamps = microTxnMap.get(userId);

        timestamps.removeIf(t -> t.isBefore(now.minusMillis(WINDOW_MS)));
        timestamps.add(now);

        if(timestamps.size() >= MAX_MICRO_TXNS){
            return Optional.of(FraudResult.RuleResult.builder()
                    .ruleName(getRuleName())
                    .score(75)
                    .reason("Enumeration attack detected:" + timestamps.size() + "micro-txns in 30 mins")
                    .build());
        }
        return Optional.empty();
    }

    @Override
    public String getRuleName(){
        return  "ENUMERATION_ATTACK_RULE";
    }
}
