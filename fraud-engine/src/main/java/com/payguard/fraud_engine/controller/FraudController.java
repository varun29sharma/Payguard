package com.payguard.fraud_engine.controller;

import com.payguard.fraud_engine.model.FraudResult;
import com.payguard.fraud_engine.model.RuleConfig;
import com.payguard.fraud_engine.model.TransactionRequest;
import com.payguard.fraud_engine.rules.FraudRule;
import com.payguard.fraud_engine.service.BacktestService;
import com.payguard.fraud_engine.service.FraudScoringService;
import tools.jackson.databind.ObjectMapper;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.lang.management.ManagementFactory;
import java.util.*;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/api/fraud")
public class FraudController {

    private final FraudScoringService scoringService;
    private final BacktestService backtestService;
    private final List<FraudRule> rules;
    private final long startedAtMillis = ManagementFactory.getRuntimeMXBean().getStartTime();
    private final ObjectMapper mapper = new ObjectMapper();
    // Spring auto-injects the services here
    public FraudController(FraudScoringService scoringService, BacktestService backtestService, List<FraudRule> rules) {
        this.scoringService = scoringService;
        this.backtestService = backtestService;
        this.rules = rules;
    }
    /*
     POST endpoint to evaluate a transaction payload for fraud.
     URL: http://localhost:8080/api/fraud/score
     */
    @PostMapping("/score")
    public ResponseEntity<FraudResult> scoreTransaction(@RequestBody TransactionRequest request) {
        FraudResult result = scoringService.score(request);
        return ResponseEntity.ok(result);
    }
    /*
     POST endpoint to replay a historical transaction stream through a
     candidate rule configuration (fresh, isolated rule state per run).
     Body: { rules: [RuleConfig...], transactions: [TransactionRequest...] }
     URL: http://localhost:8080/api/fraud/backtest
     */
    @PostMapping("/backtest")
    public ResponseEntity<Map<String, Object>> backtest(@RequestBody Map<String, Object> body) {
        List<RuleConfig> config = castRuleConfigs(body.get("rules"));
        List<TransactionRequest> transactions = castTransactions(body.get("transactions"));

        long startedAt = System.currentTimeMillis();
        List<Map<String, Object>> results = backtestService.replay(config, transactions);

        Map<String, Object> response = new LinkedHashMap<>();
        response.put("success", true);
        response.put("count", results.size());
        response.put("durationMs", System.currentTimeMillis() - startedAt);
        response.put("data", results);
        return ResponseEntity.ok(response);
    }

    /*
     GET endpoint to easily check if the fraud engine microservice is up and running.
     URL: http://localhost:8080/api/fraud/health
     Also reports the set of active rules so the Node.js server can surface
     engine capability in its own health endpoint.
     */
    // Jackson deserializes into Map<String,Object> here; convert to the typed
    // DTOs the rules expect.
    @SuppressWarnings("unchecked")
    private List<RuleConfig> castRuleConfigs(Object raw) {
        if (!(raw instanceof List)) return Collections.emptyList();
        List<RuleConfig> out = new ArrayList<>();
        for (Object o : (List<Object>) raw) {
            if (o instanceof Map) {
                out.add(ruleConfigFromMap((Map<String, Object>) o));
            }
        }
        return out;
    }

    private RuleConfig ruleConfigFromMap(Map<String, Object> m) {
        RuleConfig c = new RuleConfig();
        c.setRuleName(String.valueOf(m.getOrDefault("ruleName", "")));
        Object enabled = m.get("enabled");
        c.setEnabled(enabled == null || Boolean.parseBoolean(String.valueOf(enabled)));
        Object score = m.get("score");
        if (score instanceof Number) c.setScore(((Number) score).intValue());
        Object params = m.get("parameters");
        if (params instanceof Map) {
            c.setParameters((Map<String, Object>) params);
        }
        return c;
    }

    @SuppressWarnings("unchecked")
    private List<TransactionRequest> castTransactions(Object raw) {
        if (!(raw instanceof List)) return Collections.emptyList();
        // Let Jackson's ObjectMapper re-map the maps onto TransactionRequest
        // so all field aliases (@JsonAlias("timestamp")) apply consistently.
        List<TransactionRequest> out = new ArrayList<>();
        for (Object o : (List<Object>) raw) {
            if (o instanceof Map) {
                try {
                    out.add(mapper.convertValue(o, TransactionRequest.class));
                } catch (IllegalArgumentException e) {
                    // skip malformed rows rather than failing the whole run
                }
            }
        }
        return out;
    }

    @GetMapping("/health")
    public ResponseEntity<Map<String, Object>> health() {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("status", "UP");
        body.put("service", "payguard-fraud-engine");
        body.put("uptimeSeconds", (System.currentTimeMillis() - startedAtMillis) / 1000);
        body.put("activeRules", rules.stream().map(FraudRule::getRuleName).sorted().collect(Collectors.toList()));
        return ResponseEntity.ok(body);
    }
}