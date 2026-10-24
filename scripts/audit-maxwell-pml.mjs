import {
  createServer
}
from 'vite';
import {
  execFileSync
}
from 'node:child_process';
import {
  createHash
}
from 'node:crypto';
import {
  mkdir,
  readFile,
  writeFile
}
from 'node:fs/promises';
import {
  dirname,
  resolve,
  relative,
  isAbsolute,
  extname,
  sep
}
from 'node:path';
import {
  fileURLToPath
}
from 'node:url';
import {
  performance
}
from 'node:perf_hooks';
const root = fileURLToPath(new URL('..', import.meta.url));
const cases = [
['normal-base', false, 1, .005, .04], ['normal-thick', false, 1, .005, .08],
['normal-fine', false, 1, .0025, .08], ['normal-low', false, 1.5, .005, .08],
['normal-high', false, .75, .005, .08], ['normal-long', false, 1, .005, .08, .4],
['oblique-base', true, 1, .01, .08], ['oblique-thick', true, 1, .01, .16],
['oblique-fine', true, 1, .005, .16], ['oblique-low', true, 1.5, .01, .16],
['oblique-high', true, .75, .01, .16], ['oblique-long', true, 1, .01, .16, .4],
['oblique-45', true, 1, .01, .16, 0, 45],
['normal-fine-late', false, 1, .0025, .08], ['oblique-45-late', true, 1, .01, .16, 0, 45],
['normal-fine-tail', false, 1, .0025, .08], ['normal-sine-tail', false, 1, .0025, .08],
].map(([id, oblique, scale, h, thickness, extension = 0, angle = 30]) => ({
  id,
  oblique,
  scale,
  h,
  thickness,
  extension,
  angle
}
));
const help = `Usage: node scripts/audit-maxwell-pml.mjs [--quick] [--cases ID,ID] [--json artifacts/FILE.json] [--help]
Actual Float64 YeeSolver paired-domain finite-pulse CPML audit.
Default: all ${cases.length} bounded cases, three domains each; may take several minutes.
--quick: normal-thick and oblique-thick (unless --cases supplied).
Cases: ${cases.map(c => c.id).join(', ')}
Default includes a ct14 late-tail check and zero-area sine control; target failures remain measurements.
Exit 0 means audit executed, not physics acceptance.`;
function options(args) {
  const o = {
  }
  ;
  for (let i = 0;
  i < args.length;
  i++) {
    const a = args[i];
    if (a === '--help' || a === '-h') return {
      help: true
    }
    ;
    if (a === '--quick') {
      o.quick = true;
      continue;
    }
    if (!['--cases', '--json'].includes(a)) throw Error(`Unknown option ${a}`);
    const v = args[++i];
    if (!v || v.startsWith('--')) throw Error(`Missing value for ${a}`);
    if (a === '--cases') {
      o.ids = v.split(',');
      if (o.ids.some(id => !cases.some(c => c.id === id)) || new Set(o.ids).size !== o.ids.length) throw Error('Unknown, empty or duplicate case ID');
    }
    else o.json = resolve(root, v);
  }
  o.ids ??= o.quick ? ['normal-thick', 'oblique-thick'] : cases.map(c => c.id);
  o.json ??= resolve(root, 'artifacts/maxwell-pml-audit.json');
  const p = relative(resolve(root, 'artifacts'), o.json);
  if (!p || p === '..' || p.startsWith(`..${sep}`) || isAbsolute(p) || extname(o.json) !== '.json') throw Error('--json must name a .json file inside artifacts');
  return o;
}
const git = args => execFileSync('git', args, {
  cwd: root,
  encoding: 'utf8',
  windowsHide: true
}
).trim();
async function provenance() {
  const paths = ['src/engine/maxwell/yee.ts', 'src/engine/maxwell/cpml.ts', 'tests/maxwell/benchmarks.test.ts', 'scripts/audit-maxwell-pml.mjs'];
  return {
    head: git(['rev-parse', 'HEAD']),
    status: git(['status', '--porcelain']),
    sourceHashes: Object.fromEntries(await Promise.all(paths.map(async p => [p, createHash('sha256').update(await readFile(resolve(root, p))).digest('hex')]))),
    node: process.version
  }
  ;
}
function measure(c, YeeSolver, C) {
  const start = performance.now(),
  {
    oblique,
    scale,
    h,
    thickness,
    extension,
    angle
  }
  = c;
  const pmlCells = Math.round(thickness / h),
  transverse = oblique ? .4 * scale : h;
  const ny = oblique ? Math.round(transverse / h) : 1;
  const center = (oblique ? .5 : .3) * scale,
  probeX = (oblique ? .7 : .45) * scale;
  const length = (oblique ? 1.6 : 1) * scale + extension;
  const lateCheck = c.id.endsWith('-late');
  const tailCheck = c.id.endsWith('-tail');
  const sineControl = c.id === 'normal-sine-tail';
  const referenceExtension = lateCheck ? 1 : 0;
  const lengths = tailCheck ? [length, 8, 10] : [length, length + (oblique ? 1 : .8) * scale + referenceExtension, length + (oblique ? 2 : 1.6) * scale + referenceExtension];
  const width = (oblique ? .25 : .035) * scale,
  ky = oblique ? 2 * Math.PI / transverse : 0;
  const kx = oblique ? ky / Math.tan(angle * Math.PI / 180) : 2 * Math.PI / (.14 * scale);
  const solvers = lengths.map(L => new YeeSolver({
    nx: Math.round(L / h) + 2 * pmlCells,
    ny,
    nz: 1,
    dx: h,
    dy: h,
    dz: h,
    boundary: {
      x: 'pml',
      y: 'periodic',
      z: 'periodic'
    }
    ,
    pmlCells
  }
  ));
  const dt = solvers[0].dt;
  const modes = oblique ? Array.from({
    length: 121
  }
  , (_, j) => {
    const k = kx + (j - 60) * Math.PI / (5 * scale),
    weight = Math.exp(-(((k - kx) * width / 2) ** 2));
    const qx = 2 * Math.sin(k * h / 2) / h,
    qy = 2 * Math.sin(ky * h / 2) / h,
    q = Math.hypot(qx, qy);
    return {
      k,
      weight,
      bx: qy / (C * q),
      by: -qx / (C * q),
      omega: 2 / dt * Math.asin(C * dt * q / 2)
    }
    ;
  }
  ) : [];
  const norm = modes.reduce((s, m) => s + m.weight, 0);
  const boundaryInitialization = [];
  for (const s of solvers) {
    for (let x = 0;
    x < s.nx;
    x++) {
      const coordinate = (x - pmlCells) * h - center;
      if (!oblique) {
        const face = coordinate + h / 2 + C * dt / 2;
        s.Ey[x] = Math.exp(-((coordinate / width) ** 2)) * (sineControl ? Math.sin(kx * coordinate) : Math.cos(kx * coordinate));
        s.Bz[x] = Math.exp(-((face / width) ** 2)) * (sineControl ? Math.sin(kx * face) : Math.cos(kx * face)) / C;
      }
      else {
        // Sum exact native spatial/half-time phases; factoring y is algebraically identical.
        const sums = [0, 0, 0, 0, 0, 0];
        for (const m of modes) {
          const phases = [m.k * coordinate, m.k * coordinate + ky * h / 2 + m.omega * dt / 2, m.k * coordinate + m.k * h / 2 + m.omega * dt / 2];
          const weights = [m.weight / norm, m.weight / norm * m.bx, m.weight / norm * m.by];
          for (let j = 0;
          j < 3;
          j++) {
            sums[2*j] += weights[j] * Math.cos(phases[j]);
            sums[2*j+1] += weights[j] * Math.sin(phases[j]);
          }
        }
        for (let y = 0;
        y < ny;
        y++) {
          const i = s.index(x, y, 0),
          cy = Math.cos(ky*y*h),
          sy = Math.sin(ky*y*h);
          s.Ez[i] = sums[0]*cy-sums[1]*sy;
          s.Bx[i] = sums[2]*cy-sums[3]*sy;
          s.By[i] = sums[4]*cy-sums[5]*sy;
        }
      }
    }
    let e = 0,
    cb = 0,
    pmlE = 0;
    for (let y=0;
    y<ny;
    y++) for (let x=0;
    x<s.nx;
    x++) {
      if (x >= pmlCells && x < s.nx-pmlCells) continue;
      const i=s.index(x,y,0);
      pmlE=Math.max(pmlE,Math.abs(oblique?s.Ez[i]:s.Ey[i]));
      if (x===0 || x===s.nx-1) {
        e=Math.max(e,Math.abs(oblique?s.Ez[i]:s.Ey[i]));
        cb=Math.max(cb,C*Math.hypot(s.Bx[i],s.By[i],s.Bz[i]));
      }
    }
    boundaryInitialization.push({
      outerElectricMax:e,
      outerMagneticTimesCMax:cb,
      pmlElectricMax:pmlE
    }
    );
  }
  const projection = s => {
    const x = pmlCells + Math.round(probeX/h);
    let re=0,
    im=0;
    for(let y=0;
    y<ny;
    y++){
      const a=oblique?s.Ez[s.index(x,y,0)]:s.Ey[x];
      re+=a*Math.cos(ky*y*h);
      im+=a*Math.sin(ky*y*h);
    }
    return [re*(oblique?2:1)/ny, im*(oblique?2:1)/ny];
  }
  ;
  const incEnd=(oblique?.8:.5)*scale,
  refStart=(oblique?1.3:.7)*scale;
  const end=(tailCheck ? 14 : lateCheck ? (oblique ? 6 : 3.2) : (oblique?(angle===45?4.2:3.3):2))*scale+2*extension/Math.cos((oblique?angle:0)*Math.PI/180);
  const steps=Math.ceil(end/(C*dt));
  const tailSnapshots = [];
  let nextSnapshotCt = .5;
  let incident=0,
  reflected=0,
  contamination=0,
  peakCt=0,
  finalDifference=0,
  lateDifference=0;
  for(let n=0;
  n<steps;
  n++){
    for(const s of solvers)s.step();
    const p=solvers.map(projection),
    ct=C*solvers[0].time;
    if(ct<incEnd)incident=Math.max(incident,Math.hypot(...p[1]));
    if(ct>refStart){
      const r=Math.hypot(p[0][0]-p[1][0],p[0][1]-p[1][1]);
      finalDifference=r;
      if(ct>.9*end)lateDifference=Math.max(lateDifference,r);
      if(r>reflected){
        reflected=r;
        peakCt=ct;
      }
      contamination=Math.max(contamination,Math.hypot(p[1][0]-p[2][0],p[1][1]-p[2][1]));
    }
    if (tailCheck && ct >= nextSnapshotCt) {
      const fields = solvers.map(solver => {
        let electricMax = 0, magneticTimesCMax = 0, electricMaxX = 0;
        let interiorElectricMax = 0, leftLayerElectricMax = 0, rightLayerElectricMax = 0;
        for (let x = 0; x < solver.nx; x++) {
          const electric = Math.abs(solver.Ey[x]);
          if (electric > electricMax) { electricMax = electric; electricMaxX = (x - pmlCells) * h; }
          magneticTimesCMax = Math.max(magneticTimesCMax, C * Math.abs(solver.Bz[x]));
          if (x < pmlCells) leftLayerElectricMax = Math.max(leftLayerElectricMax, electric);
          else if (x >= solver.nx - pmlCells) rightLayerElectricMax = Math.max(rightLayerElectricMax, electric);
          else interiorElectricMax = Math.max(interiorElectricMax, electric);
        }
        return { electricMax, magneticTimesCMax, electricMaxX, interiorElectricMax, leftLayerElectricMax,
          rightLayerElectricMax, diagnosticEnergy: solver.diagnostics().totalEnergy };
      });
      tailSnapshots.push({ ct, probeCoefficients: p, fields, runningReflectedPeak: reflected,
        runningReflectedPeakCt: peakCt, runningReferenceDifferencePeak: contamination });
      nextSnapshotCt += .5;
    }
  }
  const retained=modes.filter(m=>m.weight>=.01),
  centralQ=Math.hypot(2*Math.sin(kx*h/2)/h,2*Math.sin(ky*h/2)/h);
  return {
    ...c,
    physical:{
      lengths,
      realizedLengths:solvers.map(s=>(s.nx-2*pmlCells)*h),
      center,
      probeX,
      realizedProbeX:Math.round(probeX/h)*h,
      transversePeriod:ny*h,
      width,
      nominalWavelength:2*Math.PI/Math.hypot(kx,ky),
      centralAngleDegrees:oblique?angle:0,
      kx,
      ky,
      centralYeeOmega:2/dt*Math.asin(C*dt*centralQ/2),
      pmlCells,
      realizedThickness:pmlCells*h
    }
    ,
    spectrum:oblique?{
      construction:'121 discrete kx modes, one periodic ky; positive-frequency Yee eigenmodes',
      spacing:Math.PI/(5*scale),
      weightAtLeastOnePercent:{
        kx:[retained[0].k,retained.at(-1).k],
        angleDegrees:[Math.atan2(ky,retained.at(-1).k)*180/Math.PI,Math.atan2(ky,retained[0].k)*180/Math.PI],
        frequencyHz:[Math.min(...retained.map(m=>m.omega))/(2*Math.PI),Math.max(...retained.map(m=>m.omega))/(2*Math.PI)]
      }
      ,
      negativeKxWeightFraction:modes.filter(m=>m.k<0).reduce((s,m)=>s+m.weight,0)/norm
    }
    : {
      construction:sineControl ? 'Gaussian-envelope sine (zero spatial integral); kx lobes centered at +/- kx' : 'Gaussian-envelope cosine; continuous kx lobes centered at +/- kx',
      positiveLobeOnePercentKx:[kx-2*Math.sqrt(Math.log(100))/width,kx+2*Math.sqrt(Math.log(100))/width],
      note:'broad lobes overlap DC; no isolated-DC claim; B is shifted continuum packet, not exact Yee eigenpacket'
    }
    ,
    initialization:boundaryInitialization,
    tailSnapshots,
    normalPacket: !oblique ? { carrier: sineControl ? "sine" : "cosine", analyticSpatialIntegral: sineControl ? 0 : Math.sqrt(Math.PI) * width * Math.exp(-((kx * width / 2) ** 2)) } : null,
    timing:{
      dt,
      steps,
      incidentCt:[0,incEnd],
      reflectionCt:[refStart,C*solvers[0].time],
      peakCt,
      centralGeometricReturnCt:(2*length-center-probeX)/Math.cos((oblique?angle:0)*Math.PI/180)
    }
    ,
    incidentAmplitude:incident,
    reflectedAmplitude:reflected,
    finalDifference,
    lateDifference,
    ratio:reflected/incident,
    referenceContaminationAmplitude:contamination,
    referenceContaminationRatio:contamination/incident,
    targetMet:reflected/incident<1e-3,
    seconds:(performance.now()-start)/1000
  }
  ;
}
async function main(){
  const o=options(process.argv.slice(2));
  if(o.help){
    console.log(help);
    return;
  }
  const report={
    generatedAt:new Date().toISOString(),
    target:1e-3,
    exitMeaning:'execution only',
    options:o,
    provenance:{
      before:await provenance()
    }
    ,
    results:[]
  }
  ;
  const server=await createServer({
    root,
    configFile:false,
    server:{
      middlewareMode:true,
      hmr:false,
      ws:false
    }
    ,
    optimizeDeps:{
      noDiscovery:true
    }
    ,
    appType:'custom',
    logLevel:'error'
  }
  );
  try{
    const {
      YeeSolver,
      LIGHT_SPEED:C
    }
    =await server.ssrLoadModule('/src/engine/maxwell/yee.ts');
    for(const id of o.ids){
      console.log(`Starting ${id} (${report.results.length+1}/${o.ids.length})`);
      const r=measure(cases.find(c=>c.id===id),YeeSolver,C);
      report.results.push(r);
      console.log(`${id}: R=${r.ratio.toExponential(6)} reference=${r.referenceContaminationRatio.toExponential(3)} ${r.seconds.toFixed(2)}s`);
    }
  }
  finally{
    await server.close();
  }
  report.provenance.after=await provenance();
  report.provenance.sourceChangedDuringRun=JSON.stringify(report.provenance.before.sourceHashes)!==JSON.stringify(report.provenance.after.sourceHashes);
  report.selectedSuiteMeetsTarget=report.results.every(r=>r.targetMet);
  await mkdir(dirname(o.json),{
    recursive:true
  }
  );
  await writeFile(o.json,JSON.stringify(report,null,2)+'\n');
  console.log(`Wrote ${relative(root,o.json)}; selectedSuiteMeetsTarget=${report.selectedSuiteMeetsTarget}`);
}
main().catch(e=>{
  console.error(e.message);
  process.exitCode=1;
}
);
