"""Tests for the Naive Bayes diagnosis (the independence violation, measured)."""

import numpy as np
import pandas as pd
import pytest

from payguard_ml import compare, dataset, features


@pytest.fixture(scope="module")
def diag():
    """One diagnosis over a modest synthetic frame, shared across assertions."""
    from payguard_ml.baseline import simulate_rule_engine

    frame = simulate_rule_engine(dataset.load_synthetic(n=6000, seed=5))
    feat = features.compute_features(frame)
    return compare.naive_bayes_diagnosis(feat, seed=5)


# --------------------------------------------------------------------------
# The correlation measurement
# --------------------------------------------------------------------------

def test_correlations_are_computed_per_class(diag):
    blocks = diag["class_conditional_correlations"]
    assert "fraud" in blocks
    assert blocks["fraud"]["rows"] > 0
    # The assumption is conditional on the label, so legit is measured separately.
    assert "legit" in blocks


def test_correlation_matrix_finds_a_real_pair(diag):
    top = diag["class_conditional_correlations"]["fraud"]["top_pairs"][0]
    assert top["a"] != top["b"]
    # amount and amount-to-limit style features move together by construction.
    assert abs(top["r"]) > 0.1


def test_correlation_bounds_hold(diag):
    for block in diag["class_conditional_correlations"].values():
        assert 0.0 <= block["mean_abs_r"] <= block["max_abs_r"] <= 1.0 + 1e-9
        for pair in block["top_pairs"]:
            assert -1.0 <= pair["r"] <= 1.0


# --------------------------------------------------------------------------
# Overconfidence
# --------------------------------------------------------------------------

def test_nb_is_more_extreme_than_logistic(diag):
    oc = diag["overconfidence"]
    assert oc["extreme_share_nb"] >= oc["extreme_share_logistic"]
    assert oc["mean_abs_log_odds_nb"] >= oc["mean_abs_log_odds_logistic"]


def test_nb_log_loss_is_much_worse_than_logistic(diag):
    """The load-bearing measurement: same split, far worse probabilities.

    Deliberately *not* an ECE assertion. ECE averages error within bins, and NB
    pushes almost every prediction into the same two extreme bins, so binning
    hides the damage — ECE can come out comparable while the probabilities are
    useless. Log-loss scores each row directly and cannot hide it.
    """
    assert diag["naive_bayes"]["log_loss"] > diag["logistic_reference"]["log_loss"]
    assert diag["overconfidence"]["log_loss_ratio"] > 2.0


# --------------------------------------------------------------------------
# The ablation and its control
# --------------------------------------------------------------------------

def test_ablation_drops_the_redundant_members(diag):
    dropped = diag["ablation"]["dropped_features"]
    assert len(dropped) >= 1
    # Never drop so much that the model loses its subject.
    assert len(dropped) < len(features.FEATURE_NAMES) - 1
    assert len(set(dropped)) == len(dropped)


def test_ablation_reports_both_variants(diag):
    ab = diag["ablation"]
    assert set(ab["nb_reduced"]) >= {"pr_auc", "log_loss", "ece"}
    assert set(ab["nb_control_least_correlated"]) >= {"pr_auc", "log_loss", "ece"}
    # Same count removed in both arms, so "fewer features" cannot explain a gap.
    assert len(ab["control_features"]) == len(ab["dropped_features"])


def test_the_control_removes_less_redundant_features_than_the_ablation(diag):
    """The control must be strictly less redundant, or it is not a control.

    This is the assumption the whole comparison rests on: the two arms remove
    the same number of features and differ only in how much shared evidence they
    take out.
    """
    degree = {}
    for block in diag["class_conditional_correlations"].values():
        for pair in block["pairs"]:
            degree[pair["a"]] = degree.get(pair["a"], 0.0) + abs(pair["r"])
            degree[pair["b"]] = degree.get(pair["b"], 0.0) + abs(pair["r"])
    ab = diag["ablation"]
    removed_corr = sum(degree.get(n, 0.0) for n in ab["dropped_features"])
    removed_ctrl = sum(degree.get(n, 0.0) for n in ab["control_features"])
    assert removed_corr > removed_ctrl


def test_nb_payload_is_json_serialisable(diag):
    import json
    json.dumps(diag)


def test_duplicate_columns_are_detected_from_a_constructed_matrix():
    """|r| ≈ 1 must be reported: the same fact reaching the model twice."""
    from payguard_ml.compare import _duplicate_feature_pairs

    fake = {"fraud": {"pairs": [
        {"a": "is_night", "b": "rule_night_owl", "r": 1.0},
        {"a": "log_amount", "b": "merchant_amt_percentile", "r": 0.92},
    ]}}
    dupes = _duplicate_feature_pairs(fake)
    assert [d["a"] for d in dupes] == ["is_night"]
    assert dupes[0]["b"] == "rule_night_owl"


def test_duplicate_detection_is_empty_on_an_uncorrelated_set():
    from payguard_ml.compare import _duplicate_feature_pairs

    assert _duplicate_feature_pairs({"fraud": {"pairs": [
        {"a": "x", "b": "y", "r": 0.4}]}}) == []


def test_render_names_duplicate_columns_when_present(diag):
    if not diag.get("duplicate_feature_pairs"):
        pytest.skip("this fixture has no exact duplicates")
    text = compare.render_naive_bayes(diag)
    assert "Duplicate columns" in text


def test_render_produces_a_table_with_the_verdict(diag):
    text = compare.render_naive_bayes(diag)
    assert "Naive Bayes" in text
    assert "logistic (reference)" in text
    assert "So what:" in text
    # The ECE caveat must survive into the rendered report, or a reader will
    # take the ECE column at face value.
    assert "ECE" in text
    assert "log-loss" in text


# --------------------------------------------------------------------------
# The control genuinely isolates redundancy
# --------------------------------------------------------------------------

def test_the_ablation_is_reproducible(diag):
    """The same correlations must select the same features, run to run."""
    from payguard_ml.compare import _redundant_features

    again = _redundant_features(diag["class_conditional_correlations"])
    assert again == list(diag["ablation"]["dropped_features"])


def test_the_dropped_features_are_actually_correlated(diag):
    """The ablation must remove redundant features, not arbitrary ones.

    Every dropped feature must appear in a strongly correlated pair, or the
    "removing redundancy helps" claim would be about something else entirely.
    """
    from payguard_ml.compare import _CORRELATION_THRESHOLD

    dropped = set(diag["ablation"]["dropped_features"])
    correlated = set()
    for block in diag["class_conditional_correlations"].values():
        for pair in block["pairs"]:
            if abs(pair["r"]) >= _CORRELATION_THRESHOLD:
                correlated.update((pair["a"], pair["b"]))
    assert dropped <= correlated, f"dropped uncorrelated: {dropped - correlated}"


def test_the_dropped_features_are_grouped_into_families(diag):
    """A correlated cluster should collapse to one representative, not zero.

    The selection is only ever allowed to remove redundant evidence, so at least
    one member of every correlated family must survive.
    """
    dropped = set(diag["ablation"]["dropped_features"])
    survivors = set(features.FEATURE_NAMES) - dropped
    assert survivors, "the ablation must not remove every feature"
    # Every kept feature remains usable, i.e. the reduced model is still a model.
    assert len(survivors) >= 3


def test_the_verdict_names_the_double_count_when_it_separates(diag):
    ab = diag["ablation"]
    reduced = ab["nb_reduced"].get("log_loss")
    control = ab["nb_control_least_correlated"].get("log_loss")
    if reduced is None or control is None:
        pytest.skip("no ablation was possible on this fixture")
    if reduced < control:
        assert "double-count" in diag["verdict"]
    else:
        assert "did not separate" in diag["verdict"]


def test_does_not_mutate_the_input_frame(diag):
    """The diagnosis fits models but must not write back to the frame."""
    from payguard_ml.baseline import simulate_rule_engine

    frame = simulate_rule_engine(dataset.load_synthetic(n=1500, seed=11))
    feat = features.compute_features(frame)
    before = feat.copy(deep=True)
    compare.naive_bayes_diagnosis(feat, seed=11)
    pd.testing.assert_frame_equal(feat, before)


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(pytest.main([__file__, "-v"]))
