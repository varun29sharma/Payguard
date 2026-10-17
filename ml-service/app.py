"""app.py — the ML sidecar (FastAPI, port 8000).

Why a fourth service exists at all: a boosted forest does not export to a JSON
of numbers, so `LogisticModelScorer.java`'s trick — ship the artefact, run the
dot product in Java — does not generalise. The winner needs a process.

The contract is deliberately the same shape as the Java engine's, because a
reader of this codebase should see one consistent idea applied twice:

* **Features are NOT computed here.** The Node server computes them once and
  sends the vector (see `server/services/featureService.js`). A sidecar that
  recomputed features would be a second implementation of the contract and
  therefore a second chance to drift.
* **Every response says how it was produced** (`engine`: "model" | "fallback"),
  mirroring `scoringEngine` and `mlEngine` elsewhere.
* **A missing artefact is a 503 with a plain reason, not a guessed score.** The
  caller records `mlEngine='fallback'` and carries on. Nothing here can block an
  authorisation.

Run:

    cd ml-service
    python3 -m venv --system-site-packages .venv
    ./.venv/bin/pip install -r requirements.txt
    ML_MODEL_PATH=../ml/artifacts/gbm-v1.txt ./.venv/bin/uvicorn app:app --port 8000
"""

from __future__ import annotations

import json
import os
import sys
import time
from typing import Any, Dict, List, Optional

import numpy as np
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

# The `ml` package is importable so the rule-consistency checker can be reused
# verbatim instead of being reimplemented in another language (see /rules/consistency).
ML_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "ml"))
if ML_DIR not in sys.path:
    sys.path.insert(0, ML_DIR)

MODEL_VERSION = "gbm-v1"
DEFAULT_MODEL_PATH = os.path.join(os.path.dirname(__file__), "..", "ml", "artifacts", "gbm-v1.txt")
DEFAULT_META_PATH = DEFAULT_MODEL_PATH + ".meta.json"
TOP_CONTRIBUTIONS = 5

app = FastAPI(title="PayGuard ML sidecar", version="1.0.0")


class ScoreRequest(BaseModel):
    """The Node server sends the feature vector it already computed."""

    transactionId: Optional[str] = None
    features: List[float] = Field(..., min_length=1)
    explain: bool = True


class BatchScoreRequest(BaseModel):
    items: List[ScoreRequest]


class RuleCheckRequest(BaseModel):
    """A rule set to analyse. Omit `rules` to check the engine's defaults."""

    rules: Optional[List[Dict[str, Any]]] = None


class Scorer:
    """Holds the loaded booster + explainer, and degrades explicitly."""

    def __init__(self, model_path: str, meta_path: str):
        self.ready = False
        self.reason = "not loaded"
        self.version = MODEL_VERSION
        self.feature_names: List[str] = []
        self.model = None
        self.explainer = None
        self.load_seconds = 0.0
        self.load(model_path, meta_path)

    def load(self, model_path: str, meta_path: str) -> None:
        started = time.perf_counter()
        try:
            if not os.path.exists(model_path):
                self.reason = ("model artefact not found at %s — train it with "
                               "`cd ml && ./.venv/bin/python compare_models.py`"
                               % os.path.abspath(model_path))
                return
            import lightgbm as lgb

            booster = lgb.Booster(model_file=model_path)
            self.feature_names = list(booster.feature_name())
            meta: Dict[str, Any] = {}
            if os.path.exists(meta_path):
                with open(meta_path, "r", encoding="utf-8") as fh:
                    meta = json.load(fh)
                self.feature_names = list(meta.get("features", self.feature_names))
                self.version = meta.get("version", MODEL_VERSION)
            self.model = booster
            try:
                import shap

                self.explainer = shap.TreeExplainer(booster)
            except Exception:
                self.explainer = None  # explanations degrade, scoring does not
            self.ready = True
            self.reason = None
        except Exception as exc:  # noqa: BLE001 - must never crash the app
            self.reason = "failed to load model: %s" % exc
        finally:
            self.load_seconds = time.perf_counter() - started

    def n_features(self) -> int:
        return len(self.feature_names)

    def score(self, features: List[float], explain: bool) -> Dict[str, Any]:
        vector = np.asarray(features, dtype=float).reshape(1, -1)
        probability = float(self.model.predict(vector)[0])
        body: Dict[str, Any] = {
            "probability": probability,
            "version": self.version,
            "engine": "model",
            "contributions": [],
        }
        if explain and self.explainer is not None:
            body["contributions"] = self._contributions(vector)
        return body

    def _contributions(self, vector: np.ndarray) -> List[Dict[str, Any]]:
        try:
            values = self.explainer.shap_values(vector, check_additivity=False)
        except TypeError:
            values = self.explainer.shap_values(vector)
        values = np.asarray(values)
        if values.ndim == 3:
            values = values[:, :, 1]
        row = values[0]
        order = np.argsort(-np.abs(row))[:TOP_CONTRIBUTIONS]
        return [
            {
                "feature": self.feature_names[i],
                "value": float(vector[0, i]),
                "contribution": float(row[i]),
                "weight": None,
            }
            for i in order
        ]


scorer = Scorer(os.environ.get("ML_MODEL_PATH", DEFAULT_MODEL_PATH),
                os.environ.get("ML_MODEL_META_PATH", DEFAULT_META_PATH))


@app.get("/health")
def health() -> Dict[str, Any]:
    """Readiness, stated plainly. `ready:false` is a supported state."""
    try:
        from payguard_ml.rulelogic import check_rule_configs  # noqa: F401

        rule_logic = True
    except Exception:  # noqa: BLE001
        rule_logic = False
    return {
        "ready": scorer.ready,
        "reason": scorer.reason,
        "version": scorer.version,
        "featureCount": scorer.n_features(),
        "explainable": scorer.explainer is not None,
        "loadSeconds": round(scorer.load_seconds, 3),
        "mode": "shadow",
        "ruleLogic": rule_logic,
    }


@app.post("/score")
def score(request: ScoreRequest):
    if not scorer.ready:
        # Honest 503: the caller records mlEngine='fallback'. Never invent a score.
        return JSONResponse(status_code=503, content={"engine": "fallback", "reason": scorer.reason})
    if len(request.features) != scorer.n_features():
        return JSONResponse(status_code=422, content={
            "engine": "fallback",
            "reason": "feature length %d does not match model's %d"
                      % (len(request.features), scorer.n_features()),
        })
    return scorer.score(request.features, request.explain)


@app.post("/rules/consistency")
def rules_consistency(request: RuleCheckRequest):
    """Static analysis of a rule set: dead windows, vacuous rules, subsumption.

    Deliberately **independent of the model**: this is logic about rule
    configuration, not prediction, so it answers even when no model artefact is
    loaded (which is why it does not check `scorer.ready`). A rule set with no
    possible firing transaction is a silent hole in the control layer, and no
    amount of UI polish fixes that — the operator has to be told.
    """
    try:
        from payguard_ml.rulelogic import check_rule_configs, DEFAULT_RULE_CONFIGS
    except Exception as exc:  # noqa: BLE001 - surface, never crash
        return JSONResponse(status_code=503, content={
            "available": False,
            "reason": "rule-consistency checker unavailable: %s" % exc,
        })

    started = time.perf_counter()
    result = check_rule_configs(request.rules or DEFAULT_RULE_CONFIGS)
    result["available"] = True
    result["checkSeconds"] = round(time.perf_counter() - started, 4)
    return result


@app.post("/score/batch")
def score_batch(request: BatchScoreRequest):
    if not scorer.ready:
        return JSONResponse(status_code=503, content={"engine": "fallback", "reason": scorer.reason})
    results = []
    for item in request.items:
        if len(item.features) != scorer.n_features():
            results.append({"transactionId": item.transactionId, "engine": "fallback",
                            "reason": "feature length mismatch"})
            continue
        body = scorer.score(item.features, item.explain)
        body["transactionId"] = item.transactionId
        results.append(body)
    return {"engine": "model", "version": scorer.version, "results": results}
