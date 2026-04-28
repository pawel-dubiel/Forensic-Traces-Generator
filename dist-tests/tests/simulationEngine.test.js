import test from 'node:test';
import assert from 'node:assert/strict';
import { ForensicPhysicsEngine } from '../src/utils/SimulationEngine.js';
import { createSeededRandom, deriveSeed } from '../src/utils/random.js';
const seed = 1337;
const createKernel = (engine, angleDeg = 45, toolType = 'screwdriver', sizeMm = 6) => engine.createToolKernel(toolType, sizeMm, 0.1, angleDeg, 0, {
    baseRandom: createSeededRandom(seed),
    striationRandom: createSeededRandom(deriveSeed(seed, 1)),
    striationsEnabled: true
});
const runSimulation = (engine, kernel, force, toolHardness, material = 'aluminum', chatter = 0) => {
    Array.from(engine.simulateCutGenerator(10, 30, 0, force, kernel, material, toolHardness, 20, chatter, 0.002));
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
test('fails fast for invalid simulation parameters', () => {
    const engine = new ForensicPhysicsEngine(60, 60, 10, seed);
    const kernel = createKernel(engine);
    assert.throws(() => Array.from(engine.simulateCutGenerator(10, 30, 0, -1, kernel, 'aluminum', 8, 20, 0, 0.002)), /force/);
    assert.throws(() => Array.from(engine.simulateCutGenerator(10, 30, 0, 10, kernel, 'aluminum', 0, 20, 0, 0.002)), /toolHardnessMohs/);
    assert.throws(() => Array.from(engine.simulateCutGenerator(10, 30, 0, 10, kernel, 'aluminum', 8, 20, 1.5, 0.002)), /chatterParam/);
});
