"""
tsp_qubo.py — Build a QUBO formulation of the Travelling Salesman Problem.

Binary encoding:
  x_{i,p} = 1  means "city i is visited at position p in the tour"
  Total binary variables: n² (for n cities)

This directly maps to qubits: each x_{i,p} is one qubit.

Objective:
  Minimize Σ_{p=0}^{n-1} Σ_{i,j} dist[i][j] · x_{i,p} · x_{j,(p+1) mod n}

Constraints (enforced via penalty terms):
  1. Each city visited exactly once:  Σ_p x_{i,p} = 1  for all i
  2. Each position has exactly one city:  Σ_i x_{i,p} = 1  for all p
"""

import numpy as np
from qiskit_optimization.applications import Tsp
from qiskit_optimization.converters import QuadraticProgramToQubo


def build_tsp_qubo(distance_matrix):
    """
    Build a QUBO for the TSP from a distance matrix.

    Uses qiskit_optimization's Tsp application class which:
    1. Creates binary variables x_{i,p} for each (city, position) pair
    2. Adds the distance objective
    3. Adds equality constraints (each city once, each position once)

    Args:
        distance_matrix: list[list[float]] — N×N distance matrix

    Returns:
        dict with:
            - qubo: the QUBO QuadraticProgram object
            - quadratic_program: the original constrained QP
            - num_cities: n
            - num_qubits: n² (number of binary variables / qubits)
            - tsp_instance: the Tsp application object (for decoding)
    """
    n = len(distance_matrix)
    dist = np.array(distance_matrix, dtype=float)

    # Normalize distances to avoid huge penalty values
    max_dist = dist.max()
    if max_dist > 0:
        norm_dist = dist / max_dist
    else:
        norm_dist = dist

    # Create TSP instance from adjacency matrix
    tsp = Tsp(norm_dist)

    # Get the QuadraticProgram formulation (with constraints)
    qp = tsp.to_quadratic_program()

    # Convert to QUBO (unconstrained) by folding constraints into penalties
    converter = QuadraticProgramToQubo()
    qubo = converter.convert(qp)

    return {
        "qubo": qubo,
        "quadratic_program": qp,
        "num_cities": n,
        "num_qubits": qubo.get_num_vars(),
        "tsp_instance": tsp,
        "converter": converter,
        "max_dist": max_dist,
    }


def decode_solution(result, tsp_data):
    """
    Decode a QAOA/optimizer result back into a TSP tour.

    For noisy IBM hardware results, the raw bitstring almost never forms a
    valid tour (cities repeated, others missing). This decoder:
      1. Reads the n×n assignment matrix from the quantum result
      2. Uses it as a "preference score" for city→position mapping
      3. Greedily assigns cities to positions (highest preference first)
      4. Fills any remaining gaps → always produces a valid, feasible tour

    Args:
        result: MinimumEigenOptimizer result or similar (needs .x array)
        tsp_data: dict returned by build_tsp_qubo

    Returns:
        dict with tour, distance, feasibility info
    """
    n = tsp_data["num_cities"]

    try:
        x = result.x
        x_matrix = np.array(x[:n * n], dtype=float).reshape(n, n)

        # --- Attempt 1: naive argmax (works for clean simulator results) ---
        naive_tour = []
        for p in range(n):
            naive_tour.append(int(np.argmax(x_matrix[:, p])))
        naive_feasible = len(set(naive_tour)) == n

        if naive_feasible:
            # Perfect assignment — use directly
            tour = naive_tour + [naive_tour[0]]
            is_feasible = True
        else:
            # --- Attempt 2: greedy repair from quantum preferences ---
            # Treat x_matrix[i, p] as "score" for assigning city i to position p.
            # Pick highest-scoring (city, position) pairs without conflicts.
            tour = _repair_tour_from_matrix(x_matrix, n, tsp_data)
            is_feasible = True  # repair always produces a valid tour

    except Exception:
        # Last resort fallback
        tour = list(range(n)) + [0]
        is_feasible = False

    # Compute actual distance using original (unnormalized) matrix
    distance = 0
    if "original_distances" in tsp_data:
        dist_mat = tsp_data["original_distances"]
        for i in range(len(tour) - 1):
            distance += dist_mat[tour[i]][tour[i + 1]]

    return {
        "tour": tour,
        "distance": distance,
        "is_feasible": is_feasible,
        "energy": float(result.fval) if hasattr(result, "fval") else None,
    }


def _repair_tour_from_matrix(x_matrix, n, tsp_data):
    """
    Build a valid tour from a noisy quantum assignment matrix.

    Strategy:
      1. Collect all (city, position, score) triples from x_matrix
      2. Sort by score descending (highest quantum preference first)
      3. Greedily assign: skip if city or position already taken
      4. Any unassigned cities → fill into remaining positions using
         nearest-neighbor heuristic for quality

    Always returns a valid closed tour of length n+1.
    """
    # Step 1: Rank all (city, position) pairs by quantum preference score
    scored_pairs = []
    for city in range(n):
        for pos in range(n):
            scored_pairs.append((x_matrix[city, pos], city, pos))
    scored_pairs.sort(reverse=True)  # highest score first

    # Step 2: Greedy assignment
    assigned_cities = set()
    assigned_positions = set()
    tour_slots = [None] * n  # tour_slots[position] = city

    for score, city, pos in scored_pairs:
        if city not in assigned_cities and pos not in assigned_positions:
            tour_slots[pos] = city
            assigned_cities.add(city)
            assigned_positions.add(pos)
        if len(assigned_cities) == n:
            break

    # Step 3: Fill any remaining gaps (unassigned cities into open positions)
    missing_cities = [c for c in range(n) if c not in assigned_cities]
    open_positions = [p for p in range(n) if p not in assigned_positions]

    # Use nearest-neighbor ordering for the remaining cities if we have distances
    if missing_cities and "original_distances" in tsp_data:
        dist_mat = tsp_data["original_distances"]
        # Find the last assigned city to anchor from
        last_assigned = None
        for p in range(n - 1, -1, -1):
            if tour_slots[p] is not None:
                last_assigned = tour_slots[p]
                break
        if last_assigned is None:
            last_assigned = 0

        # Order missing cities by nearest-neighbor from last_assigned
        ordered_missing = []
        remaining = set(missing_cities)
        current = last_assigned
        while remaining:
            nearest = min(remaining, key=lambda c: dist_mat[current][c])
            ordered_missing.append(nearest)
            remaining.remove(nearest)
            current = nearest
        missing_cities = ordered_missing

    for city, pos in zip(missing_cities, open_positions):
        tour_slots[pos] = city

    # Close the tour
    tour = tour_slots + [tour_slots[0]]
    return tour
