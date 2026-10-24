import type { Scene, SceneObject } from './types';
import {
  defaultCamera,
  defaultDisplay,
  defaultSimulation,
  makeAntenna,
  makeCharge,
  makeChargedSphere,
  makeCoil,
  makeConductor,
  makeDielectric,
  makeLoop,
  makeMagnet,
  makeParticle,
  makePlaneWave,
  makeProbe,
  makeScene,
  makeWire,
} from './defaults';
import type { Vec3 } from '../engine/math/vec3';

export interface Preset {
  id: string;
  title: string;
  group: string;
  subtitle: string;
  description: string;
  tags: string[];
  create: () => Scene;
}

function fieldsScene(name: string, subtitle: string, description: string): Scene {
  const s = makeScene({ name, subtitle, description, mode: 'fields' });
  s.camera = defaultCamera();
  s.display = defaultDisplay();
  s.simulation = defaultSimulation();
  return s;
}

function wavesScene(name: string, subtitle: string, description: string): Scene {
  const s = makeScene({ name, subtitle, description, mode: 'waves' });
  s.camera = { position: [1.5, 1.05, 1.6], target: [0, 0, 0], orthographic: false };
  s.display = {
    ...defaultDisplay(),
    fieldLines: 'none',
    slices: { xy: false, xz: true, yz: false },
    sliceQuantity: 'Emag',
    colormap: 'inferno',
    arrows: 'E',
    arrowDensity: 10,
    sliceResolution: 128,
    slicePositions: { x: 0, y: 0, z: 0 },
  };
  s.simulation = {
    ...defaultSimulation(),
    resolution: 48,
    pmlCells: 8,
    stepsPerFrame: 2,
    boundary: { x: 'pml', y: 'pml', z: 'pml' },
  };
  return s;
}

const maxwellDemoClock = 'Motion is authored at 10 MHz so it changes on the nanosecond FDTD clock. These are physical source frequencies: neither time nor the speed of light is secretly rescaled. The coarse finite grid is an experimental demonstration, not a converged physical prediction.';

function maxwellDemoScene(name: string, description: string): Scene {
  const s = fieldsScene(name, 'Experimental · physical field time', description);
  s.domain = { center: [0, 0, 0], size: [1, 1, 1] };
  s.simulation = { ...defaultSimulation(), useApproximation: false,
    resolution: 16, pmlCells: 4, cfl: 0.9, stepsPerFrame: 2,
    boundary: { x: 'pml', y: 'pml', z: 'pml' } };
  s.display = { ...defaultDisplay(), fieldLines: 'none', lineCount: 8, arrows: 'B', arrowDensity: 5,
    sliceResolution: 64, sliceQuantity: 'Bmag', colormap: 'inferno', conductorOpacity: 0.6 };
  return s;
}

function setDisplay(s: Scene, patch: Partial<Scene['display']>): Scene {
  s.display = { ...s.display, ...patch };
  return s;
}

function cavityWalls(size = 0.5, wall = 0.035): SceneObject[] {
  const half = size / 2;
  const inner = half - wall / 2;
  const objs: SceneObject[] = [];
  for (const sy of [-1, 1]) {
    const c = makeConductor([0, sy * inner, 0], 'box', [size, wall, size]);
    c.potential = 0;
    objs.push(c);
  }
  for (const sx of [-1, 1]) {
    const c = makeConductor([sx * inner, 0, 0], 'box', [wall, size - 2 * wall, size]);
    c.potential = 0;
    objs.push(c);
  }
  for (const sz of [-1, 1]) {
    const c = makeConductor([0, 0, sz * inner], 'box', [size - 2 * wall, size - 2 * wall, wall]);
    c.potential = 0;
    objs.push(c);
  }
  return objs;
}

export const PRESETS: Preset[] = [
  {
    id: 'point-charges',
    title: 'Point charges & dipole',
    group: 'Electrostatics',
    subtitle: 'Superposition, field lines, potential',
    description: 'Two opposite charges build a dipole field. Drag a charge and watch every field line rebuild.',
    tags: ['E', 'field lines', 'dipole'],
    create: () => {
      const s = fieldsScene('Point charges & dipole', 'Superposition', 'A positive and negative charge: the classic dipole.');
      s.objects = [
        makeCharge([-0.17, 0, 0], 2e-9),
        makeCharge([0.17, 0, 0], -2e-9),
        makeProbe([0, 0.28, 0]),
      ];
      setDisplay(s, {
        fieldLines: 'E',
        lineCount: 64,
        slices: { xy: true, xz: false, yz: false },
        sliceQuantity: 'phi',
        colormap: 'coolwarm',
        arrows: 'none',
      });
      s.theory = {
        title: 'Superposition and the dipole',
        body: 'The field of any collection of charges is the vector sum of the individual Coulomb fields. Close to the dipole the two singularities dominate; far away the 1/r³ dipole pattern emerges. Field lines start on positive charge and end on negative charge.',
        equations: [
          '\\mathbf{E}(\\mathbf{r})=\\sum_i \\frac{1}{4\\pi\\varepsilon_0}\\frac{q_i(\\mathbf{r}-\\mathbf{r}_i)}{|\\mathbf{r}-\\mathbf{r}_i|^3}',
          '\\phi(\\mathbf{r})=\\sum_i \\frac{1}{4\\pi\\varepsilon_0}\\frac{q_i}{|\\mathbf{r}-\\mathbf{r}_i|}',
          '\\mathbf{E}=-\\nabla\\phi',
        ],
        prompts: [
          'Switch the slice quantity to φ and compare equipotential bands with the field lines.',
          'Move the probe and read E and φ. Is E zero anywhere between the charges?',
          'Make both charges positive and describe the far field.',
        ],
      };
      return s;
    },
  },
  {
    id: 'charged-sphere',
    title: 'Charged sphere & shell',
    group: 'Electrostatics',
    subtitle: 'Gauss’s law inside and outside',
    description: 'A uniformly charged solid sphere has E ∝ r inside and E ∝ 1/r² outside. A shell has zero field inside.',
    tags: ['Gauss', 'sphere', 'shell'],
    create: () => {
      const s = fieldsScene('Charged sphere', 'E inside and outside', 'A uniformly charged solid sphere.');
      s.objects = [
        makeChargedSphere([0, 0, 0], 12e-9, 0.16, false),
        makeProbe([0, 0.3, 0]),
      ];
      setDisplay(s, {
        fieldLines: 'E',
        lineCount: 54,
        slices: { xy: true, xz: false, yz: false },
        sliceQuantity: 'Emag',
        colormap: 'electric',
        arrows: 'none',
      });
      s.theory = {
        title: 'Gauss’s law for spherical symmetry',
        body: 'For a uniformly charged solid sphere, a Gaussian sphere of radius r<R encloses only the fraction (r/R)³ of the charge, so E grows linearly with r. Outside, it is identical to a point charge. A conducting shell would instead have E=0 inside.',
        equations: [
          'E(r<R)=\\frac{1}{4\\pi\\varepsilon_0}\\frac{Qr}{R^3}',
          'E(r>R)=\\frac{1}{4\\pi\\varepsilon_0}\\frac{Q}{r^2}',
          '\\oint \\mathbf{E}\\cdot d\\mathbf{A}=\\frac{Q_{\\rm enc}}{\\varepsilon_0}',
        ],
        prompts: [
          'Compare the field-line spacing just inside and just outside the surface.',
          'Set the charge negative. Which way do the lines point?',
        ],
      };
      return s;
    },
  },
  {
    id: 'capacitor',
    title: 'Parallel-plate capacitor',
    group: 'Electrostatics',
    subtitle: 'Uniform field, fringing, capacitance',
    description: 'Two conducting plates at ±V. The interior field is nearly uniform; the edge shows fringing.',
    tags: ['capacitor', 'conductor', 'Poisson'],
    create: () => {
      const s = fieldsScene('Parallel-plate capacitor', 'Uniform field & fringing', 'Conducting plates held at ±3 V.');
      const a = makeConductor([-0.16, 0, 0], 'box', [0.024, 0.46, 0.46]);
      a.potential = 3;
      const b = makeConductor([0.16, 0, 0], 'box', [0.024, 0.46, 0.46]);
      b.potential = -3;
      s.objects = [a, b, makeProbe([0, 0, 0])];
      setDisplay(s, {
        fieldLines: 'E',
        lineCount: 40,
        slices: { xy: true, xz: false, yz: false },
        sliceQuantity: 'Emag',
        colormap: 'electric',
        arrows: 'none',
      });
      s.theory = {
        title: 'Capacitance from geometry',
        body: 'Far from the edges the field between the plates is uniform, E=V/d. The solver computes the full fringing field and the total charge on each plate; C=Q/V. The surface-charge overlay colours the plates by σ=ε₀E·n̂.',
        equations: [
          'C=\\frac{Q}{V}\\approx\\frac{\\varepsilon_0 A}{d}',
          'U=\\tfrac12 CV^2=\\int\\frac{\\varepsilon_0 E^2}{2}dV',
          '\\sigma=\\varepsilon_0\\,\\mathbf{E}\\cdot\\hat{\\mathbf{n}}',
        ],
        prompts: [
          'Read C in the measurements panel and compare with ε₀A/d.',
          'Move the plates apart. How do C and the fringe field change?',
          'Toggle the surface-charge overlay. Where is σ largest?',
        ],
      };
      return s;
    },
  },
  {
    id: 'capacitor-dielectric-v',
    title: 'Half-filled capacitor · fixed V',
    group: 'Electrostatics',
    subtitle: 'Dielectric half-area, battery connected',
    description: 'Half the plate area is filled with εᵣ=4 dielectric while the voltage is held fixed. C rises, energy rises.',
    tags: ['dielectric', 'capacitor', 'boundary conditions'],
    create: () => {
      const s = fieldsScene('Half-filled capacitor · fixed V', 'Dielectric at constant voltage', 'The two half-capacitors are in parallel.');
      const a = makeConductor([-0.16, 0, 0], 'box', [0.024, 0.46, 0.46]);
      a.potential = 3;
      const b = makeConductor([0.16, 0, 0], 'box', [0.024, 0.46, 0.46]);
      b.potential = -3;
      const d = makeDielectric([0, -0.115, 0], 'box', [0.296, 0.23, 0.46], 4);
      s.objects = [a, b, d, makeProbe([0, -0.11, 0])];
      setDisplay(s, {
        fieldLines: 'E',
        lineCount: 40,
        slices: { xy: true, xz: false, yz: false },
        sliceQuantity: 'energyE',
        colormap: 'inferno',
        arrows: 'none',
      });
      s.theory = {
        title: 'Parallel dielectrics at fixed voltage',
        body: 'With the voltage fixed, each half sees the same E. The dielectric stores εᵣ times more energy density, so the total capacitance and stored energy increase. The free charge on the covered half of each plate also increases.',
        equations: [
          'C=\\frac{\\varepsilon_0 A}{2d}(1+\\varepsilon_r)=\\frac{\\varepsilon_r+1}{2}C_0',
          'D=\\varepsilon_0\\varepsilon_r E,\\qquad \\nabla\\cdot\\mathbf{D}=\\rho_f',
          'U=\\tfrac12 CV^2',
        ],
        prompts: [
          'Compare energy density on the two halves of the slice.',
          'Read C and compare with (εᵣ+1)/2 × the empty capacitor.',
          'Change εᵣ to 1 and confirm the halves become identical.',
        ],
      };
      return s;
    },
  },
  {
    id: 'capacitor-dielectric-q',
    title: 'Half-filled capacitor · fixed Q',
    group: 'Electrostatics',
    subtitle: 'Dielectric isolated, charge conserved',
    description: 'The plates are isolated with ±Q. Inserting the dielectric lowers V and lowers the stored energy.',
    tags: ['dielectric', 'capacitor', 'energy'],
    create: () => {
      const s = fieldsScene('Half-filled capacitor · fixed Q', 'Dielectric at constant charge', 'Floating plates with equal and opposite charge.');
      const a = makeConductor([-0.16, 0, 0], 'box', [0.024, 0.46, 0.46]);
      a.floating = true;
      a.netCharge = 2e-11;
      const b = makeConductor([0.16, 0, 0], 'box', [0.024, 0.46, 0.46]);
      b.floating = true;
      b.netCharge = -2e-11;
      const d = makeDielectric([0, -0.115, 0], 'box', [0.296, 0.23, 0.46], 4);
      s.objects = [a, b, d, makeProbe([0, -0.11, 0])];
      setDisplay(s, {
        fieldLines: 'E',
        lineCount: 40,
        slices: { xy: true, xz: false, yz: false },
        sliceQuantity: 'energyE',
        colormap: 'inferno',
        arrows: 'none',
      });
      s.theory = {
        title: 'Isolated plates: Q is fixed',
        body: 'With no battery, the free charge cannot change. The dielectric raises C, so V=Q/C falls, and the stored energy U=Q²/2C falls as well. The field energy goes into polarising the dielectric (and ultimately heat if inserted slowly with friction).',
        equations: [
          'Q=CV=\\text{constant}',
          'V\\to V/\\left(\\frac{\\varepsilon_r+1}{2}\\right)',
          'U=\\frac{Q^2}{2C}\\quad\\text{decreases}',
        ],
        prompts: [
          'Read the conductor potentials: did they change when the dielectric was inserted?',
          'Compare total field energy with the fixed-V case.',
          'Explain the sign of the force pulling the dielectric into the gap.',
        ],
      };
      return s;
    },
  },
  {
    id: 'dielectric-slab',
    title: 'Dielectric slab in a field',
    group: 'Electrostatics',
    subtitle: 'Bound charge and D continuity',
    description: 'A dielectric slab polarises in a uniform external field. E is reduced inside; D is continuous across the faces.',
    tags: ['dielectric', 'bound charge', 'D'],
    create: () => {
      const s = fieldsScene('Dielectric slab in a field', 'Polarisation', 'A finite slab with εᵣ=5 in an applied field.');
      s.simulation.staticBoundary = 'open';
      s.simulation.externalField = [1200, 0, 0];
      s.objects = [
        makeDielectric([0, 0, 0], 'box', [0.22, 0.52, 0.52], 5),
        makeProbe([0.16, 0, 0]),
      ];
      setDisplay(s, {
        fieldLines: 'E',
        lineCount: 40,
        slices: { xy: true, xz: false, yz: false },
        sliceQuantity: 'phi',
        colormap: 'coolwarm',
        arrows: 'none',
      });
      s.theory = {
        title: 'Normal D, tangential E',
        body: 'The applied field polarises the slab. Bound surface charge appears on the faces normal to E and reduces the field inside. Across a dielectric interface with no free charge, the normal component of D=ε₀εᵣE is continuous while the tangential component of E is continuous.',
        equations: [
          '\\mathbf{D}=\\varepsilon_0\\mathbf{E}+\\mathbf{P}=\\varepsilon_0\\varepsilon_r\\mathbf{E}',
          'D_{1n}=D_{2n},\\qquad E_{1t}=E_{2t}',
          '\\sigma_b=\\mathbf{P}\\cdot\\hat{\\mathbf{n}}',
          'U=\\int\\frac{\\mathbf{E}\\cdot\\mathbf{D}}{2}dV',
        ],
        prompts: [
          'Put the probe inside and outside the slab and compare E.',
          'Is D the same on both sides of a face?',
          'Rotate the slab and watch the field pattern change.',
        ],
      };
      return s;
    },
  },
  {
    id: 'conductor-cavity',
    title: 'Conductor with a cavity',
    group: 'Electrostatics',
    subtitle: 'Electrostatic shielding',
    description: 'A grounded conducting shell surrounds a charge. Outside charges do not affect the interior field.',
    tags: ['conductor', 'shielding', 'cavity'],
    create: () => {
      const s = fieldsScene('Conductor with a cavity', 'Electrostatic shielding', 'A closed grounded shell with a charge inside and a charge outside.');
      s.objects = [
        ...cavityWalls(0.5, 0.04),
        makeCharge([0, 0, 0], 3e-9),
        makeCharge([0.43, 0, 0], -3e-9),
        makeProbe([0.12, 0.18, 0]),
      ];
      setDisplay(s, {
        fieldLines: 'E',
        conductorOpacity: 0.15,
        lineCount: 70,
        slices: { xy: true, xz: false, yz: false },
        sliceQuantity: 'Emag',
        colormap: 'electric',
        arrows: 'none',
      });
      s.theory = {
        title: 'Why a closed conductor shields',
        body: 'In equilibrium the field inside the conductor material is zero and its surface is an equipotential. A closed grounded shell therefore separates the inside from the outside: charges outside induce charge only on the outer surface; charges inside induce charge on the inner surface. The cavity field depends only on the interior charge.',
        equations: [
          '\\mathbf{E}_{\\text{inside metal}}=0',
          '\\phi_{\\text{surface}}=\\text{constant}',
          '\\oint_{\\text{cavity}}\\mathbf{E}\\cdot d\\mathbf{A}=\\frac{Q_{\\text{inside}}}{\\varepsilon_0}',
        ],
        prompts: [
          'Move the outside charge. Does the field at the probe change?',
          'Move the inside charge. Does the exterior field change?',
          'Turn off grounding (set a floating wall) and reason about the new equilibrium.',
        ],
      };
      return s;
    },
  },
  {
    id: 'conductor-sphere',
    title: 'Conducting sphere in a field',
    group: 'Electrostatics',
    subtitle: 'Induced dipole and surface charge',
    description: 'A conducting sphere distorts a uniform applied field; the induced surface charge creates a dipole field outside.',
    tags: ['conductor', 'induced charge', 'dipole'],
    create: () => {
      const s = fieldsScene('Conducting sphere in a field', 'Induced surface charge', 'A neutral conducting sphere in a uniform external field.');
      s.simulation.staticBoundary = 'open';
      s.simulation.externalField = [1500, 0, 0];
      const c = makeConductor([0, 0, 0], 'sphere', [0.22, 0.22, 0.22]);
      c.floating = true;
      c.netCharge = 0;
      s.objects = [c, makeProbe([0.28, 0, 0])];
      setDisplay(s, {
        fieldLines: 'E',
        lineCount: 54,
        slices: { xy: true, xz: false, yz: false },
        sliceQuantity: 'phi',
        colormap: 'coolwarm',
        arrows: 'none',
      });
      s.theory = {
        title: 'Induced dipole',
        body: 'The external field pushes free electrons until the interior field vanishes. The resulting surface charge is positive on one side and negative on the other; outside, it acts like an induced dipole added to the uniform field.',
        equations: [
          '\\mathbf{E}_{\\rm in}=0',
          '\\sigma(\\theta)=3\\varepsilon_0E_0\\cos\\theta',
          '\\mathbf{p}=4\\pi\\varepsilon_0R^3\\mathbf{E}_0',
        ],
        prompts: [
          'Inspect the surface-charge colours on the sphere.',
          'Compare the field at the probe with the applied 1500 V/m.',
          'Set the external field to zero and confirm E=0 inside.',
        ],
      };
      return s;
    },
  },
  {
    id: 'straight-wire',
    title: 'Straight current-carrying wire',
    group: 'Magnetostatics',
    subtitle: 'Circular B field and the right-hand rule',
    description: 'A long wire along y carries 6 A. B circles the wire with magnitude μ₀I/2πr.',
    tags: ['B', 'wire', 'Ampère'],
    create: () => {
      const s = fieldsScene('Straight current-carrying wire', 'Circular magnetic field', 'A wire along y, current 6 A.');
      s.objects = [
        makeWire([[0, -0.5, 0], [0, 0.5, 0]], 6),
        makeProbe([0.12, 0, 0]),
      ];
      setDisplay(s, {
        fieldLines: 'B',
        lineCount: 40,
        slices: { xy: false, xz: true, yz: false },
        sliceQuantity: 'Bmag',
        colormap: 'magnetic',
        arrows: 'B',
        arrowDensity: 9,
      });
      s.theory = {
        title: 'Ampère’s law',
        body: 'The field circles the wire. Point your right thumb along the current; your fingers curl in the direction of B. The strength falls as 1/r.',
        equations: [
          '\\mathbf{B}=\\frac{\\mu_0 I}{2\\pi r}\\hat{\\boldsymbol{\\varphi}}',
          '\\oint\\mathbf{B}\\cdot d\\mathbf{l}=\\mu_0 I_{\\rm enc}',
        ],
        prompts: [
          'Reverse the current. Which way do the arrows flip?',
          'Read B at two probe distances and check the 1/r ratio.',
          'Rotate the wire and watch the field lines follow.',
        ],
      };
      return s;
    },
  },
  {
    id: 'current-loop',
    title: 'Current loop',
    group: 'Magnetostatics',
    subtitle: 'On-axis field and the dipole limit',
    description: 'A circular loop produces a dipole-like field. On the axis B=μ₀IR²/2(R²+z²)^{3/2}.',
    tags: ['B', 'loop', 'dipole'],
    create: () => {
      const s = fieldsScene('Current loop', 'Magnetic dipole field', 'A 5 A loop of radius 0.18 m.');
      s.objects = [
        makeLoop([0, 0, 0], 0.18, 5),
        makeProbe([0, 0, 0.25]),
      ];
      setDisplay(s, {
        fieldLines: 'B',
        lineCount: 48,
        slices: { xy: false, xz: true, yz: false },
        sliceQuantity: 'Bmag',
        colormap: 'magnetic',
        arrows: 'B',
        arrowDensity: 9,
      });
      s.theory = {
        title: 'Field of a loop',
        body: 'Close to the wire the field circles the conductor; far away the loop looks like a magnetic dipole. The field passes through the loop in one direction and returns outside.',
        equations: [
          'B_z(z)=\\frac{\\mu_0IR^2}{2(R^2+z^2)^{3/2}}',
          '\\mathbf{B}_{\\rm dip}=\\frac{\\mu_0}{4\\pi}\\frac{3(\\mathbf{m}\\cdot\\hat{\\mathbf{r}})\\hat{\\mathbf{r}}-\\mathbf{m}}{r^3}',
          '\\mathbf{m}=I\\mathbf{A}',
        ],
        prompts: [
          'Compare B at the centre and at z=0.25 m with the on-axis formula.',
          'Flip the current and observe the field lines reverse.',
          'Increase the radius; does the centre field grow or shrink?',
        ],
      };
      return s;
    },
  },
  {
    id: 'solenoid',
    title: 'Solenoid',
    group: 'Magnetostatics',
    subtitle: 'Uniform interior field, ½LI²',
    description: 'A 14-turn solenoid concentrates B inside. The field energy is ½LI².',
    tags: ['B', 'solenoid', 'inductance', 'energy'],
    create: () => {
      const s = fieldsScene('Solenoid', 'Uniform interior field', 'A helical coil carrying 4 A.');
      s.objects = [
        makeCoil([0, 0, 0], 0.085, 0.44, 14),
        makeProbe([0, 0, 0]),
      ];
      (s.objects[0] as ReturnType<typeof makeCoil>).current = 4;
      setDisplay(s, {
        fieldLines: 'B',
        lineCount: 48,
        slices: { xy: false, xz: true, yz: false },
        sliceQuantity: 'Bmag',
        colormap: 'magnetic',
        arrows: 'B',
        arrowDensity: 9,
      });
      s.theory = {
        title: 'Solenoid and stored magnetic energy',
        body: 'Inside an ideal long solenoid B=μ₀nI, nearly independent of position. The inductance grows as N², so the stored energy ½LI² grows rapidly with turn count.',
        equations: [
          'B=\\mu_0 n I=\\mu_0\\frac{N}{\\ell}I',
          'L\\approx\\frac{\\mu_0N^2A}{\\ell}',
          'U=\\tfrac12LI^2=\\int\\frac{B^2}{2\\mu_0}dV',
        ],
        prompts: [
          'Read B at the centre and near an end: where does it start to fringe?',
          'Triple the current. By what factor does the stored energy change?',
          'Remove turns and compare the interior field.',
        ],
      };
      return s;
    },
  },
  {
    id: 'parallel-wires',
    title: 'Parallel wires',
    group: 'Magnetostatics',
    subtitle: 'Attraction, repulsion, force per length',
    description: 'Two currents side by side. Parallel currents attract; antiparallel currents repel.',
    tags: ['B', 'force', 'Ampère'],
    create: () => {
      const s = fieldsScene('Parallel wires', 'Magnetic forces', 'Two 5 A wires along y, separated by 0.24 m.');
      s.objects = [
        makeWire([[-0.12, -0.45, 0], [-0.12, 0.45, 0]], 5),
        makeWire([[0.12, -0.45, 0], [0.12, 0.45, 0]], 5),
        makeProbe([0, 0, 0]),
      ];
      setDisplay(s, {
        fieldLines: 'B',
        lineCount: 40,
        slices: { xy: true, xz: false, yz: false },
        sliceQuantity: 'Bmag',
        colormap: 'magnetic',
        arrows: 'B',
        arrowDensity: 9,
      });
      s.theory = {
        title: 'Force between wires',
        body: 'Each wire sits in the magnetic field of the other, so it feels F=IL×B. Parallel currents attract; opposite currents repel. The force per unit length is μ₀I₁I₂/2πd.',
        equations: [
          '\\frac{F}{L}=\\frac{\\mu_0I_1I_2}{2\\pi d}',
          '\\mathbf{F}=I\\int d\\mathbf{l}\\times\\mathbf{B}',
        ],
        prompts: [
          'Flip one current and watch the field pattern between the wires change.',
          'Use the probe to find where B vanishes for equal parallel currents.',
          'Double the separation: what happens to the force per length?',
        ],
      };
      return s;
    },
  },
  {
    id: 'bar-magnet',
    title: 'Bar magnet',
    group: 'Magnetostatics',
    subtitle: 'Magnetisation and bound surface current',
    description: 'A uniformly magnetised cylinder is equivalent to a surface current K_b=M×n̂. The field is dipole-like outside.',
    tags: ['B', 'magnet', 'magnetisation', 'surface current'],
    create: () => {
      const s = fieldsScene('Bar magnet', 'Bound surface current', 'A uniformly magnetised cylinder, M=8×10⁵ A/m.');
      s.objects = [
        makeMagnet([0, 0, 0], 0.055, 0.26),
        makeProbe([0.16, 0, 0]),
      ];
      setDisplay(s, {
        fieldLines: 'B',
        lineCount: 48,
        slices: { xy: false, xz: true, yz: false },
        sliceQuantity: 'Bmag',
        colormap: 'magnetic',
        arrows: 'B',
        arrowDensity: 9,
        showBoundCurrent: true,
      });
      s.theory = {
        title: 'Magnetisation as bound current',
        body: 'A permanent magnet can be modelled by bound currents: a volume current ∇×M and a surface current K_b=M×n̂. For uniform M the volume term vanishes and only the side surface current remains.',
        equations: [
          '\\mathbf{J}_b=\\nabla\\times\\mathbf{M}',
          '\\mathbf{K}_b=\\mathbf{M}\\times\\hat{\\mathbf{n}}',
          '\\mathbf{B}=\\mu_0(\\mathbf{H}+\\mathbf{M})',
        ],
        prompts: [
          'Toggle the bound-current overlay and check its direction with M×n̂.',
          'Follow a field line from N to S outside and S to N inside.',
          'Reverse the magnetisation and compare.',
        ],
      };
      return s;
    },
  },
  {
    id: 'lorentz-eb',
    title: 'Electron in E and B',
    group: 'Dynamics',
    subtitle: 'Lorentz force, cyclotron motion',
    description: 'An electron in crossed electric and magnetic fields traces a drifting cyclotron orbit.',
    tags: ['particle', 'Lorentz', 'Boris'],
    create: () => {
      const s = fieldsScene('Electron in E and B', 'Lorentz force', 'Uniform E along y and B along z.');
      s.simulation.externalField = [0, 8, 0];
      s.simulation.externalB = [0, 0, 8e-5];
      const p = makeParticle([0, 0, 0], 'electron', [1.0e6, 0, 0]);
      s.objects = [p, makeProbe([0.1, 0, 0])];
      setDisplay(s, {
        fieldLines: 'none',
        slices: { xy: false, xz: false, yz: false },
        arrows: 'none',
        vectorScale: 1.2,
      });
      s.theory = {
        title: 'Boris integration of the Lorentz force',
        body: 'The Boris pusher splits the electric and magnetic kicks. In a pure B field it conserves kinetic energy exactly, so long gyro-orbits stay circular. With E and B crossed, the guiding centre drifts with E×B/B².',
        equations: [
          '\\mathbf{F}=q(\\mathbf{E}+\\mathbf{v}\\times\\mathbf{B})',
          '\\omega_c=\\frac{|q|B}{m},\\qquad r_c=\\frac{mv_\\perp}{|q|B}',
          '\\mathbf{v}_d=\\frac{\\mathbf{E}\\times\\mathbf{B}}{B^2}',
        ],
        prompts: [
          'Press play and inspect the orbit. Read the gyroradius.',
          'Reverse B and watch the handedness flip.',
          'Set E=0 for a pure circular orbit.',
        ],
      };
      return s;
    },
  },
  {
    id: 'magnet-loop',
    title: 'Magnet through a loop',
    group: 'Induction',
    subtitle: 'Faraday’s law, Lenz’s law',
    description: 'A bar magnet oscillates through a pickup loop. The flux through the loop changes as the magnet passes, driving an EMF ε = −dΦ/dt.',
    tags: ['induction', 'Faraday', 'flux', 'EMF', 'Lenz'],
    create: () => {
      const s = fieldsScene('Magnet through a loop', 'Faraday induction', 'A moving magnet drives a changing flux through a pickup loop.');
      const magnet = makeMagnet([0, 0, 0], 0.05, 0.24);
      magnet.name = 'Oscillating magnet';
      magnet.rotation = [0, Math.PI / 2, 0];
      magnet.motion = { kind: 'oscillate', axis: [1, 0, 0], amplitude: 0.3, frequency: 0.32 };
      const loop = makeLoop([0, 0, 0], 0.12, 0);
      loop.name = 'Pickup loop';
      loop.rotation = [0, Math.PI / 2, 0];
      loop.wireRadius = 0.01;
      s.objects = [magnet, loop];
      setDisplay(s, {
        fieldLines: 'B',
        lineCount: 20,
        slices: { xy: false, xz: false, yz: false },
        arrows: 'B',
        arrowDensity: 6,
        showBoundCurrent: true,
      });
      s.theory = {
        title: 'Faraday’s law',
        body: 'The flux through the loop is Φ = ∫B·n̂ dA. While the magnet moves, Φ changes; the loop develops an EMF equal to minus the rate of change of flux. Lenz’s law fixes the sign: the induced current would oppose the change that produced it. The EMF peaks while the magnet is half in and half out of the loop, where Φ changes fastest — at dead centre the flux is momentarily stationary.',
        equations: [
          '\Phi_B=\int\mathbf{B}\cdot d\mathbf{A}',
          '\varepsilon=-\frac{d\Phi_B}{dt}',
          '\oint\mathbf{E}\cdot d\mathbf{l}=-\frac{d}{dt}\int\mathbf{B}\cdot d\mathbf{A}',
        ],
        prompts: [
          'Open Data and watch Φ and ε. The EMF peaks when the magnet is halfway through.',
          'Increase the oscillation frequency: the EMF grows in proportion.',
          'Reverse the magnet (flip its axis) and watch the sign of ε change.',
        ],
      };
      return s;
    },
  },
  {
    id: 'rotating-loop',
    title: 'Rotating loop generator',
    group: 'Induction',
    subtitle: 'AC generator, flux linkage',
    description: 'A loop spins in a uniform magnetic field. The projected area changes as cos ωt, so the induced EMF is sinusoidal.',
    tags: ['induction', 'generator', 'AC', 'flux', 'rotation'],
    create: () => {
      const s = fieldsScene('Rotating loop', 'AC generator', 'A loop rotates about x in a uniform B along z.');
      s.simulation.externalB = [0, 0, 0.002];
      const loop = makeLoop([0, 0, 0], 0.22, 0);
      loop.name = 'Rotor loop';
      loop.wireRadius = 0.01;
      loop.motion = { kind: 'spin', axis: [1, 0, 0], amplitude: 0, frequency: 0.5 };
      s.objects = [loop];
      setDisplay(s, {
        fieldLines: 'none',
        slices: { xy: false, xz: false, yz: false },
        arrows: 'B',
        arrowDensity: 7,
        colormap: 'magnetic',
      });
      s.theory = {
        title: 'The AC generator',
        body: 'For a loop of area A and N turns in a uniform field, Φ = N B A cos θ with θ = ωt. Differentiating gives ε = N B A ω sin ωt. The EMF is zero when the loop faces the field (maximum flux) and peaks when the loop is edge-on (zero flux).',
        equations: [
          '\Phi_B=NBA\cos\omega t',
          '\varepsilon=NBA\omega\sin\omega t',
          '\varepsilon_0=NBA\omega',
        ],
        prompts: [
          'Watch the EMF oscillate as the normal sweeps through the field.',
          'Double the frequency and confirm the peak EMF doubles.',
          'Tilt the field out of the plane and compare the waveform.',
        ],
      };
      return s;
    },
  },
  {
    id: 'rod-rails',
    title: 'Rod on rails',
    group: 'Induction',
    subtitle: 'Motional EMF, Bℓv',
    description: 'A conducting rod slides on two rails in a uniform B. The charges in the rod feel v × B, producing a motional EMF.',
    tags: ['induction', 'motional EMF', 'Lorentz', 'rails'],
    create: () => {
      const s = fieldsScene('Rod on rails', 'Motional EMF', 'A rod slides along two rails in a uniform B along y.');
      s.simulation.externalB = [0, 0.05, 0];
      const railA = makeWire([[-0.32, 0, 0.12], [0.32, 0, 0.12]], 0);
      railA.name = 'Rail +z';
      railA.wireRadius = 0.006;
      const railB = makeWire([[-0.32, 0, -0.12], [0.32, 0, -0.12]], 0);
      railB.name = 'Rail −z';
      railB.wireRadius = 0.006;
      const rod = makeWire([[0, 0, -0.12], [0, 0, 0.12]], 0);
      rod.name = 'Sliding rod';
      rod.wireRadius = 0.009;
      rod.motion = { kind: 'oscillate', axis: [1, 0, 0], amplitude: 0.16, frequency: 0.5 };
      s.objects = [railA, railB, rod];
      setDisplay(s, {
        fieldLines: 'none',
        slices: { xy: false, xz: false, yz: false },
        arrows: 'B',
        arrowDensity: 7,
        colormap: 'magnetic',
      });
      s.theory = {
        title: 'Motional EMF',
        body: 'A charge q in the rod moves with the rod at velocity v, so it feels qv × B. The equivalent non-electrostatic field v × B drives a current. For a straight rod of length ℓ perpendicular to B, ε = Bℓv. Reversing the motion or the field reverses the EMF.',
        equations: [
          '\mathbf{F}=q(\mathbf{v}\times\mathbf{B})',
          '\varepsilon=\int(\mathbf{v}\times\mathbf{B})\cdot d\mathbf{l}=B\ell v',
          '\varepsilon=-\frac{d\Phi_B}{dt}',
        ],
        prompts: [
          'Read ε at the centre of the stroke, where the speed is largest.',
          'Flip B and watch the sign of ε reverse.',
          'Compare the measured peak with Bℓv using v = ωA.',
        ],
      };
      return s;
    },
  },
  {
    id: 'plane-wave',
    title: 'Plane electromagnetic wave',
    group: 'Waves',
    subtitle: 'E ⟂ B ⟂ k, speed c',
    description: 'A 300 MHz plane wave propagates along x. E and B oscillate in phase, perpendicular to each other and to the direction of travel.',
    tags: ['Maxwell', 'wave', 'FDTD'],
    create: () => {
      const s = wavesScene('Plane wave', 'E ⟂ B ⟂ k', 'A CW plane wave at 300 MHz.');
      s.simulation.boundary = { x: 'pml', y: 'periodic', z: 'periodic' };
      const src = makePlaneWave();
      src.frequency = 3e8;
      src.amplitude = 1;
      src.waveform = 'cw';
      s.objects = [src, makeProbe([0.2, 0, 0])];
      setDisplay(s, {
        sliceQuantity: 'Ez',
        colormap: 'coolwarm',
        arrows: 'E',
        arrowDensity: 8,
        vectorScale: 1.25,
      });
      s.theory = {
        title: 'Maxwell’s wave',
        body: 'In vacuum the coupled curl equations give a wave equation with speed c=1/√(ε₀μ₀). E, B, and k form a right-handed orthogonal triple. The FDTD solver advances the full time-dependent Maxwell equations on a Yee lattice.',
        equations: [
          '\\nabla\\times\\mathbf{E}=-\\frac{\\partial\\mathbf{B}}{\\partial t}',
          '\\nabla\\times\\mathbf{B}=\\mu_0\\varepsilon_0\\frac{\\partial\\mathbf{E}}{\\partial t}',
          '\\nabla^2\\mathbf{E}=\\frac{1}{c^2}\\frac{\\partial^2\\mathbf{E}}{\\partial t^2}',
          'c=\\frac{1}{\\sqrt{\\varepsilon_0\\mu_0}}',
        ],
        prompts: [
          'Switch the slice to Ey and compare its phase with Ez.',
          'Turn on B arrows: does B point along y?',
          'Read the probe time series and estimate the period.',
        ],
      };
      return s;
    },
  },
  {
    id: 'pec-reflection',
    title: 'Reflection at a conductor',
    group: 'Waves',
    subtitle: 'PEC boundary and standing waves',
    description: 'A wave hits a perfect conductor. The reflected E flips sign, creating a standing wave with a node at the surface.',
    tags: ['Maxwell', 'PEC', 'standing wave'],
    create: () => {
      const s = wavesScene('Reflection at a conductor', 'PEC boundary', 'A plane wave reflects from a conducting slab.');
      s.simulation.boundary = { x: 'pml', y: 'periodic', z: 'periodic' };
      const src = makePlaneWave();
      src.frequency = 3e8;
      src.amplitude = 1;
      src.waveform = 'cw';
      const plate = makeConductor([0.28, 0, 0], 'box', [0.03, 1, 1]);
      s.objects = [src, plate, makeProbe([0.12, 0, 0]), makeProbe([0.24, 0, 0])];
      setDisplay(s, {
        sliceQuantity: 'Ez',
        colormap: 'coolwarm',
        arrows: 'E',
        arrowDensity: 8,
        vectorScale: 1.25,
      });
      s.theory = {
        title: 'Reflection coefficient of a PEC',
        body: 'The tangential electric field must vanish at a perfect conductor. The reflected wave therefore has E_reflected=-E_incident, giving a standing-wave node at the surface and an antinode a quarter wavelength away.',
        equations: [
          'E_{\\rm tan}=0\\ \\text{at PEC}',
          '\\Gamma=\\frac{E_r}{E_i}=-1',
          'E(x,t)=2E_0\\sin(kx)\\cos(\\omega t)\\ \\text{(node at }x=0)',
        ],
        prompts: [
          'Compare the two probes: which is near a node and which near an antinode?',
          'Switch to Emag: where is the electric field maximum?',
          'Move the plate and watch the standing-wave pattern shift.',
        ],
      };
      return s;
    },
  },
  {
    id: 'fresnel',
    title: 'Dielectric interface',
    group: 'Waves',
    subtitle: 'Fresnel reflection and transmission',
    description: 'A plane wave crosses from vacuum into εᵣ=4. The wavelength shortens and part of the wave reflects.',
    tags: ['Maxwell', 'Fresnel', 'dielectric'],
    create: () => {
      const s = wavesScene('Dielectric interface', 'Fresnel reflection', 'A 300 MHz plane wave enters a dielectric slab.');
      s.simulation.boundary = { x: 'pml', y: 'periodic', z: 'periodic' };
      const src = makePlaneWave();
      src.frequency = 3e8;
      src.amplitude = 1;
      src.waveform = 'cw';
      const slab = makeDielectric([0.12, 0, 0], 'box', [0.22, 1, 1], 4);
      s.objects = [src, slab, makeProbe([-0.1, 0, 0]), makeProbe([0.32, 0, 0])];
      setDisplay(s, {
        sliceQuantity: 'Emag',
        colormap: 'inferno',
        arrows: 'E',
        arrowDensity: 11,
      });
      s.theory = {
        title: 'Normal-incidence Fresnel coefficients',
        body: 'At normal incidence the reflection and transmission amplitudes depend only on the refractive indices. Inside the dielectric the wave slows to c/n and its wavelength shrinks by n. The frequency is unchanged.',
        equations: [
          'n=\\sqrt{\\varepsilon_r\\mu_r}',
          'r=\\frac{n_1-n_2}{n_1+n_2},\\qquad t=\\frac{2n_1}{n_1+n_2}',
          'R=|r|^2,\\qquad T=\\frac{n_2}{n_1}|t|^2',
          '\\lambda_2=\\lambda_1/n',
        ],
        prompts: [
          'Compare wavelength inside and outside the slab.',
          'Read the probe amplitudes: is T+R≈1?',
          'Change εᵣ to 1 and watch the reflection disappear.',
        ],
      };
      return s;
    },
  },
  {
    id: 'faraday-cage',
    title: 'Faraday cage',
    group: 'Waves',
    subtitle: 'Shielding a transient wave',
    description: 'A closed conducting box suppresses the field inside while the external wave passes around it.',
    tags: ['Maxwell', 'shielding', 'PEC'],
    create: () => {
      const s = wavesScene('Faraday cage', 'Transient shielding', 'A plane wave pulse illuminates a closed conducting box.');
      s.simulation.boundary = { x: 'pml', y: 'pml', z: 'pml' };
      const src = makePlaneWave();
      src.frequency = 2e8;
      src.amplitude = 1;
      src.waveform = 'pulse';
      s.objects = [
        src,
        ...cavityWalls(0.46, 0.03),
        makeProbe([0, 0, 0]),
        makeProbe([0, 0.4, 0]),
      ];
      setDisplay(s, {
        sliceQuantity: 'Emag',
        colormap: 'inferno',
        arrows: 'none',
        sliceResolution: 128,
      });
      s.theory = {
        title: 'Shielding in the time domain',
        body: 'A good conductor forces the tangential E field to zero at its surface. A closed conducting shell therefore excludes the external wave from its interior; the residual penetration is limited by the skin depth at the driving frequency.',
        equations: [
          '\\delta=\\sqrt{\\frac{2}{\\omega\\mu\\sigma}}',
          'E_{\\rm inside}\\approx E_0 e^{-d/\\delta}',
        ],
        prompts: [
          'Compare the centre probe with the outside probe.',
          'Open a gap in the cage (move a wall) and watch the leakage.',
          'Increase the frequency and observe the shorter pulse.',
        ],
      };
      return s;
    },
  },
  {
    id: 'dipole-antenna',
    title: 'Dipole antenna',
    group: 'Waves',
    subtitle: 'Radiation from an oscillating current',
    description: 'A short oscillating current filament launches a toroidal wave pattern with E along the antenna.',
    tags: ['Maxwell', 'radiation', 'antenna'],
    create: () => {
      const s = wavesScene('Dipole antenna', 'Radiation', 'A half-wave-scale dipole driven at 300 MHz.');
      s.simulation.boundary = { x: 'pml', y: 'pml', z: 'pml' };
      const ant = makeAntenna([0, 0, 0]);
      ant.length = 0.3;
      ant.frequency = 3e8;
      ant.amplitude = 1;
      ant.waveform = 'cw';
      s.objects = [ant, makeProbe([0.3, 0, 0]), makeProbe([0, 0.3, 0])];
      setDisplay(s, {
        sliceQuantity: 'Emag',
        colormap: 'inferno',
        arrows: 'E',
        arrowDensity: 9,
      });
      s.theory = {
        title: 'Radiation',
        body: 'An oscillating current launches propagating E and B fields. Along the antenna axis the radiation is weak; broadside it is strongest. The far field falls as 1/r and carries energy according to the Poynting vector.',
        equations: [
          '\\mathbf{S}=\\frac{1}{\\mu_0}\\mathbf{E}\\times\\mathbf{B}',
          'P=\\oint\\mathbf{S}\\cdot d\\mathbf{A}',
          'E_{\\rm far}\\propto\\frac{\\sin\\theta}{r}',
        ],
        prompts: [
          'Compare the two probes: broadside versus along the axis.',
          'Turn on Poynting arrows to see energy flow.',
          'Change the frequency and watch the wavelength change.',
        ],
      };
      return s;
    },
  },
  {
    id: 'maxwell-moving-capacitor',
    title: 'Maxwell: moving isolated capacitor',
    group: 'Maxwell FDTD',
    subtitle: 'Experimental · transported plate charge and B',
    description: 'Finite-conductivity plates start from ±3 V, then move together in isolation. No voltage clamp, hidden wires or battery. ' + maxwellDemoClock,
    tags: ['experimental', 'isolated electrodes', 'physical time'],
    create: () => {
      const s = maxwellDemoScene('Maxwell: moving isolated capacitor', 'Experimental finite-conductivity plates initialized at ±3 V, then isolated and moved on physical field time.');
      s.simulation.maxwellConductorModel = 'isolated';
      const positive = makeConductor([-0.125, 0, 0], 'box', [0.08, 0.5, 0.5]);
      const negative = makeConductor([0.125, 0, 0], 'box', [0.08, 0.5, 0.5]);
      positive.name = 'Initially +3 V isolated plate'; positive.potential = 3;
      negative.name = 'Initially −3 V isolated plate'; negative.potential = -3;
      for (const plate of [positive, negative]) {
        plate.conductivity = 0.01;
        plate.motion = { kind: 'oscillate', axis: [0, 1, 0], amplitude: 0.02, frequency: 1e7, phase: -Math.PI / 2 };
      }
      const probe = makeProbe([0, 0, 0]); probe.quantity = 'B';
      s.objects = [positive, negative, probe];
      s.theory = {
        title: 'Experimental moving isolated electrodes',
        body: 'Authored potentials prepare initial plate charge once. The supplies are then disconnected: charge/current and E/B evolve with a finite conductivity of 0.01 S/m. Both plates begin at rest at the lower end of their prescribed y oscillation; the external drive supplies their motion. Observe the magnetic response as transported charge accelerates. This material model is not a validated moving perfect conductor, and its energy/momentum diagnostics do not form a closed ledger. ' + maxwellDemoClock,
        prompts: ['Play or single-step, then compare physical time, B and plate poses.', 'Rewind preserves authored settings; Replay repeats the same initialization.', 'Refine the grid and boundaries before interpreting field amplitudes quantitatively.'],
      };
      return s;
    },
  },
  {
    id: 'maxwell-passive-pickup',
    title: 'Maxwell: passive pickup loop',
    group: 'Maxwell FDTD',
    subtitle: 'Experimental · induced material current, no applied I',
    description: 'A moving impressed magnet excites a resolved finite-conductivity loop. Source switch-on history matters; no voltage feed or imposed loop current. ' + maxwellDemoClock,
    tags: ['experimental', 'passive loop', 'induction'],
    create: () => {
      const s = maxwellDemoScene('Maxwell: passive pickup loop', 'Experimental passive finite-conductivity pickup with prescribed magnet motion and explicit source switch-on history.');
      const loop = makeLoop([0, 0, 0], 0.25, 0);
      Object.assign(loop, { name: 'Passive pickup (no applied current)', electricalModel: 'conducting', wireRadius: 0.1, conductivity: 0.01 });
      const magnet = makeMagnet([0, 0, 0], 0.07, 0.2);
      magnet.name = 'Prescribed impressed magnet'; magnet.magnetization = 10;
      magnet.motion = { kind: 'oscillate', axis: [0, 0, 1], amplitude: 0.08, frequency: 1e7, phase: -Math.PI / 2 };
      const probe = makeProbe([0.25, 0, 0]); probe.quantity = 'B';
      s.objects = [loop, magnet, probe];
      s.theory = {
        title: 'Experimental passive pickup and source history',
        body: 'The loop has no impressed current: its material current responds to the evolved fields with conductivity 0.01 S/m. Its authored 0.1 m wire radius spans at least three cells across the diameter on this 16-cell grid; geometry is not automatically enlarged. The +z impressed magnet begins at rest at the lower end of its prescribed z oscillation. Initial source switch-on and subsequent motion both contribute to the transient; this is not a pre-existing steady-state magnet history. Inspect Jy and B at the probe, and distinguish stationary material loss, body heat estimates and partial mechanical work. General circuit and closed energy/momentum validation remains incomplete. ' + maxwellDemoClock,
        prompts: ['Read Jy at the probe inside the pickup material as fields evolve.', 'Compare initial source switch-on with later changes during magnet motion.', 'Pause and single-step to keep fields, source poses and diagnostics on the same physical clock.'],
      };
      return s;
    },
  },
];

export const PRESET_GROUPS = ['Electrostatics', 'Magnetostatics', 'Dynamics', 'Induction', 'Waves', 'Maxwell FDTD'];

export function getPreset(id: string): Preset | undefined {
  return PRESETS.find((p) => p.id === id);
}

export function defaultScene(): Scene {
  const preset = getPreset('point-charges') ?? PRESETS[0];
  return preset.create();
}

export type { Vec3 };
