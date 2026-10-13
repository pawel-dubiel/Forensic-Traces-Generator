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

test('generated XML uses only elements and attributes that the NairnMPM input schema declares', async () => {
  const scenario = await load('knife_aluminum_baseline.json');
  const xml = generateNairnXml(scenario);

  // Checked against NairnMPM.dtd: there is no <Processors> element, <SetDirection> takes no attributes,
  // and friction belongs to the multimaterial contact settings, not to a material.
  assert.doesNotMatch(xml, /<Processors>/);
  assert.doesNotMatch(xml, /<SetDirection\b[^>]*\b[xy]=/);
  assert.doesNotMatch(xml, /<Material\b[^>]*>[\s\S]*?<ContactPosition>[\s\S]*?<\/Material>/);
  assert.match(xml, /<MultiMaterialMode Vmin="1">\s*<Friction>[\d.]+<\/Friction>\s*<\/MultiMaterialMode>/);
});

test('archive root is relative to the run directory the solver starts in', async () => {
  const scenario = await load('knife_aluminum_baseline.json');
  const xml = generateNairnXml(scenario);

  assert.match(xml, new RegExp(`<ArchiveRoot>archive/${scenario.outputName}\\.</ArchiveRoot>`));
});
