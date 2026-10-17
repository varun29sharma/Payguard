"""Tests for the rule-consistency checker (compact CNF + resolution refutation)."""

import pytest

from payguard_ml.rulelogic import (
    DEFAULT_RULE_CONFIGS,
    build_theory,
    check_rule_configs,
    encode_rule,
    firing_clauses,
    is_always_true,
    is_dead,
    resolution_refutation,
)


def _cfg(rule_name, parameters):
    return {"ruleName": rule_name, "enabled": True, "score": 50, "parameters": parameters}


# --------------------------------------------------------------------------
# The resolution engine itself
# --------------------------------------------------------------------------

def test_resolution_finds_a_plain_contradiction():
    unsat, _ = resolution_refutation([[("p", True)], [("p", False)]])
    assert unsat


def test_resolution_unit_propagation_chain():
    # p, p->q, q->r, not r  is unsatisfiable
    clauses = [
        [("p", True)],
        [("p", False), ("q", True)],
        [("q", False), ("r", True)],
        [("r", False)],
    ]
    unsat, steps = resolution_refutation(clauses)
    assert unsat
    assert steps >= 0


def test_resolution_leaves_satisfiable_sets_alone():
    clauses = [
        [("p", True), ("q", True)],
        [("p", False), ("q", True)],
    ]
    unsat, _ = resolution_refutation(clauses)
    assert not unsat


def test_resolution_detects_empty_clause_immediately():
    unsat, steps = resolution_refutation([[]])
    assert unsat and steps == 0


# --------------------------------------------------------------------------
# Encoding
# --------------------------------------------------------------------------

def test_amount_threshold_encodes_one_atom():
    firing = encode_rule(_cfg("AMOUNT_THRESHOLD_RULE", {"minAmount": 100000}))
    assert firing.conjuncts == [("amount>=100000", True)]


def test_night_owl_plain_reading_is_a_conjunction():
    firing = encode_rule(_cfg("NIGHT_OWL_RULE", {"startHour": 22, "endHour": 5}), wrap_windows=False)
    assert firing.conjuncts == [("hour>=22", True), ("hour<=5", True)]
    assert firing.disjunction is None


def test_night_owl_wrap_reading_is_a_disjunction():
    firing = encode_rule(_cfg("NIGHT_OWL_RULE", {"startHour": 22, "endHour": 5}), wrap_windows=True)
    assert firing.conjuncts == []
    assert firing.disjunction == [("hour>=22", True), ("hour<=5", True)]


def test_night_owl_zero_start_drops_the_vacuous_lower_bound():
    firing = encode_rule(_cfg("NIGHT_OWL_RULE", {"startHour": 0, "endHour": 5}), wrap_windows=False)
    assert firing.conjuncts == [("hour<=5", True)]
    assert firing.tautologies == [("hour>=0", True)]


def test_theory_carries_the_midnight_incompatibility():
    theory = build_theory([
        encode_rule(_cfg("NIGHT_OWL_RULE", {"startHour": 22, "endHour": 5}), wrap_windows=True),
    ])
    assert frozenset({("hour>=22", False), ("hour<=5", False)}) in set(theory)


# --------------------------------------------------------------------------
# The four checks
# --------------------------------------------------------------------------

def test_engine_defaults_are_healthy():
    result = check_rule_configs(DEFAULT_RULE_CONFIGS)
    assert result["healthy"] and result["errors"] == 0
    assert result["warnings"] == 0
    assert result["checkedRules"] == 6


def test_wrap_around_window_is_reported_as_an_error():
    configs = [dict(c) for c in DEFAULT_RULE_CONFIGS]
    for c in configs:
        if c["ruleName"] == "NIGHT_OWL_RULE":
            c["parameters"] = {"startHour": 22, "endHour": 5}
    result = check_rule_configs(configs)
    assert not result["healthy"] and result["errors"] == 1
    issue = result["issues"][0]
    assert issue["rule"] == "NIGHT_OWL_RULE"
    assert issue["kind"] == "wrap_around"


def test_wrap_around_is_distinguished_from_a_plain_dead_rule():
    # 22:00-05:00 is dead only because the implementation forgets the wrap.
    impl = encode_rule(_cfg("NIGHT_OWL_RULE", {"startHour": 22, "endHour": 5}), wrap_windows=False)
    intended = encode_rule(_cfg("NIGHT_OWL_RULE", {"startHour": 22, "endHour": 5}), wrap_windows=True)
    theory = build_theory([impl, intended])
    assert is_dead(impl, theory)[0]
    assert not is_dead(intended, theory)[0]


def test_same_start_and_end_hour_is_not_dead():
    # 03:00-03:00 restricts to one hour: degenerate, but well defined.
    impl = encode_rule(_cfg("NIGHT_OWL_RULE", {"startHour": 3, "endHour": 3}), wrap_windows=False)
    theory = build_theory([impl])
    assert not is_dead(impl, theory)[0]


def test_an_open_ended_window_is_alive():
    impl = encode_rule(_cfg("NIGHT_OWL_RULE", {"startHour": 0, "endHour": 23}), wrap_windows=False)
    theory = build_theory([impl])
    assert not is_dead(impl, theory)[0]


def test_zero_amount_threshold_always_fires():
    configs = [dict(c) for c in DEFAULT_RULE_CONFIGS]
    for c in configs:
        if c["ruleName"] == "AMOUNT_THRESHOLD_RULE":
            c["parameters"] = {"minAmount": 0}
    result = check_rule_configs(configs)
    kinds = {i["kind"] for i in result["issues"]}
    assert "always_fires" in kinds
    assert result["warnings"] >= 1


def test_a_normal_amount_threshold_does_not_always_fire():
    impl = encode_rule(_cfg("AMOUNT_THRESHOLD_RULE", {"minAmount": 100000}))
    theory = build_theory([impl])
    assert not is_always_true(impl, theory)[0]


def test_disabled_rules_are_reported_but_not_analysed():
    configs = [dict(c) for c in DEFAULT_RULE_CONFIGS]
    for c in configs:
        if c["ruleName"] == "VELOCITY_RULE":
            c["enabled"] = False
    result = check_rule_configs(configs)
    kinds = {i["kind"] for i in result["issues"]}
    assert "disabled" in kinds
    assert result["healthy"]


def test_unknown_rule_does_not_crash_the_checker():
    result = check_rule_configs([_cfg("BRAND_NEW_RULE", {"x": 1})])
    assert result["checkedRules"] == 1


def test_issue_payload_is_json_serialisable():
    import json
    configs = [dict(c) for c in DEFAULT_RULE_CONFIGS]
    for c in configs:
        if c["ruleName"] == "NIGHT_OWL_RULE":
            c["parameters"] = {"startHour": 22, "endHour": 5}
    json.dumps(check_rule_configs(configs))


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(pytest.main([__file__, "-v"]))
