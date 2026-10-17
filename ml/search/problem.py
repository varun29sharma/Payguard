"""problem.py — the shared search interface + the two problems we compare on.

A search problem is five functions: where you start, how you recognise the goal,
what you can do, where that takes you, and what it cost. Every algorithm in this
package is written against that interface only, so they are genuinely comparable
— same state space, same costs, same goal test.

The interface also carries ``heuristic``, which is what separates uninformed from
informed search and what makes A* interesting. The docstrings state admissibility
and consistency explicitly, because the exam asks for them precisely and because
grading A*'s optimality guarantee depends on which one holds.
"""

from __future__ import annotations

import heapq
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, Iterable, List, Optional, Sequence, Tuple


@dataclass
class Node:
    """A node on the search tree: a state plus how we got there."""

    state: Any
    parent: Optional["Node"] = None
    action: Any = None
    path_cost: float = 0.0
    depth: int = 0

    def path(self) -> List[Any]:
        """Actions from the root to this node."""
        actions: List[Any] = []
        node: Optional[Node] = self
        while node is not None and node.parent is not None:
            actions.append(node.action)
            node = node.parent
        return list(reversed(actions))

    def states(self) -> List[Any]:
        states: List[Any] = []
        node: Optional[Node] = self
        while node is not None:
            states.append(node.state)
            node = node.parent
        return list(reversed(states))

    def __lt__(self, other: "Node") -> bool:
        # Only used to keep heaps stable when priorities tie.
        return id(self) < id(other)


@dataclass
class SearchResult:
    """Everything the comparison table needs from one algorithm run."""

    algorithm: str
    problem: str
    success: bool
    path: List[Any] = field(default_factory=list)
    path_cost: float = float("inf")
    nodes_expanded: int = 0
    nodes_generated: int = 0
    peak_frontier: int = 0
    iterations: int = 0
    expanded_depth: int = 0
    optimal: Optional[bool] = None
    note: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return {
            "algorithm": self.algorithm,
            "problem": self.problem,
            "success": self.success,
            "path_cost": None if self.path_cost == float("inf") else round(self.path_cost, 4),
            "nodes_expanded": self.nodes_expanded,
            "nodes_generated": self.nodes_generated,
            "peak_frontier": self.peak_frontier,
            "path_length": len(self.path),
            "optimal": self.optimal,
            "note": self.note,
        }


class Problem:
    """Abstract search problem. Subclasses supply the five primitives."""

    name: str = "problem"

    def initial_state(self) -> Any:
        raise NotImplementedError

    def goal_test(self, state: Any) -> bool:
        raise NotImplementedError

    def actions(self, state: Any) -> Sequence[Any]:
        raise NotImplementedError

    def result(self, state: Any, action: Any) -> Any:
        raise NotImplementedError

    def step_cost(self, state: Any, action: Any, next_state: Any) -> float:
        return 1.0

    def heuristic(self, state: Any) -> float:
        """Default: no knowledge at all — admissible (never overestimates, since
        no non-negative cost is less than 0) but useless. This is what makes
        'uninformed' search a special case of A* rather than a different beast."""
        return 0.0

    def is_consistent(self) -> bool:
        """Whether ``heuristic`` satisfies the triangle inequality
        ``h(n) <= c(n, n') + h(n')``. Consistency implies admissibility and is
        exactly what graph search needs to be optimal *without re-expanding*."""
        raise NotImplementedError

    def __repr__(self) -> str:
        return "%s()" % type(self).__name__


# --------------------------------------------------------------------------
# 8-puzzle
# --------------------------------------------------------------------------

class EightPuzzle(Problem):
    """The classic 3x3 sliding puzzle. Blank is ``0``.

    Two heuristics are provided, and the difference between them is the whole
    lesson about heuristic quality:

    * ``misplaced`` — number of tiles out of place. Admissible and consistent.
    * ``manhattan`` — sum of grid distances. Also admissible and consistent,
      and strictly dominates ``misplaced`` (never expands more nodes), which is
      why it appears in the comparison table with a visibly smaller frontier.
    """

    GOAL = (1, 2, 3, 4, 5, 6, 7, 8, 0)
    name = "8-puzzle"
    _MOVES = (("up", -3), ("down", 3), ("left", -1), ("right", 1))

    def __init__(self, start: Optional[Sequence[int]] = None, heuristic: str = "manhattan"):
        self.start = tuple(start) if start else (1, 2, 3, 4, 0, 6, 7, 5, 8)
        if sorted(self.start) != sorted(self.GOAL):
            raise ValueError("start must be a permutation of 0..8")
        if heuristic not in ("manhattan", "misplaced", "zero"):
            raise ValueError("heuristic must be 'manhattan', 'misplaced' or 'zero'")
        self.heuristic_name = heuristic

    def initial_state(self):
        return self.start

    def goal_test(self, state) -> bool:
        return tuple(state) == self.GOAL

    def actions(self, state) -> List[str]:
        blank = state.index(0)
        row, col = divmod(blank, 3)
        out = []
        for name, delta in self._MOVES:
            if name == "up" and row == 0:
                continue
            if name == "down" and row == 2:
                continue
            if name == "left" and col == 0:
                continue
            if name == "right" and col == 2:
                continue
            out.append(name)
        return out

    def result(self, state, action):
        blank = state.index(0)
        delta = dict(self._MOVES)[action]
        target = blank + delta
        new = list(state)
        new[blank], new[target] = new[target], new[blank]
        return tuple(new)

    def heuristic(self, state) -> float:
        if self.heuristic_name == "zero":
            return 0.0
        if self.heuristic_name == "misplaced":
            return float(sum(1 for i, v in enumerate(state) if v != 0 and v != self.GOAL[i]))
        total = 0.0
        for i, v in enumerate(state):
            if v == 0:
                continue
            goal_index = self.GOAL.index(v)
            total += abs(i // 3 - goal_index // 3) + abs(i % 3 - goal_index % 3)
        return total

    def is_consistent(self) -> bool:
        # Both standard heuristics are consistent; the zero heuristic trivially is.
        return True

    def solvable(self) -> bool:
        """Inversions parity: only half the permutations are reachable."""
        flat = [v for v in self.start if v != 0]
        inversions = sum(1 for i in range(len(flat)) for j in range(i + 1, len(flat)) if flat[i] > flat[j])
        return inversions % 2 == 0


# --------------------------------------------------------------------------
# Grid maze with walls
# --------------------------------------------------------------------------

class GridMaze(Problem):
    """A grid where ``1`` is a wall, ``0`` is open. Moves are 4-connected.

    Manhattan-to-goal is admissible *because* walls can only make the true path
    longer than the straight-line distance. Remove that argument and the
    heuristic stops being admissible and A* stops being optimal — which is
    exactly the reasoning the roadmap asks you to do for the weighted identity
    graph in GraphExplorer, where edge costs can drop below 1.
    """

    name = "grid-maze"

    def __init__(self, grid: Sequence[Sequence[int]], start: Tuple[int, int],
                 goal: Tuple[int, int]):
        self.grid = [list(row) for row in grid]
        self.start = tuple(start)
        self.goal = tuple(goal)
        if self.grid[start[0]][start[1]] == 1 or self.grid[goal[0]][goal[1]] == 1:
            raise ValueError("start and goal must not be walls")

    def initial_state(self):
        return self.start

    def goal_test(self, state) -> bool:
        return tuple(state) == self.goal

    def actions(self, state) -> List[str]:
        r, c = state
        out = []
        for name, (dr, dc) in (("up", (-1, 0)), ("down", (1, 0)), ("left", (0, -1)), ("right", (0, 1))):
            nr, nc = r + dr, c + dc
            if 0 <= nr < len(self.grid) and 0 <= nc < len(self.grid[0]) and self.grid[nr][nc] != 1:
                out.append(name)
        return out

    def result(self, state, action):
        r, c = state
        dr, dc = {"up": (-1, 0), "down": (1, 0), "left": (0, -1), "right": (0, 1)}[action]
        return (r + dr, c + dc)

    def heuristic(self, state) -> float:
        return float(abs(state[0] - self.goal[0]) + abs(state[1] - self.goal[1]))

    def is_consistent(self) -> bool:
        return True

    @classmethod
    def from_ascii(cls, text: str) -> "GridMaze":
        """``#`` = wall, ``S`` = start, ``G`` = goal, ``.`` = open."""
        lines = [line for line in text.strip().splitlines() if line.strip()]
        grid, start, goal = [], None, None
        for r, line in enumerate(lines):
            row = []
            for c, ch in enumerate(line):
                if ch == "#":
                    row.append(1)
                else:
                    row.append(0)
                    if ch == "S":
                        start = (r, c)
                    elif ch == "G":
                        goal = (r, c)
            grid.append(row)
        if start is None or goal is None:
            raise ValueError("maze needs an S and a G")
        return cls(grid, start, goal)

    def render(self, path: Optional[Sequence[str]] = None) -> str:
        """ASCII render with the solution path drawn on it."""
        cells = {}
        if path:
            state = self.start
            cells[state] = "*"
            for action in path:
                state = self.result(state, action)
                cells[state] = "*"
        rows = []
        for r, row in enumerate(self.grid):
            line = []
            for c, value in enumerate(row):
                if value == 1:
                    line.append("#")
                elif (r, c) == self.start:
                    line.append("S")
                elif (r, c) == self.goal:
                    line.append("G")
                elif (r, c) in cells:
                    line.append("*")
                else:
                    line.append(".")
            rows.append("".join(line))
        return "\n".join(rows)


# --------------------------------------------------------------------------
# A small weighted digraph, for the A* / Dijkstra equivalence check
# --------------------------------------------------------------------------

class WeightedGraph(Problem):
    """A directed weighted graph with a supplied heuristic.

    This exists for one test, and it is the most important test in the package:
    **A\* must return the same path cost as Dijkstra on the same weighted graph.**
    If it does not, the heuristic is not admissible. It is also the direct
    model of the Phase 3 GraphExplorer feature — "shortest high-risk path from
    this account to a known ring" — where edge cost encodes how suspicious a
    link is (a shared device is strong evidence; a shared IP could be a coffee
    shop) and hop-count-to-target is the heuristic.

    ``nodes`` is a list of node ids; ``edges`` maps ``u -> {v: cost}``. The
    heuristic is a dict; omit it for a zero heuristic.
    """

    name = "weighted-graph"

    def __init__(self, nodes: Sequence[Any], edges: Dict[Any, Dict[Any, float]],
                 start: Any, goal: Any, heuristic: Optional[Dict[Any, float]] = None):
        self.nodes = list(nodes)
        self.edges = {u: dict(vs) for u, vs in edges.items()}
        self.start = start
        self.goal = goal
        self._h = dict(heuristic or {})
        for u, vs in self.edges.items():
            for v, cost in vs.items():
                if cost < 0:
                    raise ValueError("Dijkstra and A* require non-negative edge costs")

    def initial_state(self):
        return self.start

    def goal_test(self, state) -> bool:
        return state == self.goal

    def actions(self, state) -> List[Any]:
        return sorted(self.edges.get(state, {}).keys(), key=str)

    def result(self, state, action):
        return action

    def step_cost(self, state, action, next_state) -> float:
        return float(self.edges.get(state, {}).get(action, float("inf")))

    def heuristic(self, state) -> float:
        return float(self._h.get(state, 0.0))

    def is_consistent(self) -> bool:
        """Check the triangle inequality for every edge."""
        for u, vs in self.edges.items():
            for v, cost in vs.items():
                if self._h.get(u, 0.0) > cost + self._h.get(v, 0.0) + 1e-9:
                    return False
        return True


# --------------------------------------------------------------------------
# Small helpers shared by the algorithms
# --------------------------------------------------------------------------

class PriorityQueue:
    """A binary heap with a monotone tie-breaker.

    The tie-breaker matters: without it, comparing two entries with equal
    priority falls back to comparing the payload, which may not be orderable and
    produces non-determinism. Stable ordering is what makes the comparison table
    reproducible run to run.
    """

    def __init__(self):
        self._heap: List[Tuple[float, int, Any]] = []
        self._counter = 0
        self.peak = 0

    def push(self, priority: float, item: Any) -> None:
        heapq.heappush(self._heap, (priority, self._counter, item))
        self._counter += 1
        self.peak = max(self.peak, len(self._heap))

    def pop(self) -> Tuple[float, Any]:
        priority, _, item = heapq.heappop(self._heap)
        return priority, item

    def __bool__(self) -> bool:
        return bool(self._heap)

    def __len__(self) -> int:
        return len(self._heap)

    def __contains__(self, item: Any) -> bool:
        return any(entry[2] == item for entry in self._heap)


def reconstruct(node: Node) -> List[Any]:
    return node.path()
