package com.payguard.fraud_engine;

import com.payguard.fraud_engine.model.FraudResult;
import com.payguard.fraud_engine.model.MlScore;
import com.payguard.fraud_engine.model.TransactionRequest;
import com.payguard.fraud_engine.rules.*;
import com.payguard.fraud_engine.service.FraudScoringService;
import com.payguard.fraud_engine.service.LogisticModelScorer;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.io.File;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

/**
 * Guard on the Java half of the model contract.
 *
 * The golden fixture pins the *features* (Python vs Node). This class pins the
 * *scorer*: given the same feature vector as the offline model, the Java
 * implementation must produce the same calibrated probability. If someone
 * changes the sigmoid, forgets the Platt step, or reads the weights in the
 * wrong order, these tests fail — which is the only reason to trust that the
 * number in the dashboard matches the number in the notebook.
 */
class LogisticModelScorerTest {

    private static final double TOLERANCE = 1e-9;

    private final LogisticModelScorer scorer = new LogisticModelScorer();

    private static JsonNode loadFixture() throws Exception {
        String[] candidates = {
                "../ml/artifacts/golden_features.json",
                "ml/artifacts/golden_features.json",
        };
        for (String candidate : candidates) {
            File file = new File(candidate);
            if (file.exists()) {
                return new ObjectMapper().readTree(file);
            }
        }
        return null;
    }

    @Test
    void modelArtefactLoadsFromTheClasspath() {
        assertTrue(scorer.isAvailable(),
                "model-v1.json should be on the classpath: " + scorer.getUnavailableReason());
        assertEquals(25, scorer.getFeatureCount());
        assertEquals("1", scorer.getVersion());
    }

    @Test
    void scoreMatchesTheOfflineImplementationsProbability() throws Exception {
        JsonNode fixture = loadFixture();
        assumeTrue(fixture != null, "golden fixture not found — run ml/make_golden_fixture.py");

        JsonNode expected = fixture.get("expected");
        int checked = 0;
        double worst = 0.0;
        for (JsonNode entry : expected) {
            JsonNode probability = entry.get("probability");
            if (probability == null || probability.isNull()) continue;

            List<Double> vector = new ArrayList<>();
            for (JsonNode value : entry.get("vector")) vector.add(value.asDouble());

            Optional<MlScore> scored = scorer.score(vector);
            assertTrue(scored.isPresent(), "scorer returned empty for a valid vector");
            double got = scored.get().getProbability();
            double want = probability.asDouble();
            worst = Math.max(worst, Math.abs(got - want));
            checked++;
        }
        assertTrue(checked > 0, "fixture carried no probabilities to check");
        assertTrue(worst <= TOLERANCE,
                "Java score differs from Python's by " + worst + " (checked " + checked + " rows)");
    }

    @Test
    void contributionsAreExactProductsSortedByMagnitude() {
        List<Double> vector = new ArrayList<>();
        for (int i = 0; i < scorer.getFeatureCount(); i++) vector.add(i == 3 ? 75.0 : 0.0);

        Optional<MlScore> scored = scorer.score(vector);
        assertTrue(scored.isPresent());
        List<FraudResult.MlContribution> contributions = scored.get().getContributions();

        assertFalse(contributions.isEmpty());
        assertTrue(contributions.size() <= 5, "should return a top-5 explanation, not all 25");
        for (FraudResult.MlContribution c : contributions) {
            assertEquals(c.getWeight() * c.getValue(), c.getContribution(), 1e-12,
                    "a linear model's contribution is EXACTLY w_i * x_i — that is the explainability promise");
        }
        for (int i = 1; i < contributions.size(); i++) {
            assertTrue(Math.abs(contributions.get(i - 1).getContribution())
                            >= Math.abs(contributions.get(i).getContribution()),
                    "contributions must be sorted by absolute magnitude");
        }
    }

    @Test
    void probabilityIsInTheUnitInterval() {
        List<Double> extreme = new ArrayList<>();
        for (int i = 0; i < scorer.getFeatureCount(); i++) extreme.add(1e6);
        MlScore scored = scorer.score(extreme).orElseThrow();
        assertTrue(scored.getProbability() >= 0.0 && scored.getProbability() <= 1.0);
        assertTrue(Double.isFinite(scored.getProbability()));
    }

    @Test
    void wrongVectorLengthIsRefusedRatherThanPadded() {
        assertTrue(scorer.score(Arrays.asList(0.0, 1.0)).isEmpty(),
                "a feature-contract mismatch must be visible, not silently padded");
        assertTrue(scorer.score(null).isEmpty());
    }

    @Test
    void sigmoidIsStableAtExtremes() {
        assertEquals(0.0, LogisticModelScorer.sigmoid(-1000.0), 0.0);
        assertEquals(1.0, LogisticModelScorer.sigmoid(1000.0), 0.0);
        assertEquals(0.5, LogisticModelScorer.sigmoid(0.0), 1e-12);
    }

    private static List<FraudRule> freshRules() {
        // Fresh instances per service: the stateful rules keep windows in memory.
        return Arrays.asList(new VelocityRule(), new EnumerationAttackRule(),
                new AmountThresholdRule(), new GeographicAnomalyRule(),
                new NewDeviceRule(), new NightOwlRule());
    }

    @Test
    void shadowModeRecordsTheScoreWithoutChangingTheDecision() {
        // Two independent engines score the SAME transaction: one with the
        // model attached, one without. The property under test is the whole
        // point of shadow mode — the model's presence must not move the score.
        FraudScoringService withModel = new FraudScoringService(freshRules(), scorer);
        FraudScoringService withoutModel = new FraudScoringService(freshRules());

        List<Double> features = new ArrayList<>();
        for (int i = 0; i < scorer.getFeatureCount(); i++) features.add(0.0);
        features.set(0, Math.log1p(2_500_000));

        TransactionRequest txn = new TransactionRequest(
                "txn-shadow-1", "USER_1", "MERCHANT_1", 2_500_000.0, "INR", Instant.now(),
                "device-1", Map.of("city", "Mumbai", "lat", 19.07, "lng", 72.87),
                List.of(), features);

        FraudResult withMl = withModel.score(txn);
        FraudResult rulesOnly = withoutModel.score(txn);

        assertEquals(rulesOnly.getStatus(), withMl.getStatus(),
                "shadow mode must not change the rules' decision");
        assertEquals(rulesOnly.getScore(), withMl.getScore(),
                "shadow mode must not change the rules' score");
        assertEquals(rulesOnly.getRulesTriggered().size(), withMl.getRulesTriggered().size());

        // ...and the model's opinion IS recorded, flagged as shadow evidence.
        assertEquals("model", withMl.getMlEngine());
        assertNotNull(withMl.getMlProbability());
        assertNotNull(withMl.getMlContributions());
        assertFalse(withMl.getMlContributions().isEmpty());

        // A 2.5M transaction at least fires the amount rule and lands in review.
        assertEquals("review", withMl.getStatus());
    }

    @Test
    void backtestScoringCarriesNoModelButSaysSo() {
        // The constructor used by BacktestService passes no scorer: the tasting
        // room evaluates RULE changes, so the ML layer is explicitly absent —
        // and it reports that rather than pretending.
        FraudScoringService backtest = new FraudScoringService(
                Arrays.asList(new VelocityRule(), new AmountThresholdRule()));
        TransactionRequest txn = new TransactionRequest(
                "t", "u", "m", 100.0, "INR", Instant.now(), "d", Map.of(), List.of(), null);
        FraudResult result = backtest.score(txn);
        assertEquals("fallback", result.getMlEngine());
        assertNull(result.getMlProbability());
    }
}
