package com.payguard.fraud_engine.controller;

import com.payguard.fraud_engine.model.FraudResult;
import com.payguard.fraud_engine.model.TransactionRequest;
import com.payguard.fraud_engine.service.FraudScoringService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/fraud")
public class FraudController {

    private final FraudScoringService scoringService;
    // Spring auto-injects the FraudScoringService here
    public FraudController(FraudScoringService scoringService) {
        this.scoringService = scoringService;
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
     GET endpoint to easily check if the fraud engine microservice is up and running.
     URL: http://localhost:8080/api/fraud/health
     */
    @GetMapping("/health")
    public ResponseEntity<String> health() {
        return ResponseEntity.ok("Fraud engine running");
    }
}