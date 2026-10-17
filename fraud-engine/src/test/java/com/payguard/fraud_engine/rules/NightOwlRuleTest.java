package com.payguard.fraud_engine.rules;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * The night window is the one rule whose condition is a set of clock hours, so
 * it is the one rule where a configuration can be unsatisfiable. These tests
 * pin the wrap-around semantics that {@code ml/payguard_ml/rulelogic.py} proves
 * by resolution refutation.
 */
class NightOwlRuleTest {

    @Test
    void plainIntervalIncludesItsEndpoints() {
        assertTrue(NightOwlRule.inWindow(0, 0, 5));
        assertTrue(NightOwlRule.inWindow(3, 0, 5));
        assertTrue(NightOwlRule.inWindow(5, 0, 5));
        assertFalse(NightOwlRule.inWindow(6, 0, 5));
        assertFalse(NightOwlRule.inWindow(23, 0, 5));
    }

    @Test
    void wrapAroundWindowFiresOnBothSidesOfMidnight() {
        // 22:00-05:00 — the window that used to be silently dead.
        assertTrue(NightOwlRule.inWindow(22, 22, 5));
        assertTrue(NightOwlRule.inWindow(23, 22, 5));
        assertTrue(NightOwlRule.inWindow(0, 22, 5));
        assertTrue(NightOwlRule.inWindow(5, 22, 5));
        assertFalse(NightOwlRule.inWindow(6, 22, 5));
        assertFalse(NightOwlRule.inWindow(12, 22, 5));
        assertFalse(NightOwlRule.inWindow(21, 22, 5));
    }

    @Test
    void wrapAroundWindowIsSatisfiableOnEveryHourOfTheDay() {
        // The property the old implementation violated: for a genuine window
        // there is always at least one hour that fires the rule.
        boolean anyHourFires = false;
        for (int hour = 0; hour < 24; hour++) {
            if (NightOwlRule.inWindow(hour, 22, 5)) anyHourFires = true;
        }
        assertTrue(anyHourFires, "a wrap-around window must be satisfiable");
    }

    @Test
    void degenerateOneHourWindowFiresOnlyOnThatHour() {
        // startHour == endHour is degenerate but well defined - and the checker
        // must not report it as dead.
        assertTrue(NightOwlRule.inWindow(3, 3, 3));
        assertFalse(NightOwlRule.inWindow(2, 3, 3));
        assertFalse(NightOwlRule.inWindow(4, 3, 3));
    }

    @Test
    void fullDayWindowFiresAlways() {
        for (int hour = 0; hour < 24; hour++) {
            assertTrue(NightOwlRule.inWindow(hour, 0, 23), "hour " + hour);
        }
    }
}
