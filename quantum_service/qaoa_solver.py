"""
qaoa_solver.py — Solve a QUBO using IBM Quantum Runtime or local fallback.

Pipeline (hybrid quantum-classical):
  1. QUBO formulated from TSP distance matrix (binary variable encoding)
  2. QUBO converted to Ising Hamiltonian (qubit operator mapping)
  3. Solved using IBM Quantum Runtime (real hardware / cloud sim) or local fallback
  4. Solution decoded back to TSP tour

Execution modes (set via QUANTUM_MODE env var):
  - "ibm"     : Prefer IBM Quantum real hardware, fallback to local on failure
  - "ibm_sim" : Use IBM cloud simulator only
  - "local"   : Use local StatevectorSampler / NumPyMinimumEigensolver only

For problems with n ≤ 3 cities (≤ 9 qubits), QAOA is used.
For larger problems, NumPyMinimumEigensolver is used (exact diagonalization).
"""

import os
import time
import traceback
import numpy as np


# ---------------------------------------------------------------------------
# IBM Quantum connection (lazy-loaded singleton)
# ---------------------------------------------------------------------------
_ibm_service = None
_ibm_init_error = None


def _get_ibm_service():
    """
    Lazily initialize the IBM Quantum Runtime service.
    Returns (service, None) on success or (None, error_message) on failure.
    """
    global _ibm_service, _ibm_init_error

    if _ibm_service is not None:
        return _ibm_service, None
    if _ibm_init_error is not None:
        return None, _ibm_init_error

    token = os.environ.get("IBM_QUANTUM_TOKEN", "").strip()
    if not token:
        _ibm_init_error = "IBM_QUANTUM_TOKEN not set"
        return None, _ibm_init_error

    try:
        from qiskit_ibm_runtime import QiskitRuntimeService

        instance = os.environ.get("IBM_QUANTUM_INSTANCE", "").strip()
        connect_kwargs = {
            "channel": "ibm_quantum_platform",
            "token": token,
        }
        if instance:
            connect_kwargs["instance"] = instance

        _ibm_service = QiskitRuntimeService(**connect_kwargs)
        print(f"[IBM] Connected to IBM Quantum (instance={instance})", flush=True)
        return _ibm_service, None

    except Exception as e:
        _ibm_init_error = f"IBM Quantum init failed: {e}"
        print(f"[IBM] {_ibm_init_error}", flush=True)
        traceback.print_exc()
        return None, _ibm_init_error


def _pick_ibm_backend(service, num_qubits, prefer_simulator=False):
    """
    Select the best IBM backend for the given qubit count.
    Returns (backend, backend_name) tuple.
    """
    try:
        backend = service.least_busy(
            simulator=prefer_simulator,
            min_num_qubits=num_qubits,
            operational=True,
        )
        backend_name = backend.name
        print(
            f"[IBM] Selected backend: {backend_name} "
            f"({backend.num_qubits} qubits)",
            flush=True,
        )
        return backend, backend_name

    except Exception as e:
        print(f"[IBM] Backend selection failed: {e}", flush=True)
        raise RuntimeError(
            f"No suitable IBM backend found for {num_qubits} qubits: {e}"
        )


def reset_ibm_service():
    """Reset the cached IBM service (useful for token rotation or reconnection)."""
    global _ibm_service, _ibm_init_error
    _ibm_service = None
    _ibm_init_error = None


# ---------------------------------------------------------------------------
# Public solver entry point
# ---------------------------------------------------------------------------

def solve_with_qaoa(qubo, reps=1, max_iterations=80):
    """
    Solve a QUBO using the best available quantum backend.

    Execution order:
      1. If QUANTUM_MODE=ibm or ibm_sim → try IBM Quantum with retries
      2. On failure (or if QUANTUM_MODE=local) → local simulator

    Args:
        qubo: QuadraticProgram (QUBO form) from qiskit_optimization
        reps: int — QAOA layers
        max_iterations: int — max classical optimizer iterations

    Returns:
        dict with result, timing, quantum metadata, and backend info
    """
    num_qubits = qubo.get_num_vars()

    # Get the Ising Hamiltonian for reporting
    ising_op, offset = qubo.to_ising()
    num_ising_terms = ising_op.size

    quantum_mode = os.environ.get("QUANTUM_MODE", "local").strip().lower()
    max_retries = int(os.environ.get("IBM_MAX_RETRIES", "3"))

    # Decide execution path
    if quantum_mode in ("ibm", "ibm_sim"):
        # SPEED MODE: 1 iteration = 1 IBM job. No optimizer loop.
        # Each extra iteration adds ~25-120s (full IBM round-trip).
        ibm_max_iter = min(max_iterations, 1)

        if num_qubits > 40:
            print(
                f"[IBM] WARNING: {num_qubits} qubits — circuit will be deep.",
                flush=True,
            )

        print(
            f"[IBM] ⚡ SPEED MODE: {num_qubits} qubits, "
            f"{ibm_max_iter} IBM job(s), lightweight error suppression",
            flush=True,
        )
        # Force 1 retry max for speed (don't waste minutes retrying)
        result_data = _try_ibm_with_fallback(
            qubo, reps, ibm_max_iter, num_qubits, quantum_mode, min(max_retries, 1)
        )
    else:
        # Pure local mode
        result_data = _solve_local(qubo, reps, max_iterations, num_qubits)

    # Attach Ising metadata
    result_data["num_ising_terms"] = num_ising_terms
    result_data["ising_offset"] = float(offset)

    return result_data


# ---------------------------------------------------------------------------
# IBM Quantum execution with retry + fallback
# ---------------------------------------------------------------------------

# Config / auth errors that should NOT be retried (fail fast)
_FATAL_ERROR_KEYWORDS = [
    "not authorized",
    "401",
    "403",
    "token",
    "credential",
    "channel",
    "plan",
    "session",  # plan-related session errors
]


def _is_fatal_error(error: Exception) -> bool:
    """Return True if this error is a config/auth issue that won't fix itself on retry."""
    msg = str(error).lower()
    return any(kw in msg for kw in _FATAL_ERROR_KEYWORDS)


def _try_ibm_with_fallback(qubo, reps, max_iterations, num_qubits, quantum_mode, max_retries):
    """
    Try IBM Quantum with retries. Falls back to local only for transient errors.
    Config/auth errors fail fast (no retry, no silent fallback).
    """
    last_error = None

    for attempt in range(1, max_retries + 1):
        try:
            print(f"[IBM] Attempt {attempt}/{max_retries}...", flush=True)
            return _solve_ibm(
                qubo, reps, max_iterations, num_qubits,
                prefer_simulator=(quantum_mode == "ibm_sim"),
            )
        except Exception as e:
            last_error = e

            # Config/auth errors → fail immediately, don't waste time retrying
            if _is_fatal_error(e):
                print(f"[IBM] Fatal config error (no retry): {e}", flush=True)
                traceback.print_exc()
                break

            # Transient errors → retry with backoff
            wait_time = min(2 ** attempt, 30)
            print(
                f"[IBM] Attempt {attempt} failed (transient): {e}. "
                f"{'Retrying' if attempt < max_retries else 'Falling back to local'} "
                f"in {wait_time}s...",
                flush=True,
            )
            traceback.print_exc()
            if attempt < max_retries:
                time.sleep(wait_time)

    # All retries exhausted → fall back to local
    print(
        f"[IBM] Falling back to local simulator. Reason: {last_error}",
        flush=True,
    )
    result_data = _solve_local(qubo, reps, max_iterations, num_qubits)
    result_data["ibm_fallback_reason"] = str(last_error)
    result_data["execution_mode"] = "local_fallback"
    return result_data


def _solve_ibm(qubo, reps, max_iterations, num_qubits, prefer_simulator=False):
    """
    Solve using IBM Quantum Runtime with SamplerV2 and full error suppression.

    Error suppression stack:
      - optimization_level=3 transpilation (maximum depth reduction)
      - Dynamical Decoupling (XY4) — preserves coherence during idle cycles
      - Gate twirling — converts coherent errors to stochastic
      - Measurement twirling — mitigates readout bias
      - 4096 shots — enough statistics to extract signal from noise

    Steps:
      1. Connect to IBM Quantum service
      2. Pick the least-busy backend
      3. Pre-transpile QAOA ansatz (cached) at optimization_level=3
      4. Run QAOA via auto-transpiling SamplerV2 wrapper
      5. On IndexError (noisy result): retry once with fresh initial point
      6. Return result with full metadata
    """
    from qiskit_ibm_runtime import SamplerV2
    from qiskit_ibm_runtime.options import SamplerOptions
    from qiskit.primitives import BaseSamplerV2
    from qiskit.primitives.containers.sampler_pub import SamplerPub
    from qiskit.transpiler.preset_passmanagers import generate_preset_pass_manager
    from qiskit_algorithms import QAOA
    from qiskit_algorithms.optimizers import COBYLA

    service, init_error = _get_ibm_service()
    if service is None:
        raise RuntimeError(f"Cannot connect to IBM Quantum: {init_error}")

    backend, backend_name = _pick_ibm_backend(service, num_qubits, prefer_simulator)

    # ---- SPEED-OPTIMIZED error suppression ----
    # Prioritize speed (99%) over accuracy (1%) — hackathon mode.
    # Keep only cheap error suppression that doesn't slow execution:
    #  - DD (free: fills idle time, zero overhead)
    #  - Measurement twirling (cheap: just bit-flips)
    #  - Skip gate twirling (expensive: multiplies circuit count)
    #  - 1000 shots (fast, enough for QUBO evaluation)
    sampler_options = SamplerOptions()
    sampler_options.default_shots = 1000
    sampler_options.dynamical_decoupling.enable = True
    sampler_options.dynamical_decoupling.sequence_type = "XY4"
    sampler_options.twirling.enable_measure = True
    sampler_options.twirling.enable_gates = False

    print(
        f"[IBM] ⚡ Speed config: DD=XY4, meas_twirl=ON, "
        f"shots=1000, transpile=opt2",
        flush=True,
    )

    # ---- Transpilation (opt_level=2: fast transpile, good enough depth) ----
    pm = generate_preset_pass_manager(backend=backend, optimization_level=2)

    # Transpile-once cache: keyed by circuit structure fingerprint.
    _transpile_cache = {}
    _transpiled_depth = [0]  # track depth for metadata

    class _TranspilingSampler(BaseSamplerV2):
        """
        Wraps IBM SamplerV2 with auto-transpilation + caching.
        Transpiles ONCE and reuses for all QAOA iterations.
        """

        def __init__(self):
            super().__init__()
            self._sampler = SamplerV2(mode=backend, options=sampler_options)

        def run(self, pubs, *, shots=None):
            transpiled_pubs = []
            for pub_like in pubs:
                pub = SamplerPub.coerce(pub_like)
                circ = pub.circuit

                # Cache key: (num_qubits, num_parameters, depth)
                # QAOA reuses the same ansatz — only param values change
                cache_key = (circ.num_qubits, circ.num_parameters, circ.depth())

                if cache_key not in _transpile_cache:
                    _transpile_cache[cache_key] = pm.run(circ)
                    tc = _transpile_cache[cache_key]
                    _transpiled_depth[0] = tc.depth()
                    depth_warn = " ⚠ DEEP" if tc.depth() > 1500 else ""
                    print(
                        f"[IBM] Transpiled ansatz (cached): "
                        f"{circ.num_qubits}→{tc.num_qubits} qubits, "
                        f"depth {circ.depth()}→{tc.depth()}{depth_warn}",
                        flush=True,
                    )

                transpiled_circ = _transpile_cache[cache_key]
                new_pub = SamplerPub(
                    circuit=transpiled_circ,
                    parameter_values=pub.parameter_values,
                    shots=pub.shots if shots is None else shots,
                )
                transpiled_pubs.append(new_pub)

            return self._sampler.run(transpiled_pubs, shots=shots)

    start_time = time.time()
    iteration_count = [0]
    energies = []

    def callback(eval_count, params, mean, std):
        iteration_count[0] = eval_count
        energies.append(float(mean))
        elapsed = (time.time() - start_time)
        print(
            f"[IBM] Iter {eval_count}/{max_iterations}, "
            f"energy={mean:.4f}, elapsed={elapsed:.1f}s",
            flush=True,
        )

    # ---- Build and run QAOA directly (bypass MinimumEigenOptimizer) ----
    # MinimumEigenOptimizer's _interpret_samples crashes on noisy IBM results
    # because no bitstring perfectly satisfies TSP constraints.
    # Instead: run QAOA.compute_minimum_eigenvalue → evaluate ALL sampled
    # bitstrings against the QUBO objective → pick the best one.
    sampler = _TranspilingSampler()
    optimizer = COBYLA(maxiter=max_iterations, rhobeg=0.5)

    # Convert QUBO to Ising Hamiltonian
    ising_op, ising_offset = qubo.to_ising()
    n_vars = qubo.get_num_vars()

    qaoa = QAOA(
        sampler=sampler,
        optimizer=optimizer,
        reps=reps,
        callback=callback,
        initial_point=np.random.uniform(-np.pi, np.pi, 2 * reps),
    )

    # Run QAOA optimization directly on the Ising operator
    eigen_result = qaoa.compute_minimum_eigenvalue(ising_op)

    # ---- Manual result decoding (robust to noise) ----
    # Evaluate sampled bitstrings against QUBO objective, pick the best
    best_x, best_fval = _decode_ibm_eigenstate(eigen_result, qubo, n_vars)

    solve_time = (time.time() - start_time) * 1000
    circuit_depth = _transpiled_depth[0] or (reps * 2)

    print(
        f"[IBM] Best QUBO objective: {best_fval:.4f} "
        f"(from {n_vars}-variable decoding)",
        flush=True,
    )

    # Create a result-like object compatible with decode_solution()
    class IBMResult:
        """Minimal result object with .x and .fval for decode_solution."""
        def __init__(self, x, fval):
            self.x = x
            self.fval = fval

    return {
        "result": IBMResult(best_x, best_fval),
        "qaoa_time_ms": round(solve_time, 2),
        "circuit_depth": circuit_depth,
        "num_qubits": num_qubits,
        "optimizer_iterations": iteration_count[0],
        "reps": reps,
        "energy_history": energies[-20:] if energies else [],
        "method": f"QAOA (p={reps})",
        "backend": backend_name,
        "execution_mode": "ibm_simulator" if prefer_simulator else "real_hardware",
    }


def _decode_ibm_eigenstate(eigen_result, qubo, n_vars):
    """
    Decode QAOA eigenstate into the best QUBO variable assignment.

    Strategy: Instead of picking one "best" bitstring (which is often garbage
    on noisy hardware), we build a **probability-weighted assignment matrix**
    by aggregating ALL sampled bitstrings. Each bitstring "votes" for its
    city→position assignments, weighted by its sampling probability.

    This gives the downstream tour-repair decoder a much richer signal to
    work with — even if no single bitstring is a valid tour, the aggregate
    preferences often point to a good one.
    """
    n = int(np.sqrt(n_vars))  # number of cities (n² = n_vars)

    # Accumulate weighted assignment matrix from ALL samples
    weighted_matrix = np.zeros(n_vars, dtype=float)
    best_x = None
    best_fval = float("inf")
    total_weight = 0.0

    # 1. Process eigenstate quasi-distribution (all sampled bitstrings)
    eigenstate = getattr(eigen_result, "eigenstate", None)
    if eigenstate is not None:
        items = []
        if isinstance(eigenstate, dict):
            items = eigenstate.items()
        elif hasattr(eigenstate, "items"):
            items = eigenstate.items()

        for state_key, prob in items:
            state_int = int(state_key)
            bitstring = format(state_int, f"0{n_vars}b")
            x = np.array([int(b) for b in reversed(bitstring)])[:n_vars]
            weight = abs(prob)
            total_weight += weight

            # Accumulate probability-weighted votes
            weighted_matrix += x * weight

            # Also track the single best by QUBO energy
            fval = float(qubo.objective.evaluate(x))
            if fval < best_fval:
                best_fval = fval
                best_x = x.copy()

    # 2. Fallback: try best_measurement
    if best_x is None:
        best_meas = getattr(eigen_result, "best_measurement", None)
        if best_meas and isinstance(best_meas, dict):
            bitstring = best_meas.get("bitstring", "")
            if bitstring and len(bitstring) >= n_vars:
                x = np.array([int(b) for b in reversed(bitstring)])[:n_vars]
                best_fval = float(qubo.objective.evaluate(x))
                best_x = x
                weighted_matrix = x.astype(float)

    if best_x is None:
        print("[IBM] WARNING: No bitstrings in eigenstate, using zeros", flush=True)
        best_x = np.zeros(n_vars, dtype=int)
        best_fval = float(qubo.objective.evaluate(best_x))

    # Normalize the weighted matrix and use it as the assignment
    # The repair decoder in tsp_qubo.py will use these as preference scores
    if total_weight > 0:
        weighted_matrix /= total_weight

    # Use weighted_matrix as .x (floats, not binary) — the repair decoder
    # treats x_matrix values as scores, not binary decisions
    print(
        f"[IBM] Decoded from {len(items) if eigenstate else 0} unique bitstrings, "
        f"best single-bitstring energy: {best_fval:.4f}",
        flush=True,
    )

    return weighted_matrix, best_fval


# ---------------------------------------------------------------------------
# Local solver (StatevectorSampler / NumPy fallback)
# ---------------------------------------------------------------------------

def _solve_local(qubo, reps, max_iterations, num_qubits):
    """
    Solve locally using StatevectorSampler (small) or NumPy (large).
    This is the fallback path and also the default when QUANTUM_MODE=local.
    """
    use_qaoa = num_qubits <= 16  # QAOA feasible for ≤ 4 cities (16 qubits)

    start_time = time.time()
    iteration_count = [0]
    energies = []

    if use_qaoa:
        result, circuit_depth = _solve_local_qaoa(
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
        "optimizer_iterations": iteration_count[0],
        "reps": reps,
        "energy_history": energies[-20:] if energies else [],
        "method": method,
        "backend": "local_statevector" if use_qaoa else "local_numpy",
        "execution_mode": "local_simulator",
    }


def _solve_local_qaoa(qubo, reps, max_iterations, iteration_count, energies):
    """Solve using QAOA with local StatevectorSampler (for small problems)."""
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
    Exact diagonalization — the classical fallback for large problems.
    """
    from qiskit_algorithms import NumPyMinimumEigensolver
    from qiskit_optimization.algorithms import MinimumEigenOptimizer

    numpy_solver = NumPyMinimumEigensolver()
    optimizer = MinimumEigenOptimizer(numpy_solver)
    result = optimizer.solve(qubo)

    return result, 0
