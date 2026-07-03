package com.payguard.fraud_engine.model;
import lombok.Builder;
import lombok.Data;
import java.util.*;
@Data
@Builder
public class FraudResult {
    private int score;//0-100
    private String status;//"clear","review","blocked"
    private List<RuleResult> rulesTriggered;
    @Data
    @Builder
    public static class RuleResult {
        private String ruleName;
        private int score;
        private String reason;
    }
}
