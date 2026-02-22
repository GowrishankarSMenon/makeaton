"""
app.py — Flask microservice for quantum TSP solving.

Receives a distance matrix from the Node.js server, runs the quantum pipeline:
  1. Build QUBO from distance matrix
  2. Solve with QAOA (hybrid quantum-classical)
  3. Decode solution to tour
  4. Return tour + quantum metrics

Runs on port 5001.
"""

import os
import sys
import traceback
import numpy as np
from flask import Flask, request, jsonify
from flask_cors import CORS
from dotenv import load_dotenv

# Load .env from the quantum_service directory
load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

from tsp_qubo import build_tsp_qubo, decode_solution
from qaoa_solver import solve_with_qaoa, reset_ibm_service

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
        if n > 10:
            return jsonify({"error": f"QAOA limited to 10 locations (got {n}). n²={n*n} qubits."}), 400

        warm_start_tour = data.get("warmStartTour", None)

        print(f"[QAOA] Solving TSP for {n} cities ({n*n} qubits)...", flush=True)

        # Step 1: Build QUBO
        tsp_data = build_tsp_qubo(dist_matrix)
        tsp_data["original_distances"] = dist_matrix
        print(f"[QAOA] QUBO built: {tsp_data['num_qubits']} qubits", flush=True)

        # Step 1.5: Build warm-start initial state from classical tour
        warm_start_state = None
        if warm_start_tour and len(warm_start_tour) >= n:
            try:
                from tsp_qubo import tour_to_initial_state
                warm_start_state, _ = tour_to_initial_state(warm_start_tour, tsp_data)
                print(f"[QAOA] ⚡ Warm-start from classical tour: {warm_start_tour}", flush=True)
            except Exception as ws_err:
                print(f"[QAOA] Warm-start build failed (continuing without): {ws_err}", flush=True)

        # Step 2: Solve with QAOA
        # Reps=1 keeps circuit shallow. maxiter=1 for speed (single IBM job).
        reps = 1
        max_iter = 1

        qaoa_result = solve_with_qaoa(
            tsp_data["qubo"], reps=reps, max_iterations=max_iter,
            warm_start_state=warm_start_state,
        )
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
                "backend": qaoa_result.get("backend", "unknown"),
                "executionMode": qaoa_result.get("execution_mode", "local_simulator"),
                "fallbackReason": qaoa_result.get("ibm_fallback_reason", None),
                "warmStartUsed": warm_start_state is not None,
            },
        }

        print(f"[QAOA] Tour: {tour}, Distance: {total_dist}, Feasible: {decoded['is_feasible']}", flush=True)
        return jsonify(response)

    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


@app.route("/health", methods=["GET"])
def health():
    quantum_mode = os.environ.get("QUANTUM_MODE", "local")
    ibm_token_set = bool(os.environ.get("IBM_QUANTUM_TOKEN", "").strip())
    return jsonify({
        "status": "ok",
        "service": "quantum-solver",
        "quantumMode": quantum_mode,
        "ibmTokenConfigured": ibm_token_set,
    })


@app.route("/ibm-status", methods=["GET"])
def ibm_status():
    """Check IBM Quantum connectivity and available backends."""
    try:
        from qaoa_solver import _get_ibm_service
        service, error = _get_ibm_service()
        if service is None:
            return jsonify({
                "connected": False,
                "error": error,
            })

        backends = service.backends(operational=True)
        backend_list = [
            {"name": b.name, "qubits": b.num_qubits, "simulator": b.simulator}
            for b in backends[:10]  # limit to 10
        ]
        return jsonify({
            "connected": True,
            "backends": backend_list,
        })
    except Exception as e:
        return jsonify({"connected": False, "error": str(e)}), 500


@app.route("/reset-ibm", methods=["POST"])
def reset_ibm():
    """Reset the cached IBM service (e.g. after updating token)."""
    reset_ibm_service()
    return jsonify({"status": "ok", "message": "IBM service cache cleared"})


if __name__ == "__main__":
    mode = os.environ.get("QUANTUM_MODE", "local")
    print(f"[QAOA] Quantum solver service starting on port 5001 (mode={mode})...", flush=True)
    app.run(host="0.0.0.0", port=5001, debug=False)
