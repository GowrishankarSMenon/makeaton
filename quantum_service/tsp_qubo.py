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

    Args:
        result: MinimumEigenOptimizer result or similar
        tsp_data: dict returned by build_tsp_qubo

    Returns:
        dict with tour, distance, feasibility info
    """
    tsp = tsp_data["tsp_instance"]
    n = tsp_data["num_cities"]
    max_dist = tsp_data["max_dist"]

    # Interpret the result through the converter to get original variable values
    converter = tsp_data["converter"]

    # Extract the tour from the result
    try:
        x = result.x
        # x is a binary array of n² values: x_{0,0}, x_{0,1}, ..., x_{n-1,n-1}
        # Reshape to n×n matrix where entry (i,p) = 1 means city i at position p
        x_matrix = np.array(x[:n * n]).reshape(n, n)

        # Build tour: for each position p, find which city is assigned
        tour = []
        for p in range(n):
            city_at_p = np.argmax(x_matrix[:, p])
            tour.append(int(city_at_p))

        # Close the tour (return to start)
        tour.append(tour[0])

        # Check feasibility: each city should appear exactly once
        cities_visited = set(tour[:-1])
        is_feasible = len(cities_visited) == n and len(tour) - 1 == n

    except Exception as e:
        # Fallback: just return the raw result
        tour = list(range(n)) + [0]
        is_feasible = False

    # Compute actual distance using original (unnormalized) matrix
    distance = 0
    for i in range(len(tour) - 1):
        distance += tsp_data.get("original_distances", [[0]])[tour[i]][tour[i + 1]] if "original_distances" in tsp_data else 0

    return {
        "tour": tour,
        "distance": distance,
        "is_feasible": is_feasible,
        "energy": float(result.fval) if hasattr(result, "fval") else None,
    }
