"""uninformed.py — BFS, DFS, DFID, bidirectional search.

None of these look at the heuristic, which is exactly what "uninformed" means:
they explore on structure alone. The comparison table then shows the price:

* **BFS** is complete and optimal for unit costs, and pays for it in memory —
  the frontier grows with the number of states at a depth.
* **DFS** is memory-cheap (O(depth)) and fast when it happens to be right, but
  is neither optimal nor complete on infinite/looping spaces unless you track
  visited states.
* **DFID** gets BFS's optimality with DFS's O(depth) memory, by redoing work:
  it expands the shallow levels repeatedly. Seeing that trade in the node counts
  is the point — it is the same trade IDA* makes in ``informed.py``.
* **Bidirectional search** can cut the explored region from b^d to ~2*b^(d/2),
  which looks magical until you notice it needs the goal to be searchable
  *backwards* and needs a fast frontier-intersection test.

Backward search here relies on the state graph being **undirected** — true for
both the 8-puzzle and a 4-connected maze, because every move has an inverse. It
is *not* generally true (a directed identity graph with asymmetric edges is the
counterexample), and saying so is the honest caveat.
"""

from __future__ import annotations

from collections import deque
from typing import Any, Dict, List, Optional, Set, Tuple

from .problem import Node, Problem, PriorityQueue, SearchResult

MAX_NODES_DEFAULT = 200_000


def _result(algorithm: str, problem: Problem, node: Optional[Node], expanded: int,
            peak_frontier: int, generated: int, optimal: Optional[bool],
            note: str = "", iterations: int = 0, depth: int = 0) -> SearchResult:
    if node is None:
        return SearchResult(algorithm, problem.name, False, nodes_expanded=expanded,
                            peak_frontier=peak_frontier, nodes_generated=generated,
                            optimal=optimal, note=note or "no solution found",
                            iterations=iterations, expanded_depth=depth)
    return SearchResult(algorithm, problem.name, True, path=node.path(),
                        path_cost=node.path_cost, nodes_expanded=expanded,
                        peak_frontier=peak_frontier, nodes_generated=generated,
                        optimal=optimal, note=note, iterations=iterations,
                        expanded_depth=node.depth)


def breadth_first_search(problem: Problem, max_nodes: int = MAX_NODES_DEFAULT) -> SearchResult:
    """Complete and optimal for unit step costs. Memory is the frontier."""
    root = Node(problem.initial_state())
    if problem.goal_test(root.state):
        return _result("BFS", problem, root, 0, 1, 1, True)
    frontier = deque([root])
    explored: Set[Any] = {root.state}
    expanded = generated = peak = 0
    while frontier:
        node = frontier.popleft()
        expanded += 1
        if expanded > max_nodes:
            return _result("BFS", problem, None, expanded, peak, generated, True,
                           note="node budget exhausted")
        for action in problem.actions(node.state):
            child_state = problem.result(node.state, action)
            # Goal test on generation, not expansion: BFS's frontier is
            # depth-ordered, so the first goal generated is depth-optimal.
            if child_state in explored:
                continue
            child = Node(child_state, node, action, node.path_cost + problem.step_cost(node.state, action, child_state), node.depth + 1)
            generated += 1
            if problem.goal_test(child_state):
                return _result("BFS", problem, child, expanded, peak, generated, True)
            explored.add(child_state)
            frontier.append(child)
        peak = max(peak, len(frontier))
    return _result("BFS", problem, None, expanded, peak, generated, True)


def depth_first_search(problem: Problem, max_nodes: int = MAX_NODES_DEFAULT) -> SearchResult:
    """Graph DFS with a visited set, so it terminates. Not optimal."""
    root = Node(problem.initial_state())
    stack = [root]
    explored: Set[Any] = set()
    expanded = generated = peak = 0
    while stack:
        node = stack.pop()
        if node.state in explored:
            continue
        if problem.goal_test(node.state):
            return _result("DFS", problem, node, expanded, peak, generated, False,
                           note="not optimal in general")
        explored.add(node.state)
        expanded += 1
        if expanded > max_nodes:
            return _result("DFS", problem, None, expanded, peak, generated, False,
                           note="node budget exhausted")
        for action in reversed(list(problem.actions(node.state))):
            child_state = problem.result(node.state, action)
            if child_state in explored:
                continue
            generated += 1
            stack.append(Node(child_state, node, action,
                              node.path_cost + problem.step_cost(node.state, action, child_state),
                              node.depth + 1))
        peak = max(peak, len(stack))
    return _result("DFS", problem, None, expanded, peak, generated, False)


def depth_limited_search(problem: Problem, limit: int, max_nodes: int = MAX_NODES_DEFAULT
                         ) -> Tuple[Optional[Node], int, int, bool, int]:
    """DFS with a depth ceiling.

    Returns ``(node, expanded, generated, hit_cutoff, peak_frontier)``. The peak
    is MEASURED from the stack, not assumed: it is the frontier for this pass and
    it is what makes DFID's memory claim checkable rather than asserted.
    """
    root = Node(problem.initial_state())
    stack: List[Tuple[Node, int]] = [(root, 0)]
    explored: Dict[Any, int] = {}
    expanded = generated = 0
    peak = 1
    hit_cutoff = False
    while stack:
        node, depth = stack.pop()
        if problem.goal_test(node.state):
            return node, expanded, generated, False, peak
        if depth >= limit:
            hit_cutoff = True
            continue
        if explored.get(node.state, 10 ** 9) <= depth:
            continue
        explored[node.state] = depth
        expanded += 1
        if expanded > max_nodes:
            return None, expanded, generated, False, peak
        for action in reversed(list(problem.actions(node.state))):
            child_state = problem.result(node.state, action)
            child = Node(child_state, node, action,
                         node.path_cost + problem.step_cost(node.state, action, child_state),
                         depth + 1)
            generated += 1
            stack.append((child, depth + 1))
        peak = max(peak, len(stack))
    return None, expanded, generated, hit_cutoff, peak


def iterative_deepening(problem: Problem, max_depth: int = 30,
                        max_nodes: int = MAX_NODES_DEFAULT) -> SearchResult:
    """DFID — BFS optimality at DFS memory, paid for in repeated work."""
    total_expanded = total_generated = 0
    peak = 1
    for limit in range(max_depth + 1):
        node, expanded, generated, cutoff, pass_peak = depth_limited_search(problem, limit, max_nodes)
        total_expanded += expanded
        total_generated += generated
        peak = max(peak, pass_peak)
        if node is not None:
            return _result("DFID", problem, node, total_expanded, peak,
                           total_generated, True, iterations=limit + 1, depth=node.depth)
        if not cutoff:
            break
    return _result("DFID", problem, None, total_expanded, peak, total_generated, True,
                   note="depth limit reached without a solution")


def bidirectional_search(problem: Problem, max_nodes: int = MAX_NODES_DEFAULT) -> SearchResult:
    """BFS from both ends, meeting in the middle.

    Assumes the state graph is undirected (every move has an inverse), which
    holds for both problems here. The returned path is forward-actions then the
    reversed backward-actions.
    """
    if problem.goal_test(problem.initial_state()):
        return _result("Bidirectional BFS", problem, Node(problem.initial_state()), 0, 1, 1, True)

    start = problem.initial_state()
    goal = _goal_state(problem)
    if goal is None:
        return _result("Bidirectional BFS", problem, None, 0, 0, 0, None,
                       note="goal state unknown — bidirectional search needs it explicitly")

    forward_frontier = deque([Node(start)])
    backward_frontier = deque([Node(goal)])
    forward_seen: Dict[Any, Node] = {start: forward_frontier[0]}
    backward_seen: Dict[Any, Node] = {goal: backward_frontier[0]}
    expanded = generated = 2
    peak = 2

    def meet(state: Any, forward_node: Node, backward_node: Node) -> Node:
        """Stitch forward path to the reversed backward path."""
        tail = backward_node.path()
        tail.reverse()
        node = forward_node
        for action in tail:
            child_state = problem.result(node.state, action)
            node = Node(child_state, node, action,
                        node.path_cost + problem.step_cost(node.state, action, child_state),
                        node.depth + 1)
        return node

    while forward_frontier and backward_frontier:
        if len(forward_frontier) <= len(backward_frontier):
            frontier, seen, other_seen = forward_frontier, forward_seen, backward_seen
            is_forward = True
        else:
            frontier, seen, other_seen = backward_frontier, backward_seen, forward_seen
            is_forward = False

        node = frontier.popleft()
        expanded += 1
        if expanded > max_nodes:
            return _result("Bidirectional BFS", problem, None, expanded, peak, generated, True,
                           note="node budget exhausted")
        for action in problem.actions(node.state):
            child_state = problem.result(node.state, action)
            if child_state in seen:
                continue
            child = Node(child_state, node, action,
                         node.path_cost + problem.step_cost(node.state, action, child_state),
                         node.depth + 1)
            seen[child_state] = child
            generated += 1
            if child_state in other_seen:
                if is_forward:
                    start_node, goal_node = child, other_seen[child_state]
                    return _result("Bidirectional BFS", problem,
                                   meet(child_state, start_node, goal_node),
                                   expanded, peak, generated, True)
                start_node, goal_node = other_seen[child_state], child
                return _result("Bidirectional BFS", problem,
                               meet(child_state, start_node, goal_node),
                               expanded, peak, generated, True)
            frontier.append(child)
        peak = max(peak, len(frontier) + len(other_seen))
    return _result("Bidirectional BFS", problem, None, expanded, peak, generated, True)


def _goal_state(problem: Problem) -> Optional[Any]:
    """Recover the goal state for problems that declare it. Grid and puzzle both do."""
    if hasattr(problem, "GOAL"):
        return problem.GOAL
    if hasattr(problem, "goal"):
        return problem.goal
    return None
