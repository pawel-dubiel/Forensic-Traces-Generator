import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSurfaceMeshIndices, ForensicPhysicsEngine, MATERIALS } from '../src/utils/SimulationEngine.js';
import { createSeededRandom, deriveSeed } from '../src/utils/random.js';
const seed = 1337;
const createKernel = (engine, angleDeg = 45, toolType = 'screwdriver', sizeMm = 6) => engine.createToolKernel(toolType, sizeMm, 0.1, angleDeg, 0, {
    baseRandom: createSeededRandom(seed),
    striationRandom: createSeededRandom(deriveSeed(seed, 1)),
    striationsEnabled: true
});
const runSimulation = (engine, kernel, force, toolHardness, material = 'aluminum', chatter = 0, speed = 20, angleDir = 0, timeStep = 0.002, materialThicknessMm = MATERIALS[material].defaultThicknessMm) => {
    Array.from(engine.simulateCutGenerator(10, 30, angleDir, force, kernel, material, materialThicknessMm, toolHardness, speed, chatter, timeStep));
};
const surfaceStats = (before, after) => {
    assert.equal(before.length, after.length);
    let changed = 0;
    let minDelta = Infinity;
    let maxDelta = -Infinity;
    for (let i = 0; i < before.length; i++) {
        const delta = after[i] - before[i];
        if (Math.abs(delta) > 1e-12) {
            changed += 1;
            if (delta < minDelta)
                minDelta = delta;
            if (delta > maxDelta)
                maxDelta = delta;
        }
    }
    return { changed, minDelta, maxDelta };
};
const simulate = (force, toolHardness, material = 'aluminum', chatter = 0, angleDeg = 45, resolution = 10) => {
    const engine = new ForensicPhysicsEngine(60, 60, resolution, seed);
    const before = new Float64Array(engine.surface.data);
    const kernel = createKernel(engine, angleDeg);
    runSimulation(engine, kernel, force, toolHardness, material, chatter);
    return surfaceStats(before, engine.surface.data);
};
const simulateSurface = (force, toolHardness, material, angleDeg = 45, speed = 20, toolType = 'screwdriver', sizeMm = 6, materialThicknessMm = MATERIALS[material].defaultThicknessMm) => {
    const engine = new ForensicPhysicsEngine(60, 60, 10, seed);
    const before = new Float64Array(engine.surface.data);
    const kernel = createKernel(engine, angleDeg, toolType, sizeMm);
    runSimulation(engine, kernel, force, toolHardness, material, 0, speed, 0, 0.002, materialThicknessMm);
    return { before, after: engine.surface.data, engine };
};
const trailingPileupVolume = (before, after, engine) => {
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
const roughnessInCutBand = (before, after, engine) => {
    const values = [];
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
const meanCutDepthInCutBand = (before, after, engine) => {
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
const fractureStats = (engine) => {
    const { damage, detached, edgeLift, debrisHeight } = engine.getFractureState();
    let detachedCount = 0;
    let maxDamage = 0;
    let liftedCells = 0;
    let debrisVolume = 0;
    const cellAreaMm2 = 1 / (engine.surface.resolution * engine.surface.resolution);
    for (let i = 0; i < detached.length; i++) {
        if (detached[i])
            detachedCount++;
        if (damage[i] > maxDamage)
            maxDamage = damage[i];
        if (edgeLift[i] > 0)
            liftedCells++;
        if (debrisHeight[i] > 0)
            debrisVolume += debrisHeight[i] * cellAreaMm2;
    }
    return { detachedCount, maxDamage, liftedCells, debrisVolume };
};
const heightAt = (engine, xMm, yMm) => {
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
test('higher friction material produces more trailing pile-up under the same force and tool', () => {
    const originalFriction = MATERIALS.aluminum.frictionCoefficient;
    try {
        MATERIALS.aluminum.frictionCoefficient = 0.05;
        const lowerFriction = simulateSurface(100, 8, 'aluminum');
        MATERIALS.aluminum.frictionCoefficient = 0.95;
        const higherFriction = simulateSurface(100, 8, 'aluminum');
        assert.ok(trailingPileupVolume(higherFriction.before, higherFriction.after, higherFriction.engine) >
            trailingPileupVolume(lowerFriction.before, lowerFriction.after, lowerFriction.engine));
    }
    finally {
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
    const detachedHeights = new Map();
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
    assert.throws(() => Array.from(engine.simulateCutGenerator(10, 30, 0, -1, kernel, 'aluminum', 1, 8, 20, 0, 0.002)), /force/);
    assert.throws(() => Array.from(engine.simulateCutGenerator(10, 30, 0, 10, kernel, 'aluminum', 1, 0, 20, 0, 0.002)), /toolHardnessMohs/);
    assert.throws(() => Array.from(engine.simulateCutGenerator(10, 30, 0, 10, kernel, 'aluminum', 1, 8, 20, 1.5, 0.002)), /chatterParam/);
    assert.throws(() => Array.from(engine.simulateCutGenerator(10, 30, 0, 10, kernel, 'aluminum', 0, 8, 20, 0, 0.002)), /materialThicknessMm/);
});
