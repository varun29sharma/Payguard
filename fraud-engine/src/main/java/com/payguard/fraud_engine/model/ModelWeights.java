package com.payguard.fraud_engine.model;

import java.util.List;
import java.util.Map;

/**
 * The trained logistic-regression artefact, deserialised from
 * {@code src/main/resources/model-v1.json} (produced by {@code ml/train_logistic.py}).
 *
 * Coefficients are stored on the <em>original</em> feature scale, so scoring is
 * literally {@code sigmoid(w . x + b)} — no standardisation constants travel at
 * runtime. Feature order is positional and must match the exported list; the
 * scorer validates the length rather than trusting it.
 *
 * Plain-Java DTO (no Lombok), matching the rest of the model package so the
 * build works on any JDK without annotation processing.
 */
public class ModelWeights {
    private String version = "1";
    private List<String> features;
    private List<Double> weights;
    private double intercept;
    private String solver;
    private int iterations;
    private boolean converged;
    private Map<String, Object> metadata;
    /** {"method": "platt"|"isotonic"|"none", ...} — see LogisticModelScorer. */
    private Map<String, Object> calibration;

    public ModelWeights() {
    }

    public String getVersion() { return version; }
    public void setVersion(String version) { this.version = version; }

    public List<String> getFeatures() { return features; }
    public void setFeatures(List<String> features) { this.features = features; }

    public List<Double> getWeights() { return weights; }
    public void setWeights(List<Double> weights) { this.weights = weights; }

    public double getIntercept() { return intercept; }
    public void setIntercept(double intercept) { this.intercept = intercept; }

    public String getSolver() { return solver; }
    public void setSolver(String solver) { this.solver = solver; }

    public int getIterations() { return iterations; }
    public void setIterations(int iterations) { this.iterations = iterations; }

    public boolean isConverged() { return converged; }
    public void setConverged(boolean converged) { this.converged = converged; }

    public Map<String, Object> getMetadata() { return metadata; }
    public void setMetadata(Map<String, Object> metadata) { this.metadata = metadata; }

    public Map<String, Object> getCalibration() { return calibration; }
    public void setCalibration(Map<String, Object> calibration) { this.calibration = calibration; }

    public int featureCount() {
        return weights == null ? 0 : weights.size();
    }

    /** True when the artefact is structurally usable for scoring. */
    public boolean isUsable() {
        return weights != null && features != null && !weights.isEmpty()
                && weights.size() == features.size();
    }
}
