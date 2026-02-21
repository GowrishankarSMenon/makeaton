"""
tsp_qubo.py — Build a QUBO formulation of the Travelling Salesman Problem.

Reduced encoding (default):
  Fix start city at position 0 to reduce qubit count from n² to (n-1)².
  x_{i,p} = 1  means "city i is visited at position p" (excluding start city).

Full encoding (fallback for n ≤ 2):
  x_{i,p} = 1  means "city i is visited at position p in the tour"
  Total binary variables: n²
"""

import numpy as np
from qiskit_optimization import QuadraticProgram
from qiskit_optimization.applications import Tsp
from qiskit_optimization.converters import QuadraticProgramToQubo


def build_tsp_qubo(distance_matrix, start_node=0):
    """
    Build a reduced QUBO for the TSP, fixing start_node at position 0.
    Reduces qubit count from n² to (n-1)².

    Args:
        distance_matrix: list[list[float]] — N×N distance matrix
        start_node: int — city fixed at position 0 (default 0)

    Returns:
        dict with qubo, metadata, and decoding info
    """
    n = len(distance_matrix)
    dist = np.array(distance_matrix, dtype=float)

    # Normalize distances to avoid huge penalty values
    max_dist = dist.max()
    if max_dist > 0:
        norm_dist = dist / max_dist
    else:
        norm_dist = dist

    if n <= 2:
        return _build_full_qubo(distance_matrix)

    # Cities to optimise (excluding the fixed start city)
    cities = [i for i in range(n) if i != start_node]
    m = len(cities)  # n-1

    qp = QuadraticProgram()

    # Binary variables: x_{city}_{position} for reduced grid (m × m)
    var_names = {}
    for i in cities:
        for p in range(m):
            name = f"x_{i}_{p}"
            qp.binary_var(name)
            var_names[(i, p)] = name

    # ---- Objective ----
    linear = {}
    quadratic = {}

    # start_node → city at position 0
    for i in cities:
        v = var_names[(i, 0)]
        linear[v] = linear.get(v, 0) + norm_dist[start_node][i]

    # city at position m-1 → start_node
    for i in cities:
        v = var_names[(i, m - 1)]
        linear[v] = linear.get(v, 0) + norm_dist[i][start_node]

    # consecutive positions 0 … m-2
    for p in range(m - 1):
        for i in cities:
            for j in cities:
                if i != j:
                    key = (var_names[(i, p)], var_names[(j, p + 1)])
                    quadratic[key] = quadratic.get(key, 0) + norm_dist[i][j]

    qp.minimize(linear=linear, quadratic=quadratic)

    # ---- Constraints ----
    for i in cities:
        coeffs = {var_names[(i, p)]: 1 for p in range(m)}
        qp.linear_constraint(linear=coeffs, sense="==", rhs=1, name=f"city_{i}")

    for p in range(m):
        coeffs = {var_names[(i, p)]: 1 for i in cities}
        qp.linear_constraint(linear=coeffs, sense="==", rhs=1, name=f"pos_{p}")

    converter = QuadraticProgramToQubo()
    qubo = converter.convert(qp)

    return {
        "qubo": qubo,
        "quadratic_program": qp,
        "num_cities": n,
        "num_qubits": qubo.get_num_vars(),
        "converter": converter,
        "max_dist": max_dist,
        "start_node": start_node,
        "cities": cities,
        "reduced": True,
    }


def _build_full_qubo(distance_matrix):
    """Fallback full n² encoding for trivial cases (n ≤ 2)."""
    n = len(distance_matrix)
    dist = np.array(distance_matrix, dtype=float)
    max_dist = dist.max()
    if max_dist > 0:
        norm_dist = dist / max_dist
    else:
        norm_dist = dist

    tsp = Tsp(norm_dist)
    qp = tsp.to_quadratic_program()
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
        "reduced": False,
    }


def decode_solution(result, tsp_data):
    """Decode a QAOA result back into a TSP tour."""
    if tsp_data.get("reduced", False):
        return _decode_reduced(result, tsp_data)
    return _decode_full(result, tsp_data)


def _decode_reduced(result, tsp_data):
    """Decode solution from reduced (fixed start) QUBO."""
    n = tsp_data["num_cities"]
    start_node = tsp_data["start_node"]
    cities = tsp_data["cities"]
    m = len(cities)

    try:
        x = result.x
        x_matrix = np.array(x[: m * m]).reshape(m, m)

        tour = [start_node]
        for p in range(m):
            city_idx = np.argmax(x_matrix[:, p])
            tour.append(cities[city_idx])
        tour.append(start_node)

        cities_visited = set(tour[:-1])
        is_feasible = len(cities_visited) == n and len(tour) - 1 == n
    except Exception:
        tour = [start_node] + cities + [start_node]
        is_feasible = False

    return {
        "tour": tour,
        "is_feasible": is_feasible,
        "energy": float(result.fval) if hasattr(result, "fval") else None,
    }


def _decode_full(result, tsp_data):
    """Decode from full n² encoding."""
    n = tsp_data["num_cities"]

    try:
        x = result.x
        x_matrix = np.array(x[: n * n]).reshape(n, n)

        tour = []
        for p in range(n):
            city_at_p = np.argmax(x_matrix[:, p])
            tour.append(int(city_at_p))
        tour.append(tour[0])

        cities_visited = set(tour[:-1])
        is_feasible = len(cities_visited) == n and len(tour) - 1 == n
    except Exception:
        tour = list(range(n)) + [0]
        is_feasible = False

    return {
        "tour": tour,
        "is_feasible": is_feasible,
        "energy": float(result.fval) if hasattr(result, "fval") else None,
    }
