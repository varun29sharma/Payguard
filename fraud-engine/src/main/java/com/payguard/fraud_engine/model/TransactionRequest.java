package com.payguard.fraud_engine.model;

import com.fasterxml.jackson.annotation.JsonFormat;

import lombok.Data;
import lombok.NoArgsConstructor;
import lombok.AllArgsConstructor;
import java.time.Instant;
import java.util.*;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class TransactionRequest {
    private String transactionId;
    private String userId;
    private String merchantId;
    private double amount;
    private String currency;
    @JsonFormat(shape = JsonFormat.Shape.STRING, pattern = "yyyy-MM-dd'T'HH:mm:ss.SSSX", timezone = "UTC")
    private Instant timeStamp;
    private String deviceId;
    private Map<String,Object> location; //{city,lat,lng}

}
