import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSurfaceMeshIndices, ForensicPhysicsEngine, getStrokeStart, MATERIALS, STROKE_LENGTH_MM } from '../src/utils/SimulationEngine.js';
import { createSeededRandom, deriveSeed } from '../src/utils/random.js';
import type { MaterialType, ToolKernel } from '../src/utils/SimulationEngine.js';

const seed = 1337;

const createKernel = (
  engine: ForensicPhysicsEngine,
  angleDeg = 45,
  toolType = 'screwdriver',
  sizeMm = 6
): ToolKernel =>
  engine.createToolKernel(toolType, sizeMm, 0.1, angleDeg, 0, {
    baseRandom: createSeededRandom(seed),
    striationRandom: createSeededRandom(deriveSeed(seed, 1)),
    striationsEnabled: true
  });

const runSimulation = (
  engine: ForensicPhysicsEngine,
  kernel: ToolKernel,
  force: number,
  toolHardness: number,
  material: MaterialType = 'aluminum',
  chatter = 0,
  speed = 20,
  angleDir = 0,
  timeStep = 0.002,
  materialThicknessMm = MATERIALS[material].defaultThicknessMm
) => {
  Array.from(engine.simulateCutGenerator(
    10,
    30,
    angleDir,
    force,
    kernel,
    material,
    materialThicknessMm,
    toolHardness,
    speed,
    chatter,
    timeStep
  ));
};

const surfaceStats = (before: Float64Array, after: Float64Array) => {
  assert.equal(before.length, after.length);

  let changed = 0;
  let minDelta = Infinity;
  let maxDelta = -Infinity;

  for (let i = 0; i < before.length; i++) {
    const delta = after[i] - before[i];
    if (Math.abs(delta) > 1e-12) {
      changed += 1;
      if (delta < minDelta) minDelta = delta;
      if (delta > maxDelta) maxDelta = delta;
    }
  }

  return { changed, minDelta, maxDelta };
};

const simulate = (
  force: number,
  toolHardness: number,
  material: MaterialType = 'aluminum',
  chatter = 0,
  angleDeg = 45,
  resolution = 10
) => {
  const engine = new ForensicPhysicsEngine(60, 60, resolution, seed);
  const before = new Float64Array(engine.surface.data);
  const kernel = createKernel(engine, angleDeg);

  runSimulation(engine, kernel, force, toolHardness, material, chatter);

  return surfaceStats(before, engine.surface.data);
};

const simulateSurface = (
  force: number,
  toolHardness: number,
  material: MaterialType,
  angleDeg = 45,
  speed = 20,
  toolType = 'screwdriver',
  sizeMm = 6,
  materialThicknessMm = MATERIALS[material].defaultThicknessMm
) => {
  const engine = new ForensicPhysicsEngine(60, 60, 10, seed);
  const before = new Float64Array(engine.surface.data);
  const kernel = createKernel(engine, angleDeg, toolType, sizeMm);
  runSimulation(engine, kernel, force, toolHardness, material, 0, speed, 0, 0.002, materialThicknessMm);
  return { before, after: engine.surface.data, engine };
};

const meanCutDepthInCutBand = (before: Float64Array, after: Float64Array, engine: ForensicPhysicsEngine) => {
  let totalDepth = 0;
  let loweredCells = 0;
  const minY = Math.floor(26 * engine.surface.resolution);
  const maxY = Math.floor(34 * engine.surface.resolution);

  for (let y = minY; y <= maxY; y++) {
    for (let x = 0; x < engine.surface.width; x++) {
      const idx = y * engine.surface.width + x;
      const delta = after[idx] - before[idx];
      if (delta < -0.001) {
        totalDepth += -delta;
        loweredCells++;
      }
    }
  }

  if (loweredCells === 0) {
    throw new Error('cut band must contain lowered cells');
  }

  return totalDepth / loweredCells;
};

const fractureStats = (engine: ForensicPhysicsEngine) => {
  const { damage, detached, edgeLift, debrisHeight } = engine.getFractureState();
  let detachedCount = 0;
  let maxDamage = 0;
  let liftedCells = 0;
  let debrisVolume = 0;
  const cellAreaMm2 = 1 / (engine.surface.resolution * engine.surface.resolution);

  for (let i = 0; i < detached.length; i++) {
    if (detached[i]) detachedCount++;
    if (damage[i] > maxDamage) maxDamage = damage[i];
    if (edgeLift[i] > 0) liftedCells++;
    if (debrisHeight[i] > 0) debrisVolume += debrisHeight[i] * cellAreaMm2;
  }

  return { detachedCount, maxDamage, liftedCells, debrisVolume };
};

const heightAt = (engine: ForensicPhysicsEngine, xMm: number, yMm: number) => {
  const x = Math.floor(xMm * engine.surface.resolution);
  const y = Math.floor(yMm * engine.surface.resolution);
  return engine.surface.data[y * engine.surface.width + x];
};

test('fails fast for invalid engine dimensions and resolution', () => {
  assert.throws(() => new ForensicPhysicsEngine(0, 60, 10, seed), /widthMM/);
  assert.throws(() => new ForensicPhysicsEngine(60, 60, 10.5, seed), /resolution/);
});

test('fails fast for invalid tool angle', () => {
  const engine = new ForensicPhysicsEngine(20, 20, 10, seed);
  assert.throws(() => createKernel(engine, 0), /angleDeg/);
});

test('zero force does not modify the surface', () => {
  const stats = simulate(0, 8, 'aluminum', 0.2);
  assert.equal(stats.changed, 0);
});

test('base topography is stable at the same physical coordinate across resolutions', () => {
  const lowResolution = new ForensicPhysicsEngine(60, 60, 10, seed);
  const highResolution = new ForensicPhysicsEngine(60, 60, 20, seed);

  assert.equal(heightAt(lowResolution, 12, 8), heightAt(highResolution, 12, 8));
});

test('surface field sample computes gradient laplacian and damage gradient', () => {
  const engine = new ForensicPhysicsEngine(5, 5, 1, seed);
  const { damage } = engine.getFractureState();

  for (let y = 0; y < engine.surface.height; y++) {
    for (let x = 0; x < engine.surface.width; x++) {
      const idx = y * engine.surface.width + x;
      engine.surface.data[idx] = x * x + y * y;
      damage[idx] = x === 3 && y === 2 ? 1 : 0;
    }
  }

  const field = engine.getSurfaceFieldSample(2, 2);

  assert.equal(field.heightGradientX, 4);
  assert.equal(field.heightGradientY, 4);
  assert.equal(field.heightLaplacian, 4);
  assert.equal(field.damageGradientX, 0.5);
  assert.equal(field.damageGradientY, 0);
  assert.ok(field.strainConcentration > Math.hypot(4, 4));
});

test('higher force produces a deeper trace', () => {
  const lowForce = simulate(25, 8);
  const highForce = simulate(100, 8);

  assert.ok(lowForce.changed > 0);
  assert.ok(highForce.changed > 0);
  assert.ok(highForce.minDelta < lowForce.minDelta);
});

test('tool hardness affects cutting depth', () => {
  const softTool = simulate(100, 3, 'steel');
  const hardTool = simulate(100, 10, 'steel');

  assert.ok(softTool.changed > 0);
  assert.ok(hardTool.changed > 0);
  assert.ok(hardTool.minDelta < softTool.minDelta);
});

test('steeper attack angle produces a deeper trace through normal force', () => {
  const shallowAngle = simulate(100, 8, 'aluminum', 0, 10);
  const steepAngle = simulate(100, 8, 'aluminum', 0, 80);

  assert.ok(shallowAngle.changed > 0);
  assert.ok(steepAngle.changed > 0);
  assert.ok(steepAngle.minDelta < shallowAngle.minDelta);
});

test('depth remains comparable when resolution changes', () => {
  const lowResolution = simulate(100, 8, 'aluminum', 0, 45, 10);
  const highResolution = simulate(100, 8, 'aluminum', 0, 45, 20);
  const relativeDifference = Math.abs(highResolution.minDelta - lowResolution.minDelta) / Math.abs(lowResolution.minDelta);

  assert.ok(lowResolution.changed > 0);
  assert.ok(highResolution.changed > 0);
  assert.ok(relativeDifference < 0.35);
});

test('creates a high-resolution detail map for fine striations', () => {
  const engine = new ForensicPhysicsEngine(60, 60, 30, seed);
  const knifeKernel = createKernel(engine, 45, 'knife', 1);

  runSimulation(engine, knifeKernel, 100, 8);

  const detailMap = engine.getSurfaceDetailMap();
  assert.ok(detailMap);
  assert.ok(detailMap.resolution >= 240);
  assert.ok(0.08 * detailMap.resolution >= 19);
  assert.ok(detailMap.lengthSamples > engine.surface.resolution * 40);
  assert.ok(detailMap.widthSamples > 1);
  assert.ok(detailMap.maxHeight > detailMap.minHeight);
});

test('knife kernel has a sharp rounded edge and rising bevel profile', () => {
  const engine = new ForensicPhysicsEngine(20, 20, 50, seed);
  const kernel = engine.createToolKernel('knife', 1, 0, 45, 0, {
    baseRandom: createSeededRandom(seed),
    striationRandom: createSeededRandom(deriveSeed(seed, 1)),
    striationsEnabled: false
  });
  let edgeX = 0;
  let edgeY = 0;
  let edgeZ = Infinity;
  for (let i = 0; i < kernel.profile.length; i++) {
    const z = kernel.profile[i];
    if (z < edgeZ) {
      edgeZ = z;
      edgeX = i % kernel.width;
      edgeY = Math.floor(i / kernel.width);
    }
  }
  const nearBevelZ = kernel.profile[(edgeY + 2) * kernel.width + edgeX];
  const farBevelZ = kernel.profile[(edgeY + 8) * kernel.width + edgeX];

  assert.ok(edgeZ < 0.001);
  assert.ok(nearBevelZ > edgeZ);
  assert.ok(farBevelZ > nearBevelZ);
  assert.ok(kernel.sharpness > 0.9);
});

test('higher friction smears more of the cut material back into the groove', () => {
  const originalFriction = MATERIALS.aluminum.frictionCoefficient;
  // What was cut out of the plate but is no longer missing from the groove was smeared back behind the tool.
  const smearedBackVolume = (friction: number) => {
    MATERIALS.aluminum.frictionCoefficient = friction;
    const { summary, engine, before } = runStroke('screwdriver', 6, 'aluminum', 100);
    return summary.carvedVolumeMm3 - netRemovedVolume(before, engine);
  };

  try {
    const lowerFriction = smearedBackVolume(0.05);
    const higherFriction = smearedBackVolume(0.95);

    assert.ok(lowerFriction > 0);
    assert.ok(higherFriction > lowerFriction);
  } finally {
    MATERIALS.aluminum.frictionCoefficient = originalFriction;
  }
});

test('higher speed increases shear roughness while preserving comparable depth', () => {
  const slow = simulateSurface(100, 8, 'aluminum', 45, 5);
  const fast = simulateSurface(100, 8, 'aluminum', 45, 80);
  const slowDepth = meanCutDepthInCutBand(slow.before, slow.after, slow.engine);
  const fastDepth = meanCutDepthInCutBand(fast.before, fast.after, fast.engine);
  const relativeDepthDifference = Math.abs(fastDepth - slowDepth) / slowDepth;
  const slowDetail = slow.engine.getSurfaceDetailMap();
  const fastDetail = fast.engine.getSurfaceDetailMap();

  // Tearing shows in the fine texture. The coarse groove also carries hand tremor, which is wavier at low speed.
  assert.ok(slowDetail);
  assert.ok(fastDetail);
  assert.ok(fastDetail.maxHeight - fastDetail.minHeight > slowDetail.maxHeight - slowDetail.minHeight);
  assert.ok(relativeDepthDifference < 0.5);
});

test('time step changes deformation sampling', () => {
  const coarse = new ForensicPhysicsEngine(60, 60, 10, seed);
  const fine = new ForensicPhysicsEngine(60, 60, 10, seed);
  const coarseKernel = createKernel(coarse);
  const fineKernel = createKernel(fine);

  runSimulation(coarse, coarseKernel, 100, 8, 'aluminum', 0.2, 20, 0, 0.004);
  runSimulation(fine, fineKernel, 100, 8, 'aluminum', 0.2, 20, 0, 0.001);

  let maxDelta = 0;
  for (let i = 0; i < coarse.surface.data.length; i++) {
    maxDelta = Math.max(maxDelta, Math.abs(coarse.surface.data[i] - fine.surface.data[i]));
  }

  assert.ok(maxDelta > 1e-4);
});

test('higher tangential component increases shear texture without increasing normal depth', () => {
  const lowTangential = simulateSurface(100, 8, 'aluminum', 80);
  const highTangential = simulateSurface(100, 8, 'aluminum', 20);
  const lowTangentialStats = surfaceStats(lowTangential.before, lowTangential.after);
  const highTangentialStats = surfaceStats(highTangential.before, highTangential.after);
  const lowTangentialDetail = lowTangential.engine.getSurfaceDetailMap();
  const highTangentialDetail = highTangential.engine.getSurfaceDetailMap();

  assert.ok(lowTangentialDetail);
  assert.ok(highTangentialDetail);
  assert.ok(highTangentialDetail.maxHeight - highTangentialDetail.minHeight > lowTangentialDetail.maxHeight - lowTangentialDetail.minHeight);
  assert.ok(highTangentialStats.minDelta > lowTangentialStats.minDelta);
});

test('brittle material fractures more under high shear than ductile material', () => {
  const ductile = simulateSurface(120, 8, 'gold', 25);
  const brittle = simulateSurface(120, 8, 'wood', 25);
  const ductileFracture = fractureStats(ductile.engine);
  const brittleFracture = fractureStats(brittle.engine);

  assert.ok(brittleFracture.maxDamage > ductileFracture.maxDamage);
  assert.ok(brittleFracture.detachedCount > ductileFracture.detachedCount);
});

test('zero force does not create a detail map', () => {
  const engine = new ForensicPhysicsEngine(60, 60, 10, seed);
  const kernel = createKernel(engine);

  runSimulation(engine, kernel, 0, 8, 'aluminum', 0);

  assert.equal(engine.getSurfaceDetailMap(), null);
});

test('low force on thick material accumulates no detachment', () => {
  const thickWood = simulateSurface(20, 8, 'wood', 45, 20, 'screwdriver', 6, 5);
  const stats = fractureStats(thickWood.engine);

  assert.equal(stats.detachedCount, 0);
});

test('high force on thin brittle material creates holes lifted edges and debris', () => {
  const thinWood = simulateSurface(500, 8, 'wood', 45, 20, 'screwdriver', 6, 0.2);
  const stats = fractureStats(thinWood.engine);

  assert.ok(stats.detachedCount > 0);
  assert.ok(stats.liftedCells > 0);
  assert.ok(stats.debrisVolume > 0);
});

test('greater thickness resists material detachment', () => {
  const thinWood = simulateSurface(350, 8, 'wood', 45, 20, 'screwdriver', 6, 0.2);
  const thickWood = simulateSurface(350, 8, 'wood', 45, 20, 'screwdriver', 6, 2.5);

  assert.ok(fractureStats(thinWood.engine).detachedCount > fractureStats(thickWood.engine).detachedCount);
});

test('ductile metal resists detachment more than brittle wood under the same load', () => {
  const wood = simulateSurface(300, 8, 'wood', 45, 20, 'screwdriver', 6, 0.4);
  const aluminum = simulateSurface(300, 8, 'aluminum', 45, 20, 'screwdriver', 6, 0.4);

  assert.ok(fractureStats(wood.engine).detachedCount > fractureStats(aluminum.engine).detachedCount);
});

test('detached cells are not deformed again by later passes', () => {
  const engine = new ForensicPhysicsEngine(60, 60, 10, seed);
  const kernel = createKernel(engine);

  runSimulation(engine, kernel, 500, 8, 'wood', 0, 20, 0, 0.002, 0.2);

  const { detached } = engine.getFractureState();
  const detachedHeights = new Map<number, number>();
  for (let i = 0; i < detached.length; i++) {
    if (detached[i]) {
      detachedHeights.set(i, engine.surface.data[i]);
    }
  }
  assert.ok(detachedHeights.size > 0);

  runSimulation(engine, kernel, 500, 8, 'wood', 0, 20, 0, 0.002, 0.2);

  for (const [idx, height] of detachedHeights) {
    assert.equal(engine.surface.data[idx], height);
  }
});

test('fracture debris volume is deterministic for the same seed', () => {
  const first = simulateSurface(500, 8, 'wood', 45, 20, 'screwdriver', 6, 0.2);
  const second = simulateSurface(500, 8, 'wood', 45, 20, 'screwdriver', 6, 0.2);

  assert.equal(fractureStats(first.engine).debrisVolume, fractureStats(second.engine).debrisVolume);
});

test('surface mesh indices remove triangles adjacent to detached vertices', () => {
  const detached = new Uint8Array(9);
  const full = buildSurfaceMeshIndices(3, 3, detached);

  detached[4] = 1;
  const fractured = buildSurfaceMeshIndices(3, 3, detached);

  assert.equal(full.length, 24);
  assert.equal(fractured.length, 0);
});

test('reset restores fracture state without detached cells or debris', () => {
  const fractured = simulateSurface(500, 8, 'wood', 45, 20, 'screwdriver', 6, 0.2);
  assert.ok(fractureStats(fractured.engine).detachedCount > 0);

  fractured.engine.reset();
  const resetStats = fractureStats(fractured.engine);

  assert.equal(resetStats.detachedCount, 0);
  assert.equal(resetStats.debrisVolume, 0);
  assert.equal(resetStats.liftedCells, 0);
  assert.equal(resetStats.maxDamage, 0);
});

test('fails fast for invalid simulation parameters', () => {
  const engine = new ForensicPhysicsEngine(60, 60, 10, seed);
  const kernel = createKernel(engine);

  assert.throws(
    () => Array.from(engine.simulateCutGenerator(10, 30, 0, -1, kernel, 'aluminum', 1, 8, 20, 0, 0.002)),
    /force/
  );
  assert.throws(
    () => Array.from(engine.simulateCutGenerator(10, 30, 0, 10, kernel, 'aluminum', 1, 0, 20, 0, 0.002)),
    /toolHardnessMohs/
  );
  assert.throws(
    () => Array.from(engine.simulateCutGenerator(10, 30, 0, 10, kernel, 'aluminum', 1, 8, 20, 1.5, 0.002)),
    /chatterParam/
  );
  assert.throws(
    () => Array.from(engine.simulateCutGenerator(10, 30, 0, 10, kernel, 'aluminum', 0, 8, 20, 0, 0.002)),
    /materialThicknessMm/
  );
});

const runStroke = (
  toolType: string,
  sizeMm: number,
  material: MaterialType,
  force: number,
  directionDeg = 0,
  chatter = 0,
  timeStep = 0.002
) => {
  const engine = new ForensicPhysicsEngine(60, 60, 10, seed);
  const before = new Float64Array(engine.surface.data);
  const kernel = engine.createToolKernel(toolType, sizeMm, 0.1, 45, directionDeg, {
    baseRandom: createSeededRandom(seed),
    striationRandom: createSeededRandom(deriveSeed(seed, 1)),
    striationsEnabled: true
  });
  const start = getStrokeStart(60, 60, directionDeg);
  Array.from(engine.simulateCutGenerator(
    start.x,
    start.y,
    directionDeg,
    force,
    kernel,
    material,
    MATERIALS[material].defaultThicknessMm,
    8,
    20,
    chatter,
    timeStep
  ));
  const summary = engine.getCutSummary();
  assert.ok(summary);
  return { engine, before, kernel, summary };
};

const netRemovedVolume = (before: Float64Array, engine: ForensicPhysicsEngine) => {
  const cellAreaMm2 = 1 / (engine.surface.resolution * engine.surface.resolution);
  let volume = 0;
  for (let i = 0; i < before.length; i++) {
    const delta = engine.surface.data[i] - before[i];
    if (delta < 0) {
      volume -= delta * cellAreaMm2;
    }
  }
  return volume;
};

test('a harder target takes a shallower mark under the same load', () => {
  const aluminum = runStroke('screwdriver', 6, 'aluminum', 150);
  const steel = runStroke('screwdriver', 6, 'steel', 150);

  assert.ok(steel.summary.maxCutDepthMm > 0);
  assert.ok(steel.summary.maxCutDepthMm < aluminum.summary.maxCutDepthMm);
  assert.ok(steel.summary.carvedVolumeMm3 < aluminum.summary.carvedVolumeMm3);
});

test('chatter does not dig a mark that the load cannot make', () => {
  const steady = runStroke('screwdriver', 6, 'steel', 1, 0, 0);
  const chattering = runStroke('screwdriver', 6, 'steel', 1, 0, 1);

  assert.ok(chattering.summary.maxCutDepthMm < 0.01);
  assert.ok(chattering.summary.carvedVolumeMm3 <= steady.summary.carvedVolumeMm3 + 0.01);
});

test('a flat face under a light load only burnishes the surface finish', () => {
  const engine = new ForensicPhysicsEngine(60, 60, 10, seed);
  const kernel = createKernel(engine, 90, 'hammer_face', 25);
  runSimulation(engine, kernel, 50, 8, 'steel');
  const burnished = engine.getCutSummary();
  const cut = runStroke('screwdriver', 6, 'aluminum', 150);

  assert.ok(burnished);
  // The plate's own roughness is several microns, so anything shallower is not a visible mark.
  assert.ok(burnished.maxCutDepthMm < 0.005, `burnished depth ${burnished.maxCutDepthMm}`);
  assert.ok(burnished.carvedVolumeMm3 < cut.summary.carvedVolumeMm3 / 100);
  assert.ok(cut.summary.maxCutDepthMm > 0.03);
});

test('a centred stroke stays on the plate for every drag direction', () => {
  for (let directionDeg = 0; directionDeg < 360; directionDeg += 15) {
    const start = getStrokeStart(60, 60, directionDeg);
    const rad = directionDeg * Math.PI / 180;
    const endX = start.x + Math.cos(rad) * STROKE_LENGTH_MM;
    const endY = start.y + Math.sin(rad) * STROKE_LENGTH_MM;

    for (const value of [start.x, start.y, endX, endY]) {
      assert.ok(value >= 0 && value <= 60, `direction ${directionDeg} leaves the plate`);
    }
  }
});

test('the tool profile and its contact table do not depend on the drag direction', () => {
  const engine = new ForensicPhysicsEngine(60, 60, 20, seed);
  const createFor = (directionDeg: number) => engine.createToolKernel('screwdriver', 6, 0.1, 45, directionDeg, {
    baseRandom: createSeededRandom(seed),
    striationRandom: createSeededRandom(deriveSeed(seed, 1)),
    striationsEnabled: true
  });

  const straight = createFor(0);
  for (const directionDeg of [30, 45, 135, 250]) {
    const rotated = createFor(directionDeg);
    assert.deepEqual(rotated.profile, straight.profile, `profile differs at ${directionDeg}`);
    assert.deepEqual(rotated.contactPatchLUT, straight.contactPatchLUT, `contact table differs at ${directionDeg}`);
  }
});

test('the same stroke carves the same mark in any drag direction', () => {
  const straight = runStroke('screwdriver', 6, 'aluminum', 150, 0);

  // 30 and 250 degrees line up with neither the grid axes nor its diagonals.
  for (const directionDeg of [30, 45, 250]) {
    const turned = runStroke('screwdriver', 6, 'aluminum', 150, directionDeg);
    const carvedDifference = Math.abs(turned.summary.carvedVolumeMm3 - straight.summary.carvedVolumeMm3) / straight.summary.carvedVolumeMm3;
    const straightRemoved = netRemovedVolume(straight.before, straight.engine);
    const removedDifference = Math.abs(netRemovedVolume(turned.before, turned.engine) - straightRemoved) / straightRemoved;
    const depthDifference = Math.abs(turned.summary.maxCutDepthMm - straight.summary.maxCutDepthMm) / straight.summary.maxCutDepthMm;

    assert.ok(carvedDifference < 0.05, `carved volume differs by ${carvedDifference} at ${directionDeg}`);
    assert.ok(removedDifference < 0.08, `groove volume differs by ${removedDifference} at ${directionDeg}`);
    assert.ok(depthDifference < 0.2, `depth differs by ${depthDifference} at ${directionDeg}`);
  }
});

test('a knife scored into aluminium at any direction does not tear the plate', () => {
  for (const directionDeg of [0, 45]) {
    const { summary } = runStroke('knife', 4, 'aluminum', 150, directionDeg);

    assert.ok(summary.maxCutDepthMm > 0.1);
    assert.ok(summary.maxCutDepthMm < MATERIALS.aluminum.defaultThicknessMm / 2);
    assert.equal(summary.detachedCells, 0, `plate torn at ${directionDeg}`);
  }
});

test('the hand tremor is the same path whatever the time step', () => {
  const coarse = runStroke('screwdriver', 6, 'aluminum', 100, 0, 0, 0.004);
  const fine = runStroke('screwdriver', 6, 'aluminum', 100, 0, 0, 0.0005);
  const coarsePath = coarse.engine.getToolPath();
  const finePath = fine.engine.getToolPath();
  const coarseEnd = coarsePath[coarsePath.length - 1];
  const fineEnd = finePath[finePath.length - 1];
  const start = getStrokeStart(60, 60, 0);

  assert.ok(Math.abs(coarseEnd.x - fineEnd.x) < 1e-6);
  assert.ok(Math.abs(coarseEnd.y - fineEnd.y) < 1e-6);
  let widestWander = 0;
  for (const point of finePath) {
    widestWander = Math.max(widestWander, Math.abs(point.y - start.y));
  }
  assert.ok(widestWander > 0.005, 'the path should wander');
  assert.ok(widestWander < 0.25, `the path wandered ${widestWander} mm`);
});

test('pile-up never holds more material than was cut out of the plate', () => {
  for (const [toolType, sizeMm, material] of [['screwdriver', 6, 'aluminum'], ['knife', 4, 'gold'], ['crowbar', 10, 'brass']] as const) {
    const { engine, before, summary } = runStroke(toolType, sizeMm, material, 300);
    const cellAreaMm2 = 1 / (engine.surface.resolution * engine.surface.resolution);
    let raisedVolume = 0;
    for (let i = 0; i < before.length; i++) {
      const delta = engine.surface.data[i] - before[i];
      if (delta > 0) {
        raisedVolume += delta * cellAreaMm2;
      }
    }

    assert.ok(summary.carvedVolumeMm3 > 0);
    assert.ok(raisedVolume > 0);
    assert.ok(raisedVolume < summary.carvedVolumeMm3, `${toolType} on ${material} raised ${raisedVolume} of ${summary.carvedVolumeMm3}`);
    // The groove left behind cannot be bigger than what was cut.
    assert.ok(netRemovedVolume(before, engine) <= summary.carvedVolumeMm3 + 1e-9);
  }
});

test('a ball scratch is as wide as scratch hardness predicts', () => {
  // ASTM G171: scratch hardness = 8 P / (pi w^2), because a sliding ball is carried by its leading half.
  // A scratch in a material of indentation hardness H should give back about H.
  const loadN = 300;
  const engine = new ForensicPhysicsEngine(60, 60, 20, seed);
  const before = new Float64Array(engine.surface.data);
  const kernel = engine.createToolKernel('crowbar', 10, 0, 90, 0, {
    baseRandom: createSeededRandom(seed),
    striationRandom: createSeededRandom(deriveSeed(seed, 1)),
    striationsEnabled: false
  });
  const start = getStrokeStart(60, 60, 0);
  Array.from(engine.simulateCutGenerator(start.x, start.y, 0, loadN, kernel, 'aluminum', 3, 10, 20, 0, 0.002));

  const res = engine.surface.resolution;
  const widths: number[] = [];
  for (let x = 20 * res; x <= 40 * res; x += res) {
    let cells = 0;
    for (let y = 25 * res; y <= 35 * res; y++) {
      if (engine.surface.data[y * engine.surface.width + x] - before[y * engine.surface.width + x] < -0.002) {
        cells++;
      }
    }
    widths.push(cells / res);
  }
  widths.sort((a, b) => a - b);
  const widthMm = widths[Math.floor(widths.length / 2)];
  const scratchHardnessMPa = 8 * loadN / (Math.PI * widthMm * widthMm);

  assert.ok(widthMm > 1, `scratch width ${widthMm}`);
  assert.ok(
    Math.abs(scratchHardnessMPa - MATERIALS.aluminum.hardnessMPa) / MATERIALS.aluminum.hardnessMPa < 0.25,
    `scratch hardness ${scratchHardnessMPa} MPa from a ${widthMm} mm scratch`
  );
});

test('pile-up forms ridges beside the groove and leaves the groove open', () => {
  const { engine, before, summary } = runStroke('knife', 4, 'aluminum', 50);
  const res = engine.surface.resolution;
  const centreline: number[] = [];
  let farthestRidgeMm = 0;
  let highestRidge = 0;
  let highestRidgeOffsetMm = 0;

  // The middle of the stroke, clear of the prow left where the tool stopped.
  for (let y = 0; y < engine.surface.height; y++) {
    for (let x = 15 * res; x <= 45 * res; x++) {
      const delta = engine.surface.data[y * engine.surface.width + x] - before[y * engine.surface.width + x];
      const offsetMm = Math.abs(y / res - 30);
      if (delta > 0.002) {
        farthestRidgeMm = Math.max(farthestRidgeMm, offsetMm);
      }
      if (delta > highestRidge) {
        highestRidge = delta;
        highestRidgeOffsetMm = offsetMm;
      }
    }
  }
  for (let x = 15 * res; x <= 45 * res; x++) {
    let deepest = 0;
    for (let y = 29 * res; y <= 31 * res; y++) {
      deepest = Math.min(deepest, engine.surface.data[y * engine.surface.width + x] - before[y * engine.surface.width + x]);
    }
    centreline.push(deepest);
  }
  centreline.sort((a, b) => a - b);

  assert.ok(highestRidge > 0.002);
  // The ridge crest sits at the edge of the groove, and the ridge is lower than the groove is deep.
  assert.ok(highestRidgeOffsetMm < 1, `ridge crest ${highestRidgeOffsetMm} mm from the cut`);
  assert.ok(highestRidge < summary.maxCutDepthMm);
  assert.ok(farthestRidgeMm < 2, `ridge found ${farthestRidgeMm} mm from the cut`);
  assert.ok(centreline[Math.floor(centreline.length / 2)] < -0.02);
});

test('a very small time step does not multiply the work', () => {
  const started = performance.now();
  const fine = runStroke('screwdriver', 6, 'aluminum', 100, 0, 0.2, 1e-7);
  const elapsedMs = performance.now() - started;
  const path = fine.engine.getToolPath();

  assert.ok(elapsedMs < 20000, `run took ${elapsedMs} ms`);
  assert.ok(Math.abs(path[path.length - 1].time - STROKE_LENGTH_MM / 20) < 1e-6);
  assert.ok(fine.summary.carvedVolumeMm3 > 0);
});

const runStrike = (
  toolType: string,
  sizeMm: number,
  material: MaterialType,
  energyJ: number,
  angleDeg = 90,
  directionDeg = 0,
  thicknessMm = 3,
  resolution = 10
) => {
  const engine = new ForensicPhysicsEngine(60, 60, resolution, seed);
  const before = new Float64Array(engine.surface.data);
  const kernel = engine.createToolKernel(toolType, sizeMm, 0.1, angleDeg, directionDeg, {
    baseRandom: createSeededRandom(seed),
    striationRandom: createSeededRandom(deriveSeed(seed, 1)),
    striationsEnabled: true
  });
  Array.from(engine.simulateStrikeGenerator(30, 30, energyJ, kernel, material, thicknessMm, 8));
  const summary = engine.getCutSummary();
  assert.ok(summary);

  // Extent of the impression: cells pressed more than 2 microns below where they were.
  const res = engine.surface.resolution;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let pressedCells = 0;
  for (let y = 0; y < engine.surface.height; y++) {
    for (let x = 0; x < engine.surface.width; x++) {
      if (engine.surface.data[y * engine.surface.width + x] - before[y * engine.surface.width + x] < -0.002) {
        pressedCells++;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
  }
  return {
    engine,
    before,
    summary,
    pressedAreaMm2: pressedCells / (res * res),
    extentXMm: pressedCells > 0 ? (maxX - minX + 1) / res : 0,
    extentYMm: pressedCells > 0 ? (maxY - minY + 1) / res : 0
  };
};

test('a square hammer blow leaves a round impression the size of the face', () => {
  const blow = runStrike('hammer_face', 25, 'aluminum', 5);

  // The flat of the face is 20 mm across; the chamfer around it stays clear of the surface.
  assert.ok(blow.extentXMm > 19 && blow.extentXMm < 22, `impression is ${blow.extentXMm} mm long`);
  assert.ok(Math.abs(blow.extentXMm - blow.extentYMm) < 1, `impression is ${blow.extentXMm} by ${blow.extentYMm} mm`);
  assert.ok(blow.summary.maxCutDepthMm > 0.03);
  assert.ok(blow.summary.maxPileUpMm < blow.summary.maxCutDepthMm);
  assert.equal(blow.summary.detachedCells, 0);
  assert.equal(blow.engine.getSurfaceDetailMap(), null);
});

test('a harder blow leaves a deeper impression and no blow leaves none', () => {
  const none = runStrike('hammer_face', 25, 'aluminum', 0);
  const light = runStrike('hammer_face', 25, 'aluminum', 5);
  const heavy = runStrike('hammer_face', 25, 'aluminum', 15);

  assert.equal(none.summary.carvedVolumeMm3, 0);
  assert.deepEqual(none.engine.surface.data, none.before);
  assert.ok(heavy.summary.maxCutDepthMm > light.summary.maxCutDepthMm);
  assert.ok(heavy.summary.carvedVolumeMm3 > light.summary.carvedVolumeMm3);
});

test('a softer target takes a deeper impression from the same blow', () => {
  const aluminum = runStrike('hammer_face', 25, 'aluminum', 8);
  const steel = runStrike('hammer_face', 25, 'steel', 8);

  assert.ok(aluminum.summary.maxCutDepthMm > steel.summary.maxCutDepthMm);
  assert.ok(aluminum.summary.carvedVolumeMm3 > steel.summary.carvedVolumeMm3);
});

test('a blow that lands on the edge of the face leaves a crescent', () => {
  const square = runStrike('hammer_face', 25, 'aluminum', 5);
  const edgeOn = runStrike('hammer_face', 25, 'aluminum', 5, 60);

  // The rim digs in along an arc: a mark much longer across the tool than along it, and far smaller
  // and deeper than the print of the whole face.
  assert.ok(edgeOn.extentYMm > 2 * edgeOn.extentXMm, `mark is ${edgeOn.extentXMm} by ${edgeOn.extentYMm} mm`);
  assert.ok(edgeOn.pressedAreaMm2 < square.pressedAreaMm2 / 4);
  assert.ok(edgeOn.summary.maxCutDepthMm > 3 * square.summary.maxCutDepthMm);
});

test('an edge-on blow leaves the same mark whichever way the tool is turned', () => {
  const ahead = runStrike('hammer_face', 25, 'aluminum', 5, 60, 0);
  const turned = runStrike('hammer_face', 25, 'aluminum', 5, 60, 120);
  const carvedDifference = Math.abs(turned.summary.carvedVolumeMm3 - ahead.summary.carvedVolumeMm3) / ahead.summary.carvedVolumeMm3;
  const areaDifference = Math.abs(turned.pressedAreaMm2 - ahead.pressedAreaMm2) / ahead.pressedAreaMm2;

  assert.ok(carvedDifference < 0.05, `carved volume differs by ${carvedDifference}`);
  assert.ok(areaDifference < 0.08, `impression area differs by ${areaDifference}`);
});

test('a ball driven in by a blow goes as deep as the energy and hardness allow', () => {
  // Plastic work = hardness x displaced volume (Tabor), and a ball of radius R pressed in by d
  // displaces a spherical cap of pi d^2 (R - d / 3).
  const energyJ = 1;
  const radiusMm = 5;
  const engine = new ForensicPhysicsEngine(60, 60, 20, seed);
  const kernel = engine.createToolKernel('crowbar', 2 * radiusMm, 0, 90, 0, {
    baseRandom: createSeededRandom(seed),
    striationRandom: createSeededRandom(deriveSeed(seed, 1)),
    striationsEnabled: false
  });
  Array.from(engine.simulateStrikeGenerator(30, 30, energyJ, kernel, 'aluminum', 5, 10));
  const summary = engine.getCutSummary();
  assert.ok(summary);
  const penetrationMm = -Math.min(...engine.getToolPath().map(point => point.toolZ));
  const capVolumeMm3 = Math.PI * penetrationMm * penetrationMm * (radiusMm - penetrationMm / 3);
  const expectedVolumeMm3 = energyJ * 1000 / MATERIALS.aluminum.hardnessMPa;

  // The ball carries a fine machining texture, so it is not an exact sphere.
  assert.ok(Math.abs(capVolumeMm3 - expectedVolumeMm3) / expectedVolumeMm3 < 0.05, `cap volume ${capVolumeMm3} for ${expectedVolumeMm3}`);
  // What stays after the ball lifts off is that impression less its elastic recovery.
  assert.ok(summary.carvedVolumeMm3 < expectedVolumeMm3);
  assert.ok(summary.carvedVolumeMm3 > 0.6 * expectedVolumeMm3);
  assert.ok(summary.maxCutDepthMm > 0.8 * penetrationMm);
});

test('surface height can be read between grid points and is undefined off the plate', () => {
  const { engine } = runStroke('knife', 4, 'aluminum', 100);

  assert.ok(engine.getSurfaceHeightAt(30, 30) < -0.02);
  assert.ok(Math.abs(engine.getSurfaceHeightAt(30.013, 12.37)) < 0.02);
  assert.ok(Number.isNaN(engine.getSurfaceHeightAt(-1, 30)));
  assert.ok(Number.isNaN(engine.getSurfaceHeightAt(30, 60.5)));
});

test('fails fast for invalid strike parameters', () => {
  const engine = new ForensicPhysicsEngine(60, 60, 10, seed);
  const kernel = createKernel(engine, 90, 'hammer_face', 25);

  assert.throws(() => Array.from(engine.simulateStrikeGenerator(30, 30, -1, kernel, 'aluminum', 1, 8)), /energyJ/);
  assert.throws(() => Array.from(engine.simulateStrikeGenerator(30, 30, Number.NaN, kernel, 'aluminum', 1, 8)), /energyJ/);
  assert.throws(() => Array.from(engine.simulateStrikeGenerator(30, 30, 5, kernel, 'aluminum', 0, 8)), /materialThicknessMm/);
});
