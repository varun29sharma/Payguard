"""compare.py — run the whole UNIT-I family on the same problems and tabulate.

The table is the deliverable. Reading pseudocode tells you what each algorithm
*claims*; this tells you what it *costs*: nodes expanded, peak frontier, path
cost, and whether the answer is optimal. Seeing DFID match BFS's path cost with a
frontier of O(depth), and A* expand a tenth of the nodes with a good heuristic,
is the part that sticks.

Usage::

    python -m search.compare
"""

from __future__ import annotations

import time
from typing import Any, Callable, Dict, List, Sequence, Tuple

from . import informed, uninformed
from .problem import EightPuzzle, GridMaze, Problem, SearchResult

#: A compact maze with a genuinely adversarial wall: the greedy path is blocked
#: and must be abandoned, which is why best-first can look bad here.
MAZE = """
S..#.......
.#.#.#####.
.#...#.....
.####.#.###
....#.#...#
###.#.#.#.#
#...#...#.#
#.#####.#.#
#.......#G#
###########
"""


def algorithm_suite(beam_width: int = 8) -> List[Tuple[str, Callable[[Problem], SearchResult]]]:
    return [
        ("BFS", uninformed.breadth_first_search),
        ("DFS", uninformed.depth_first_search),
        ("DFID", uninformed.iterative_deepening),
        ("Bidirectional BFS", uninformed.bidirectional_search),
        ("Hill climbing", informed.hill_climbing),
        ("Beam search", lambda p: informed.beam_search(p, beam_width=beam_width)),
        ("Best-first (greedy)", informed.best_first_search),
        ("Branch & bound", informed.branch_and_bound),
        ("Uniform cost (Dijkstra)", informed.uniform_cost_search),
        ("A*", informed.a_star_search),
        ("IDA*", informed.ida_star),
    ]


def run_all(problem: Problem, beam_width: int = 8) -> List[Dict[str, Any]]:
    out = []
    for name, fn in algorithm_suite(beam_width):
        started = time.perf_counter()
        result = fn(problem)
        elapsed_ms = (time.perf_counter() - started) * 1000.0
        row = result.to_dict()
        row["elapsed_ms"] = round(elapsed_ms, 2)
        out.append(row)
    return out


def reference_cost(problem: Problem) -> float:
    """Dijkstra's answer — the ground truth every optimality claim is checked against."""
    return uninformed.breadth_first_search(problem).path_cost if _unit_costs(problem) \
        else informed.uniform_cost_search(problem).path_cost


def _unit_costs(problem: Problem) -> bool:
    return isinstance(problem, (EightPuzzle, GridMaze))


def render(rows: Sequence[Dict[str, Any]], title: str) -> str:
    lines = ["### %s" % title, "",
             "| algorithm | success | cost | nodes expanded | peak frontier | path len | optimal | ms |",
             "|---|---|---:|---:|---:|---:|---|---:|"]
    for row in rows:
        lines.append("| %s | %s | %s | %d | %d | %d | %s | %.2f |" % (
            row["algorithm"], "yes" if row["success"] else "no",
            row["path_cost"] if row["path_cost"] is not None else "—",
            row["nodes_expanded"], row["peak_frontier"], row["path_length"],
            {True: "yes", False: "no", None: "?"}.get(row["optimal"]),
            row["elapsed_ms"],
        ))
    return "\n".join(lines)


def main() -> int:
    # Six moves from the goal: deep enough that the heuristic visibly matters.
    START = (1, 6, 2, 4, 0, 3, 7, 5, 8)
    puzzle = EightPuzzle(start=START, heuristic="manhattan")
    print("8-puzzle, solvable:", puzzle.solvable(), "manhattan of start:", puzzle.heuristic(puzzle.start))
    rows = run_all(puzzle)
    print(render(rows, "8-puzzle (Manhattan heuristic)"))
    print()

    # The lesson in one line: A* with NO heuristic IS Dijkstra. Everything the
    # heuristic buys shows up as the gap between these two rows.
    blind = informed.a_star_search(EightPuzzle(start=START, heuristic="zero"))
    informed_a = informed.a_star_search(EightPuzzle(start=START, heuristic="manhattan"))
    print("A* with h=0 (== Dijkstra): %d nodes expanded, cost %s"
          % (blind.nodes_expanded, blind.path_cost))
    print("A* with Manhattan:         %d nodes expanded, cost %s"
          % (informed_a.nodes_expanded, informed_a.path_cost))
    print("heuristic reduced expansions by %.1f%%"
          % (100 * (1 - informed_a.nodes_expanded / max(1, blind.nodes_expanded))))
    print()

    maze = GridMaze.from_ascii(MAZE)
    mrows = run_all(maze)
    print(render(mrows, "Grid maze with walls"))
    print()
    print("Maze with the A* solution drawn in:")
    astar = informed.a_star_search(maze)
    print(maze.render(astar.path))
    print()
    print("BFS vs A* on the maze: %s vs %s nodes expanded, both cost %s."
          % (uninformed.breadth_first_search(maze).nodes_expanded,
             astar.nodes_expanded, astar.path_cost))
    print("Dijkstra cost == A* cost:", reference_cost(maze) == astar.path_cost)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
