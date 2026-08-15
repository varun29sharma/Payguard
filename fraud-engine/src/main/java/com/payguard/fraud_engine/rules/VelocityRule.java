package com.payguard.fraud_engine.rules;
import com.payguard.fraud_engine.model.FraudResult;
import com.payguard.fraud_engine.model.RuleConfig;
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
    // Built-in defaults — overridable per request via RuleConfig parameters
    // (maxTransactions, windowSeconds) and score.
    private static final int DEFAULT_MAX_TXNS = 5;
    private static final long DEFAULT_WINDOW_SECONDS = 60;
    private static final int DEFAULT_SCORE = 60;

    @Override
    public Optional<FraudResult.RuleResult> evaluate(TransactionRequest txn, RuleConfig config){
        int maxTxns = config.intParam("maxTransactions", DEFAULT_MAX_TXNS);
        long windowSeconds = config.longParam("windowSeconds", DEFAULT_WINDOW_SECONDS);
        int score = config.scoreOrDefault(DEFAULT_SCORE);

        String userId = txn.getUserId();
        Instant now = txn.getTimeStamp() != null ? txn.getTimeStamp() : Instant.now() ;
        //creating list of users
        recentTransactions.putIfAbsent(userId,new ArrayList<>());
        List<Instant> timestamps = recentTransactions.get(userId);

        Instant cutoff = now.minusSeconds(windowSeconds);
        //here we are removing the older timestamps whose window is expired
        //i.e. their time exceeded the window
        timestamps.removeIf(t -> t.isBefore(cutoff));
        //add the current transaction
        timestamps.add(now);

        if(timestamps.size() > maxTxns){
            return Optional.of(FraudResult.RuleResult.builder()
                    .ruleName(getRuleName())
                    .score(score)
                    .reason(String.format("%d transactions in %d sec - velocity exceeded", timestamps.size(), windowSeconds))
                    .build());
        }
        //this means no rules were triggered
        return Optional.empty();
    }
    @Override
    public String getRuleName(){return "VELOCITY_RULE";}

}
