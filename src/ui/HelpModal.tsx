import React, { useEffect, useRef } from 'react';
import { Icon } from './Icon';

export function HelpModal({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current!;
    const app = document.querySelector('.workspace') as HTMLElement | null;
    if (app) app.inert = true;
    dialog.querySelector<HTMLElement>('button')?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeRef.current(); }
      if (event.key === 'Tab') {
        const controls = [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),[tabindex="0"]')];
        const first = controls[0], last = controls.at(-1);
        if (!first) { event.preventDefault(); dialog.focus(); }
        else if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', key, true);
    return () => { document.removeEventListener('keydown', key, true); if (app) app.inert = false; previous?.focus(); };
  }, []);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={dialogRef} tabIndex={-1} className="modal" role="dialog" aria-modal="true" aria-label="Help">
        <div className="modal-head">
          <Icon name="help" size={18} />
          <span className="modal-title">FieldLab quick guide</span>
          <button className="icon-btn" style={{ marginLeft: 'auto' }} onClick={onClose} aria-label="Close">
            <Icon name="close" size={16} />
          </button>
        </div>
        <div className="modal-body">
          <h3>Choose an experiment</h3>
          <p>
            <b>Fields</b> solves electrostatics and magnetostatics: analytic superposition where possible,
            a 3D Poisson/multigrid solve for conductors and dielectrics, and Biot–Savart integration for
            currents and magnets. Wave scenes use a time-domain 3D FDTD curl-equation solver with
            materials, PEC objects, periodic walls and a graded absorbing layer. Choose a preset in
            Scenes; its solver is selected automatically.
          </p>
          <h3>Building a scene</h3>
          <p>
            Start with <b>New custom scene</b> or edit a preset. Use <b>Add</b> to insert objects,
            then edit their positions and parameters. Wires accept any number of 3D control points up
            to 256, with straight or smooth paths. Motion supports oscillation, spin and timed keyframes.
            Export saves your design as JSON; autosave restores the latest scene on reload.
          </p>
          <h3>Reading the field</h3>
          <p>
            Slices show a scalar heatmap; field lines and arrows show direction. The legend gives the
            mapped quantity and range. Under Data, enter a coordinate and add a probe there. Select a
            probe to see every E/B component, or read its magnitude label in the viewport. View includes
            conductor opacity for cavity interiors and directional surface-current rings on magnets.
            Uniform-field magnitudes can change without changing line direction; use probe values to compare them.
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
            The Poisson solver uses a finite-volume multigrid discretisation at the selected resolution. Point
            charges are deposited cloud-in-cell, so fields very close to a charge are regularised at the
            cell scale. The FDTD solver is second order on a Yee lattice; keep at least ~20 cells per
            wavelength. The absorbing layer is impedance-matched but is not a perfect PML, so weak
            reflections can remain. Particles are pushed with Boris and do not self-consistently source
            the fields.
          </p>
          <p>
            Induction is quasistatic: moving fields and integrated EMF update, but E probes show only
            the electrostatic contribution. Induced electric fields, eddy currents, circuit feedback and
            radiation are not solved. Static B assumes vacuum permeability. Test particles use the initial
            analytic source fields, without the Poisson conductor solution or moving-source feedback.
            Particle and prescribed-motion animations use different clocks.
          </p>
          <h3>Runs on your device</h3>
          <p>
            All computation runs in your browser. Field solves and overlays use Web Workers; particle
            and induction stepping also run locally in the browser. Large scenes can reduce refresh
            rates on your device. Other visitors do not share a physics server with you.
          </p>
          <h3>Touch controls</h3><p>Drag with one finger to orbit. Use two fingers to pan or pinch to zoom. Open the library or inspector from the toolbar; close the drawer to return to the field view.</p>
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
