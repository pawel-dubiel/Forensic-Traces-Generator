import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { validateScenario } from '../src/scenario.js';
import { generateNairnXml, validateGeneratedXmlStructure } from '../src/xml.js';

const load = async (name: string) => validateScenario(JSON.parse(await readFile(join('fixtures', 'scenarios', name), 'utf8')));

test('generates NairnMPM XML for knife fixture', async () => {
  const scenario = await load('knife_aluminum_baseline.json');
  const xml = generateNairnXml(scenario);

  validateGeneratedXmlStructure(xml);
  assert.match(xml, /<Analysis>10<\/Analysis>/);
  assert.match(xml, /<Material Type="9" Name="Target">/);
  assert.match(xml, /<Material Type="35" Name="Tool">/);
  assert.match(xml, /knife edgeRadiusMm=0\.015/);
  assert.match(xml, /<Body matname="Tool"/);
});

test('generates NairnMPM XML for screwdriver fixture', async () => {
  const scenario = await load('screwdriver_wood_fracture_probe.json');
  const xml = generateNairnXml(scenario);

  validateGeneratedXmlStructure(xml);
  assert.match(xml, /screwdriver-wood-fracture-probe/);
  assert.match(xml, /<Rect xmin="7" xmax="13" ymin="27" ymax="33"\/>/);
  assert.match(xml, /<yield>80<\/yield>/);
});
