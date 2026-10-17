"""Tests for payguard_ml.schema — the dataset -> ingest mapping."""

from datetime import datetime, timezone

import pytest

from payguard_ml import schema


SPARKOV_ROW = {
    "trans_date_trans_time": "2020-06-21 12:14:25",
    "cc_num": "2291163933867244",
    "merchant": "fraud_Kirlin and Sons",
    "category": "personal_care",
    "amt": 25.19,
    "city": "Dallas",
    "state": "TX",
    "lat": 32.7767,
    "long": -96.7970,
    "city_pop": 1345000,
    "job": "engineer",
    "trans_num": "0d1e1f4e2f5b6c",
    "unix_time": 1371816865,
    "merch_lat": 33.2117,
    "merch_long": -95.9940,
    "is_fraud": 1,
}

PAYSIM_ROW = {
    "step": 1,
    "type": "TRANSFER",
    "amount": 181.0,
    "nameOrig": "C1305486145",
    "oldbalanceOrg": 181.0,
    "newbalanceOrig": 0.0,
    "nameDest": "C553264065",
    "oldbalanceDest": 0.0,
    "newbalanceDest": 0.0,
    "isFraud": 1,
    "isFlaggedFraud": 0,
}


class TestTimestamps:
    def test_parses_naive_sparkov_format_as_utc(self):
        ts = schema.parse_timestamp("2020-06-21 12:14:25")
        assert ts.tzinfo is not None
        assert ts == datetime(2020, 6, 21, 12, 14, 25, tzinfo=timezone.utc)

    def test_parses_iso_with_z(self):
        ts = schema.parse_timestamp("2020-06-21T12:14:25Z")
        assert ts == datetime(2020, 6, 21, 12, 14, 25, tzinfo=timezone.utc)

    def test_parses_epoch_seconds(self):
        ts = schema.parse_timestamp(0)
        assert ts == datetime(1970, 1, 1, tzinfo=timezone.utc)

    def test_passes_through_datetime(self):
        naive = datetime(2021, 1, 1, 6, 0, 0)
        assert schema.parse_timestamp(naive).tzinfo == timezone.utc

    def test_rejects_garbage(self):
        with pytest.raises(ValueError):
            schema.parse_timestamp("not-a-date")

    def test_rejects_missing(self):
        with pytest.raises(ValueError):
            schema.parse_timestamp(None)


class TestSparkovMapping:
    def test_core_fields(self):
        tx = schema.map_sparkov(SPARKOV_ROW)
        assert tx.userId == "cc_2291163933867244"
        assert tx.merchantId == "fraud_kirlin_and_sons"
        assert tx.amount == pytest.approx(25.19)
        assert tx.city == "Dallas"
        assert tx.lat == pytest.approx(32.7767)
        assert tx.is_fraud is True
        assert tx.transactionId == "0d1e1f4e2f5b6c"
        assert tx.source == "sparkov"

    def test_merchant_coordinates_kept_for_feature_engineering(self):
        tx = schema.map_sparkov(SPARKOV_ROW)
        assert tx.merchant_lat == pytest.approx(33.2117)
        assert tx.merchant_lng == pytest.approx(-95.9940)

    def test_device_absent_by_default(self):
        tx = schema.map_sparkov(SPARKOV_ROW)
        assert tx.deviceId is None
        assert tx.device_provenance == "absent"
        assert "deviceId" not in tx.to_payguard_body()

    def test_synthetic_device_mode_is_tagged(self):
        tx = schema.map_sparkov(SPARKOV_ROW, device_mode="synthetic")
        assert tx.deviceId is not None
        assert tx.device_provenance == "synthetic"

    def test_synthetic_device_is_deterministic(self):
        a = schema.map_sparkov(SPARKOV_ROW, device_mode="synthetic").deviceId
        b = schema.map_sparkov(SPARKOV_ROW, device_mode="synthetic").deviceId
        assert a == b

    def test_rejects_unknown_device_mode(self):
        with pytest.raises(ValueError):
            schema.map_sparkov(SPARKOV_ROW, device_mode="magic")


class TestPaySimMapping:
    def test_beneficiary_is_the_counterparty(self):
        tx = schema.map_paysim(PAYSIM_ROW)
        assert tx.userId == "C1305486145"
        assert tx.beneficiaryId == "C553264065"

    def test_step_becomes_hour_offset(self):
        tx = schema.map_paysim(PAYSIM_ROW)
        assert tx.timestamp == schema.PAYSIM_ORIGIN + schema.PAYSIM_STEP

    def test_transaction_id_is_deterministic(self):
        assert schema.map_paysim(PAYSIM_ROW).transactionId == \
            schema.map_paysim(dict(PAYSIM_ROW)).transactionId

    def test_balance_columns_preserved_as_extras(self):
        tx = schema.map_paysim(PAYSIM_ROW)
        assert tx.extra["paysim_type"] == "transfer"
        assert tx.extra["oldbalanceOrg"] == pytest.approx(181.0)


class TestBodyShape:
    def test_body_omits_absent_optional_fields(self):
        tx = schema.map_paysim(PAYSIM_ROW)
        body = tx.to_payguard_body()
        assert "deviceId" not in body
        assert "ipAddress" not in body
        assert body["beneficiaryId"] == "C553264065"

    def test_body_timestamp_is_iso_utc(self):
        body = schema.map_sparkov(SPARKOV_ROW).to_payguard_body()
        assert body["timestamp"].endswith("+00:00")

    def test_map_rows_sorts_chronologically(self):
        rows = [
            dict(SPARKOV_ROW, trans_num="b", trans_date_trans_time="2020-06-22 10:00:00"),
            dict(SPARKOV_ROW, trans_num="a", trans_date_trans_time="2020-06-21 10:00:00"),
            dict(SPARKOV_ROW, trans_num="c", trans_date_trans_time="2020-06-23 10:00:00"),
        ]
        out = schema.map_rows(rows, kind="sparkov")
        assert [t.transactionId for t in out] == ["a", "b", "c"]

    def test_map_rows_rejects_unknown_kind(self):
        with pytest.raises(ValueError):
            schema.map_rows([], kind="obscure")
