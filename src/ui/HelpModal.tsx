import React from 'react';
import { Icon } from './Icon';

export function HelpModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Help">
        <div className="modal-head">
          <Icon name="help" size={18} />
          <span className="modal-title">FieldLab quick guide</span>
          <button className="icon-btn" style={{ marginLeft: 'auto' }} onClick={onClose} aria-label="Close">
            <Icon name="close" size={16} />
          </button>
        </div>
        <div className="modal-body">
          <h3>Two regimes, one scene</h3>
          <p>
            <b>Fields</b> solves electrostatics and magnetostatics: analytic superposition where possible,
            a 3D Poisson/multigrid solve for conductors and dielectrics, and Biot–Savart integration for
            currents and magnets. <b>Waves</b> runs a full time-domain 3D FDTD Maxwell solver with
            materials, PEC objects, periodic walls and a graded absorbing layer.
          </p>
          <h3>Building a scene</h3>
          <p>
            Use <b>Add</b> to insert objects, click an object to select it, then drag the transform gizmo.
            The inspector exposes charge, current, material, potential and source parameters. Everything
            re-solves in a worker; the viewport never blocks.
          </p>
          <h3>Reading the field</h3>
          <p>
            Slices show a scalar heatmap; field lines and arrows show direction. The legend gives the
            mapped quantity and range. Probes report E, B and φ at marked points. In waves mode the
            probe chart records E and B versus simulated time.
          </p>
          <h3>Shortcuts</h3>
          <div className="kbd-grid">
            <span><span className="kbd">space</span></span><span>Play / pause</span>
            <span><span className="kbd">G</span> / <span className="kbd">R</span> / <span className="kbd">S</span></span><span>Translate / rotate / scale gizmo</span>
            <span><span className="kbd">1</span> … <span className="kbd">4</span></span><span>Camera: iso / front / top / side</span>
            <span><span className="kbd">F</span></span><span>Frame the domain</span>
            <span><span className="kbd">Delete</span></span><span>Delete selected object</span>
            <span><span className="kbd">Ctrl</span> <span className="kbd">Z</span></span><span>Undo</span>
            <span><span className="kbd">Ctrl</span> <span className="kbd">Shift</span> <span className="kbd">Z</span></span><span>Redo</span>
          </div>
          <h3>Numerical notes</h3>
          <p>
            The Poisson solver uses a finite-volume multigrid discretisation on a 65³ node grid. Point
            charges are deposited cloud-in-cell, so fields very close to a charge are regularised at the
            cell scale. The FDTD solver is second order on a Yee lattice; keep at least ~20 cells per
            wavelength. The absorbing layer is impedance-matched but is not a perfect PML, so weak
            reflections can remain. Particles are pushed with Boris and do not self-consistently source
            the fields.
          </p>
          <h3>Units</h3>
          <p>
            Everything is SI. The viewport normalises colours and arrow lengths for readability; the
            probe/potential readouts retain physical units. FDTD time steps are ~10⁻¹¹ s and are shown in
            scientific notation.
          </p>
        </div>
      </div>
    </div>
  );
}
