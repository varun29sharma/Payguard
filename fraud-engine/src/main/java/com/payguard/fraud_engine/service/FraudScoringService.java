package com.payguard.fraud_engine.service;

import com.payguard.fraud_engine.model.*;
import com.payguard.fraud_engine.rules.FraudRule;
import org.springframework.stereotype.Service;
import java.util.*;
import java.util.stream.Collectors;

@Service
public class FraudScoringService {

    private final List<FraudRule> rules;
    public FraudScoringService(List<FraudRule> rules) {
        this.rules = rules;
    }

    public FraudResult score(TransactionRequest txn) {
        List<FraudResult.RuleResult> triggered = rules.stream()
                .map(rule -> rule.evaluate(txn))
                .filter(Optional::isPresent)
                .map(Optional::get)
                .collect(Collectors.toList());

        int finalScore = triggered.isEmpty() ? 0 : (int) triggered.stream()
                .mapToInt(FraudResult.RuleResult::getScore)
                .average()
                .orElse(0);

        String status;
        if (finalScore >= 70) status = "blocked";
        else if (finalScore >= 40) status = "review";
        else status = "clear";

        return FraudResult.builder()
                .score(finalScore)
                .status(status)
                .rulesTriggered(triggered)
                .build();
    }
}