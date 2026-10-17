package com.payguard.fraud_engine.model;

import java.util.List;

/**
 * The model's opinion on one transaction, ready to be attached to a
 * {@link FraudResult} in shadow mode.
 *
 * {@code probability} is <em>calibrated</em>: it is the number that actually
 * means "of transactions scored like this, this fraction were fraud". The
 * product promise is that every decision comes with reasons; a linear model
 * keeps that promise for free, because each feature's contribution
 * {@code w_i * x_i} is exact rather than an approximation, so
 * {@code contributions} is the explanation, not a post-hoc guess.
 */
public class MlScore {
    private String version;
    private double rawProbability;
    private double probability;
    private String engine; // "model" | "fallback"
    private List<FraudResult.MlContribution> contributions;

    public MlScore() {
    }

    public MlScore(String version, double rawProbability, double probability, String engine,
                   List<FraudResult.MlContribution> contributions) {
        this.version = version;
        this.rawProbability = rawProbability;
        this.probability = probability;
        this.engine = engine;
        this.contributions = contributions;
    }

    public String getVersion() { return version; }
    public void setVersion(String version) { this.version = version; }

    public double getRawProbability() { return rawProbability; }
    public void setRawProbability(double rawProbability) { this.rawProbability = rawProbability; }

    public double getProbability() { return probability; }
    public void setProbability(double probability) { this.probability = probability; }

    public String getEngine() { return engine; }
    public void setEngine(String engine) { this.engine = engine; }

    public List<FraudResult.MlContribution> getContributions() { return contributions; }
    public void setContributions(List<FraudResult.MlContribution> contributions) {
        this.contributions = contributions;
    }
}
