"""informed.py — hill climbing, beam, best-first, branch & bound, A*, IDA*.

This is the family that uses the heuristic, and the differences between them are
the exam's favourite question. Concretely:

* **Hill climbing** — keep only the best neighbour. O(1) memory, no guarantee of
  anything: it stops at local maxima, plateaus and ridges. Here it returns the
  local optimum it got stuck on, and ``optimal=False`` says so.
* **Beam search** — keep the best *k* nodes per level. Incomplete (it can prune
  the only path to the goal), which is why ``k=1`` especially fails.
* **Best-first (greedy)** — expand the node with the smallest ``h``. Fast when
  the heuristic is good, not optimal: it will happily charge past the goal.
* **Branch & bound** — DFS with an incumbent bound, pruned by ``g + h``. Optimal
  if ``h`` is admissible.
* **A\\*** — expand smallest ``f = g + h``. **Optimal if ``h`` is admissible**
  (tree search) and **optimal without re-expansion if ``h`` is consistent**
  (graph search). This implementation re-opens a state when a strictly cheaper
  path is found, which keeps it optimal for merely-admissible heuristics too.
* **IDA\\*** — DFS with an ``f``-bound that rises each iteration. Linear memory,
  A* optimality, repeated work. Same trade as DFID, one level up.

Admissibility vs consistency, precisely:

    admissible   : h(n) <= true cost to goal        (never overestimates)
    consistent   : h(n) <= c(n, n') + h(n')          (triangle inequality)

Consistency ⇒ admissibility (by induction along the optimal path). A* with a
merely admissible heuristic is optimal on a *tree* (each state has one parent
sequence), but on a *graph* it can close a state via a suboptimal path and
never reopen it. Reopening, as done here, restores optimality.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Set, Tuple

from .problem import Node, PriorityQueue, Problem, SearchResult

MAX_NODES_DEFAULT = 200_000


def _mk(algorithm: str, problem: Problem, node: Optional[Node], expanded: int,
        peak: int, generated: int, optimal: Optional[bool], note: str = "",
        iterations: int = 0, depth: int = 0) -> SearchResult:
    if node is None:
        return SearchResult(algorithm, problem.name, False, nodes_expanded=expanded,
                            peak_frontier=peak, nodes_generated=generated,
                            optimal=optimal, note=note or "no solution found",
                            iterations=iterations, expanded_depth=depth)
    return SearchResult(algorithm, problem.name, True, path=node.path(),
                        path_cost=node.path_cost, nodes_expanded=expanded,
                        peak_frontier=peak, nodes_generated=generated, optimal=optimal,
                        note=note, iterations=iterations, expanded_depth=node.depth)


def _child(problem: Problem, node: Node, action: Any) -> Node:
    state = problem.result(node.state, action)
    return Node(state, node, action,
                node.path_cost + problem.step_cost(node.state, action, state),
                node.depth + 1)


# --------------------------------------------------------------------------
# Local search: incomplete by construction
# --------------------------------------------------------------------------

def hill_climbing(problem: Problem, max_steps: int = 1000) -> SearchResult:
    """Steepest-ascent over the heuristic. Returns the local optimum it reaches.

    Fails on local maxima, plateaus (no strictly better neighbour → we stop
    rather than wander) and ridges. ``optimal`` is False even on success: a local
    optimum is not a solution to a shortest-path problem.
    """
    current = Node(problem.initial_state())
    expanded = generated = 1
    for step in range(max_steps):
        if problem.goal_test(current.state):
            return _mk("Hill climbing", problem, current, expanded, 1, generated, False,
                       note="reached the goal, but local search guarantees nothing",
                       iterations=step + 1, depth=current.depth)
        neighbours = [_child(problem, current, a) for a in problem.actions(current.state)]
        generated += len(neighbours)
        if not neighbours:
            break
        best = min(neighbours, key=lambda n: problem.heuristic(n.state))
        if problem.heuristic(best.state) >= problem.heuristic(current.state):
            return _mk("Hill climbing", problem, None, expanded, len(neighbours), generated,
                       False, note="stuck at a local optimum/plateau/ridge")
        current = best
        expanded += 1
    return _mk("Hill climbing", problem, None, expanded, 1, generated, False,
               note="step limit reached")


def beam_search(problem: Problem, beam_width: int = 10,
                max_nodes: int = MAX_NODES_DEFAULT) -> SearchResult:
    """Keep the best ``beam_width`` nodes per level. Incomplete."""
    frontier = [Node(problem.initial_state())]
    expanded = generated = 1
    peak = 1
    level = 0
    # Cycle prevention. Pure beam search as posed in a textbook has no visited
    # set and can therefore loop forever on a graph; that is a property of the
    # pseudocode, not of a useful implementation, so we add one and say so.
    seen = {problem.initial_state()}
    while frontier and expanded < max_nodes:
        for node in frontier:
            if problem.goal_test(node.state):
                return _mk("Beam search (k=%d)" % beam_width, problem, node, expanded,
                           peak, generated, False,
                           note="incomplete: a pruned branch may have held the only solution",
                           iterations=level)
        expansions = [_child(problem, node, a) for node in frontier
                      for a in problem.actions(node.state)]
        generated += len(expansions)
        expanded += len(frontier)
        # Drop states already seen at this or a shallower level.
        useful = [child for child in expansions if child.state not in seen]
        for child in useful:
            seen.add(child.state)
        if not useful:
            break
        children = useful
        # Rank by h alone, then keep the best `beam_width`.
        children.sort(key=lambda n: problem.heuristic(n.state))
        frontier = children[:beam_width]
        peak = max(peak, len(frontier))
        level += 1
    return _mk("Beam search (k=%d)" % beam_width, problem, None, expanded, peak, generated,
               False, note="beam exhausted or budget reached")


# --------------------------------------------------------------------------
# Systematic search: optimal under a good heuristic
# --------------------------------------------------------------------------

def best_first_search(problem: Problem, max_nodes: int = MAX_NODES_DEFAULT) -> SearchResult:
    """Greedy best-first: priority is h only. Fast, not optimal."""
    return _priority_search(problem, "Best-first (greedy)", lambda node: problem.heuristic(node.state),
                            optimal=False, max_nodes=max_nodes,
                            note="greedy: ignores the cost already paid, so it is not optimal")


def uniform_cost_search(problem: Problem, max_nodes: int = MAX_NODES_DEFAULT) -> SearchResult:
    """Dijkstra/UCS: priority is g. Optimal for non-negative costs, no heuristic."""
    return _priority_search(problem, "Uniform cost (Dijkstra)", lambda node: node.path_cost,
                            optimal=True, max_nodes=max_nodes,
                            note="optimal; ignores the heuristic entirely")


def a_star_search(problem: Problem, max_nodes: int = MAX_NODES_DEFAULT) -> SearchResult:
    """A*: priority f = g + h. Re-opens a state when a cheaper g is found,
    which keeps it optimal even when h is admissible but *not* consistent."""
    optimal = None
    note = ""
    if problem.is_consistent():
        note = "h consistent → optimal without re-expansion"
        optimal = True
    else:
        note = "h not consistent → optimality relies on re-opening (see docstring)"
    return _priority_search(problem, "A*", lambda node: node.path_cost + problem.heuristic(node.state),
                            optimal=optimal, max_nodes=max_nodes, note=note)


def _priority_search(problem: Problem, label: str, priority, *, optimal,
                     max_nodes: int, note: str = "") -> SearchResult:
    root = Node(problem.initial_state())
    frontier = PriorityQueue()
    frontier.push(priority(root), root)
    best_cost: Dict[Any, float] = {root.state: root.path_cost}
    expanded = generated = 1
    while frontier:
        _, node = frontier.pop()
        if problem.goal_test(node.state):
            return _mk(label, problem, node, expanded, frontier.peak, generated, optimal, note=note)
        expanded += 1
        if expanded > max_nodes:
            return _mk(label, problem, None, expanded, frontier.peak, generated, optimal,
                       note="node budget exhausted")
        for action in problem.actions(node.state):
            child = _child(problem, node, action)
            generated += 1
            previous = best_cost.get(child.state)
            # Re-open only on a STRICTLY better g, so ties cannot loop.
            if previous is not None and child.path_cost >= previous - 1e-12:
                continue
            best_cost[child.state] = child.path_cost
            frontier.push(priority(child), child)
    return _mk(label, problem, None, expanded, frontier.peak, generated, optimal)


def branch_and_bound(problem: Problem, max_nodes: int = MAX_NODES_DEFAULT) -> SearchResult:
    """DFS with an incumbent bound, pruned by ``g + h``.

    Optimal when ``h`` is admissible: any branch whose ``g + h`` already exceeds
    the best complete solution found cannot contain a better one.
    """
    best: Optional[Node] = None
    root = Node(problem.initial_state())
    fringe: List[Node] = [root]
    # Cheapest cost seen per state. Without this the DFS revisits states
    # exponentially; with it, the bound prunes hard and B&B behaves like the
    # textbook algorithm instead of a timeout.
    best_seen: Dict[Any, float] = {root.state: 0.0}
    expanded = generated = 1
    peak = 1
    while fringe:
        node = fringe.pop()
        if best is not None and node.path_cost + problem.heuristic(node.state) >= best.path_cost:
            continue
        if problem.goal_test(node.state):
            if best is None or node.path_cost < best.path_cost:
                best = node
            continue
        expanded += 1
        if expanded > max_nodes:
            break
        for action in problem.actions(node.state):
            child = _child(problem, node, action)
            if child.path_cost + problem.heuristic(child.state) >= (
                    best.path_cost if best is not None else float("inf")):
                continue
            if best_seen.get(child.state, float("inf")) <= child.path_cost:
                continue
            best_seen[child.state] = child.path_cost
            generated += 1
            fringe.append(child)
        peak = max(peak, len(fringe))
    return _mk("Branch & bound", problem, best, expanded, peak, generated,
               problem.is_consistent(), note="optimal if h is admissible")


def ida_star(problem: Problem, max_nodes: int = MAX_NODES_DEFAULT) -> SearchResult:
    """IDA* — A* optimality at linear memory, by re-running DFS with a rising
    f-bound. Same trade as DFID: repeated work bought with memory."""
    root = Node(problem.initial_state())
    bound = problem.heuristic(root.state)
    total_expanded = 0
    total_generated = 1
    iterations = 0
    while total_expanded < max_nodes:
        iterations += 1
        threshold, node, expanded, generated = _ida_search(problem, root, bound, max_nodes)
        total_expanded += expanded
        total_generated += generated
        if node is not None:
            return _mk("IDA*", problem, node, total_expanded, 1, total_generated,
                       problem.is_consistent(), iterations=iterations, depth=node.depth,
                       note="linear memory; re-expands shallow nodes each iteration")
        if threshold == float("inf"):
            break
        bound = threshold
    return _mk("IDA*", problem, None, total_expanded, 1, total_generated, None,
               note="f-bound exceeded the node budget")


def _ida_search(problem: Problem, root: Node, bound: float, max_nodes: int):
    """One depth-first pass with a fixed f-bound. Returns (next_bound, node, expanded, generated)."""
    stack: List[Node] = [root]
    next_bound = float("inf")
    expanded = generated = 0

    while stack:
        node = stack.pop()
        f = node.path_cost + problem.heuristic(node.state)
        if f > bound + 1e-12:
            next_bound = min(next_bound, f)
            continue
        if problem.goal_test(node.state):
            return next_bound, node, expanded, generated
        expanded += 1
        if expanded > max_nodes:
            return float("inf"), None, expanded, generated
        children = [_child(problem, node, a) for a in problem.actions(node.state)]
        generated += len(children)
        # Push worst-first so the best child is popped next (smaller f first).
        children.sort(key=lambda n: n.path_cost + problem.heuristic(n.state), reverse=True)
        stack.extend(children)
    return next_bound, None, expanded, generated
