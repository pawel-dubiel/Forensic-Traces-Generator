import test from 'node:test';
import assert from 'node:assert/strict';
import { ElasticPlasticModel } from '../src/utils/elasticPlastic.js';

test('fails fast for invalid material values', () => {
  assert.throws(
    () => new ElasticPlasticModel({ youngModulusGPa: 0, yieldStrengthMPa: 100, hardeningModulusMPa: 1000 }),
    /youngModulusGPa/
  );
});

test('returns no permanent depth in the elastic regime', () => {
  const model = new ElasticPlasticModel({ youngModulusGPa: 200, yieldStrengthMPa: 250, hardeningModulusMPa: 1000 });
  const result = model.computePermanentDepth(0.005, 10, 0);
  assert.equal(result.permanentDepth, 0);
  assert.equal(result.plasticStrainIncrement, 0);
});

test('computes permanent depth in the plastic regime', () => {
  const model = new ElasticPlasticModel({ youngModulusGPa: 200, yieldStrengthMPa: 250, hardeningModulusMPa: 1000 });
  const result = model.computePermanentDepth(0.05, 10, 0);
  assert.ok(Math.abs(result.permanentDepth - 0.0375) < 1e-6);
  assert.ok(Math.abs(result.plasticStrainIncrement - 0.00375) < 1e-8);
});

test('hardening reduces permanent depth for the same penetration', () => {
  const model = new ElasticPlasticModel({ youngModulusGPa: 200, yieldStrengthMPa: 250, hardeningModulusMPa: 1000 });
  const baseline = model.computePermanentDepth(0.05, 10, 0);
  const hardened = model.computePermanentDepth(0.05, 10, 0.05);
  assert.ok(hardened.permanentDepth < baseline.permanentDepth);
});
