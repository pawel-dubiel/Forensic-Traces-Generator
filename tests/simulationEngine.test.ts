import test from 'node:test';
import assert from 'node:assert/strict';
import { ForensicPhysicsEngine, MATERIALS } from '../src/utils/SimulationEngine.js';
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
  timeStep = 0.002
) => {
  Array.from(engine.simulateCutGenerator(
    10,
    30,
    angleDir,
    force,
    kernel,
    material,
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
  sizeMm = 6
) => {
  const engine = new ForensicPhysicsEngine(60, 60, 10, seed);
  const before = new Float64Array(engine.surface.data);
  const kernel = createKernel(engine, angleDeg, toolType, sizeMm);
  runSimulation(engine, kernel, force, toolHardness, material, 0, speed);
  return { before, after: engine.surface.data, engine };
};

const trailingPileupVolume = (before: Float64Array, after: Float64Array, engine: ForensicPhysicsEngine) => {
  const trailingEndX = Math.floor(10 * engine.surface.resolution);
  const cellAreaMm2 = 1 / (engine.surface.resolution * engine.surface.resolution);
  let volume = 0;

  for (let y = 0; y < engine.surface.height; y++) {
    for (let x = 0; x < trailingEndX; x++) {
      const idx = y * engine.surface.width + x;
      const delta = after[idx] - before[idx];
      if (delta > 0) {
        volume += delta * cellAreaMm2;
      }
    }
  }

  return volume;
};

const roughnessInCutBand = (before: Float64Array, after: Float64Array, engine: ForensicPhysicsEngine) => {
  const values: number[] = [];
  const minY = Math.floor(26 * engine.surface.resolution);
  const maxY = Math.floor(34 * engine.surface.resolution);

  for (let y = minY; y <= maxY; y++) {
    for (let x = 0; x < engine.surface.width; x++) {
      const idx = y * engine.surface.width + x;
      const delta = after[idx] - before[idx];
      if (delta < -0.001) {
        values.push(delta);
      }
    }
  }

  if (values.length < 2) {
    throw new Error('cut band must contain enough lowered cells');
  }

  const mean = values.reduce((acc, value) => acc + value, 0) / values.length;
  const variance = values.reduce((acc, value) => acc + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
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

test('higher force produces a deeper trace', () => {
  const lowForce = simulate(25, 8);
  const highForce = simulate(100, 8);

  assert.ok(lowForce.changed > 0);
  assert.ok(highForce.changed > 0);
  assert.ok(highForce.minDelta < lowForce.minDelta);
});

test('tool hardness affects cutting depth', () => {
  const softTool = simulate(100, 1, 'steel');
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

test('higher friction material produces more trailing pile-up under the same force and tool', () => {
  const originalFriction = MATERIALS.aluminum.frictionCoefficient;

  try {
    MATERIALS.aluminum.frictionCoefficient = 0.05;
    const lowerFriction = simulateSurface(100, 8, 'aluminum');

    MATERIALS.aluminum.frictionCoefficient = 0.95;
    const higherFriction = simulateSurface(100, 8, 'aluminum');

    assert.ok(trailingPileupVolume(higherFriction.before, higherFriction.after, higherFriction.engine) >
      trailingPileupVolume(lowerFriction.before, lowerFriction.after, lowerFriction.engine));
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

  assert.ok(roughnessInCutBand(fast.before, fast.after, fast.engine) > roughnessInCutBand(slow.before, slow.after, slow.engine));
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

test('brittle material roughens more under high shear than ductile material', () => {
  const ductile = simulateSurface(120, 8, 'gold', 25);
  const brittle = simulateSurface(120, 8, 'wood', 25);

  assert.ok(roughnessInCutBand(brittle.before, brittle.after, brittle.engine) > roughnessInCutBand(ductile.before, ductile.after, ductile.engine));
});

test('zero force does not create a detail map', () => {
  const engine = new ForensicPhysicsEngine(60, 60, 10, seed);
  const kernel = createKernel(engine);

  runSimulation(engine, kernel, 0, 8, 'aluminum', 0);

  assert.equal(engine.getSurfaceDetailMap(), null);
});

test('fails fast for invalid simulation parameters', () => {
  const engine = new ForensicPhysicsEngine(60, 60, 10, seed);
  const kernel = createKernel(engine);

  assert.throws(
    () => Array.from(engine.simulateCutGenerator(10, 30, 0, -1, kernel, 'aluminum', 8, 20, 0, 0.002)),
    /force/
  );
  assert.throws(
    () => Array.from(engine.simulateCutGenerator(10, 30, 0, 10, kernel, 'aluminum', 0, 20, 0, 0.002)),
    /toolHardnessMohs/
  );
  assert.throws(
    () => Array.from(engine.simulateCutGenerator(10, 30, 0, 10, kernel, 'aluminum', 8, 20, 1.5, 0.002)),
    /chatterParam/
  );
});
