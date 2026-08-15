package com.payguard.fraud_engine.model;

import com.fasterxml.jackson.annotation.JsonAlias;
import com.fasterxml.jackson.annotation.JsonFormat;
import com.fasterxml.jackson.annotation.JsonProperty;

import java.time.Instant;
import java.util.List;
import java.util.Map;

/**
 * Plain-Java DTO (no Lombok) so the build works on any JDK without
 * annotation-processing constraints. Fields mirror what the Node.js server
 * sends to /api/fraud/score.
 */
public class TransactionRequest {
    private String transactionId;
    private String userId;
    private String merchantId;
    private double amount;
    private String currency;
    // @JsonAlias("timestamp") so the all-lowercase key sent by the Node.js
    // client maps onto this field as well as "timeStamp".
    @JsonProperty("timeStamp")
    @JsonAlias("timestamp")
    @JsonFormat(shape = JsonFormat.Shape.STRING, pattern = "yyyy-MM-dd'T'HH:mm:ss.SSSX", timezone = "UTC")
    private Instant timeStamp;
    private String deviceId;
    private Map<String, Object> location; // {city, lat, lng}
    // Optional per-request rule configuration (see RuleConfig). When absent,
    // every rule runs with its built-in defaults.
    private List<RuleConfig> rules;

    public TransactionRequest() {
    }

    public TransactionRequest(String transactionId, String userId, String merchantId, double amount,
                              String currency, Instant timeStamp, String deviceId, Map<String, Object> location,
                              List<RuleConfig> rules) {
        this.transactionId = transactionId;
        this.userId = userId;
        this.merchantId = merchantId;
        this.amount = amount;
        this.currency = currency;
        this.timeStamp = timeStamp;
        this.deviceId = deviceId;
        this.location = location;
        this.rules = rules;
    }

    public String getTransactionId() { return transactionId; }
    public void setTransactionId(String transactionId) { this.transactionId = transactionId; }

    public String getUserId() { return userId; }
    public void setUserId(String userId) { this.userId = userId; }

    public String getMerchantId() { return merchantId; }
    public void setMerchantId(String merchantId) { this.merchantId = merchantId; }

    public double getAmount() { return amount; }
    public void setAmount(double amount) { this.amount = amount; }

    public String getCurrency() { return currency; }
    public void setCurrency(String currency) { this.currency = currency; }

    public Instant getTimeStamp() { return timeStamp; }
    public void setTimeStamp(Instant timeStamp) { this.timeStamp = timeStamp; }

    public String getDeviceId() { return deviceId; }
    public void setDeviceId(String deviceId) { this.deviceId = deviceId; }

    public Map<String, Object> getLocation() { return location; }
    public void setLocation(Map<String, Object> location) { this.location = location; }

    public List<RuleConfig> getRules() { return rules; }
    public void setRules(List<RuleConfig> rules) { this.rules = rules; }
}
