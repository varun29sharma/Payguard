package com.payguard.fraud_engine.rules;
import com.payguard.fraud_engine.model.FraudResult;
import com.payguard.fraud_engine.model.TransactionRequest;
import org.springframework.stereotype.Component;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

@Component
public class VelocityRule implements FraudRule{
    //in-memory store for list of recent transactions carried out
    //concHashmap cuz its thread safe
    private final Map<String,List<Instant>> recentTransactions = new ConcurrentHashMap<>();
    private static final int MAX_TXNS_PER_MINUTE = 5;
    private static final long WINDOW_MS = 60000;

    @Override
    public Optional<FraudResult.RuleResult> evaluate(TransactionRequest txn){
        String userId = txn.getUserId();
        Instant now = txn.getTimeStamp() != null ? txn.getTimeStamp() : Instant.now() ;
        //creating list of users
        recentTransactions.putIfAbsent(userId,new ArrayList<>());
        List<Instant> timestamps = recentTransactions.get(userId);

        Instant cutoff = now.minusMillis(WINDOW_MS);
        //here we are removing the older timestamps whose window is expired
        //i.e. their time exceeded WINDOW_MS
        timestamps.removeIf(t -> t.isBefore(cutoff));
        //add the current transaction
        timestamps.add(now);

        if(timestamps.size() > MAX_TXNS_PER_MINUTE){
            return Optional.of(FraudResult.RuleResult.builder()
                    .ruleName(getRuleName())
                    .score(60)
                    .reason(String.format("%d transactions in 1 min - velocity exceeded", timestamps.size()))
                    .build());
        }
        //this means no rules were triggered
        return Optional.empty();
    }
    @Override
    public String getRuleName(){return "VELOCITY RULE";}

}
