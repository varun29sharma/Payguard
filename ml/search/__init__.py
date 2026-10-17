"""ml/search — UNIT-I search algorithms, implemented on shared problems.

Syllabus UNIT-I covers BFS, DFS, DFID, bidirectional search, hill climbing,
beam, best-first, branch & bound, A* and IDA*. Reading the pseudocode teaches
almost nothing; implementing all of them behind one interface and comparing them
on the *same* two problems teaches the thing that actually matters — **why A\*
expands a fraction of the nodes, and what each algorithm's memory and optimality
guarantees cost you in exchange.**

Two problems keep the comparison honest:

* ``EightPuzzle`` — the classic, with a genuine branching factor and two
  heuristics (misplaced tiles, Manhattan distance) that let you *see* the effect
  of heuristic quality on nodes expanded.
* ``GridMaze`` — a maze with walls, where a weak heuristic (Manhattan with walls
  in the way) can badly mislead a greedy search and where BFS's optimality is
  easy to verify by hand.

``compare.py`` runs the whole family on both and prints one table.
"""

from .problem import Node, Problem, EightPuzzle, GridMaze, SearchResult  # noqa: F401
from . import informed, uninformed  # noqa: F401

__all__ = ["Node", "Problem", "EightPuzzle", "GridMaze", "SearchResult", "informed", "uninformed"]
