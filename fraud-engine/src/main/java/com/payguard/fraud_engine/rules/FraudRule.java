package com.payguard.fraud_engine.rules;
import com.payguard.fraud_engine.model.FraudResult;
import com.payguard.fraud_engine.model.RuleConfig;
import com.payguard.fraud_engine.model.TransactionRequest;
import java.util.Optional;
public interface FraudRule {
    //basically Optional is used bcuz if no fraud was detected the evaluate would return null
    //but this would crash the app by a NullPointerException thus if no fraud we return Optional.empty()
    //config carries per-request overrides (enabled flag, score, thresholds) — see RuleConfig.
    //It is never null: FraudScoringService always hands each rule a resolved config.
    public Optional<FraudResult.RuleResult> evaluate(TransactionRequest transaction, RuleConfig config);
    String getRuleName();
}
