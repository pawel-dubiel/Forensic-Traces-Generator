import { readFile } from 'node:fs/promises';
import { ALL_TOOLS, DECLARED_UNSUPPORTED_TOOLS, MATERIALS, SUPPORTED_TOOLS } from './types.js';
import type {
  KnifeGeometry,
  MaterialProperties,
  Scenario,
  ScrewdriverGeometry,
  ToolConfig
} from './types.js';

const hasOwn = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);

const fail = (path: string, message: string): never => {
  throw new Error(`${path}: ${message}`);
};

const assertObject = (value: unknown, path: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(path, 'must be an object');
  }
  return value as Record<string, unknown>;
};

const assertKeys = (value: Record<string, unknown>, path: string, keys: string[]) => {
  for (const key of keys) {
    if (!hasOwn(value, key)) {
      fail(`${path}.${key}`, 'is required');
    }
  }

  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) {
      fail(`${path}.${key}`, 'is not supported by schema version 1');
    }
  }
};

const assertString = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || value.trim() === '') {
    fail(path, 'must be a non-empty string');
  }
  return value as string;
};

const assertNumber = (value: unknown, path: string, options: { min?: number; max?: number; integer?: boolean } = {}): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(path, 'must be a finite number');
  }
  const numberValue = value as number;
  if (options.integer && !Number.isInteger(numberValue)) {
    fail(path, 'must be an integer');
  }
  if (options.min !== undefined && numberValue < options.min) {
    fail(path, `must be >= ${options.min}`);
  }
  if (options.max !== undefined && numberValue > options.max) {
    fail(path, `must be <= ${options.max}`);
  }
  return numberValue;
};

const assertLiteral = <T extends string | number>(value: unknown, path: string, expected: readonly T[]): T => {
  if (!expected.includes(value as T)) {
    fail(path, `must be one of ${expected.map(item => JSON.stringify(item)).join(', ')}`);
  }
  return value as T;
};

const assertStringArray = (value: unknown, path: string): string[] => {
  if (!Array.isArray(value) || value.length === 0) {
    fail(path, 'must be a non-empty array of strings');
  }
  return (value as unknown[]).map((item, index) => assertString(item, `${path}[${index}]`));
};

const parseUnits = (value: unknown) => {
  const units = assertObject(value, 'units');
  assertKeys(units, 'units', ['length', 'time', 'force', 'stress', 'density']);
  assertLiteral(units.length, 'units.length', ['mm']);
  assertLiteral(units.time, 'units.time', ['s']);
  assertLiteral(units.force, 'units.force', ['N']);
  assertLiteral(units.stress, 'units.stress', ['MPa']);
  assertLiteral(units.density, 'units.density', ['mg/mm^3']);
  return units as unknown as Scenario['units'];
};

const parseMaterialProperties = (value: unknown): MaterialProperties => {
  const properties = assertObject(value, 'target.properties');
  assertKeys(properties, 'target.properties', [
    'youngModulusMPa',
    'poissonRatio',
    'densityMgPerMm3',
    'yieldStrengthMPa',
    'hardeningModulusMPa',
    'frictionCoefficient',
    'tensileStrengthMPa',
    'fractureEnergyNPerMm',
    'criticalPlasticStrain'
  ]);

  return {
    youngModulusMPa: assertNumber(properties.youngModulusMPa, 'target.properties.youngModulusMPa', { min: 1 }),
    poissonRatio: assertNumber(properties.poissonRatio, 'target.properties.poissonRatio', { min: 0, max: 0.49 }),
    densityMgPerMm3: assertNumber(properties.densityMgPerMm3, 'target.properties.densityMgPerMm3', { min: 0 }),
    yieldStrengthMPa: assertNumber(properties.yieldStrengthMPa, 'target.properties.yieldStrengthMPa', { min: 0 }),
    hardeningModulusMPa: assertNumber(properties.hardeningModulusMPa, 'target.properties.hardeningModulusMPa', { min: 0 }),
    frictionCoefficient: assertNumber(properties.frictionCoefficient, 'target.properties.frictionCoefficient', { min: 0 }),
    tensileStrengthMPa: assertNumber(properties.tensileStrengthMPa, 'target.properties.tensileStrengthMPa', { min: 0 }),
    fractureEnergyNPerMm: assertNumber(properties.fractureEnergyNPerMm, 'target.properties.fractureEnergyNPerMm', { min: 0 }),
    criticalPlasticStrain: assertNumber(properties.criticalPlasticStrain, 'target.properties.criticalPlasticStrain', { min: 0 })
  };
};

const parseScrewdriverGeometry = (value: unknown): ScrewdriverGeometry => {
  const geometry = assertObject(value, 'tool.geometry');
  assertKeys(geometry, 'tool.geometry', ['bladeWidthMm', 'bladeThicknessMm', 'activeLengthMm']);
  return {
    bladeWidthMm: assertNumber(geometry.bladeWidthMm, 'tool.geometry.bladeWidthMm', { min: 0 }),
    bladeThicknessMm: assertNumber(geometry.bladeThicknessMm, 'tool.geometry.bladeThicknessMm', { min: 0 }),
    activeLengthMm: assertNumber(geometry.activeLengthMm, 'tool.geometry.activeLengthMm', { min: 0 })
  };
};

const parseKnifeGeometry = (value: unknown): KnifeGeometry => {
  const geometry = assertObject(value, 'tool.geometry');
  assertKeys(geometry, 'tool.geometry', ['edgeRadiusMm', 'bevelHalfAngleDeg', 'bladeLengthMm', 'bladeThicknessMm']);
  return {
    edgeRadiusMm: assertNumber(geometry.edgeRadiusMm, 'tool.geometry.edgeRadiusMm', { min: 0 }),
    bevelHalfAngleDeg: assertNumber(geometry.bevelHalfAngleDeg, 'tool.geometry.bevelHalfAngleDeg', { min: 0, max: 90 }),
    bladeLengthMm: assertNumber(geometry.bladeLengthMm, 'tool.geometry.bladeLengthMm', { min: 0 }),
    bladeThicknessMm: assertNumber(geometry.bladeThicknessMm, 'tool.geometry.bladeThicknessMm', { min: 0 })
  };
};

const parseToolGeometry = (tool: ToolConfig): ToolConfig['geometry'] => {
  if (tool.type === 'screwdriver') {
    return parseScrewdriverGeometry(tool.geometry);
  }
  if (tool.type === 'knife') {
    return parseKnifeGeometry(tool.geometry);
  }
  return fail('tool.type', `tool "${tool.type}" is declared for inventory parity but is not implemented in the NairnMPM sidecar`);
};

export const validateScenario = (input: unknown): Scenario => {
  const root = assertObject(input, 'scenario');
  assertKeys(root, 'scenario', ['schemaVersion', 'id', 'outputName', 'units', 'simulation', 'target', 'tool', 'solver']);
  if (root.schemaVersion !== 1) {
    fail('schemaVersion', 'must be exactly 1');
  }

  const simulation = assertObject(root.simulation, 'simulation');
  assertKeys(simulation, 'simulation', [
    'dimension',
    'widthMm',
    'heightMm',
    'thicknessMm',
    'cellSizeMm',
    'particlesPerElement',
    'timeStepSeconds',
    'maxTimeSeconds',
    'archiveTimeSeconds',
    'originXmm',
    'originYmm'
  ]);

  const target = assertObject(root.target, 'target');
  assertKeys(target, 'target', ['material', 'thicknessMm', 'materialModel', 'properties']);

  const tool = assertObject(root.tool, 'tool');
  assertKeys(tool, 'tool', [
    'type',
    'hardnessMohs',
    'forceN',
    'angleDeg',
    'directionDeg',
    'speedMmPerSec',
    'chatter',
    'wear',
    'startXmm',
    'startYmm',
    'pathLengthMm',
    'geometry'
  ]);

  const solver = assertObject(root.solver, 'solver');
  assertKeys(solver, 'solver', ['processors', 'mpmMethod', 'archiveFields', 'extractFields']);

  const scenario: Scenario = {
    schemaVersion: 1,
    id: assertString(root.id, 'id'),
    outputName: assertString(root.outputName, 'outputName'),
    units: parseUnits(root.units),
    simulation: {
      dimension: assertLiteral(simulation.dimension, 'simulation.dimension', ['2d']),
      widthMm: assertNumber(simulation.widthMm, 'simulation.widthMm', { min: 0 }),
      heightMm: assertNumber(simulation.heightMm, 'simulation.heightMm', { min: 0 }),
      thicknessMm: assertNumber(simulation.thicknessMm, 'simulation.thicknessMm', { min: 0 }),
      cellSizeMm: assertNumber(simulation.cellSizeMm, 'simulation.cellSizeMm', { min: 0 }),
      particlesPerElement: assertNumber(simulation.particlesPerElement, 'simulation.particlesPerElement', { min: 1, integer: true }),
      timeStepSeconds: assertNumber(simulation.timeStepSeconds, 'simulation.timeStepSeconds', { min: 0 }),
      maxTimeSeconds: assertNumber(simulation.maxTimeSeconds, 'simulation.maxTimeSeconds', { min: 0 }),
      archiveTimeSeconds: assertNumber(simulation.archiveTimeSeconds, 'simulation.archiveTimeSeconds', { min: 0 }),
      originXmm: assertNumber(simulation.originXmm, 'simulation.originXmm'),
      originYmm: assertNumber(simulation.originYmm, 'simulation.originYmm')
    },
    target: {
      material: assertLiteral(target.material, 'target.material', MATERIALS),
      thicknessMm: assertNumber(target.thicknessMm, 'target.thicknessMm', { min: 0 }),
      materialModel: assertLiteral(target.materialModel, 'target.materialModel', ['IsoPlasticity']),
      properties: parseMaterialProperties(target.properties)
    },
    tool: {
      type: assertLiteral(tool.type, 'tool.type', ALL_TOOLS),
      hardnessMohs: assertNumber(tool.hardnessMohs, 'tool.hardnessMohs', { min: 1, max: 10 }),
      forceN: assertNumber(tool.forceN, 'tool.forceN', { min: 0 }),
      angleDeg: assertNumber(tool.angleDeg, 'tool.angleDeg', { min: 0, max: 90 }),
      directionDeg: assertNumber(tool.directionDeg, 'tool.directionDeg', { min: 0, max: 360 }),
      speedMmPerSec: assertNumber(tool.speedMmPerSec, 'tool.speedMmPerSec', { min: 0 }),
      chatter: assertNumber(tool.chatter, 'tool.chatter', { min: 0, max: 1 }),
      wear: assertNumber(tool.wear, 'tool.wear', { min: 0, max: 1 }),
      startXmm: assertNumber(tool.startXmm, 'tool.startXmm'),
      startYmm: assertNumber(tool.startYmm, 'tool.startYmm'),
      pathLengthMm: assertNumber(tool.pathLengthMm, 'tool.pathLengthMm', { min: 0 }),
      geometry: assertObject(tool.geometry, 'tool.geometry')
    },
    solver: {
      processors: assertNumber(solver.processors, 'solver.processors', { min: 1, integer: true }),
      mpmMethod: assertLiteral(solver.mpmMethod, 'solver.mpmMethod', ['USF', 'USL', 'MUSL']),
      archiveFields: assertStringArray(solver.archiveFields, 'solver.archiveFields'),
      extractFields: assertStringArray(solver.extractFields, 'solver.extractFields')
    }
  };

  scenario.tool.geometry = parseToolGeometry(scenario.tool);

  if (!SUPPORTED_TOOLS.includes(scenario.tool.type as never) && DECLARED_UNSUPPORTED_TOOLS.includes(scenario.tool.type as never)) {
    fail('tool.type', `tool "${scenario.tool.type}" is not implemented`);
  }

  return scenario;
};

export const loadScenario = async (path: string): Promise<Scenario> => {
  const raw = await readFile(path, 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`${path}: invalid JSON: ${(error as Error).message}`);
  }
  return validateScenario(parsed);
};
