import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseExtractedParticles } from '../src/extract.js';
import { normalizeParticles } from '../src/result.js';
import { validateScenario } from '../src/scenario.js';

const loadScenario = async () => validateScenario(JSON.parse(await readFile(join('fixtures', 'scenarios', 'knife_aluminum_baseline.json'), 'utf8')));

test('parses ExtractMPM-style text particle output', async () => {
  const text = await readFile(join('fixtures', 'extract', 'sample_particles.txt'), 'utf8');
  const particles = parseExtractedParticles(text);

  assert.equal(particles.length, 3);
  assert.equal(particles[1].damage, 0.1);
  assert.equal(particles[2].vx, 10);
});

test('parses ExtractMPM XML particle output', async () => {
  const xml = await readFile(join('fixtures', 'extract', 'sample_particles.xml'), 'utf8');
  const particles = parseExtractedParticles(xml);

  assert.equal(particles.length, 2);
  assert.equal(particles[0].materialId, 1);
  assert.equal(particles[1].mass, 0.001);
});

test('normalizes particles into app-readable result summary', async () => {
  const scenario = await loadScenario();
  const text = await readFile(join('fixtures', 'extract', 'sample_particles.txt'), 'utf8');
  const particles = parseExtractedParticles(text);
  const result = normalizeParticles(scenario, particles, { scenario: 'fixture.json', extractedData: 'sample_particles.txt' });

  assert.equal(result.metadata.scenarioId, 'knife-aluminum-baseline');
  assert.equal(result.particleSummary.particleCount, 3);
  assert.equal(result.particleSummary.bounds.minX, 10);
  assert.ok(result.particleSummary.maxDisplacement);
  assert.equal(result.particleSummary.maxDamage, 0.1);
});
