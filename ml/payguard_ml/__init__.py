"""PayGuard ML — the data + modelling layer for the AIML roadmap.

This package exists so that the fraud model can be built, evaluated and
explained against *externally labelled* data instead of the simulator
(cf. Flaw 2 in ROADMAP-AIML.md). Nothing here talks to MongoDB directly:
every path into the product goes through PayGuard's own ingest and dispute
APIs, exactly as a real integration would.

Modules
-------
schema      external dataset row  ->  PayGuard ``POST /api/transactions`` body
dataset     load Sparkov / PaySim / synthetic frames into a canonical shape
replay      drive the ingest + dispute APIs chronologically
metrics     confusion matrix, PR/ROC, calibration — implemented from scratch
features    point-in-time (as-of) feature engineering with no future leakage
logistic    logistic regression from scratch (batch GD + Newton/IRLS)
calibration Platt scaling + isotonic regression + reliability diagrams
trees       ID3 decision tree from scratch
compare     seven-model comparison on one chronological split
rulelogic   resolution-refutation checks over the rule configuration
"""

__all__ = [
    "schema",
    "dataset",
    "replay",
    "metrics",
    "features",
    "logistic",
    "calibration",
    "trees",
    "compare",
    "rulelogic",
]

__version__ = "1.0.0"
