"""replay.py — drive a labelled dataset through PayGuard's own ingest + dispute APIs.

The elegant part of Phase 0: there is no new service and no new endpoint. A
labelled dataset is replayed through ``POST /api/transactions`` (the API-key
machine-ingest path, which already exists) and the labels are fed back as
chargebacks via ``POST /api/disputes`` — exactly how ground truth arrives in a
real payments system. ``disputeService`` then sets ``isConfirmedFraud``.

Two things make the result trustworthy:

1. **Chronological order.** The rules hold sliding-window state; replaying out
   of order silently corrupts velocity / enumeration / geo.
2. **Real timestamps.** The historical timestamp must survive the ingest, or
   every interval collapses to "now" and four of six rules fire on everything.
   The server-side prerequisite for this is the timestamp whitelist in
   ``transactionService.js``; this module *verifies* it round-trips rather than
   assuming it.

``dry_run`` writes bodies to JSONL instead of POSTing. That is how the pipeline
is tested in CI without a running three-service stack — and the report makes
clear that a dry run validates the *mapping*, not the server.
"""

from __future__ import annotations

import json
import os
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

from .schema import CanonicalTransaction

#: Dispute reason that PayGuard's disputeService treats as confirmed fraud.
FRAUD_DISPUTE_REASON = "unauthorized"


@dataclass
class ReplayOutcome:
    """Per-transaction record of what happened during a replay."""

    source_transaction_id: str
    payguard_transaction_id: Optional[str]
    source_timestamp: datetime
    stored_timestamp: Optional[datetime]
    status_code: Optional[int]
    fraud_status: Optional[str]
    fraud_score: Optional[int]
    rules_triggered: List[str] = field(default_factory=list)
    is_fraud_label: bool = False
    dispute_posted: bool = False
    error: Optional[str] = None

    @property
    def timestamp_delta_ms(self) -> Optional[float]:
        if self.stored_timestamp is None:
            return None
        return (self.stored_timestamp - self.source_timestamp).total_seconds() * 1000.0


@dataclass
class ReplayReport:
    """Aggregate result of a replay, plus the evidence the phase's
    verification checkbox asks for."""

    outcomes: List[ReplayOutcome] = field(default_factory=list)
    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None
    dry_run: bool = False

    @property
    def posted(self) -> int:
        return sum(1 for o in self.outcomes if o.status_code in (200, 201))

    @property
    def failed(self) -> int:
        return sum(1 for o in self.outcomes if o.error or (o.status_code or 500) >= 400)

    @property
    def disputes_posted(self) -> int:
        return sum(1 for o in self.outcomes if o.dispute_posted)

    @property
    def max_timestamp_delta_ms(self) -> Optional[float]:
        deltas = [abs(o.timestamp_delta_ms) for o in self.outcomes
                  if o.timestamp_delta_ms is not None]
        return max(deltas) if deltas else None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "dry_run": self.dry_run,
            "posted": self.posted,
            "failed": self.failed,
            "disputes_posted": self.disputes_posted,
            "max_timestamp_delta_ms": self.max_timestamp_delta_ms,
            "started_at": str(self.started_at),
            "finished_at": str(self.finished_at),
        }


# --------------------------------------------------------------------------
# HTTP client
# --------------------------------------------------------------------------

class ReplayClient:
    """Thin wrapper over the two PayGuard endpoints a replay needs.

    Uses ``x-api-key`` (the machine-ingest path) rather than a JWT, which is
    also what makes historical timestamps acceptable server-side.
    """

    def __init__(self, base_url: str = "http://localhost:3000",
                 api_key: Optional[str] = None, timeout: float = 10.0):
        import requests  # local import so schema/metrics stay dependency-light

        self.base_url = base_url.rstrip("/")
        self.api_key = api_key or os.environ.get("PAYGUID_API_KEY")
        if not self.api_key and api_key is not None:
            raise ValueError("api_key must be non-empty")
        self.timeout = timeout
        self._session = requests.Session()
        if self.api_key:
            self._session.headers["x-api-key"] = self.api_key

    def post_transaction(self, body: Dict[str, Any]) -> Tuple[int, Dict[str, Any]]:
        resp = self._session.post(
            "%s/api/transactions" % self.base_url, json=body, timeout=self.timeout
        )
        try:
            payload = resp.json()
        except ValueError:
            payload = {"raw": resp.text}
        return resp.status_code, payload

    def post_dispute(self, transaction_id: str, reason: str = FRAUD_DISPUTE_REASON,
                     status: str = "lost", notes: Optional[str] = None
                     ) -> Tuple[int, Dict[str, Any]]:
        body = {"transactionId": transaction_id, "reason": reason, "status": status}
        if notes:
            body["notes"] = notes
        resp = self._session.post(
            "%s/api/disputes" % self.base_url, json=body, timeout=self.timeout
        )
        try:
            payload = resp.json()
        except ValueError:
            payload = {"raw": resp.text}
        return resp.status_code, payload

    def get_json(self, path: str) -> Tuple[int, Dict[str, Any]]:
        resp = self._session.get("%s%s" % (self.base_url, path), timeout=self.timeout)
        try:
            return resp.status_code, resp.json()
        except ValueError:
            return resp.status_code, {"raw": resp.text}

    def get_detection_rates(self) -> Dict[str, Any]:
        status, payload = self.get_json("/api/disputes/detection")
        if status >= 400:
            raise RuntimeError("detection endpoint returned %s: %s" % (status, payload))
        return payload


# --------------------------------------------------------------------------
# Replay
# --------------------------------------------------------------------------

def _extract_transaction(payload: Dict[str, Any]) -> Dict[str, Any]:
    data = payload.get("data")
    if isinstance(data, dict):
        return data
    return {}


def _parse_dt(value: Any) -> Optional[datetime]:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def replay_transactions(
    transactions: Sequence[CanonicalTransaction],
    client: Optional[ReplayClient] = None,
    *,
    limit: Optional[int] = None,
    dispute_frauds: bool = True,
    dry_run_path: Optional[str] = None,
    sleep_ms: float = 0.0,
    progress_every: int = 200,
    log=print,
) -> ReplayReport:
    """Replay transactions chronologically, then feed fraud labels back as disputes.

    Parameters
    ----------
    transactions
        Already-mapped canonical transactions. They are re-sorted here — never
        trust the caller's order, because the rules cannot forgive it.
    client
        ``ReplayClient``; required unless ``dry_run_path`` is set.
    limit
        Replay only the earliest N (a contiguous slice).
    dispute_frauds
        POST a dispute for every ``is_fraud`` row. This is what populates
        ``isConfirmedFraud`` from external truth.
    dry_run_path
        If set, write ``{"body": ..., "is_fraud": ...}`` JSONL here and simulate
        the responses locally. No network calls are made.
    """
    started = datetime.now(timezone.utc)
    ordered = sorted(transactions, key=lambda t: (t.timestamp, t.transactionId))
    if limit is not None:
        ordered = ordered[:limit]

    report = ReplayReport(started_at=started, dry_run=bool(dry_run_path))
    sink = open(dry_run_path, "w", encoding="utf-8") if dry_run_path else None
    if sink is None and client is None:
        raise ValueError("replay_transactions needs either a client or a dry_run_path")

    try:
        for i, txn in enumerate(ordered):
            body = txn.to_payguard_body()
            outcome = ReplayOutcome(
                source_transaction_id=txn.transactionId,
                payguard_transaction_id=None,
                source_timestamp=txn.timestamp,
                stored_timestamp=None,
                status_code=None,
                fraud_status=None,
                fraud_score=None,
                is_fraud_label=txn.is_fraud,
            )
            try:
                if sink is not None:
                    sink.write(json.dumps({"body": body, "is_fraud": txn.is_fraud}) + "\n")
                    # Simulate a server that stores the timestamp it was given.
                    stored = {"transactionId": txn.transactionId, "timestamp": body["timestamp"],
                              "fraudStatus": "clear", "fraudScore": 0, "rulesTriggered": []}
                    outcome.status_code = 201
                    outcome.payguard_transaction_id = txn.transactionId
                    outcome.stored_timestamp = txn.timestamp
                    outcome.fraud_status = "clear"
                    outcome.fraud_score = 0
                else:
                    status, payload = client.post_transaction(body)
                    outcome.status_code = status
                    stored = _extract_transaction(payload)
                    outcome.payguard_transaction_id = stored.get("transactionId")
                    outcome.stored_timestamp = _parse_dt(stored.get("timestamp"))
                    outcome.fraud_status = stored.get("fraudStatus")
                    score = stored.get("fraudScore")
                    outcome.fraud_score = int(score) if score is not None else None
                    outcome.rules_triggered = [
                        r.get("ruleName") for r in (stored.get("rulesTriggered") or [])
                        if isinstance(r, dict)
                    ]
                    if status >= 400 and status != 403:
                        outcome.error = json.dumps(payload)[:300]
            except Exception as exc:  # network/transport error — record and continue
                outcome.error = "%s: %s" % (type(exc).__name__, exc)

            # Ground truth comes from the dataset, never from rulesTriggered.
            if (dispute_frauds and txn.is_fraud and outcome.payguard_transaction_id
                    and outcome.error is None):
                try:
                    if sink is not None:
                        outcome.dispute_posted = True
                    else:
                        did, _ = client.post_dispute(outcome.payguard_transaction_id)
                        outcome.dispute_posted = did in (200, 201)
                except Exception as exc:
                    outcome.error = (outcome.error or "") + " dispute:%s" % exc

            report.outcomes.append(outcome)
            if progress_every and (i + 1) % progress_every == 0:
                log("  replayed %d/%d (flagged=%d disputes=%d)" % (
                    i + 1, len(ordered),
                    sum(1 for o in report.outcomes if o.fraud_status not in (None, "clear")),
                    report.disputes_posted,
                ))
            if sleep_ms and sink is None:
                time.sleep(sleep_ms / 1000.0)
    finally:
        if sink is not None:
            sink.close()
        report.finished_at = datetime.now(timezone.utc)
    return report


# --------------------------------------------------------------------------
# Verification (the phase's "Done when" checks)
# --------------------------------------------------------------------------

def _stamp_of(item: Any) -> datetime:
    """Accept either a ``CanonicalTransaction`` (``.timestamp``) or a
    ``ReplayOutcome`` (``.source_timestamp``)."""
    for attr in ("timestamp", "source_timestamp"):
        value = getattr(item, attr, None)
        if isinstance(value, datetime):
            return value
    raise TypeError("object has no timestamp to order by: %r" % (item,))


def assert_chronological(transactions: Sequence[Any]) -> None:
    """Raise if the sequence is not non-decreasing in time."""
    stamps = [_stamp_of(t) for t in transactions]
    if stamps != sorted(stamps):
        raise AssertionError("replay is not chronological — sliding-window rules would corrupt")


def verify_timestamp_roundtrip(report: ReplayReport, tolerance_ms: float = 1500.0) -> None:
    """Assert the timestamp we sent is the timestamp PayGuard stored.

    This is the check that would have caught the original bug (ingest
    hardcoding ``new Date()``). Without it the whole phase produces plausible
    garbage.
    """
    deltas = [abs(o.timestamp_delta_ms) for o in report.outcomes
              if o.timestamp_delta_ms is not None]
    if not deltas:
        raise AssertionError("no stored timestamps to verify — did every request fail?")
    worst = max(deltas)
    if worst > tolerance_ms:
        raise AssertionError(
            "timestamp round-trip failed: worst delta %.0fms > %.0fms — the ingest "
            "is very likely overwriting the caller's timestamp" % (worst, tolerance_ms)
        )


def assert_no_label_from_rules(outcomes: Iterable[ReplayOutcome]) -> None:
    """Assert no labelled-fraud row got its truth from ``rulesTriggered``.

    Flaw 2 in one assertion. It is a weak test (it cannot prove independence
    from rules in general) but it catches the specific mistake of deriving the
    label from what the engine decided, which is the mistake that matters.
    """
    for o in outcomes:
        if o.is_fraud_label and o.rules_triggered and not o.dispute_posted:
            raise AssertionError(
                "labelled-fraud row %s has rules_triggered=%s but no dispute — the "
                "label looks rule-derived" % (o.source_transaction_id, o.rules_triggered)
            )


def load_dry_run(path: str) -> List[Dict[str, Any]]:
    """Read a JSONL produced by a dry run (used by the tests)."""
    rows = []
    with open(path, "r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows
