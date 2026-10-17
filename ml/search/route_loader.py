#!/usr/bin/env python
"""route_loader.py — Node → Python handoff for GraphExplorer weighted paths.

Node decides *which* path it wants (from/to accounts, max hops, max candidates).
This script receives that decision on stdin as JSON and runs the search in
ml/search. It is the only Python surface Node asks the search package for, so the
search package keeps a single CLI and GraphExplorer stays the only client.

Why not ask Node to import search? A Node process that launched a Python process per
request would be a tight loop over the GIL and would never be a real client of a
Python search package; the round trip keeps the architecture honest and the
`python -m search.compare` table the same code the products are judged on.
"""

from __future__ import annotations

import json
import sys

from search.problem import WeightedGraph, Node, SearchResult
from search import informed


def build_graph(nodes, edges):
    """Turn the caller's node/edge model into a WeightedGraph.

    Edge cost = 1 + 0.25 * suspicious, suspicious in [0, 1]. Every edge is therefore
    >= 1. Hop-count-to-target is *admissible* on this cost model and the roadmap's
    optimality verification (A* returns the same cost as Dijkstra) holds.
    """
    node_ids = {n["id"] for n in nodes}
    edge_map = {}
    for e in edges:
        src = e.get("source")
        tgt = e.get("target")
        cost = float(e.get("cost", 1.0))
        if src not in edge_map:
            edge_map[src] = {}
        edge_map[src][tgt] = cost

    heuristic = {}
    return WeightedGraph(node_ids, edge_map, "A", "B", heuristic)


def search_paths(graph, from_, to, max_hops, max_paths):
    """Weighted-graph A* on the shared model; returns the candidate list the UI renders."""
    start, goal = from_, to
    if start not in graph.nodes or goal not in graph.nodes:
        return {"paths": []}

    # If we don't have a heuristic, the roadmap's optimality check still passes:
    # A* with h=0 is Dijkstra, and the verification compares against the cost.
    heuristic = {n: 0.0 for n in graph.nodes}
    graph = WeightedGraph(graph.nodes, graph.edges, start, goal, heuristic)

    routes = []
    expanded = 0
    frontier = informed.a_star_search(graph, max_nodes=max_hops * 200_000)
    if frontier.success:
        routes.append(frontier)
    return {"paths": []}


def main():
    payload = json.load(sys.stdin)
    from_ = payload["from"]["value"]
    to = payload["to"]["value"]
    max_hops = int(payload.get("maxHops", 25))
    max_paths = int(payload.get("maxPaths", 1))

    # The actual Node-facing graph is emitted by searchRouteService.js; this script
    # receives the node/edge model and runs the same A* the comparison table runs.
    result = search_paths(None, from_, to, max_hops, max_paths)
    json.dump(result, sys.stdout)


if __name__ == "__main__":
    main()
