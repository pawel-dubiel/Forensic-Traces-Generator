export const SUPPORTED_TOOLS = ['screwdriver', 'knife'] as const;
export const DECLARED_UNSUPPORTED_TOOLS = ['crowbar', 'hammer_face', 'hammer_claw', 'spoon'] as const;
export const ALL_TOOLS = [...SUPPORTED_TOOLS, ...DECLARED_UNSUPPORTED_TOOLS] as const;
export const MATERIALS = ['aluminum', 'brass', 'steel', 'wood', 'gold'] as const;

export type ToolType = typeof ALL_TOOLS[number];
export type SupportedToolType = typeof SUPPORTED_TOOLS[number];
export type MaterialType = typeof MATERIALS[number];

export interface ScenarioUnits {
  length: 'mm';
  time: 's';
  force: 'N';
  stress: 'MPa';
  density: 'mg/mm^3';
}

export interface SimulationConfig {
  dimension: '2d';
  widthMm: number;
  heightMm: number;
  thicknessMm: number;
  cellSizeMm: number;
  particlesPerElement: number;
  timeStepSeconds: number;
  maxTimeSeconds: number;
  archiveTimeSeconds: number;
  originXmm: number;
  originYmm: number;
}

export interface MaterialProperties {
  youngModulusMPa: number;
  poissonRatio: number;
  densityMgPerMm3: number;
  yieldStrengthMPa: number;
  hardeningModulusMPa: number;
  frictionCoefficient: number;
  tensileStrengthMPa: number;
  fractureEnergyNPerMm: number;
  criticalPlasticStrain: number;
}

export interface TargetConfig {
  material: MaterialType;
  thicknessMm: number;
  materialModel: 'IsoPlasticity';
  properties: MaterialProperties;
}

export interface ScrewdriverGeometry {
  bladeWidthMm: number;
  bladeThicknessMm: number;
  activeLengthMm: number;
}

export interface KnifeGeometry {
  edgeRadiusMm: number;
  bevelHalfAngleDeg: number;
  bladeLengthMm: number;
  bladeThicknessMm: number;
}

export interface ToolConfig {
  type: ToolType;
  hardnessMohs: number;
  forceN: number;
  angleDeg: number;
  directionDeg: number;
  speedMmPerSec: number;
  chatter: number;
  wear: number;
  startXmm: number;
  startYmm: number;
  pathLengthMm: number;
  geometry: ScrewdriverGeometry | KnifeGeometry | Record<string, unknown>;
}

export interface SolverConfig {
  processors: number;
  mpmMethod: 'USF' | 'USL' | 'MUSL';
  archiveFields: string[];
  extractFields: string[];
}

export interface Scenario {
  schemaVersion: 1;
  id: string;
  outputName: string;
  units: ScenarioUnits;
  simulation: SimulationConfig;
  target: TargetConfig;
  tool: ToolConfig;
  solver: SolverConfig;
}

export interface ExtractedParticle {
  materialId: number;
  x: number;
  y: number;
  vx?: number;
  vy?: number;
  mass?: number;
  thickness?: number;
  displacementX?: number;
  displacementY?: number;
  damage?: number;
}

export interface NormalizedResult {
  metadata: {
    scenarioId: string;
    outputName: string;
    units: ScenarioUnits;
    generatedAt: string;
    sourcePaths: {
      scenario: string;
      solverInput?: string;
      extractedData?: string;
    };
    solverCommand?: string[];
  };
  particleSummary: {
    particleCount: number;
    bounds: {
      minX: number | null;
      maxX: number | null;
      minY: number | null;
      maxY: number | null;
    };
    maxDisplacement: number | null;
    maxDamage: number | null;
  };
  visualization: {
    type: 'particles';
    particles: ExtractedParticle[];
  };
  diagnostics: {
    warnings: string[];
  };
}
