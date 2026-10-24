#!/usr/bin/env python3
"""Generate real native-Meep data; run with the optional isolated Python prefix."""
import argparse
import json
import math
from pathlib import Path
import platform

import meep as mp


def coordinate(point):
    z = point.z
    return z() if callable(z) else z


def benchmark(resolution, epsilon):
    length = 1.0
    courant = 0.5
    dx = length / resolution
    dt = courant * dx
    k = 2 * math.pi / length
    phase_step = 2 * math.asin(courant / math.sqrt(epsilon) * math.sin(k * dx / 2))
    sim = mp.Simulation(cell_size=mp.Vector3(0, 0, length), dimensions=1,
                        resolution=resolution, Courant=courant, k_point=mp.Vector3(),
                        default_material=mp.Medium(epsilon=epsilon), sources=[])
    sim.init_sim()
    e_coordinates = []
    b_coordinates = []

    def initial_d(point):
        z = coordinate(point)
        e_coordinates.append(z)
        return epsilon * math.cos(k * z)

    def initial_b(point):
        z = coordinate(point)
        b_coordinates.append(z)
        return -math.sqrt(epsilon) * math.sin(k * z) * math.sin(phase_step / 2)

    # Initialize D/B, rather than E/H alone: Meep updates the constitutive fields.
    sim.fields.initialize_field(mp.Dx, initial_d)
    sim.fields.initialize_field(mp.By, initial_b)
    assert math.isclose(sim.fields.dt, dt, rel_tol=1e-14)
    # Discover the actual native Yee origin rather than assume an output-grid origin.
    e_positions = sorted({round(z, 14) for z in e_coordinates if -length / 2 <= z < length / 2})
    b_positions = sorted({round(z, 14) for z in b_coordinates if -length / 2 <= z < length / 2})
    assert len(e_positions) == resolution, (len(e_positions), resolution)
    assert len(b_positions) == resolution, (len(b_positions), resolution)
    origin = e_positions[0]
    # Map each B sample to the forward face of its E sample, with periodic wrapping.
    positions_b = [origin + (i + 0.5) * dx for i in range(resolution)]
    assert all(min(abs((b - z + length / 2) % length - length / 2) for b in b_positions) < 1e-12
               for z in positions_b)

    def sample(component, positions):
        return [float(sim.get_field_point(component, mp.Vector3(z=z)).real) for z in positions]

    def snapshot():
        e = sample(mp.Ex, e_positions)
        b = sample(mp.By, positions_b)
        sim.fields.synchronize_magnetic_fields()
        b_sync = sample(mp.By, positions_b)
        sim.fields.restore_magnetic_fields()
        return {"time": float(sim.meep_time()), "Ex": e, "By": b, "BySynchronized": b_sync}

    initial = snapshot()
    assert max(abs(v - math.cos(k * z)) for v, z in zip(initial["Ex"], e_positions)) < 1e-12
    assert max(abs(v + math.sqrt(epsilon) * math.sin(k * z) * math.sin(phase_step / 2))
               for v, z in zip(initial["By"], positions_b)) < 1e-12
    # Equal final physical time for every resolution and both media.
    steps = resolution // 2
    snapshots = [{"step": 0, **initial}]
    for n in range(1, steps + 1):
        sim.fields.step()
        if n in {steps // 2, steps}:
            snapshots.append({"step": n, **snapshot()})
    result = {"name": "periodic-vacuum" if epsilon == 1 else "periodic-dielectric",
              "resolution": resolution, "relativePermittivity": epsilon, "relativePermeability": 1,
              "length": length, "courant": courant, "dx": dx, "dt": dt, "steps": steps,
              "nativeElectricOrigin": origin, "electricPositions": e_positions,
              "magneticPositions": positions_b, "discretePhaseStep": phase_step,
              "snapshots": snapshots}
    sim.reset_meep()
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parents[1] /
                        "tests/fixtures/maxwell/meep-periodic.json")
    args = parser.parse_args()
    mp.verbosity(0)
    data = {"schemaVersion": 1, "generator": "scripts/meep-reference.py", "meepVersion": mp.__version__,
            "pythonVersion": platform.python_version(), "units": {
                "lengthSI": 1, "timeSI": 1 / 299792458, "electricFieldSI": 1,
                "magneticFluxDensitySI": 1 / 299792458,
                "description": "Meep c=1; x_SI=x m; t_SI=t/c s; E_SI=E V/m; B_SI=B/c T"},
            "boundary": "periodic (zero Bloch k), no PML", "sources": [], "geometry": [],
            "initialization": "D_x=epsilon*cos(2*pi*z); B_y=-sqrt(epsilon)*sin(2*pi*z)*sin(discretePhaseStep/2)",
            "sampling": "Ex at native edges, By at native forward faces; By at t-dt/2 and BySynchronized at t",
            "cases": [benchmark(n, eps) for eps in (1, 4) for n in (32, 64, 128)]}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {args.output}: native Meep {mp.__version__}, {len(data['cases'])} cases")


if __name__ == "__main__":
    main()
