"""Tests for ml/search — including the A* vs Dijkstra optimality check.

The roadmap asks for one verification specifically: *"unit tests confirming your
A\\* returns the same path as Dijkstra on the same weighted graph — if it doesn't,
your heuristic isn't admissible."* That is ``TestAStarOptimality`` below.
"""

import numpy as np
import pytest

from search import informed, uninformed
from search.compare import MAZE, reference_cost, run_all
from search.problem import EightPuzzle, GridMaze, WeightedGraph


class TestEightPuzzle:
    def test_goal_test(self):
        p = EightPuzzle(start=(1, 2, 3, 4, 5, 6, 7, 8, 0))
        assert p.goal_test(p.GOAL)
        assert not p.goal_test((1, 2, 3, 4, 5, 6, 7, 0, 8))

    def test_rejects_non_permutation(self):
        with pytest.raises(ValueError):
            EightPuzzle(start=(1, 2, 3, 4, 5, 6, 7, 8, 9))

    def test_actions_are_legal_from_each_corner(self):
        p = EightPuzzle(start=(0, 1, 2, 3, 4, 5, 6, 7, 8))
        # Blank in the top-left corner: only down and right.
        assert sorted(p.actions(p.start)) == ["down", "right"]

    def test_manhattan_is_admissible_and_consistent(self):
        p = EightPuzzle(start=(1, 2, 3, 4, 0, 6, 7, 5, 8), heuristic="manhattan")
        # True cost is at least the heuristic, always.
        bfs = uninformed.breadth_first_search(p)
        assert p.heuristic(p.start) <= bfs.path_cost
        assert p.is_consistent()

    def test_manhattan_dominates_misplaced(self):
        state = (1, 2, 3, 4, 0, 6, 7, 5, 8)
        manhattan = EightPuzzle(start=state, heuristic="manhattan")
        misplaced = EightPuzzle(start=state, heuristic="misplaced")
        assert manhattan.heuristic(state) >= misplaced.heuristic(state)


class TestUninformedCorrectness:
    def test_bfs_is_optimal(self):
        p = GridMaze.from_ascii(MAZE)
        bfs = uninformed.breadth_first_search(p)
        assert bfs.success
        assert bfs.path_cost == reference_cost(p)

    def test_dfs_finds_a_path_but_not_necessarily_the_shortest(self):
        p = GridMaze.from_ascii(MAZE)
        dfs = uninformed.depth_first_search(p)
        assert dfs.success
        assert dfs.path_cost >= reference_cost(p)
        assert dfs.optimal is False

    def test_dfid_matches_bfs_cost_linear_memory_paid_in_work(self):
        p = GridMaze.from_ascii(MAZE)
        bfs = uninformed.breadth_first_search(p)
        dfid = uninformed.iterative_deepening(p)
        assert dfid.path_cost == bfs.path_cost
        # DFID's memory is O(branching * depth) — linear in the solution depth and
        # INDEPENDENT of how large the state space is. (On this narrow corridor
        # maze BFS's frontier happens to be small too, so comparing the two here
        # would prove nothing; the branching-factor case is the 8-puzzle test.)
        branching = max(len(p.actions(p.result(p.start, a))) for a in p.actions(p.start))
        assert dfid.peak_frontier <= branching * (dfid.expanded_depth + 1)
        # ...and pays for the memory saving in repeated expansions.
        assert dfid.nodes_expanded > bfs.nodes_expanded

    def test_dfid_uses_less_memory_than_bfs_on_a_high_branching_problem(self):
        # 8-puzzle, six moves from the goal: BFS's frontier grows with depth,
        # while DFID's stays linear in the depth. This is the case the textbook
        # claim is actually about, and the instance is deep enough to show it.
        p = EightPuzzle(start=(1, 6, 2, 4, 0, 3, 7, 5, 8), heuristic="zero")
        bfs = uninformed.breadth_first_search(p)
        dfid = uninformed.iterative_deepening(p, max_depth=20)
        assert dfid.success and bfs.success
        assert dfid.path_cost == bfs.path_cost
        assert dfid.peak_frontier < bfs.peak_frontier

    def test_bidirectional_finds_the_optimal_path(self):
        p = GridMaze.from_ascii(MAZE)
        bidir = uninformed.bidirectional_search(p)
        assert bidir.success
        assert bidir.path_cost == reference_cost(p)

    def test_bfs_path_is_walkable(self):
        p = GridMaze.from_ascii(MAZE)
        result = uninformed.breadth_first_search(p)
        state = p.start
        for action in result.path:
            state = p.result(state, action)
            assert p.grid[state[0]][state[1]] != 1
        assert p.goal_test(state)


class TestInformedBehaviour:
    def test_a_star_expands_far_fewer_nodes_than_bfs(self):
        p = GridMaze.from_ascii(MAZE)
        assert informed.a_star_search(p).nodes_expanded < uninformed.breadth_first_search(p).nodes_expanded

    def test_greedy_best_first_is_not_optimal_in_general(self):
        # Greedy chases h and can overshoot; on this maze it is at least not better than A*.
        p = GridMaze.from_ascii(MAZE)
        greedy = informed.best_first_search(p)
        assert greedy.optimal is False

    def test_hill_climbing_reports_incompleteness(self):
        p = GridMaze.from_ascii(MAZE)
        result = informed.hill_climbing(p)
        assert result.optimal is False

    def test_beam_search_with_width_one_can_fail(self):
        p = GridMaze.from_ascii(MAZE)
        narrow = informed.beam_search(p, beam_width=1)
        wide = informed.beam_search(p, beam_width=32)
        assert narrow.optimal is False
        # A wider beam does no worse.
        assert (wide.path_cost if wide.success else float("inf")) <= (
            narrow.path_cost if narrow.success else float("inf"))

    def test_ida_star_matches_a_star_cost(self):
        p = GridMaze.from_ascii(MAZE)
        astar = informed.a_star_search(p)
        ida = informed.ida_star(p)
        assert ida.success and astar.success
        assert ida.path_cost == astar.path_cost

    def test_uniform_cost_needs_no_heuristic(self):
        p = GridMaze.from_ascii(MAZE)
        ucs = informed.uniform_cost_search(p)
        assert ucs.path_cost == reference_cost(p)


class TestAStarOptimality:
    """The phase's stated verification, on a weighted graph."""

    @pytest.fixture()
    def graph(self):
        # Costs above 1 so hop-count is admissible; the heuristic is exact
        # distances-to-goal for a subset of nodes and 0 elsewhere.
        nodes = ["mule", "b", "c", "d", "merchant", "ring"]
        edges = {
            "mule": {"b": 2.0, "c": 5.0},
            "b": {"merchant": 4.0, "c": 1.5},
            "c": {"ring": 6.0},
            "d": {"merchant": 1.0},
            "merchant": {"ring": 3.0},
            "ring": {},
        }
        heuristic = {"mule": 4.0, "b": 3.0, "c": 5.5, "merchant": 3.0, "d": 2.0, "ring": 0.0}
        return WeightedGraph(nodes, edges, start="mule", goal="ring", heuristic=heuristic)

    def test_astar_matches_dijkstra_on_a_weighted_graph(self, graph):
        astar = informed.a_star_search(graph)
        dijkstra = informed.uniform_cost_search(graph)
        assert astar.success and dijkstra.success
        assert astar.path_cost == pytest.approx(dijkstra.path_cost)

    def test_astar_expands_no_more_than_dijkstra(self, graph):
        assert informed.a_star_search(graph).nodes_expanded <= \
            informed.uniform_cost_search(graph).nodes_expanded

    def test_heuristic_consistency_is_reported(self, graph):
        assert graph.is_consistent()

    def test_would_detect_an_inadmissible_heuristic(self):
        # h("mule") = 999 while the cheapest route costs 6 -> not admissible.
        bad = WeightedGraph(
            ["mule", "b", "ring"],
            {"mule": {"b": 1.0}, "b": {"ring": 1.0}, "ring": {}},
            "mule", "ring", heuristic={"mule": 999.0, "b": 1.0, "ring": 0.0},
        )
        assert bad.is_consistent() is False

    def test_negative_edge_costs_are_rejected(self):
        with pytest.raises(ValueError):
            WeightedGraph(["a", "b"], {"a": {"b": -1.0}, "b": {}}, "a", "b")


class TestComparisonHarness:
    def test_runs_the_whole_family_without_error(self):
        p = GridMaze.from_ascii(MAZE)
        rows = run_all(p)
        assert len(rows) == 11
        assert all("nodes_expanded" in r for r in rows)
        # Every optimal algorithm agrees on the cost.
        optimal_costs = {r["path_cost"] for r in rows
                         if r["optimal"] is True and r["success"]}
        assert len(optimal_costs) == 1

    def test_reference_cost_matches_bfs_on_unit_cost_problems(self):
        p = GridMaze.from_ascii(MAZE)
        assert reference_cost(p) == uninformed.breadth_first_search(p).path_cost
