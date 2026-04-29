import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { validateScenario } from '../src/scenario.js';

const fixture = async (name: string) => JSON.parse(await readFile(join('fixtures', 'scenarios', name), 'utf8')) as unknown;

test('validates fixture scenarios', async () => {
  const knife = validateScenario(await fixture('knife_aluminum_baseline.json'));
  const screwdriver = validateScenario(await fixture('screwdriver_wood_fracture_probe.json'));

  assert.equal(knife.id, 'knife-aluminum-baseline');
  assert.equal(knife.tool.type, 'knife');
  assert.equal(screwdriver.tool.type, 'screwdriver');
});

test('fails fast when a required field is missing', async () => {
  const scenario = await fixture('knife_aluminum_baseline.json') as Record<string, unknown>;
  delete scenario.outputName;

  assert.throws(() => validateScenario(scenario), /outputName/);
});

test('fails fast when an unknown field is present', async () => {
  const scenario = await fixture('knife_aluminum_baseline.json') as Record<string, unknown>;
  scenario.defaultForceN = 100;

  assert.throws(() => validateScenario(scenario), /defaultForceN/);
});

test('fails fast for invalid material names', async () => {
  const scenario = await fixture('knife_aluminum_baseline.json') as {
    target: { material: string };
  };
  scenario.target.material = 'titanium';

  assert.throws(() => validateScenario(scenario), /target\.material/);
});

test('fails fast for declared but unsupported tool geometry', async () => {
  const scenario = await fixture('knife_aluminum_baseline.json') as {
    tool: { type: string; geometry: Record<string, unknown> };
  };
  scenario.tool.type = 'crowbar';
  scenario.tool.geometry = { tipRadiusMm: 5 };

  assert.throws(() => validateScenario(scenario), /crowbar/);
});
