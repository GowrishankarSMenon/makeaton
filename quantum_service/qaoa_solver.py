"""
qaoa_solver.py — Solve a QUBO using Qiskit's quantum optimization pipeline.

Pipeline (hybrid quantum-classical):
  1. QUBO formulated from TSP distance matrix (binary variable encoding)
  2. QUBO converted to Ising Hamiltonian (qubit operator mapping)
  3. Solved using quantum-compatible eigensolver
  4. Solution decoded back to TSP tour

For problems with n ≤ 3 cities (≤ 9 qubits), uses QAOA with StatevectorSampler.
For larger problems, uses NumPyMinimumEigensolver on the Ising Hamiltonian
(exact diagonalization — equivalent to solving the quantum system classically,
which is the standard approach for quantum simulation on classical hardware).
"""

import time
import numpy as np


def solve_with_qaoa(qubo, reps=1, max_iterations=80):
    """
    Solve a QUBO using Qiskit's quantum optimization pipeline.

    Args:
        qubo: QuadraticProgram (QUBO form) from qiskit_optimization
        reps: int — QAOA layers (used only when QAOA is feasible)
        max_iterations: int — max classical optimizer iterations

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
    """Solve using QAOA with StatevectorSampler (for small problems)."""
    from qiskit_algorithms import QAOA
    from qiskit_algorithms.optimizers import COBYLA
    from qiskit_optimization.algorithms import MinimumEigenOptimizer
    from qiskit.primitives import StatevectorSampler

    def callback(eval_count, params, mean, std):
        iteration_count[0] = eval_count
        energies.append(float(mean))

    sampler = StatevectorSampler()
    optimizer = COBYLA(maxiter=max_iterations, rhobeg=0.5)

    qaoa = QAOA(
        sampler=sampler,
        optimizer=optimizer,
        reps=reps,
        callback=callback,
        initial_point=np.random.uniform(-np.pi, np.pi, 2 * reps),
    )

    qaoa_optimizer = MinimumEigenOptimizer(qaoa)
    result = qaoa_optimizer.solve(qubo)

    try:
        circuit_depth = qaoa.ansatz.depth()
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
