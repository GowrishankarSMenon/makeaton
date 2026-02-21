# Quantum Delivery Route Optimizer

## Initial Concept

This project explores a **quantum computing approach** to solve the classic Vehicle Routing Problem (VRP) for a small number of delivery locations. The goal is to determine the **optimal delivery path** for a vehicle that minimizes total travel distance while visiting each location exactly once, starting from a fixed depot.

The solution leverages a **hybrid quantum-classical optimization** pipeline, combining the strengths of quantum computation for combinatorial search with classical post-processing for feasibility and refinement.

---

## Problem Statement

> Design a quantum solution to determine the optimal delivery path for a vehicle serving a small number of locations, with the objective of minimizing total travel distance. Each delivery location must be visited exactly once, starting from a fixed depot, under simplified and realistic logistics constraints. Participants are required to encode the routing problem into binary variables, map them to qubits, and use a hybrid quantum-classical optimization approach to generate candidate routes.

---

## Problem Statement Validation

### 1. Well-Defined Objective
The problem has a clear, measurable objective: **minimize the total travel distance** across all delivery stops. This makes it well-suited for optimization and allows straightforward benchmarking of solution quality.

### 2. Constraint Feasibility
- **Each location visited exactly once** — This is a standard constraint from the Travelling Salesman Problem (TSP), which is well understood and directly encodable.
- **Fixed depot start** — Anchoring the route to a depot is a realistic logistics constraint that simplifies the problem without reducing its relevance.
- **Small number of locations** — Keeps the problem tractable for current noisy intermediate-scale quantum (NISQ) devices, while still being NP-hard in the general case.

### 3. Quantum Suitability
- The routing problem can be naturally encoded as a **Quadratic Unconstrained Binary Optimization (QUBO)** problem.
- Binary decision variables (e.g., whether location *j* is visited at step *k*) map directly to **qubits**.
- Hybrid approaches such as **QAOA (Quantum Approximate Optimization Algorithm)** or **VQE (Variational Quantum Eigensolver)** are well-established methods for tackling QUBO problems on near-term quantum hardware.

### 4. Real-World Relevance
- Last-mile delivery optimization is a high-impact logistics challenge faced by e-commerce, food delivery, and supply chain companies.
- Even small improvements in route efficiency translate to significant cost and emissions savings at scale.

### 5. Scope & Scalability
- The simplified constraints allow participants to focus on the quantum encoding and optimization aspects.
- The framework can be incrementally extended to handle time windows, vehicle capacity, and multi-vehicle scenarios in future iterations.

---

## Approach Outline

1. **Model the problem** — Define locations, distances, and constraints as a mathematical optimization problem.
2. **QUBO formulation** — Encode the routing decision variables as binary variables and express the objective + constraints as a QUBO matrix.
3. **Qubit mapping** — Map binary variables to qubits for quantum circuit execution.
4. **Hybrid optimization** — Use a quantum-classical loop (e.g., QAOA) to explore the solution space and converge on near-optimal routes.
5. **Classical validation** — Decode quantum measurements into valid routes and compare against classical benchmarks (e.g., brute-force, nearest-neighbor heuristic).

---

*Hackathon Project — Quantum Route Optimization*
