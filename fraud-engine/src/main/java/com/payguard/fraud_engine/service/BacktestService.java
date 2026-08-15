package com.payguard.fraud_engine.service;

import com.payguard.fraud_engine.model.FraudResult;
import com.payguard.fraud_engine.model.RuleConfig;
import com.payguard.fraud_engine.model.TransactionRequest;
import com.payguard.fraud_engine.rules.*;
import org.springframework.stereotype.Service;

import java.util.*;

/**
 * BacktestService — replays a historical transaction stream through a
 * candidate rule configuration and reports what WOULD have happened.
 *
 * The critical design point: each run gets BRAND-NEW rule instances. The
 * stateful rules (velocity, enumeration, geographic, new-device) keep their
 * windows in in-memory maps, so reusing the live singleton rules would both
 * pollute live state with replayed history and corrupt the replay itself.
 * Fresh instances give every backtest run a clean, isolated state trajectory.
 */
@Service
public class BacktestService {

    /**
     * Builds a fresh set of rule instances (state starts empty).
     * Keep in sync with the @Component rules used for live scoring.
     */
    private List<FraudRule> freshRules() {
        return Arrays.asList(
                new VelocityRule(),
                new EnumerationAttackRule(),
                new AmountThresholdRule(),
                new GeographicAnomalyRule(),
                new NewDeviceRule(),
                new NightOwlRule());
    }

    /**
     * Replays `transactions` (expected in chronological order) through a
     * scoring pass configured with `config`. Returns one result per
     * transaction, keyed by transactionId so the caller can line results up
     * with its own records.
     */
    public List<Map<String, Object>> replay(List<RuleConfig> config, List<TransactionRequest> transactions) {
        FraudScoringService scorer = new FraudScoringService(freshRules());
        List<Map<String, Object>> results = new ArrayList<>(transactions.size());
        for (TransactionRequest txn : transactions) {
            // The config travels with every request (same mechanism as live
            // scoring), so the replay honors enabled flags, score overrides
            // and thresholds exactly like production would.
            txn.setRules(config);
            FraudResult result = scorer.score(txn);
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("transactionId", txn.getTransactionId());
            row.put("score", result.getScore());
            row.put("status", result.getStatus());
            row.put("rulesTriggered", result.getRulesTriggered());
            results.add(row);
        }
        return results;
    }
}
