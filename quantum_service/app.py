"""
app.py — Flask microservice for quantum TSP solving.

Receives a distance matrix from the Node.js server, runs the quantum pipeline:
  1. Build QUBO from distance matrix
  2. Solve with QAOA (hybrid quantum-classical)
  3. Decode solution to tour
  4. Return tour + quantum metrics

Runs on port 5001.
"""

import sys
import traceback
import numpy as np
from flask import Flask, request, jsonify
from flask_cors import CORS

from tsp_qubo import build_tsp_qubo, decode_solution
from qaoa_solver import solve_with_qaoa

app = Flask(__name__)
CORS(app)


@app.route("/solve", methods=["POST"])
def solve():
    """
    POST /solve
    Body: {
        "distanceMatrix": [[0, 10, ...], ...],  # N×N matrix
        "startNode": 0                           # depot index
    }
    """
    try:
        data = request.get_json()
        dist_matrix = data.get("distanceMatrix", [])
        start_node = data.get("startNode", 0)

        n = len(dist_matrix)
        if n < 2:
            return jsonify({"error": "At least 2 locations required"}), 400
        if n > 8:
            return jsonify({"error": f"QAOA is limited to 8 locations (got {n}). n²={n*n} qubits."}), 400

        print(f"[QAOA] Solving TSP for {n} cities ({n*n} qubits)...", flush=True)

        # Step 1: Build QUBO
        tsp_data = build_tsp_qubo(dist_matrix)
        tsp_data["original_distances"] = dist_matrix
        print(f"[QAOA] QUBO built: {tsp_data['num_qubits']} qubits", flush=True)

        # Step 2: Solve with QAOA
        # Use fewer reps for larger problems to keep runtime manageable
        reps = 1
        max_iter = 30

        qaoa_result = solve_with_qaoa(tsp_data["qubo"], reps=reps, max_iterations=max_iter)
        print(f"[QAOA] Solved in {qaoa_result['qaoa_time_ms']} ms", flush=True)

        # Step 3: Decode to tour
        decoded = decode_solution(qaoa_result["result"], tsp_data)

        # If tour doesn't start at startNode, rotate it
        tour = decoded["tour"]
        if tour[0] != start_node and start_node in tour:
            # Rotate tour so it starts at startNode
            cycle = tour[:-1]  # remove closing node
            idx = cycle.index(start_node)
            cycle = cycle[idx:] + cycle[:idx]
            cycle.append(cycle[0])  # close the tour
            tour = cycle

        # Calculate actual distance with original matrix
        total_dist = 0
        for i in range(len(tour) - 1):
            total_dist += dist_matrix[tour[i]][tour[i + 1]]

        response = {
            "tour": tour,
            "distance": total_dist,
            "solverName": f"Quantum {qaoa_result['method']}",
            "isFeasible": decoded["is_feasible"],
            "quantumMetrics": {
                "numQubits": qaoa_result["num_qubits"],
                "circuitDepth": qaoa_result["circuit_depth"],
                "qaoaReps": qaoa_result["reps"],
                "optimizerIterations": qaoa_result["optimizer_iterations"],
                "qaoaEnergy": decoded["energy"],
                "solveTimeMs": qaoa_result["qaoa_time_ms"],
                "energyHistory": qaoa_result.get("energy_history", []),
            },
        }

        print(f"[QAOA] Tour: {tour}, Distance: {total_dist}, Feasible: {decoded['is_feasible']}", flush=True)
        return jsonify(response)

    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "service": "quantum-solver"})


if __name__ == "__main__":
    print("[QAOA] Quantum solver service starting on port 5001...", flush=True)
    app.run(host="0.0.0.0", port=5001, debug=False)
