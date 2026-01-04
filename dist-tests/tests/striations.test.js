import test from 'node:test';
import assert from 'node:assert/strict';
import { createStriationProfile, getStriationOffset } from '../src/utils/striations.js';
import { ForensicPhysicsEngine } from '../src/utils/SimulationEngine.js';
import { createSeededRandom } from '../src/utils/random.js';
const makeRng = (seed) => createSeededRandom(seed);
test('fails fast on invalid striation config', () => {
    assert.throws(() => createStriationProfile({
        widthMm: 0,
        pitchMm: 0.1,
        amplitudeMm: 0.01,
        irregularity: 0.2,
        wear: 0.1,
        random: makeRng(1)
    }), /widthMm/);
});
test('creates deterministic profiles with a seeded RNG', () => {
    const rngA = makeRng(123);
    const rngB = makeRng(123);
    const profileA = createStriationProfile({
        widthMm: 5,
        pitchMm: 0.25,
        amplitudeMm: 0.02,
        irregularity: 0.4,
        wear: 0.3,
        random: rngA
    });
    const profileB = createStriationProfile({
        widthMm: 5,
        pitchMm: 0.25,
        amplitudeMm: 0.02,
        irregularity: 0.4,
        wear: 0.3,
        random: rngB
    });
    assert.equal(profileA.values.length, profileB.values.length);
    for (let i = 0; i < profileA.values.length; i++) {
        assert.equal(profileA.values[i], profileB.values[i]);
    }
});
test('clamps striation offset lookups to the profile width', () => {
    const profile = createStriationProfile({
        widthMm: 4,
        pitchMm: 0.2,
        amplitudeMm: 0.02,
        irregularity: 0.3,
        wear: 0.2,
        random: makeRng(42)
    });
    const atStart = getStriationOffset(profile, 0);
    const belowStart = getStriationOffset(profile, -2);
    const atEnd = getStriationOffset(profile, profile.widthMm);
    const aboveEnd = getStriationOffset(profile, profile.widthMm + 2);
    assert.equal(atStart, belowStart);
    assert.equal(atEnd, aboveEnd);
});
test('kernel profiles differ when striations are enabled', () => {
    const engine = new ForensicPhysicsEngine(20, 20, 10, 101);
    const makeSeeded = (seed) => makeRng(seed);
    const kernelNoStriation = engine.createToolKernel('screwdriver', 6, 0.2, 45, 0, {
        baseRandom: makeSeeded(1),
        striationRandom: makeSeeded(2),
        striationsEnabled: false
    });
    const kernelWithStriation = engine.createToolKernel('screwdriver', 6, 0.2, 45, 0, {
        baseRandom: makeSeeded(1),
        striationRandom: makeSeeded(2),
        striationsEnabled: true
    });
    let maxDelta = 0;
    for (let i = 0; i < kernelNoStriation.profile.length; i++) {
        const a = kernelNoStriation.profile[i];
        const b = kernelWithStriation.profile[i];
        if (a >= 500 || b >= 500) {
            continue;
        }
        const delta = Math.abs(a - b);
        if (delta > maxDelta)
            maxDelta = delta;
    }
    assert.ok(maxDelta > 0);
});
test('kernel profiles match when striation amplitude is zero', () => {
    const engine = new ForensicPhysicsEngine(20, 20, 10, 101);
    const makeSeeded = (seed) => makeRng(seed);
    const override = { pitchMm: 0.2, amplitudeMm: 0, irregularity: 0.4 };
    const kernelNoStriation = engine.createToolKernel('screwdriver', 6, 0.2, 45, 0, {
        baseRandom: makeSeeded(7),
        striationRandom: makeSeeded(8),
        striationsEnabled: false,
        striationConfigOverride: override
    });
    const kernelWithStriation = engine.createToolKernel('screwdriver', 6, 0.2, 45, 0, {
        baseRandom: makeSeeded(7),
        striationRandom: makeSeeded(8),
        striationsEnabled: true,
        striationConfigOverride: override
    });
    assert.equal(kernelNoStriation.profile.length, kernelWithStriation.profile.length);
    for (let i = 0; i < kernelNoStriation.profile.length; i++) {
        assert.equal(kernelNoStriation.profile[i], kernelWithStriation.profile[i]);
    }
});
