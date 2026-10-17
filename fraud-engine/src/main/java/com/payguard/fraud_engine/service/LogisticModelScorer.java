package com.payguard.fraud_engine.service;

import com.payguard.fraud_engine.model.FraudResult;
import com.payguard.fraud_engine.model.MlScore;
import com.payguard.fraud_engine.model.ModelWeights;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Service;
import tools.jackson.databind.ObjectMapper;

import java.io.InputStream;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Scores a transaction with the trained logistic-regression model — in
 * <strong>shadow mode</strong>.
 *
 * The design call that makes Phase 1 cheap: a logistic regression <em>is</em> a
 * vector of numbers, so it needs no Python service to run. The artefact is a
 * JSON file on the classpath, the scorer is fifty lines, and it lives inside
 * the Java engine that already has the transaction and the timing budget. No
 * new infrastructure, no feature-parity drift from a second serving path.
 *
 * Everything here is defensive on purpose. A model that cannot load must
 * degrade to "not available" and <em>say so</em> — mirroring the engine's
 * existing {@code scoringEngine: 'fallback'} honesty — rather than failing the
 * transaction or silently returning a score of zero. Nothing in this class can
 * change a transaction's outcome: the rules still decide.
 */
@Service
public class LogisticModelScorer {

    private static final Logger log = LoggerFactory.getLogger(LogisticModelScorer.class);

    /** How many per-feature contributions to return. Enough to explain, few
     *  enough to render, and small enough to keep the scoring payload light. */
    private static final int TOP_CONTRIBUTIONS = 5;

    private final ModelWeights model;
    private final boolean available;
    private final String unavailableReason;
    private final double[] weights;
    private final double intercept;
    private final int featureCount;

    public LogisticModelScorer() {
        ModelWeights loaded = null;
        String reason = null;
        double[] w = null;
        double b = 0.0;
        int count = 0;
        try {
            ClassPathResource resource = new ClassPathResource("model-v1.json");
            if (!resource.exists()) {
                reason = "model-v1.json not on the classpath";
            } else {
                try (InputStream in = resource.getInputStream()) {
                    loaded = new ObjectMapper().readValue(in, ModelWeights.class);
                }
                if (loaded == null || !loaded.isUsable()) {
                    reason = "model artefact is incomplete (weights/features mismatch)";
                    loaded = null;
                } else {
                    count = loaded.featureCount();
                    w = new double[count];
                    for (int i = 0; i < count; i++) w[i] = loaded.getWeights().get(i);
                    b = loaded.getIntercept();
                }
            }
        } catch (Exception e) {
            reason = "failed to load model: " + e.getMessage();
            loaded = null;
        }
        this.model = loaded;
        this.available = loaded != null;
        this.unavailableReason = reason;
        this.weights = w;
        this.intercept = b;
        this.featureCount = count;
        if (available) {
            log.info("ML shadow model v{} loaded: {} features, solver {}, converged={}",
                    model.getVersion(), featureCount, model.getSolver(), model.isConverged());
        } else {
            log.warn("ML shadow model unavailable ({}). Transactions will report mlEngine=fallback; "
                    + "the rules are unaffected.", reason);
        }
    }

    public boolean isAvailable() {
        return available;
    }

    public String getUnavailableReason() {
        return unavailableReason;
    }

    public String getVersion() {
        return available ? model.getVersion() : null;
    }

    public int getFeatureCount() {
        return featureCount;
    }

    /**
     * Scores one feature vector.
     *
     * Returns {@link Optional#empty()} when the model is unavailable or the
     * vector length does not match the artefact — a mismatch means the caller
     * and the model disagree about the feature contract, which must be visible
     * rather than silently padded.
     */
    public Optional<MlScore> score(List<Double> features) {
        if (!available) return Optional.empty();
        if (features == null || features.size() != featureCount) {
            log.warn("ML feature vector length {} does not match model's {} — skipping score",
                    features == null ? -1 : features.size(), featureCount);
            return Optional.empty();
        }

        double linear = intercept;
        List<FraudResult.MlContribution> contributions = new ArrayList<>(featureCount);
        for (int i = 0; i < featureCount; i++) {
            double x = features.get(i);
            if (Double.isNaN(x) || Double.isInfinite(x)) x = 0.0;
            double term = weights[i] * x;
            linear += term;
            contributions.add(new FraudResult.MlContribution(
                    model.getFeatures().get(i), x, weights[i], term));
        }

        double raw = sigmoid(linear);
        double calibrated = calibrate(raw);
        contributions.sort(Comparator.comparingDouble(
                (FraudResult.MlContribution c) -> Math.abs(c.getContribution())).reversed());
        if (contributions.size() > TOP_CONTRIBUTIONS) {
            contributions = new ArrayList<>(contributions.subList(0, TOP_CONTRIBUTIONS));
        }
        return Optional.of(new MlScore(model.getVersion(), raw, calibrated, "model", contributions));
    }

    private double calibrate(double raw) {
        Map<String, Object> calibration = model.getCalibration();
        if (calibration == null) return raw;
        String method = String.valueOf(calibration.getOrDefault("method", "none"));
        if ("platt".equals(method)) {
            // Platt is two numbers in log-odds space, so it inlines cleanly.
            double slope = num(calibration.get("slope"), 1.0);
            double offset = num(calibration.get("intercept"), 0.0);
            return sigmoid(slope * logit(raw) + offset);
        }
        if ("isotonic".equals(method)) {
            double[] xs = toArray(calibration.get("x"));
            double[] ys = toArray(calibration.get("y"));
            return interpolate(raw, xs, ys);
        }
        return raw;
    }

    /**
     * Numerically stable sigmoid, same branch as the Python implementation and
     * public so the parity test can pin its behaviour at the extremes.
     */
    public static double sigmoid(double z) {
        if (z >= 0) {
            return 1.0 / (1.0 + Math.exp(-z));
        }
        double ez = Math.exp(z);
        return ez / (1.0 + ez);
    }

    private static double logit(double p) {
        double clipped = Math.min(Math.max(p, 1e-6), 1 - 1e-6);
        return Math.log(clipped / (1 - clipped));
    }

    private static double interpolate(double x, double[] xs, double[] ys) {
        if (xs.length == 0) return x;
        if (xs.length == 1) return ys[0];
        if (x <= xs[0]) return ys[0];
        if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
        int hi = 1;
        while (hi < xs.length && xs[hi] < x) hi++;
        int lo = hi - 1;
        double span = xs[hi] - xs[lo];
        if (span <= 0) return ys[hi];
        double t = (x - xs[lo]) / span;
        return ys[lo] + t * (ys[hi] - ys[lo]);
    }

    private static double num(Object value, double fallback) {
        if (value instanceof Number n) return n.doubleValue();
        if (value instanceof String s) {
            try { return Double.parseDouble(s); } catch (NumberFormatException e) { return fallback; }
        }
        return fallback;
    }

    @SuppressWarnings("unchecked")
    private static double[] toArray(Object value) {
        if (!(value instanceof List<?> list)) return new double[0];
        double[] out = new double[list.size()];
        for (int i = 0; i < list.size(); i++) out[i] = num(list.get(i), 0.0);
        return out;
    }
}
