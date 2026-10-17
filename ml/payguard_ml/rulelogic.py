"""rulelogic.py — reasoning about the rules with propositional logic (UNIT-II).

`RuleConfig` documents **are propositional formulae.** `AMOUNT_THRESHOLD_RULE`
with `minAmount: 100000` is literally ``amount >= 100000``. Once you see that,
you can reason about a rule set automatically and catch real operator errors
that no amount of UI polish would surface:

1. **Dead configurations** — a constraint combination that can never fire. A
   silently dead fraud rule is a security hole that *looks* like a working
   control: the Rules screen shows it enabled and green, and nobody finds out.
2. **Wrap-around windows** — the subcase of the above that is actually sitting
   in this repo. `NightOwlRule.java` tests
   ``if (hour < startHour || hour > endHour) return empty`` — a plain interval
   test with no wrap-around. So the night window an operator would naturally
   write, ``startHour: 22, endHour: 5``, is **unsatisfiable**: no hour is
   simultaneously >= 22 and <= 5. The rule silently never fires while showing as
   enabled. (``startHour == endHour`` is *not* the bug — that fires for exactly
   that one hour, degenerate but well defined. The bug is any window that wraps
   midnight, i.e. every window a night-owl rule actually wants.)
3. **Subsumption** — one rule's firing set contains another's, so the second
   adds nothing. Redundant rules distort the score average (Flaw 1) and clutter
   the analyst's reasons.
4. **Always-fires** — a rule whose condition holds for every possible
   transaction (`minAmount: 0`), which flags everything and swallows the signal.

Mechanism
---------
A **compact CNF over threshold atoms**, decided by **resolution refutation**.

The encoding matters for both correctness and speed. Enumerating a domain
(``hour = 0``, ``hour = 1``, …) is *correct* but blows up: 24 values need a
1+276-clause exactly-one encoding, and saturating resolution on it takes seconds.
Instead we introduce only the atoms the rules actually mention —
``amount>=100000``, ``hour>=22``, ``hour<=5``, ``txns>5`` — and a tiny theory of
ordering facts relating them::

    amount>=t2  ->  amount>=t1            for t1 < t2
    hour>=a and hour<=b  are incompatible  for a > b
    hour >= 0                (an hour is never negative)

A rule's firing condition becomes ``fires_R -> conjunction``, one clause per
conjunct (or a single clause for a disjunction, which is how a *wrap-aware*
night window is expressed). Then, with resolution refutation:

    dead(R)          iff  KB ∧ fires_R                     is unsatisfiable
    subsumes(A, B)   iff  KB ∧ fires_B ∧ ¬fires_A          is unsatisfiable

This is genuine resolution — the derived clauses are the proof — and it is fast
because the atom set stays in the tens. ``resolutionSteps`` is reported so the
reasoning is auditable rather than a black box saying "dead".
"""

from __future__ import annotations

from dataclasses import dataclass, field
from itertools import combinations
from typing import Any, Dict, FrozenSet, Iterable, List, Optional, Sequence, Set, Tuple

Literal = Tuple[str, bool]           # (atom, positive?)
Clause = FrozenSet[Literal]
CNF = List[Clause]


# --------------------------------------------------------------------------
# Resolution refutation
# --------------------------------------------------------------------------

def _resolve(a: Clause, b: Clause) -> Optional[Clause]:
    """Resolvent on exactly one complementary literal, or None."""
    complementary = [lit for lit in a if (lit[0], not lit[1]) in b]
    if len(complementary) != 1:
        return None
    lit = complementary[0]
    return frozenset((set(a) - {lit}) | (set(b) - {(lit[0], not lit[1])}))


def _unit_propagate(clauses: Set[Clause]) -> Tuple[Set[Clause], bool]:
    """Assign every unit clause, simplifying the rest. Returns (clauses, conflict)."""
    units: Dict[str, bool] = {}
    work = set(clauses)
    while True:
        new_units: Dict[str, bool] = {}
        for clause in work:
            if len(clause) == 1:
                atom, polarity = next(iter(clause))
                if atom in units and units[atom] != polarity:
                    return work, True
                new_units[atom] = polarity
            elif len(clause) == 0:
                return work, True
        if not new_units:
            return work, False
        for atom, polarity in new_units.items():
            units.setdefault(atom, polarity)
        simplified: Set[Clause] = set()
        for clause in work:
            if any(units.get(a) == p for a, p in clause):
                continue                       # clause already satisfied
            reduced = frozenset((a, p) for a, p in clause if units.get(a) != (not p))
            if len(reduced) == 0:
                return set(), True
            simplified.add(reduced)
        if simplified == work:
            return work, False
        work = simplified


def resolution_refutation(clauses: Sequence[Iterable[Literal]],
                          max_derived: int = 20_000) -> Tuple[bool, int]:
    """Is ``clauses`` unsatisfiable? Returns ``(unsatisfiable, steps_derived)``.

    Unit propagation first (which is resolution restricted to unit clauses — it
    catches the wrap-around conflict in two steps), then full resolution with
    subsumption elimination. Refutation is *refutation-complete*: if a set of
    clauses is unsatisfiable, resolution can always derive the empty clause, so a
    ``False`` result is sound subject to the derivation budget.
    """
    work: Set[Clause] = set()
    for clause in clauses:
        frozen = frozenset(clause)
        if len(frozen) == 0:
            return True, 0
        work.add(frozen)

    work, conflict = _unit_propagate(work)
    if conflict:
        return True, 1

    steps = 0
    changed = True
    while changed:
        changed = False
        current = list(work)
        for i, a in enumerate(current):
            for b in current[i + 1:]:
                resolvent = _resolve(a, b)
                if resolvent is None:
                    continue
                steps += 1
                if steps > max_derived:
                    return False, steps
                if len(resolvent) == 0:
                    return True, steps
                if any(existing <= resolvent for existing in work):
                    continue
                for existing in [c for c in work if resolvent < c]:
                    work.discard(existing)
                work.add(resolvent)
                changed = True
        if changed:
            work, conflict = _unit_propagate(work)
            if conflict:
                return True, steps + 1
    return False, steps


# --------------------------------------------------------------------------
# Rule conditions -> threshold atoms
# --------------------------------------------------------------------------

@dataclass
class RuleFiring:
    """One rule's firing condition, in the compact atom language."""

    rule_name: str
    enabled: bool = True
    score: Optional[int] = None
    conjuncts: List[Literal] = field(default_factory=list)
    disjunction: Optional[List[Literal]] = None
    note: str = ""
    # Tautologies discovered while encoding (e.g. `amount >= 0`): true facts,
    # not conditions. Kept separate so `always_fires` stays exact.
    tautologies: List[Literal] = field(default_factory=list)

    def fire_atom(self) -> Literal:
        return ("fires_%s" % self.rule_name, True)


def _threshold_atom(variable: str, op: str, value: Any) -> Literal:
    return ("%s%s%g" % (variable, op, float(value)), True)


def encode_rule(config: Dict[str, Any], *, wrap_windows: bool = False) -> RuleFiring:
    """One rule config -> its firing condition over threshold atoms."""
    name = config.get("ruleName") or config.get("rule_name")
    enabled = config.get("enabled", True)
    score = config.get("score")
    params = config.get("parameters") or {}

    if name == "AMOUNT_THRESHOLD_RULE":
        minimum = float(params.get("minAmount", 100000))
        firing = RuleFiring(name, enabled, score)
        if minimum <= 0:
            # amount >= 0 is a fact about money, not a condition.
            firing.tautologies.append(_threshold_atom("amount", ">=", 0))
            firing.note = "minAmount <= 0 → fires for every transaction"
        else:
            firing.conjuncts = [_threshold_atom("amount", ">=", minimum)]
        return firing

    if name == "NIGHT_OWL_RULE":
        start = int(params.get("startHour", 0))
        end = int(params.get("endHour", 5))
        fires = RuleFiring(name, enabled, score)
        if wrap_windows and start > end:
            # Intended semantics: hour >= start OR hour <= end.
            fires.disjunction = [_threshold_atom("hour", ">=", start),
                                 _threshold_atom("hour", "<=", end)]
            fires.note = "window %02d:00-%02d:00, wrap-aware (hour >= %d OR hour <= %d)" % (start, end, start, end)
        else:
            literals = []
            if start > 0:
                literals.append(_threshold_atom("hour", ">=", start))
            else:
                fires.tautologies.append(_threshold_atom("hour", ">=", 0))
            if end < 23:
                literals.append(_threshold_atom("hour", "<=", end))
            else:
                fires.tautologies.append(_threshold_atom("hour", "<=", 23))
            fires.conjuncts = literals
            fires.note = "window %02d:00-%02d:00, plain interval (hour >= %d AND hour <= %d)" % (start, end, start, end)
        return fires

    if name == "VELOCITY_RULE":
        maximum = int(params.get("maxTransactions", 5))
        return RuleFiring(name, enabled, score,
                          conjuncts=[_threshold_atom("txns", ">", maximum)] if maximum >= 0 else [])

    if name == "ENUMERATION_ATTACK_RULE":
        max_micro = int(params.get("maxMicroTxns", 8))
        return RuleFiring(name, enabled, score,
                          conjuncts=[_threshold_atom("micro_txns", ">=", max_micro)] if max_micro > 0 else [])

    if name == "GEOGRAPHIC_ANOMALY_RULE":
        return RuleFiring(name, enabled, score, conjuncts=[_threshold_atom("cities", ">=", 2)])

    if name == "NEW_DEVICE_RULE":
        return RuleFiring(name, enabled, score, conjuncts=[("device_is_new", True)])

    return RuleFiring(name, enabled, score, note="unknown rule — no encoding available")


# --------------------------------------------------------------------------
# The theory
# --------------------------------------------------------------------------

def _atom_components(atom: str) -> Optional[Tuple[str, str, float]]:
    """Parse ``amount>=100000`` into ('amount', '>=', 100000.0)."""
    for op in (">=", "<=", ">", "<"):
        if op in atom:
            variable, _, value = atom.partition(op)
            try:
                return variable, op, float(value)
            except ValueError:
                return None
    return None


def firing_clauses(firing: RuleFiring) -> CNF:
    """``fires_R -> condition`` as clauses: one per conjunct, or a single
    disjunctive clause when the condition is a disjunction (wrap-aware window)."""
    fire = firing.fire_atom()
    clauses: CNF = []
    for conjunct in firing.conjuncts:
        clauses.append(frozenset({(fire[0], False), conjunct}))
    if firing.disjunction:
        clauses.append(frozenset([(fire[0], False)] + list(firing.disjunction)))
    return clauses


def build_theory(firings: Sequence[RuleFiring]) -> CNF:
    """Ground facts about the world: the ordering relations between the
    thresholds the rules mention. Deliberately excludes any rule's own firing
    implication, so each rule can be tested against a shared, fixed theory."""
    clauses: CNF = []
    atoms: Set[str] = set()

    for firing in firings:
        for atom, polarity in list(firing.conjuncts) + list(firing.tautologies) + (firing.disjunction or []):
            atoms.add(atom)
            _ = polarity

    # Facts and ordering relationships between the mentioned thresholds.
    by_variable: Dict[str, List[Tuple[str, float]]] = {}
    for atom in atoms:
        parsed = _atom_components(atom)
        if parsed is None:
            continue
        variable, op, value = parsed
        by_variable.setdefault(variable, []).append((op, value))

    for variable, entries in by_variable.items():
        lowers = sorted({v for op, v in entries if op == ">="})
        uppers = sorted({v for op, v in entries if op == "<="})
        for low, high in combinations(lowers, 2):
            lo, hi = sorted((low, high))
            # amount>=hi implies amount>=lo
            clauses.append(frozenset({(("%s>=%g" % (variable, hi)), False),
                                      (("%s>=%g" % (variable, lo)), True)}))
        for low in lowers:
            for high in uppers:
                if low > high:
                    # No value is simultaneously >= low and <= high.
                    clauses.append(frozenset({(("%s>=%g" % (variable, low)), False),
                                              (("%s<=%g" % (variable, high)), False)}))

    # A time-of-day is always within [0, 23]; money is never negative.
    hour_atoms = {a for a in atoms if _atom_components(a) and _atom_components(a)[0] == "hour"}
    if hour_atoms:
        clauses.append(frozenset({("hour>=0", True)}))
        clauses.append(frozenset({("hour<=23", True)}))
    amount_atoms = {a for a in atoms if _atom_components(a) and _atom_components(a)[0] == "amount"}
    if amount_atoms:
        clauses.append(frozenset({("amount>=0", True)}))

    return clauses


# --------------------------------------------------------------------------
# Checks
# --------------------------------------------------------------------------

@dataclass
class Issue:
    severity: str            # "error" | "warning" | "info"
    rule: str
    kind: str
    message: str
    detail: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {"severity": self.severity, "rule": self.rule, "kind": self.kind,
                "message": self.message, **self.detail}


def is_dead(firing: RuleFiring, theory: CNF) -> Tuple[bool, int]:
    """Unsatisfiable firing condition, by resolution refutation.

    ``KB ∧ fires_R`` unsatisfiable ⇔ there is no transaction that could ever
    satisfy the rule's condition, i.e. the rule is silently dead.
    """
    if not firing.conjuncts and not firing.disjunction:
        return False, 0
    clauses = list(theory) + firing_clauses(firing) + [frozenset({firing.fire_atom()})]
    return resolution_refutation(clauses)


def is_always_true(firing: RuleFiring, theory: CNF) -> Tuple[bool, int]:
    """Is the condition vacuous — true for every possible transaction?

    ``KB ∧ ¬fires_R`` unsatisfiable ⇔ KB entails ``fires_R``, so the rule flags
    everything and carries no information.
    """
    if not firing.conjuncts and not firing.disjunction and firing.tautologies:
        return True, 0
    if not firing.conjuncts and not firing.disjunction:
        return False, 0
    clauses = list(theory) + firing_clauses(firing) + [frozenset({(firing.fire_atom()[0], False)})]
    return resolution_refutation(clauses)


def subsumes(a: RuleFiring, b: RuleFiring, theory: CNF) -> bool:
    """Does ``a`` firing follow from ``b`` firing? (b's firing set ⊆ a's)

    ``KB ∧ fires_b ∧ ¬fires_a`` unsatisfiable means: no transaction fires ``b``
    without also firing ``a``, so ``b`` contributes no distinct evidence.
    """
    if not a.conjuncts and not a.disjunction:
        return False
    if not b.conjuncts and not b.disjunction:
        return False
    clauses = (list(theory) + firing_clauses(a) + firing_clauses(b)
               + [frozenset({b.fire_atom()}), frozenset({(a.fire_atom()[0], False)})])
    unsat, _ = resolution_refutation(clauses)
    return unsat


def check_rule_configs(configs: Sequence[Dict[str, Any]]) -> Dict[str, Any]:
    """Check a whole rule set and return issues ready for the Rules screen."""
    issues: List[Issue] = []
    as_implemented = [encode_rule(c, wrap_windows=False) for c in configs]
    as_intended = [encode_rule(c, wrap_windows=True) for c in configs]
    # One shared ground theory, covering the atoms from both readings, so a rule
    # is judged against the same facts regardless of which reading we test.
    theory = build_theory(as_implemented + as_intended)
    total_steps = 0
    dead_rules: Set[str] = set()

    for config, impl, intended in zip(configs, as_implemented, as_intended):
        if not impl.enabled:
            issues.append(Issue("info", impl.rule_name, "disabled",
                                "%s is disabled and contributes no evidence." % impl.rule_name))
            continue

        dead_impl, steps_a = is_dead(impl, theory)
        dead_intended, steps_b = is_dead(intended, theory)
        total_steps += steps_a + steps_b
        if dead_impl:
            dead_rules.add(impl.rule_name)

        if dead_impl and not dead_intended:
            params = config.get("parameters") or {}
            issues.append(Issue(
                "error", impl.rule_name, "wrap_around",
                ("%s can never fire: the window %s:00–%s:00 crosses midnight, but the rule "
                 "tests it as a plain interval (hour >= start AND hour <= end), which no hour "
                 "satisfies. The rule shows as enabled but is silently dead."
                 % (impl.rule_name, params.get("startHour"), params.get("endHour"))),
                {"parameters": params, "as_implemented": impl.note, "as_intended": intended.note,
                 "resolution_steps": steps_a},
            ))
        elif dead_impl and dead_intended:
            issues.append(Issue("error", impl.rule_name, "dead_config",
                                "%s has an unsatisfiable condition and can never fire."
                                % impl.rule_name,
                                {"parameters": config.get("parameters") or {},
                                 "resolution_steps": steps_a}))
        else:
            always, steps_c = is_always_true(impl, theory)
            total_steps += steps_c
            if always:
                issues.append(Issue("warning", impl.rule_name, "always_fires",
                                    ("%s fires for every possible transaction, so it carries no "
                                     "evidence and subsumes every other rule." % impl.rule_name),
                                    {"parameters": config.get("parameters") or {},
                                     "resolution_steps": steps_c}))

    # A dead rule is vacuously "subsumed" by every other rule, which is noise:
    # the dead-configuration issue is the real signal, so keep it uncluttered.
    enabled = [f for f in as_implemented if f.enabled and f.rule_name not in dead_rules]
    for a, b in combinations(enabled, 2):
        if subsumes(a, b, theory):
            issues.append(Issue("warning", b.rule_name, "subsumed",
                                ("%s is subsumed by %s: every transaction that fires it also "
                                 "fires %s, so it adds no distinct evidence — and a redundant "
                                 "signal dilutes any average of rule scores."
                                 % (b.rule_name, a.rule_name, a.rule_name)),
                                {"subsumed_by": a.rule_name}))
        elif subsumes(b, a, theory):
            issues.append(Issue("warning", a.rule_name, "subsumed",
                                ("%s is subsumed by %s: every transaction that fires it also "
                                 "fires %s." % (a.rule_name, b.rule_name, b.rule_name)),
                                {"subsumed_by": b.rule_name}))

    errors = [i for i in issues if i.severity == "error"]
    warnings = [i for i in issues if i.severity == "warning"]
    return {
        "checkedRules": len(configs),
        "errors": len(errors),
        "warnings": len(warnings),
        "resolutionSteps": total_steps,
        "healthy": len(errors) == 0,
        "issues": [i.to_dict() for i in issues],
        "method": ("compact CNF over threshold atoms + resolution refutation with unit "
                   "propagation; conditions are modelled per-transaction and only the "
                   "thresholds the rules mention are encoded"),
    }


#: The engine's live defaults, mirrored from server/services/ruleConfigService.js.
DEFAULT_RULE_CONFIGS = [
    {"ruleName": "VELOCITY_RULE", "enabled": True, "score": 60,
     "parameters": {"maxTransactions": 5, "windowSeconds": 60}},
    {"ruleName": "ENUMERATION_ATTACK_RULE", "enabled": True, "score": 75,
     "parameters": {"microAmountThreshold": 50, "maxMicroTxns": 8, "windowSeconds": 1800}},
    {"ruleName": "AMOUNT_THRESHOLD_RULE", "enabled": True, "score": 65,
     "parameters": {"minAmount": 100000}},
    {"ruleName": "GEOGRAPHIC_ANOMALY_RULE", "enabled": True, "score": 80,
     "parameters": {"windowMinutes": 120}},
    {"ruleName": "NEW_DEVICE_RULE", "enabled": True, "score": 55, "parameters": {}},
    {"ruleName": "NIGHT_OWL_RULE", "enabled": True, "score": 40,
     "parameters": {"startHour": 0, "endHour": 5}},
]


def main() -> int:
    """CLI: check the default set and the wrap-around bug it contains. """
    print("=== Engine defaults ===")
    result = check_rule_configs(DEFAULT_RULE_CONFIGS)
    print("errors=%d warnings=%d steps=%d healthy=%s"
          % (result["errors"], result["warnings"], result["resolutionSteps"], result["healthy"]))
    for issue in result["issues"]:
        print("  [%s] %s: %s" % (issue["severity"], issue["rule"], issue["message"]))

    print()
    print("=== An operator writes the night window they actually mean ===")
    buggy = [dict(c) for c in DEFAULT_RULE_CONFIGS]
    for c in buggy:
        if c["ruleName"] == "NIGHT_OWL_RULE":
            c["parameters"] = {"startHour": 22, "endHour": 5}
    result = check_rule_configs(buggy)
    print("errors=%d healthy=%s" % (result["errors"], result["healthy"]))
    for issue in result["issues"]:
        print("  [%s/%s] %s" % (issue["severity"], issue["kind"], issue["message"]))

    print()
    print("=== An operator sets minAmount to 0 ===")
    always = [dict(c) for c in DEFAULT_RULE_CONFIGS]
    for c in always:
        if c["ruleName"] == "AMOUNT_THRESHOLD_RULE":
            c["parameters"] = {"minAmount": 0}
    result = check_rule_configs(always)
    for issue in result["issues"]:
        print("  [%s/%s] %s" % (issue["severity"], issue["kind"], issue["message"]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
