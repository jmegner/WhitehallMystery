#!/usr/bin/env python3
"""Reproducible graph analysis for the Whitehall Mystery report.

The script reads only the canonical JSONL map data under ``src/data/whitehall``
and writes ``reports/initial_report/analysis/analysis.json``. It intentionally mirrors the
movement graph construction in ``src/game/mapData.ts``.

Run with Python 3.11 or newer (standard library only):

    python reports/scripts/analyze_whitehall.py
"""

from __future__ import annotations

import argparse
import collections
import heapq
import itertools
import json
import math
import multiprocessing
import os
import statistics
import time
import urllib.request
from pathlib import Path
from typing import Iterable, Iterator, Sequence


HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
DATA = ROOT / "src" / "data" / "whitehall"
OUTPUT = ROOT / "reports" / "initial_report" / "analysis" / "analysis.json"
INF = 10**9
QUADRANTS = ("NW", "NE", "SW", "SE")


def read_jsonl(path: Path):
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def percentile(values: Sequence[float], p: float) -> float:
    ordered = sorted(values)
    if not ordered:
        return math.nan
    position = (len(ordered) - 1) * p
    low = int(math.floor(position))
    high = int(math.ceil(position))
    if low == high:
        return ordered[low]
    return ordered[low] * (high - position) + ordered[high] * (position - low)


def summary(values: Sequence[int | float], digits: int = 3):
    vals = list(values)
    return {
        "count": len(vals),
        "min": min(vals),
        "p25": round(percentile(vals, 0.25), digits),
        "median": round(statistics.median(vals), digits),
        "mean": round(statistics.fmean(vals), digits),
        "p75": round(percentile(vals, 0.75), digits),
        "p90": round(percentile(vals, 0.90), digits),
        "max": max(vals),
    }


def bfs_distances(adjacency: Sequence[Sequence[int]], source: int) -> list[int]:
    dist = [INF] * len(adjacency)
    dist[source] = 0
    queue = collections.deque([source])
    while queue:
        node = queue.popleft()
        nd = dist[node] + 1
        for neighbor in adjacency[node]:
            if dist[neighbor] == INF:
                dist[neighbor] = nd
                queue.append(neighbor)
    return dist


def all_pairs_shortest(adjacency: Sequence[Sequence[int]]) -> list[list[int]]:
    return [bfs_distances(adjacency, source) for source in range(len(adjacency))]


def brandes_betweenness(adjacency: Sequence[Sequence[int]]) -> list[float]:
    """Unnormalised undirected node betweenness."""
    n = len(adjacency)
    score = [0.0] * n
    for source in range(n):
        stack: list[int] = []
        pred: list[list[int]] = [[] for _ in range(n)]
        sigma = [0.0] * n
        sigma[source] = 1.0
        distance = [-1] * n
        distance[source] = 0
        queue = collections.deque([source])
        while queue:
            node = queue.popleft()
            stack.append(node)
            for neighbor in adjacency[node]:
                if distance[neighbor] < 0:
                    distance[neighbor] = distance[node] + 1
                    queue.append(neighbor)
                if distance[neighbor] == distance[node] + 1:
                    sigma[neighbor] += sigma[node]
                    pred[neighbor].append(node)
        delta = [0.0] * n
        while stack:
            node = stack.pop()
            for previous in pred[node]:
                delta[previous] += sigma[previous] / sigma[node] * (1.0 + delta[node])
            if node != source:
                score[node] += delta[node]
    return [value / 2.0 for value in score]


class MapModel:
    def __init__(self):
        self.circles = sorted(read_jsonl(DATA / "circles.jsonl"), key=lambda row: row["id"])
        self.crossings = sorted(read_jsonl(DATA / "squares.jsonl"), key=lambda row: row["id"])
        self.connections = read_jsonl(DATA / "connections.jsonl")
        self.alley_groups = [[int(value) for value in row] for row in read_jsonl(DATA / "alley_groups.jsonl")]
        self.water_groups = [[int(value) for value in row] for row in read_jsonl(DATA / "water_groups.jsonl")]
        self.circle_ids = [row["id"] for row in self.circles]
        self.crossing_ids = [row["id"] for row in self.crossings]
        self.cidx = {value: index for index, value in enumerate(self.circle_ids)}
        self.xidx = {value: index for index, value in enumerate(self.crossing_ids)}
        self.colors = [row["color"] for row in self.circles]
        self.quadrants = [self.quadrant(row["x"], row["y"]) for row in self.circles]
        self.starting_crossings = [self.xidx[row["id"]] for row in self.crossings if row["starting"]]

        self.circle_crossings: list[list[int]] = [[] for _ in self.circles]
        self.crossing_circles: list[list[int]] = [[] for _ in self.crossings]
        self.direct_crossing_edges: list[tuple[int, int]] = []
        for first_raw, second_raw in self.connections:
            first_circle = str(first_raw).isdigit()
            second_circle = str(second_raw).isdigit()
            if first_circle != second_circle:
                circle_id = int(first_raw if first_circle else second_raw)
                crossing_id = str(second_raw if first_circle else first_raw)
                ci, xi = self.cidx[circle_id], self.xidx[crossing_id]
                self.circle_crossings[ci].append(xi)
                self.crossing_circles[xi].append(ci)
            elif not first_circle:
                self.direct_crossing_edges.append((self.xidx[str(first_raw)], self.xidx[str(second_raw)]))
            else:
                raise ValueError(f"circle-to-circle raw connection: {first_raw}, {second_raw}")

        self.direct_crossing_adj: list[set[int]] = [set() for _ in self.crossings]
        for first, second in self.direct_crossing_edges:
            self.direct_crossing_adj[first].add(second)
            self.direct_crossing_adj[second].add(first)

        self.street_adj = self.build_street_adjacency(frozenset())
        self.investigator_adj: list[set[int]] = [set(neighbors) for neighbors in self.direct_crossing_adj]
        for adjacent in self.circle_crossings:
            for first, second in itertools.combinations(adjacent, 2):
                self.investigator_adj[first].add(second)
                self.investigator_adj[second].add(first)
        self.investigator_adj = [set(row) for row in self.investigator_adj]

        self.alley_adj = self.group_adjacency(self.alley_groups)
        self.boat_adj = self.group_adjacency(self.water_groups)
        self.coach_edges: list[list[tuple[int, int]]] = [[] for _ in self.circles]
        for start in range(len(self.circles)):
            seen: set[tuple[int, int]] = set()
            for middle in self.street_adj[start]:
                if self.colors[middle] == "blue":
                    continue
                for destination in self.street_adj[middle]:
                    if destination in (start, middle) or self.colors[destination] == "blue":
                        continue
                    if (destination, middle) not in seen:
                        seen.add((destination, middle))
                        self.coach_edges[start].append((destination, middle))

    @staticmethod
    def quadrant(x: float, y: float) -> str:
        return ("N" if y < 600 else "S") + ("W" if x < 600 else "E")

    def group_adjacency(self, groups: Sequence[Sequence[int]]) -> list[set[int]]:
        adjacency: list[set[int]] = [set() for _ in self.circles]
        for group in groups:
            indices = [self.cidx[value] for value in group]
            for source in indices:
                adjacency[source].update(value for value in indices if value != source)
        return adjacency

    def build_street_adjacency(self, blocked: frozenset[int]) -> list[set[int]]:
        """Jack street edges after removing occupied/blocked crossings."""
        component = [-1] * len(self.crossings)
        component_count = 0
        for crossing in range(len(self.crossings)):
            if crossing in blocked or component[crossing] >= 0:
                continue
            component[crossing] = component_count
            queue = [crossing]
            while queue:
                node = queue.pop()
                for neighbor in self.direct_crossing_adj[node]:
                    if neighbor not in blocked and component[neighbor] < 0:
                        component[neighbor] = component_count
                        queue.append(neighbor)
            component_count += 1
        circles_by_component: list[set[int]] = [set() for _ in range(component_count)]
        components_by_circle: list[set[int]] = [set() for _ in self.circles]
        for circle, crossings in enumerate(self.circle_crossings):
            for crossing in crossings:
                if crossing not in blocked:
                    comp = component[crossing]
                    components_by_circle[circle].add(comp)
                    circles_by_component[comp].add(circle)
        adjacency: list[set[int]] = [set() for _ in self.circles]
        for circle, components in enumerate(components_by_circle):
            for comp in components:
                adjacency[circle].update(circles_by_component[comp])
            adjacency[circle].discard(circle)
        return adjacency

    def validate(self):
        assert len(self.circles) == 189
        assert len(self.crossings) == 174
        assert len(self.starting_crossings) == 6
        assert all(self.colors[self.cidx[value]] != "blue" for group in self.alley_groups for value in group)
        assert all(self.colors[self.cidx[value]] == "blue" for group in self.water_groups for value in group)
        assert all(source in self.street_adj[destination] for source, row in enumerate(self.street_adj) for destination in row)


def graph_extremes(ids: Sequence[int | str], distances: Sequence[Sequence[int]]):
    eccentricities = [max(row) for row in distances]
    radius = min(eccentricities)
    diameter = max(eccentricities)
    centers = [ids[index] for index, value in enumerate(eccentricities) if value == radius]
    pairs = [
        [ids[first], ids[second]]
        for first in range(len(ids))
        for second in range(first + 1, len(ids))
        if distances[first][second] == diameter
    ]
    return {
        "radius": radius,
        "centers": centers,
        "diameter": diameter,
        "diameterPairs": pairs,
        "eccentricityDistribution": dict(sorted(collections.Counter(eccentricities).items())),
        "lowestEccentricityRank": [
            {"id": ids[index], "eccentricity": eccentricities[index], "meanDistance": round(statistics.fmean(distances[index]), 3)}
            for index in sorted(range(len(ids)), key=lambda i: (eccentricities[i], statistics.fmean(distances[i]), str(ids[i])))[:20]
        ],
    }


def constrained_distances(model: MapModel, source: int, allowed: frozenset[str]):
    """Minimum action-turn and track-slot distances with <=2 of each allowed special."""
    resource_names = tuple(sorted(allowed))
    limits = (3,) * len(resource_names)
    start_resource = (0,) * len(resource_names)
    action_dist: dict[tuple[int, tuple[int, ...]], int] = {(source, start_resource): 0}
    queue = collections.deque([(source, start_resource)])
    while queue:
        node, used = queue.popleft()
        distance = action_dist[(node, used)]
        edges: list[tuple[int, str | None]] = [(destination, None) for destination in model.street_adj[node]]
        if "alley" in allowed:
            edges.extend((destination, "alley") for destination in model.alley_adj[node])
        if "boat" in allowed:
            edges.extend((destination, "boat") for destination in model.boat_adj[node])
        if "coach" in allowed:
            edges.extend((destination, "coach") for destination, _ in model.coach_edges[node])
        for destination, resource in edges:
            next_used = used
            if resource is not None:
                position = resource_names.index(resource)
                if used[position] >= 2:
                    continue
                mutable = list(used)
                mutable[position] += 1
                next_used = tuple(mutable)
            state = (destination, next_used)
            if state not in action_dist:
                action_dist[state] = distance + 1
                queue.append(state)
    actions = [INF] * len(model.circles)
    slots = [INF] * len(model.circles)
    for (node, used), turns in action_dist.items():
        actions[node] = min(actions[node], turns)
        coach_count = used[resource_names.index("coach")] if "coach" in allowed else 0
        slots[node] = min(slots[node], turns + coach_count)
    return actions, slots


def constrained_extremes(model: MapModel, allowed: frozenset[str]):
    action_matrix: list[list[int]] = []
    slot_matrix: list[list[int]] = []
    for source in range(len(model.circles)):
        action, slots = constrained_distances(model, source, allowed)
        action_matrix.append(action)
        slot_matrix.append(slots)
    return {
        "allowedSpecials": sorted(allowed),
        "actionTurns": graph_extremes(model.circle_ids, action_matrix),
        "moveTrackSlots": graph_extremes(model.circle_ids, slot_matrix),
    }, action_matrix, slot_matrix


def exact_resource_profiles_to_targets(model: MapModel, target_indices: Sequence[int]):
    """Pair profiles for tours with forced normal/street entry to each target.

    Profile keys are (alleys, boats, coaches), each 0..2. Every route's first
    arrival at the target is by a normal move. Coach routes using the target as
    their intermediate or destination are excluded.
    """
    incoming: list[list[tuple[int, str | None, int | None]]] = [[] for _ in model.circles]
    for source, destinations in enumerate(model.street_adj):
        for destination in destinations:
            incoming[destination].append((source, None, None))
    for source, destinations in enumerate(model.alley_adj):
        for destination in destinations:
            incoming[destination].append((source, "alley", None))
    for source, destinations in enumerate(model.boat_adj):
        for destination in destinations:
            incoming[destination].append((source, "boat", None))
    for source, destinations in enumerate(model.coach_edges):
        for destination, middle in destinations:
            incoming[destination].append((source, "coach", middle))

    all_profiles: dict[tuple[int, int], list[tuple[int, int, int, int]]] = {}
    resource_position = {"alley": 0, "boat": 1, "coach": 2}
    for target_number, target in enumerate(target_indices, start=1):
        # Reverse BFS starts immediately before the mandatory final street edge.
        dist: dict[tuple[int, int, int, int], int] = {}
        queue = collections.deque()
        for predecessor in model.street_adj[target]:
            state = (predecessor, 0, 0, 0)
            dist[state] = 1
            queue.append(state)
        while queue:
            node, alleys, boats, coaches = queue.popleft()
            turns = dist[(node, alleys, boats, coaches)]
            for predecessor, resource, middle in incoming[node]:
                if predecessor == target:
                    continue
                if resource == "coach" and middle == target:
                    continue
                counts = [alleys, boats, coaches]
                if resource is not None:
                    position = resource_position[resource]
                    if counts[position] >= 2:
                        continue
                    counts[position] += 1
                state = (predecessor, counts[0], counts[1], counts[2])
                if state not in dist:
                    dist[state] = turns + 1
                    queue.append(state)
        for source in target_indices:
            if source == target:
                continue
            raw = [
                (alleys, boats, coaches, turns)
                for (node, alleys, boats, coaches), turns in dist.items()
                if node == source
            ]
            # A profile with weakly more of every resource and no fewer turns can
            # never improve a globally resource-constrained tour.
            nondominated = []
            for profile in sorted(raw, key=lambda row: (row[3], sum(row[:3]), row[:3])):
                a, b, c, turns = profile
                if any(pa <= a and pb <= b and pc <= c and pt <= turns for pa, pb, pc, pt in nondominated):
                    continue
                nondominated.append(profile)
            all_profiles[(source, target)] = nondominated
        if target_number % 20 == 0:
            print(f"  discovery-entry profiles: {target_number}/{len(target_indices)} targets", flush=True)
    return all_profiles


def best_route_for_four(
    nodes: tuple[int, int, int, int],
    profiles: dict[tuple[int, int], list[tuple[int, int, int, int]]],
    optimise_slots: bool,
):
    best: tuple[int, int, tuple[int, ...], tuple[int, int, int]] | None = None
    # Reverse routes are equivalent between white endpoints, so fixing a
    # canonical orientation removes half the permutations.
    for order in itertools.permutations(nodes):
        if order[0] > order[-1]:
            continue
        states = {(0, 0, 0): 0}
        for first, second in zip(order, order[1:]):
            next_states: dict[tuple[int, int, int], int] = {}
            for used, cost in states.items():
                for alleys, boats, coaches, turns in profiles[(first, second)]:
                    total = (used[0] + alleys, used[1] + boats, used[2] + coaches)
                    if any(value > 2 for value in total):
                        continue
                    increment = turns + coaches if optimise_slots else turns
                    next_states[total] = min(next_states.get(total, INF), cost + increment)
            # Pareto prune partial route states.
            states = {
                resources: cost
                for resources, cost in next_states.items()
                if not any(
                    other != resources
                    and all(other[i] <= resources[i] for i in range(3))
                    and other_cost <= cost
                    for other, other_cost in next_states.items()
                )
            }
        if not states:
            continue
        resources, cost = min(states.items(), key=lambda row: (row[1], sum(row[0]), row[0]))
        turns = cost if not optimise_slots else cost - resources[2]
        slots = turns + resources[2]
        candidate = (cost, slots if not optimise_slots else turns, order, resources)
        if best is None or candidate[:2] < best[:2]:
            best = candidate
    assert best is not None
    primary, _, order, resources = best
    turns = primary if not optimise_slots else primary - resources[2]
    slots = turns + resources[2]
    return {"actionTurns": turns, "moveTrackSlots": slots, "order": order, "resources": resources}


def best_routes_for_four_both_objectives(
    nodes: tuple[int, int, int, int],
    profiles: dict[tuple[int, int], list[tuple[int, int, int, int]]],
    allowed_resources: frozenset[int],
):
    """Return action- and slot-optimal routes in one DP pass per ordering."""
    best_action = None
    best_slots = None
    for order in itertools.permutations(nodes):
        states = {(0, 0, 0): 0}
        for first, second in zip(order, order[1:]):
            next_states: dict[tuple[int, int, int], int] = {}
            for used, cost in states.items():
                for alleys, boats, coaches, turns in profiles[(first, second)]:
                    counts = (alleys, boats, coaches)
                    if any(counts[position] and position not in allowed_resources for position in range(3)):
                        continue
                    total = (used[0] + alleys, used[1] + boats, used[2] + coaches)
                    if any(value > 2 for value in total):
                        continue
                    next_states[total] = min(next_states.get(total, INF), cost + turns)
            states = {
                resources: cost
                for resources, cost in next_states.items()
                if not any(
                    other != resources
                    and all(other[i] <= resources[i] for i in range(3))
                    and other_cost <= cost
                    for other, other_cost in next_states.items()
                )
            }
        action_resources, action_turns = min(states.items(), key=lambda row: (row[1], row[1] + row[0][2], sum(row[0]), row[0]))
        slot_resources, slot_turns = min(states.items(), key=lambda row: (row[1] + row[0][2], row[1], sum(row[0]), row[0]))
        action_candidate = (action_turns, action_turns + action_resources[2], order, action_resources)
        slot_candidate = (slot_turns + slot_resources[2], slot_turns, order, slot_resources)
        if best_action is None or action_candidate < best_action:
            best_action = action_candidate
        if best_slots is None or slot_candidate < best_slots:
            best_slots = slot_candidate
    assert best_action is not None and best_slots is not None
    return (
        {"actionTurns": best_action[0], "moveTrackSlots": best_action[1], "order": best_action[2], "resources": best_action[3]},
        {"moveTrackSlots": best_slots[0], "actionTurns": best_slots[1], "order": best_slots[2], "resources": best_slots[3]},
    )


def route_street_metrics(nodes: tuple[int, int, int, int], street_dist: Sequence[Sequence[int]]):
    by_start: dict[int, tuple[int, tuple[int, ...]]] = {}
    for start in nodes:
        best = min(
            (sum(street_dist[a][b] for a, b in zip(order, order[1:])), order)
            for order in itertools.permutations(nodes)
            if order[0] == start
        )
        by_start[start] = best
    best_cost, best_order = min(by_start.values())
    max_cost, max_order = max(
        (sum(street_dist[a][b] for a, b in zip(order, order[1:])), order)
        for order in itertools.permutations(nodes)
    )
    return {
        "bestStartTurns": best_cost,
        "bestOrder": best_order,
        "longestOrderTurns": max_cost,
        "longestOrder": max_order,
        "worstForcedStartTurns": max(value[0] for value in by_start.values()),
        "byStart": {start: {"turns": value[0], "order": value[1]} for start, value in by_start.items()},
    }


def compact_set_record(model: MapModel, indices: tuple[int, int, int, int], metrics: dict):
    def convert_order(order):
        return [model.circle_ids[value] for value in order]

    result = {"locations": [model.circle_ids[value] for value in indices]}
    for key, value in metrics.items():
        if key in ("order", "bestOrder", "longestOrder"):
            result[key] = convert_order(value)
        elif key == "resources":
            result[key] = {"alley": value[0], "boat": value[1], "coach": value[2]}
        elif key == "byStart":
            result[key] = {
                str(model.circle_ids[start]): {"turns": details["turns"], "order": convert_order(details["order"])}
                for start, details in value.items()
            }
        else:
            result[key] = value
    return result


_WORKER_STREET_DIST = None
_WORKER_PROFILES = None


def _init_discovery_worker(street_dist, profiles):
    global _WORKER_STREET_DIST, _WORKER_PROFILES
    _WORKER_STREET_DIST = street_dist
    _WORKER_PROFILES = profiles


def _discovery_chunk(nodes_chunk):
    street_dist = _WORKER_STREET_DIST
    profiles = _WORKER_PROFILES
    scenarios = {
        "coachOnly": frozenset({2}),
        "alleyOnly": frozenset({0}),
        "boatOnly": frozenset({1}),
        "allSpecials": frozenset({0, 1, 2}),
    }
    result = {"street": []}
    for scenario in scenarios:
        result[scenario + "Action"] = []
        result[scenario + "Slots"] = []
    for nodes in nodes_chunk:
        street = route_street_metrics(nodes, street_dist)
        result["street"].append((street["bestStartTurns"], street["worstForcedStartTurns"], nodes, street))
        for scenario, allowed in scenarios.items():
            action, slots = best_routes_for_four_both_objectives(nodes, profiles, allowed)
            result[scenario + "Action"].append((action["actionTurns"], action["moveTrackSlots"], nodes, action))
            result[scenario + "Slots"].append((slots["moveTrackSlots"], slots["actionTurns"], nodes, slots))
    compact = {}
    for name, records in result.items():
        records.sort(key=lambda row: (row[0], row[1], row[2]))
        compact[name] = {
            "distribution": collections.Counter(row[0] for row in records),
            "best": records[:20],
            "worst": records[-20:][::-1],
        }
    return compact


def discovery_set_analysis(model: MapModel, street_dist, profiles):
    whites_by_quadrant = {
        quadrant: [i for i, color in enumerate(model.colors) if color == "white" and model.quadrants[i] == quadrant]
        for quadrant in QUADRANTS
    }
    total = math.prod(len(whites_by_quadrant[q]) for q in QUADRANTS)
    start_time = time.perf_counter()
    product = itertools.product(*(whites_by_quadrant[q] for q in QUADRANTS))
    chunk_size = 1000
    chunks = iter(lambda: list(itertools.islice(product, chunk_size)), [])
    workers = min(12, os.cpu_count() or 1)
    merged = {}
    processed = 0
    context = multiprocessing.get_context("spawn")
    with context.Pool(workers, initializer=_init_discovery_worker, initargs=(street_dist, profiles)) as pool:
        for chunk_result in pool.imap_unordered(_discovery_chunk, chunks, chunksize=1):
            for name, values in chunk_result.items():
                target = merged.setdefault(name, {"distribution": collections.Counter(), "best": [], "worst": []})
                target["distribution"].update(values["distribution"])
                target["best"].extend(values["best"])
                target["best"].sort(key=lambda row: (row[0], row[1], row[2]))
                del target["best"][20:]
                target["worst"].extend(values["worst"])
                target["worst"].sort(reverse=True, key=lambda row: (row[0], row[1], row[2]))
                del target["worst"][20:]
            processed += sum(chunk_result["street"]["distribution"].values())
            if processed % 25000 < chunk_size:
                elapsed = time.perf_counter() - start_time
                print(f"  discovery sets: {processed}/{total} ({elapsed:.1f}s, {workers} workers)", flush=True)

    def extremes(name):
        values = merged[name]
        return {
            "distribution": dict(sorted(values["distribution"].items())),
            "best": [compact_set_record(model, row[2], row[3]) for row in values["best"]],
            "worst": [compact_set_record(model, row[2], row[3]) for row in values["worst"]],
        }

    return {
        "legalSetCount": total,
        "whiteCountsByQuadrant": {q: len(v) for q, v in whites_by_quadrant.items()},
        "streetOnly": extremes("street"),
        "upToTwoCoaches": {"optimiseActionTurns": extremes("coachOnlyAction"), "optimiseMoveTrackSlots": extremes("coachOnlySlots")},
        "upToTwoAlleys": {"optimiseActionTurns": extremes("alleyOnlyAction"), "optimiseMoveTrackSlots": extremes("alleyOnlySlots")},
        "upToTwoBoats": {"optimiseActionTurns": extremes("boatOnlyAction"), "optimiseMoveTrackSlots": extremes("boatOnlySlots")},
        "upToTwoEachSpecial": {"optimiseActionTurns": extremes("allSpecialsAction"), "optimiseMoveTrackSlots": extremes("allSpecialsSlots")},
    }


def quadrant_analysis(model: MapModel, street_dist, scenario_matrices):
    whites = {
        q: [i for i, color in enumerate(model.colors) if color == "white" and model.quadrants[i] == q]
        for q in QUADRANTS
    }
    opposite = {"NW": "SE", "SE": "NW", "NE": "SW", "SW": "NE"}
    adjacent = {q: [other for other in QUADRANTS if other != q and other != opposite[q]] for q in QUADRANTS}

    def analyse_matrix(matrix):
        output = {}
        for source_q in QUADRANTS:
            targets = {
                "adjacentQuadrants": [i for q in adjacent[source_q] for i in whites[q]],
                "diagonalQuadrant": whites[opposite[source_q]],
                "allOtherQuadrants": [i for q in QUADRANTS if q != source_q for i in whites[q]],
            }
            output[source_q] = {}
            for label, target_nodes in targets.items():
                nearest = [min(matrix[source][target] for target in target_nodes) for source in whites[source_q]]
                pairwise = [matrix[source][target] for source in whites[source_q] for target in target_nodes]
                output[source_q][label] = {
                    "nearestTargetFromEachSourceWhite": summary(nearest),
                    "allSourceTargetPairs": summary(pairwise),
                }
            adjacent_each = [
                max(min(matrix[source][target] for target in whites[target_q]) for target_q in adjacent[source_q])
                for source in whites[source_q]
            ]
            every_other = [
                max(
                    min(matrix[source][target] for target in whites[target_q])
                    for target_q in QUADRANTS
                    if target_q != source_q
                )
                for source in whites[source_q]
            ]
            output[source_q]["coverEachAdjacentQuadrant"] = {
                "perSourceWorstNearestQuadrantDistance": summary(adjacent_each)
            }
            output[source_q]["coverEveryOtherQuadrant"] = {
                "perSourceWorstNearestQuadrantDistance": summary(every_other)
            }
        return output

    return {name: analyse_matrix(matrix) for name, matrix in scenario_matrices.items()}


def investigator_analysis(model: MapModel, crossing_dist, street_dist):
    white_indices = [i for i, color in enumerate(model.colors) if color == "white"]
    investigator_turns_to_circle: list[list[int]] = []
    for crossing in range(len(model.crossings)):
        values = []
        for circle in range(len(model.circles)):
            distance = min(crossing_dist[crossing][adjacent] for adjacent in model.circle_crossings[circle])
            values.append(math.ceil(distance / 2))
        investigator_turns_to_circle.append(values)

    deployment_records = []
    for starts in itertools.combinations(model.starting_crossings, 3):
        access = [min(investigator_turns_to_circle[start][circle] for start in starts) for circle in white_indices]
        deployment_records.append({
            "crossings": [model.crossing_ids[value] for value in starts],
            "worstTurnsToAnyWhite": max(access),
            "meanTurnsToWhite": round(statistics.fmean(access), 3),
            "medianTurnsToWhite": statistics.median(access),
            "whiteReachedAtTurn0": sum(value == 0 for value in access),
            "whiteReachedWithin1Turn": sum(value <= 1 for value in access),
            "whiteReachedWithin2Turns": sum(value <= 2 for value in access),
        })
    deployment_records.sort(key=lambda row: (row["worstTurnsToAnyWhite"], row["meanTurnsToWhite"], -row["whiteReachedAtTurn0"], row["crossings"]))

    # Per-discovery best deployment set; useful because setup precedes the public
    # reveal, while this is an optimistic hindsight benchmark.
    per_discovery = []
    all_deployments = list(itertools.combinations(model.starting_crossings, 3))
    for circle in white_indices:
        best_turn = min(min(investigator_turns_to_circle[s][circle] for s in starts) for starts in all_deployments)
        best_sets = [
            [model.crossing_ids[s] for s in starts]
            for starts in all_deployments
            if min(investigator_turns_to_circle[s][circle] for s in starts) == best_turn
        ]
        per_discovery.append({"circle": model.circle_ids[circle], "turns": best_turn, "bestStartingSets": best_sets})

    crossing_betweenness = brandes_betweenness([list(row) for row in model.investigator_adj])
    crossing_rank = sorted(
        range(len(model.crossings)),
        key=lambda crossing: (-crossing_betweenness[crossing], model.crossing_ids[crossing]),
    )

    circle_access = []
    for circle in range(len(model.circles)):
        incident = model.circle_crossings[circle]
        street_degree = len(model.street_adj[circle])
        action_surface = set()
        for crossing in incident:
            action_surface.update(model.crossing_circles[crossing])
        start_turn = min(investigator_turns_to_circle[start][circle] for start in model.starting_crossings)
        circle_access.append({
            "circle": model.circle_ids[circle],
            "color": model.colors[circle],
            "quadrant": model.quadrants[circle],
            "adjacentCrossingCount": len(incident),
            "streetDegree": street_degree,
            "streetExitsPerAdjacentCrossing": round(street_degree / max(1, len(incident)), 3),
            "nearestStartingCrossingTurns": start_turn,
            "adjacentCrossings": [model.crossing_ids[value] for value in incident],
        })

    return {
        "crossingGraph": graph_extremes(model.crossing_ids, crossing_dist),
        "startingCrossings": [model.crossing_ids[value] for value in model.starting_crossings],
        "startingSetRank": deployment_records,
        "perDiscoveryOptimisticHindsightDeployment": per_discovery,
        "topCrossingBetweenness": [
            {"crossing": model.crossing_ids[value], "betweenness": round(crossing_betweenness[value], 3)}
            for value in crossing_rank[:30]
        ],
        "circleCatchUpFeatures": circle_access,
        "investigatorTurnsToCircleFromStartingCrossing": {
            model.crossing_ids[start]: {str(model.circle_ids[circle]): investigator_turns_to_circle[start][circle] for circle in range(len(model.circles))}
            for start in model.starting_crossings
        },
    }, investigator_turns_to_circle


def pair_safety_analysis(model: MapModel, street_dist, investigator_turns_to_circle):
    """Directed discovery-pair proxies, clearly not a hidden-information solver."""
    whites = [i for i, color in enumerate(model.colors) if color == "white"]
    start_sets = list(itertools.combinations(model.starting_crossings, 3))
    global_best_set = min(
        start_sets,
        key=lambda starts: (
            max(min(investigator_turns_to_circle[s][circle] for s in starts) for circle in whites),
            statistics.fmean(min(investigator_turns_to_circle[s][circle] for s in starts) for circle in whites),
        ),
    )
    records = []
    for source in whites:
        for target in whites:
            if source == target or model.quadrants[source] == model.quadrants[target]:
                continue
            jack_turns = street_dist[source][target]
            inv_arrival = min(investigator_turns_to_circle[start][target] for start in global_best_set)
            # Positive head start means Jack reaches the destination before an
            # investigator deployed at the globally best set could be adjacent.
            head_start = inv_arrival - jack_turns
            route_slack, min_exposure, path = safest_shortest_path(
                model, source, target, street_dist, investigator_turns_to_circle, global_best_set
            )
            records.append({
                "from": model.circle_ids[source],
                "to": model.circle_ids[target],
                "fromQuadrant": model.quadrants[source],
                "toQuadrant": model.quadrants[target],
                "jackStreetTurns": jack_turns,
                "investigatorTurnsToDestination": inv_arrival,
                "destinationHeadStart": head_start,
                "minimumOmniscientlyCoverableStepsAmongShortestPaths": min_exposure,
                "minimumWorstCatchupSlackAmongShortestPaths": route_slack,
                "exampleSafestShortestPath": [model.circle_ids[value] for value in path],
            })
    records.sort(
        key=lambda row: (
            -row["destinationHeadStart"],
            row["minimumOmniscientlyCoverableStepsAmongShortestPaths"],
            -row["minimumWorstCatchupSlackAmongShortestPaths"],
            row["jackStreetTurns"],
            row["from"], row["to"],
        )
    )
    return {
        "deploymentSetUsed": [model.crossing_ids[value] for value in global_best_set],
        "interpretation": "Static lower-bound proxies. Investigators are treated as if they knew the route; clue-search order, inference, occupied-crossing blocking, and simultaneous multi-investigator coordination are not solved.",
        "bestForJack": records[:30],
        "worstForJack": records[-30:][::-1],
    }


def safest_shortest_path(model, source, target, street_dist, investigator_turns_to_circle, starts):
    """DP over the shortest-path DAG, minimising coverable steps then worst slack."""
    length = street_dist[source][target]
    layers = {0: [source]}
    for distance in range(1, length + 1):
        layers[distance] = [
            node for node in range(len(model.circles))
            if street_dist[source][node] == distance and distance + street_dist[node][target] == length
        ]
    state = {source: (0, INF, [source])}
    for turn in range(1, length + 1):
        next_state = {}
        for node in layers[turn]:
            inv_turn = min(investigator_turns_to_circle[start][node] for start in starts)
            coverable = 1 if inv_turn <= turn else 0
            slack = inv_turn - turn
            candidates = []
            for previous in model.street_adj[node]:
                if previous in state:
                    previous_exposure, previous_worst, previous_path = state[previous]
                    candidates.append((previous_exposure + coverable, min(previous_worst, slack), previous_path + [node]))
            if candidates:
                next_state[node] = min(candidates, key=lambda row: (row[0], -row[1], row[2]))
        state = next_state
    exposure, worst_slack, path = state[target]
    return worst_slack, exposure, path


def blockade_analysis(model: MapModel, street_dist, crossing_dist, crossing_betweenness_ids: Sequence[str]):
    """Search three-crossing quadrant blockades over a defensible candidate set.

    Candidate crossings are every crossing incident to a cross-quadrant street
    transition plus the globally highest investigator-graph betweenness nodes.
    This is exhaustive over that disclosed candidate set, not all C(174, 3).
    """
    boundary_seeds: set[int] = set()
    for source, destinations in enumerate(model.street_adj):
        for destination in destinations:
            if model.quadrants[source] == model.quadrants[destination]:
                continue
            boundary_seeds.update(model.circle_crossings[source])
            boundary_seeds.update(model.circle_crossings[destination])
    # A direct crossing component can offer alternate routes for the same
    # street connection, so include the full component of every boundary seed.
    boundary: set[int] = set(boundary_seeds)
    queue = collections.deque(boundary_seeds)
    while queue:
        crossing = queue.popleft()
        for neighbor in model.direct_crossing_adj[crossing]:
            if neighbor not in boundary:
                boundary.add(neighbor)
                queue.append(neighbor)
    high_centrality = {model.xidx[value] for value in crossing_betweenness_ids[:20]}
    candidates = sorted(boundary | high_centrality)
    whites = {
        q: [i for i, color in enumerate(model.colors) if color == "white" and model.quadrants[i] == q]
        for q in QUADRANTS
    }

    def distances_to_target(adjacency, target_q):
        # Multi-source BFS from target whites in the undirected Jack street graph.
        distances = [INF] * len(model.circles)
        queue = collections.deque()
        for target in whites[target_q]:
            distances[target] = 0
            queue.append(target)
        while queue:
            node = queue.popleft()
            for neighbor in adjacency[node]:
                if distances[neighbor] == INF:
                    distances[neighbor] = distances[node] + 1
                    queue.append(neighbor)
        return distances

    def nearest_target_stats(distances, target_q, baseline_distances):
        outside = [i for q in QUADRANTS if q != target_q for i in whites[q]]
        finite_indices = [i for i in outside if distances[i] < INF]
        finite = [distances[i] for i in finite_indices]
        increases = [distances[i] - baseline_distances[i] for i in finite_indices]
        source_means = {}
        source_delayed = {}
        for source_q in QUADRANTS:
            if source_q == target_q:
                continue
            source_increases = [
                distances[i] - baseline_distances[i]
                for i in whites[source_q]
                if distances[i] < INF
            ]
            source_means[source_q] = statistics.fmean(source_increases) if source_increases else None
            source_delayed[source_q] = sum(value > 0 for value in source_increases)
        finite_source_means = [value for value in source_means.values() if value is not None]
        return {
            "mean": statistics.fmean(finite) if finite else INF,
            "max": max(finite) if finite else INF,
            "unreachable": sum(distances[i] == INF for i in outside),
            "outsideCount": len(outside),
            "meanIncrease": statistics.fmean(increases) if increases else INF,
            "medianIncrease": statistics.median(increases) if increases else INF,
            "maxIncrease": max(increases) if increases else INF,
            "delayedCount": sum(value > 0 for value in increases),
            "meanIncreaseBySourceQuadrant": source_means,
            "delayedCountBySourceQuadrant": source_delayed,
            "minimumSourceQuadrantMeanIncrease": min(finite_source_means) if finite_source_means else None,
        }

    def formation_plan(blockers):
        best = None
        for starts in itertools.permutations(model.starting_crossings, len(blockers)):
            turns = tuple(math.ceil(crossing_dist[start][blocker] / 2) for start, blocker in zip(starts, blockers))
            key = (max(turns), sum(turns), tuple(model.crossing_ids[start] for start in starts))
            if best is None or key < best[0]:
                best = (key, starts, turns)
        assert best is not None
        return {
            "minimumFormationTurns": best[0][0],
            "exampleAssignment": [
                {
                    "start": model.crossing_ids[start],
                    "destination": model.crossing_ids[blocker],
                    "movementTurns": turns,
                }
                for start, blocker, turns in zip(best[1], blockers, best[2])
            ],
        }

    output = {
        "candidateCrossings": [model.crossing_ids[value] for value in candidates],
        "candidateCount": len(candidates),
        "searchScope": "All three-crossing combinations from boundary-transition incident crossings plus the top 20 investigator betweenness crossings.",
        "quadrants": {},
    }
    for quadrant in QUADRANTS:
        baseline_distances = distances_to_target(model.street_adj, quadrant)
        baseline = nearest_target_stats(baseline_distances, quadrant, baseline_distances)
        ranked = []
        for blockers in itertools.combinations(candidates, 3):
            adjacency = model.build_street_adjacency(frozenset(blockers))
            distances = distances_to_target(adjacency, quadrant)
            stats = nearest_target_stats(distances, quadrant, baseline_distances)
            ranked.append((stats, blockers))
        ranked.sort(
            reverse=True,
            key=lambda row: (
                row[0]["unreachable"],
                row[0]["meanIncrease"],
                row[0]["delayedCount"],
                row[0]["maxIncrease"],
                tuple(model.crossing_ids[x] for x in row[1]),
            ),
        )

        def blockade_record(row):
            stats, blockers = row
            return {
                "crossings": [model.crossing_ids[value] for value in blockers],
                "outsideWhiteCount": stats["outsideCount"],
                "unreachableOutsideWhites": stats["unreachable"],
                "delayedOutsideWhites": stats["delayedCount"],
                "meanTurnsFromOutsideWhiteToNearestTargetWhite": round(stats["mean"], 3),
                "maxTurns": stats["max"],
                "meanIncrease": round(stats["meanIncrease"], 3),
                "medianIncrease": round(stats["medianIncrease"], 3),
                "maxIncrease": stats["maxIncrease"],
                "meanIncreaseBySourceQuadrant": {
                    key: round(value, 3) if value is not None else None
                    for key, value in stats["meanIncreaseBySourceQuadrant"].items()
                },
                "delayedCountBySourceQuadrant": stats["delayedCountBySourceQuadrant"],
                "minimumSourceQuadrantMeanIncrease": (
                    round(stats["minimumSourceQuadrantMeanIncrease"], 3)
                    if stats["minimumSourceQuadrantMeanIncrease"] is not None
                    else None
                ),
                **formation_plan(blockers),
            }

        connected_delay = sorted(
            (row for row in ranked if row[0]["unreachable"] == 0),
            reverse=True,
            key=lambda row: (
                row[0]["meanIncrease"],
                row[0]["delayedCount"],
                row[0]["medianIncrease"],
                row[0]["maxIncrease"],
                tuple(model.crossing_ids[x] for x in row[1]),
            ),
        )
        robust_cordons = sorted(
            (row for row in ranked if row[0]["unreachable"] == 0),
            reverse=True,
            key=lambda row: (
                row[0]["minimumSourceQuadrantMeanIncrease"],
                row[0]["meanIncrease"],
                row[0]["delayedCount"],
                row[0]["maxIncrease"],
                tuple(model.crossing_ids[x] for x in row[1]),
            ),
        )
        output["quadrants"][quadrant] = {
            "baselineNearestEntry": {
                "mean": round(baseline["mean"], 3),
                "max": baseline["max"],
                "outsideWhiteCount": baseline["outsideCount"],
            },
            # A disconnected origin has infinite travel time and therefore
            # outranks every finite delay in the containment list. The second
            # list separately answers the less absolute question: which triple
            # delays entry most while keeping every outside white connected?
            "bestThreeCrossingBlockades": [blockade_record(row) for row in ranked[:20]],
            "bestConnectedThreeCrossingDelays": [blockade_record(row) for row in connected_delay[:20]],
            "bestRobustThreeCrossingCordons": [blockade_record(row) for row in robust_cordons[:20]],
        }
        print(f"  blockades: {quadrant}, {math.comb(len(candidates), 3)} triples", flush=True)
    return output


def mobility_and_backtracking(model: MapModel, street_dist):
    betweenness = brandes_betweenness([list(row) for row in model.street_adj])
    rows = []
    for source in range(len(model.circles)):
        neighbors = model.street_adj[source]
        two_step_walks = sum(len(model.street_adj[neighbor]) for neighbor in neighbors)
        no_immediate_return_walks = sum(max(0, len(model.street_adj[neighbor]) - 1) for neighbor in neighbors)
        endpoints2 = {end for neighbor in neighbors for end in model.street_adj[neighbor]}
        alley_gain = max([street_dist[source][destination] - 1 for destination in model.alley_adj[source]] or [0])
        boat_gain = max([street_dist[source][destination] - 1 for destination in model.boat_adj[source]] or [0])
        # Local investigator control proxy: minimum incident crossings whose
        # occupation removes every current normal destination.
        blocker_number, blocker_sets = minimum_exit_blockers(model, source)
        rows.append({
            "circle": model.circle_ids[source],
            "color": model.colors[source],
            "quadrant": model.quadrants[source],
            "streetDegree": len(neighbors),
            "streetBetweenness": round(betweenness[source], 3),
            "twoStepWalkCount": two_step_walks,
            "twoStepNonImmediateBacktrackWalkCount": no_immediate_return_walks,
            "distinctTwoStepEndpoints": len(endpoints2),
            "immediateBacktrackRouteFraction": round((two_step_walks - no_immediate_return_walks) / max(1, two_step_walks), 4),
            "maximumSingleAlleySaving": alley_gain,
            "maximumSingleBoatSaving": boat_gain,
            "minimumOccupiedCrossingsToBlockAllCurrentStreetMoves": blocker_number,
            "exampleMinimumBlockerSets": [[model.crossing_ids[x] for x in values] for values in blocker_sets[:10]],
        })

    catch = sorted(rows, key=lambda row: (row["minimumOccupiedCrossingsToBlockAllCurrentStreetMoves"], row["streetDegree"], row["streetBetweenness"], row["circle"]))
    outrun_street = sorted(rows, key=lambda row: (-row["minimumOccupiedCrossingsToBlockAllCurrentStreetMoves"], -row["streetDegree"], -row["distinctTwoStepEndpoints"], row["circle"]))
    outrun_alley = sorted(rows, key=lambda row: (-row["maximumSingleAlleySaving"], -row["streetDegree"], row["circle"]))
    outrun_boat = sorted(rows, key=lambda row: (-row["maximumSingleBoatSaving"], -row["streetDegree"], row["circle"]))
    backtrack = sorted(rows, key=lambda row: (-row["twoStepWalkCount"], row["immediateBacktrackRouteFraction"], row["circle"]))
    return {
        "catchUpLocations": catch[:30],
        "streetOutrunLocations": outrun_street[:30],
        "alleyEscapeLocations": outrun_alley[:30],
        "boatEscapeLocations": outrun_boat[:30],
        "backtrackingAndRouteAmbiguity": backtrack[:30],
        "allCircleFeatures": rows,
    }


def minimum_exit_blockers(model: MapModel, source: int):
    destinations = model.street_adj[source]
    if not destinations:
        return 0, [tuple()]
    candidate_crossings = sorted(model.circle_crossings[source])
    # Direct crossing chains mean a blocker away from the source may also cut an
    # exit. Add the full directly-connected components incident to the source.
    queue = list(candidate_crossings)
    expanded = set(candidate_crossings)
    while queue:
        node = queue.pop()
        for neighbor in model.direct_crossing_adj[node]:
            if neighbor not in expanded:
                expanded.add(neighbor)
                queue.append(neighbor)
    candidates = sorted(expanded)
    for count in range(1, min(5, len(candidates)) + 1):
        winning = []
        for blockers in itertools.combinations(candidates, count):
            if not model.build_street_adjacency(frozenset(blockers))[source]:
                winning.append(blockers)
                if len(winning) >= 10:
                    return count, winning
        if winning:
            return count, winning
    return None, []


def discovery_move_options(model: MapModel):
    rows = [
        {
            "circle": model.circle_ids[index],
            "quadrant": model.quadrants[index],
            "streetDestinationCount": len(model.street_adj[index]),
            "destinations": [model.circle_ids[value] for value in sorted(model.street_adj[index])],
        }
        for index, color in enumerate(model.colors)
        if color == "white"
    ]
    return {
        "distribution": dict(sorted(collections.Counter(row["streetDestinationCount"] for row in rows).items())),
        "best": sorted(rows, key=lambda row: (-row["streetDestinationCount"], row["circle"]))[:30],
        "worst": sorted(rows, key=lambda row: (row["streetDestinationCount"], row["circle"]))[:30],
        "all": rows,
    }


def special_savings(model: MapModel, street_dist):
    def rows(kind: str, adjacency):
        values = []
        for source in range(len(model.circles)):
            for destination in adjacency[source]:
                if source >= destination:
                    continue
                values.append({
                    "from": model.circle_ids[source],
                    "to": model.circle_ids[destination],
                    "streetTurns": street_dist[source][destination],
                    "specialTurns": 1,
                    "turnsSaved": street_dist[source][destination] - 1,
                })
        values.sort(key=lambda row: (-row["turnsSaved"], -row["streetTurns"], row["from"], row["to"]))
        return {"kind": kind, "pairCount": len(values), "topSavings": values[:50], "allPairs": values}
    return {"alleys": rows("alley", model.alley_adj), "boats": rows("boat", model.boat_adj)}


def rankdata(values: Sequence[float]) -> list[float]:
    order = sorted(range(len(values)), key=values.__getitem__)
    ranks = [0.0] * len(values)
    cursor = 0
    while cursor < len(order):
        end = cursor + 1
        while end < len(order) and values[order[end]] == values[order[cursor]]:
            end += 1
        rank = (cursor + 1 + end) / 2
        for position in order[cursor:end]:
            ranks[position] = rank
        cursor = end
    return ranks


def correlation(first: Sequence[float], second: Sequence[float]) -> float:
    first_mean, second_mean = statistics.fmean(first), statistics.fmean(second)
    numerator = sum((a - first_mean) * (b - second_mean) for a, b in zip(first, second))
    denominator = math.sqrt(
        sum((a - first_mean) ** 2 for a in first) * sum((b - second_mean) ** 2 for b in second)
    )
    return numerator / denominator


def website_difficulty_comparison(model: MapModel, street_dist):
    """Compare exact graph tours with whitehallmystery.com's disclosed model."""
    url = "https://whitehallmystery.com/main.js?v=7"
    import re

    request = urllib.request.Request(url, headers={"User-Agent": "WhitehallMystery graph report"})
    source = urllib.request.urlopen(request, timeout=30).read().decode("utf-8")
    regions_match = re.search(r"regions:\s*(\[.*?\]),\s*\n\s*locations:", source, re.S)
    costs_match = re.search(r"costs:\s*(\[.*?\]),\s*\n\s*getTripCost:", source, re.S)
    if not regions_match or not costs_match:
        raise RuntimeError("Could not parse whitehallmystery.com/main.js?v=7")
    site_regions = json.loads(re.sub(r"//[^\n]*", "", regions_match.group(1)))
    site_costs = json.loads(re.sub(r"//[^\n]*", "", costs_match.group(1)))
    thresholds = {
        "easyUpperBound": 4.212505796,
        "mediumLowerBound": 5.560504654,
        "mediumUpperBound": 7.136783123,
        "hardLowerBound": 8.136795311,
    }
    all_orders = list(itertools.permutations(range(4)))
    fields = {
        "difficulty": [],
        "siteMinTour": [],
        "siteMaxTour": [],
        "exactMinTour": [],
        "exactMaxTour": [],
        "localMobilityPenalty": [],
    }
    tier_values: dict[str, list[int]] = collections.defaultdict(list)
    examples = []
    for site_nodes in itertools.product(*site_regions):
        ids = tuple(row["id"] for row in site_nodes)
        indices = tuple(model.cidx[value] for value in ids)
        site_routes = [sum(site_costs[ids[a]][ids[b]] for a, b in zip(order, order[1:])) for order in all_orders]
        exact_routes = [sum(street_dist[indices[a]][indices[b]] for a, b in zip(order, order[1:])) for order in all_orders]
        site_min, site_max = min(site_routes), max(site_routes)
        exact_min, exact_max = min(exact_routes), max(exact_routes)
        local = sum(row["circles"] ** -1.0 * row["squares"] ** -0.8 for row in site_nodes)
        difficulty = local * site_min ** 0.75 * site_max ** 0.25
        if difficulty <= thresholds["easyUpperBound"]:
            tier = "easy"
        elif thresholds["mediumLowerBound"] <= difficulty <= thresholds["mediumUpperBound"]:
            tier = "medium"
        elif difficulty >= thresholds["hardLowerBound"]:
            tier = "hard"
        else:
            tier = "unselectedGap"
        values = (difficulty, site_min, site_max, exact_min, exact_max, local)
        for name, value in zip(fields, values):
            fields[name].append(value)
        tier_values[tier].append(exact_min)
        examples.append((difficulty, ids, exact_min, exact_max, site_min, site_max, local, tier))

    difficulty = fields["difficulty"]
    correlations = {}
    for name, values in fields.items():
        if name == "difficulty":
            continue
        correlations[name] = {
            "pearson": round(correlation(difficulty, values), 5),
            "spearman": round(correlation(rankdata(difficulty), rankdata(values)), 5),
        }
    pair_differences = []
    half_step_count = 0
    for first in range(len(model.circles)):
        for second in range(first + 1, len(model.circles)):
            site_value = site_costs[model.circle_ids[first]][model.circle_ids[second]]
            if site_value % 1:
                half_step_count += 1
            pair_differences.append(abs(site_value - street_dist[first][second]))
    examples.sort()
    return {
        "source": url,
        "sourceFormula": "sum(circleStreetDegree^-1 * adjacentCrossingCount^-0.8) * siteMinTour^0.75 * siteMaxTour^0.25",
        "thresholds": thresholds,
        "legalSetCount": len(examples),
        "siteCostMatrixVsExactStreetDistance": {
            "meanAbsoluteDifference": round(statistics.fmean(pair_differences), 4),
            "maximumAbsoluteDifference": max(pair_differences),
            "exactMatches": sum(value == 0 for value in pair_differences),
            "unorderedPairs": len(pair_differences),
            "halfStepPairCount": half_step_count,
        },
        "correlationWithPublishedDifficulty": correlations,
        "exactMinimumTourByPublishedTier": {
            tier: {**summary(values), "setCount": len(values)} for tier, values in sorted(tier_values.items())
        },
        "lowestPublishedDifficulty": [
            {"locations": list(row[1]), "difficulty": round(row[0], 6), "exactMinTour": row[2], "exactMaxTour": row[3], "siteMinTour": row[4], "siteMaxTour": row[5], "localPenalty": round(row[6], 6), "tier": row[7]}
            for row in examples[:20]
        ],
        "highestPublishedDifficulty": [
            {"locations": list(row[1]), "difficulty": round(row[0], 6), "exactMinTour": row[2], "exactMaxTour": row[3], "siteMinTour": row[4], "siteMaxTour": row[5], "localPenalty": round(row[6], 6), "tier": row[7]}
            for row in examples[-20:][::-1]
        ],
        "caveat": "The site's hand-entered cost matrix includes half steps and is not the exact unblocked street graph. Its formula is a heuristic, not a validated win-probability model; published tier gaps intentionally exclude many sets.",
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--skip-discovery-sets",
        action="store_true",
        help="quick graph-metric refresh; preserves existing exhaustive tour results when available",
    )
    args = parser.parse_args()
    existing = {}
    if args.skip_discovery_sets and OUTPUT.exists():
        existing = json.loads(OUTPUT.read_text(encoding="utf-8"))
    started = time.perf_counter()
    model = MapModel()
    model.validate()
    print("Built canonical graphs", flush=True)
    street_dist = all_pairs_shortest([list(row) for row in model.street_adj])
    crossing_dist = all_pairs_shortest([list(row) for row in model.investigator_adj])

    constrained = {}
    scenario_matrices = {"streetOnly": street_dist}
    for name, allowed in (
        ("upToTwoBoats", frozenset({"boat"})),
        ("upToTwoAlleys", frozenset({"alley"})),
        ("upToTwoEachSpecial", frozenset({"alley", "boat", "coach"})),
    ):
        print(f"Computing {name}", flush=True)
        report, action_matrix, slot_matrix = constrained_extremes(model, allowed)
        constrained[name] = report
        scenario_matrices[name + "ActionTurns"] = action_matrix
        scenario_matrices[name + "MoveTrackSlots"] = slot_matrix

    print("Computing investigator metrics", flush=True)
    investigator, investigator_turns = investigator_analysis(model, crossing_dist, street_dist)
    top_crossing_ids = [row["crossing"] for row in investigator["topCrossingBetweenness"]]

    result = {
        "meta": {
            "generatedAtUnix": int(time.time()),
            "sourceFiles": [str(path.relative_to(ROOT)).replace("\\", "/") for path in sorted(DATA.glob("*.jsonl"))],
            "circleCount": len(model.circles),
            "crossingCount": len(model.crossings),
            "semantics": {
                "street": "One Jack action-turn and one move-track slot between numbered circles connected through an unoccupied crossing or direct chain of crossings, matching mapData.ts.",
                "investigator": "One graph step between crossings sharing a numbered circle or connected directly; an investigator turn permits 0, 1, or 2 such steps.",
                "coach": "One Jack action-turn, two recorded locations, and two move-track slots. It ignores occupied crossings. Intermediate and final circles must be non-blue and distinct from each other and the origin.",
                "alleyBoat": "One Jack action-turn and one move-track slot; at most two of each per game.",
                "discoverySpecialEntry": "Tour profiles require the first arrival at each next discovery to be a normal street move. Coach use of that target as intermediate or final is excluded. Other as-yet-unreached discovery circles are not target-specifically forbidden inside a pairwise leg, so special-tour set results are a topology/planning lower bound when a route touches a third discovery early.",
                "blockedVsStatic": "All ordinary distances are on the unoccupied static map. Blockade results rebuild street reachability after deleting the specified occupied crossings. Coach is not included in blockade paths because Coach ignores investigators.",
            },
        },
        "jack": {
            "streetGraph": graph_extremes(model.circle_ids, street_dist),
            "resourceConstrainedGraphs": constrained,
            "discoveryStreetMoveOptions": discovery_move_options(model),
            "specialSavings": special_savings(model, street_dist),
            "quadrants": quadrant_analysis(model, street_dist, scenario_matrices),
            "websiteDifficultyComparison": (
                existing.get("jack", {}).get("websiteDifficultyComparison")
                or website_difficulty_comparison(model, street_dist)
            ),
        },
        "investigators": investigator,
        "discoveryPairSafetyProxies": pair_safety_analysis(model, street_dist, investigator_turns),
        "mobilityPursuitAndBacktracking": mobility_and_backtracking(model, street_dist),
        "blockades": blockade_analysis(model, street_dist, crossing_dist, top_crossing_ids),
    }

    if not args.skip_discovery_sets:
        whites = [i for i, color in enumerate(model.colors) if color == "white"]
        print("Computing forced-street-entry pair profiles", flush=True)
        profiles = exact_resource_profiles_to_targets(model, whites)
        print("Computing all legal discovery sets", flush=True)
        result["jack"]["discoverySets"] = discovery_set_analysis(model, street_dist, profiles)
    elif OUTPUT.exists():
        # Keep the expensive exhaustive result when refreshing the faster
        # graph metrics. A first-time diagnostic run still emits a smaller file.
        discovery_sets = existing.get("jack", {}).get("discoverySets")
        if discovery_sets:
            result["jack"]["discoverySets"] = discovery_sets
            print("Preserved existing exhaustive discovery-set results", flush=True)

    output = OUTPUT
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, indent=2, sort_keys=False), encoding="utf-8")
    print(f"Wrote {output} in {time.perf_counter() - started:.1f}s", flush=True)


if __name__ == "__main__":
    main()
