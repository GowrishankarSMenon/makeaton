"""
qaoa_solver.py — Solve a QUBO using Qiskit's quantum optimization pipeline.

Pipeline:
  1. QUBO → Ising Hamiltonian
  2. QAOA with COBYLA optimizer + one warm-start restart
  3. Decode best result

Uses QAOA with StatevectorSampler for ≤16 qubits,
NumPyMinimumEigensolver for larger problems.
"""

import time
import numpy as np


def solve_with_qaoa(qubo, reps=1, max_iterations=20):
    """
    Solve a QUBO using QAOA (COBYLA, one warm-start restart).

    Args:
        qubo: QuadraticProgram (QUBO form)
        reps: QAOA depth (layers)
        max_iterations: total optimizer iterations (split across 2 runs)

    Returns:
        dict with result, timing, and quantum metadata
    """
    num_qubits = qubo.get_num_vars()

    # Get the Ising Hamiltonian for reporting
    ising_op, offset = qubo.to_ising()
    num_ising_terms = ising_op.size

    use_qaoa = num_qubits <= 16  # QAOA feasible for ≤ 4 cities (16 qubits)

    start_time = time.time()
    iteration_count = [0]
    energies = []

    if use_qaoa:
        result, circuit_depth = _solve_qaoa(
            qubo, reps, max_iterations, iteration_count, energies
        )
        method = f"QAOA (p={reps})"
    else:
        result, circuit_depth = _solve_numpy(qubo)
        method = "Exact Eigensolver"

    solve_time = (time.time() - start_time) * 1000

    return {
        "result": result,
        "qaoa_time_ms": round(solve_time, 2),
        "circuit_depth": circuit_depth,
        "num_qubits": num_qubits,
        "num_ising_terms": num_ising_terms,
        "optimizer_iterations": iteration_count[0],
        "reps": reps,
        "energy_history": energies[-20:] if energies else [],
        "method": method,
        "ising_offset": float(offset),
    }


def _solve_qaoa(qubo, reps, max_iterations, iteration_count, energies):
    """Solve using QAOA + COBYLA with one warm-start restart."""
    from qiskit_algorithms import QAOA
    from qiskit_algorithms.optimizers import COBYLA
    from qiskit_optimization.algorithms import MinimumEigenOptimizer
    from qiskit.primitives import StatevectorSampler

    sampler = StatevectorSampler()
    best_params = [None]
    best_energy = [float("inf")]

    def callback(eval_count, params, mean, std):
        iteration_count[0] = eval_count
        energies.append(float(mean))
        if mean < best_energy[0]:
            best_energy[0] = mean
            best_params[0] = np.array(params, dtype=float).copy()

    # --- Run 1: random initial point ---
    iters_r1 = max_iterations // 2
    optimizer1 = COBYLA(maxiter=iters_r1, rhobeg=0.5)
    init_point = np.random.uniform(-np.pi, np.pi, 2 * reps)

    qaoa1 = QAOA(
        sampler=sampler,
        optimizer=optimizer1,
        reps=reps,
        callback=callback,
        initial_point=init_point,
    )
    result1 = MinimumEigenOptimizer(qaoa1).solve(qubo)

    # --- Run 2: warm-start from best params found ---
    warm_point = best_params[0] if best_params[0] is not None else init_point
    iters_r2 = max_iterations - iters_r1
    optimizer2 = COBYLA(maxiter=iters_r2, rhobeg=0.3)

    qaoa2 = QAOA(
        sampler=sampler,
        optimizer=optimizer2,
        reps=reps,
        callback=callback,
        initial_point=warm_point,
    )
    result2 = MinimumEigenOptimizer(qaoa2).solve(qubo)

    # Return the result with lower energy
    e1 = result1.fval if hasattr(result1, "fval") else float("inf")
    e2 = result2.fval if hasattr(result2, "fval") else float("inf")
    result = result2 if e2 <= e1 else result1

    try:
        circuit_depth = qaoa2.ansatz.depth()
    except Exception:
        circuit_depth = reps * 2

    return result, circuit_depth


def _solve_numpy(qubo):
    """
    Solve using NumPyMinimumEigensolver on the Ising Hamiltonian.
    This performs exact diagonalization — equivalent to solving the
    full quantum system on classical hardware.
    """
    from qiskit_algorithms import NumPyMinimumEigensolver
    from qiskit_optimization.algorithms import MinimumEigenOptimizer

    numpy_solver = NumPyMinimumEigensolver()
    optimizer = MinimumEigenOptimizer(numpy_solver)
    result = optimizer.solve(qubo)

    # No circuit since this is classical diagonalization
    circuit_depth = 0

    return result, circuit_depth
