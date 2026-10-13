// SimulationEngine.ts
// High-Fidelity Discrete Heightfield Simulation
import { ElasticPlasticModel, getElasticPlasticMaterial } from './elasticPlastic.js';
import { createStriationProfile, getStriationOffset } from './striations.js';
import { createSeededRandom } from './random.js';
import type { StriationProfile } from './striations.js';

export interface SurfaceMap {
    width: number;
    height: number;
    resolution: number; // points per mm
    data: Float64Array; // High-precision Height values (Z)
}

export interface SurfaceDetailMap {
    lengthMm: number;
    widthMm: number;
    resolution: number; // samples per mm
    lengthSamples: number;
    widthSamples: number;
    originX: number;
    originY: number;
    directionDeg: number;
    data: Float32Array; // Fine height offsets in mm, stored length-major
    minHeight: number;
    maxHeight: number;
}

export interface FractureState {
    damage: Float32Array;
    detached: Uint8Array;
    edgeLift: Float32Array;
    debrisHeight: Float32Array;
}

export interface ToolKernel {
    // Tool tip heights on a grid fixed to the tool: x runs along the drag axis (trailing edge first), y across it.
    profile: Float64Array;
    width: number; // grid samples along the drag axis
    height: number; // grid samples across it
    spacingMm: number;
    halfSizeMm: number;
    // The contact point that follows the tool path, in tool coordinates.
    anchorAlongMm: number;
    anchorAcrossMm: number;
    directionDeg: number;
    tiltSlope: number; // rise of the tool face per mm towards the front
    sharpness: number; // 0-1 (1 is razor sharp)
    contactPatchLUT: ContactPatchSample[];
    maxProfileDepth: number;
    striationProfile: StriationProfile;
    angleDeg: number;
    type: string;
    shearEfficiency: number;
    edgeDragFactor: number;
}

export interface ToolPathPoint {
    x: number;
    y: number;
    toolZ: number;
    time: number;
}

// What the most recent pass did to the surface.
export interface CutSummary {
    maxCutDepthMm: number; // deepest point below the nominal surface
    maxPileUpMm: number; // tallest point, above the nominal surface, that the pass piled material onto
    carvedVolumeMm3: number; // cut out of the plate itself, not counting pile-up that was pushed along
    detachedCells: number;
}

interface ContactPatchSample {
    depth: number;
    areaMm2: number; // whole patch: what bears the load when the tool is pressed straight in
    leadingAreaMm2: number; // forward-facing part: what bears the load when the tool slides
}

interface ToolKernelOptions {
    baseRandom: () => number;
    striationRandom: () => number;
    striationsEnabled: boolean;
    striationConfigOverride?: StriationConfigOverride;
}

interface StriationConfigOverride {
    pitchMm: number;
    amplitudeMm: number;
    irregularity: number;
}

export type MaterialType = 'aluminum' | 'brass' | 'steel' | 'wood' | 'gold';

interface MaterialConstants {
    hardnessMPa: number;
    mohsHardness: number;
    flow: number;
    brittleness: number;
    frictionCoefficient: number;
    shearStrengthMPa: number;
    smearFactor: number;
    tensileStrengthMPa: number;
    fractureEnergyNPerMm: number;
    criticalPlasticStrain: number;
    densityMgPerMm3: number;
    defaultThicknessMm: number;
}

interface ToolShearConstants {
    shearEfficiency: number;
    edgeDragFactor: number;
}

interface ShearResponse {
    stressRatio: number;
    lateralDisplacement: number;
    smearDepth: number;
    prowFraction: number;
    tearRoughness: number;
    trailingX: number;
    trailingY: number;
}

export interface SurfaceFieldSample {
    heightGradientX: number;
    heightGradientY: number;
    heightLaplacian: number;
    damageGradientX: number;
    damageGradientY: number;
    damageLaplacian: number;
    strainConcentration: number;
}

// Material constants for the simulation loop
export const MATERIALS: Record<MaterialType, MaterialConstants> = {
    // Brittleness: 0 = Clay (100% Flow), 1 = Glass (100% Fracture/Chip)
    aluminum: { hardnessMPa: 245, mohsHardness: 2.75, flow: 0.8, brittleness: 0.1, frictionCoefficient: 0.47, shearStrengthMPa: 70, smearFactor: 0.65, tensileStrengthMPa: 110, fractureEnergyNPerMm: 18, criticalPlasticStrain: 0.12, densityMgPerMm3: 2.7, defaultThicknessMm: 1.2 },
    brass: { hardnessMPa: 900, mohsHardness: 3.0, flow: 0.6, brittleness: 0.2, frictionCoefficient: 0.42, shearStrengthMPa: 180, smearFactor: 0.45, tensileStrengthMPa: 250, fractureEnergyNPerMm: 26, criticalPlasticStrain: 0.09, densityMgPerMm3: 8.5, defaultThicknessMm: 1.2 },
    steel: { hardnessMPa: 1800, mohsHardness: 5.5, flow: 0.3, brittleness: 0.1, frictionCoefficient: 0.35, shearStrengthMPa: 260, smearFactor: 0.25, tensileStrengthMPa: 400, fractureEnergyNPerMm: 55, criticalPlasticStrain: 0.16, densityMgPerMm3: 7.85, defaultThicknessMm: 1.5 },
    wood: { hardnessMPa: 40, mohsHardness: 2.0, flow: 0.1, brittleness: 0.9, frictionCoefficient: 0.62, shearStrengthMPa: 12, smearFactor: 0.15, tensileStrengthMPa: 35, fractureEnergyNPerMm: 2.2, criticalPlasticStrain: 0.025, densityMgPerMm3: 0.55, defaultThicknessMm: 1.0 }, // High brittleness = Splintering
    gold: { hardnessMPa: 220, mohsHardness: 2.5, flow: 0.95, brittleness: 0.0, frictionCoefficient: 0.55, shearStrengthMPa: 45, smearFactor: 0.85, tensileStrengthMPa: 120, fractureEnergyNPerMm: 32, criticalPlasticStrain: 0.22, densityMgPerMm3: 19.3, defaultThicknessMm: 1.0 }, // Very ductile, piles up easily
};

const MOHS_TO_HARDNESS_MPA = [
    10,
    350,
    1000,
    1500,
    3000,
    6000,
    11000,
    15000,
    21000,
    100000,
];

const DETAIL_MAP_RESOLUTION = 240;
const MAX_DETAIL_WIDTH_MM = 8;

const TOOL_STRIATION_CONFIG: Record<string, { pitchMm: number; amplitudeMm: number; irregularity: number }> = {
    screwdriver: { pitchMm: 0.22, amplitudeMm: 0.015, irregularity: 0.45 },
    knife: { pitchMm: 0.08, amplitudeMm: 0.008, irregularity: 0.25 },
    crowbar: { pitchMm: 0.35, amplitudeMm: 0.02, irregularity: 0.5 },
    hammer_face: { pitchMm: 0.6, amplitudeMm: 0.012, irregularity: 0.6 },
    hammer_claw: { pitchMm: 0.28, amplitudeMm: 0.018, irregularity: 0.55 },
    spoon: { pitchMm: 0.5, amplitudeMm: 0.012, irregularity: 0.35 },
};

const TOOL_SHEAR_CONFIG: Record<string, ToolShearConstants> = {
    screwdriver: { shearEfficiency: 0.65, edgeDragFactor: 1.15 },
    knife: { shearEfficiency: 0.9, edgeDragFactor: 0.85 },
    crowbar: { shearEfficiency: 0.45, edgeDragFactor: 1.05 },
    hammer_face: { shearEfficiency: 0.2, edgeDragFactor: 1.25 },
    hammer_claw: { shearEfficiency: 0.75, edgeDragFactor: 1.2 },
    spoon: { shearEfficiency: 0.3, edgeDragFactor: 0.95 },
};

const KNIFE_EDGE_RADIUS_MM = 0.015;
const KNIFE_BEVEL_HALF_ANGLE_DEG = 17;

export const STROKE_LENGTH_MM = 40;
const TOOL_BOUND_EPSILON_MM = 1e-9;
// Contact patch table: depths are spaced geometrically because real marks are tens of microns deep.
const CONTACT_LUT_SAMPLES = 40;
const CONTACT_LUT_MIN_DEPTH_MM = 0.002;
const CONTACT_LUT_SUBSAMPLES = 3;
const ANCHOR_DEPTH_FRACTION = 1 / 24;
const CIRCLE_DIAMETER_PER_ROOT_AREA = 2 / Math.sqrt(Math.PI);
// Chatter modulates the applied force, so its depth swing scales with the load.
const CHATTER_FORCE_MODULATION = 0.75;
const ACTIVE_CELL_MARGIN_MM = 0.05;
const ACTIVE_REGION_BANDS = 16;
const PILE_UP_RING_WEIGHTS = [1, 1 / 2, 1 / 3, 1 / 4];
const PILE_UP_WEIGHT_SUM = PILE_UP_RING_WEIGHTS.reduce((sum, weight) => sum + weight, 0);
// Only material within a few cut depths of the groove edge flows sideways; the rest is pushed ahead.
const SIDE_FLOW_REACH_DEPTHS = 4;
// A ridge spreads over a few cut depths beside the groove, so a deeper cut raises a wider ridge, not a taller wall.
const RIDGE_WIDTH_DEPTHS = SIDE_FLOW_REACH_DEPTHS;
// Around an impression the rim spreads over at least this share of the contact size: a wide, shallow
// dent raises a broad low rim, not a thin wall.
const INDENT_RIM_WIDTH_CONTACT_SHARE = 0.25;
// Piled-up rims around indentations reach a fraction of the indentation depth.
const INDENT_RIM_HEIGHT_DEPTHS = 0.3;
const MIN_RIM_SMOOTHING_PASSES = 8;
const MAX_RIM_SMOOTHING_PASSES = 300;
const BANK_SMOOTHING_PASSES = 12;
// The prow ahead of the tool cannot stand taller than the cut is deep; the excess breaks off as chips.
const PROW_HEIGHT_DEPTHS = 1;
const CRACKS_PER_MM = 1.5;
// Width of the strip whose plastic work feeds a crack. A fixed length, so fracture does not depend on the grid.
const FRACTURE_PROCESS_ZONE_MM = 1 / 30;
// A ductile plate tears only where the cut has weakened it: fracture reaches its full rate once this share
// of the thickness is gone, so a shallow groove in a thick plate does not tear through. Brittle materials
// crack from the surface and need proportionally less.
const LIGAMENT_FULL_DAMAGE_FRACTION = 0.5;
// Tabor's representative strain under a wedge or cone is about 0.2 tan(beta), with tan(beta) the
// depth over the contact radius: 0.4 times the depth over the contact diameter that the engine tracks.
const REPRESENTATIVE_STRAIN_FACTOR = 0.4;
// Torn material stands proud of the cut by up to this share of the local cut depth, reached at the
// strongest tearing the shear model produces.
const TEAR_DEPTH_FRACTION = 0.2;
const MAX_TEAR_ROUGHNESS_MM = 0.12;
const CHIP_ROUGHNESS_MM = 0.05;
// At the strongest smearing the shear model produces, this share of the fresh cut is laid back down.
const MAX_SMEAR_SHARE = 0.35;
const MAX_SMEAR_DEPTH_MM = 0.08;
// Sideways wander of a hand-held tool: physiological tremor near 10 Hz on top of slower drift.
// It is a function of time, so the path does not depend on the step size or the grid.
const HAND_TREMOR_COMPONENTS = [
    { frequencyHz: 9.5, amplitudeMm: 0.012 },
    { frequencyHz: 3.1, amplitudeMm: 0.02 },
    { frequencyHz: 0.45, amplitudeMm: 0.06 },
];
// Ghost playback of a blow: the tool comes down from this height, dwells and lifts off again.
const STRIKE_APPROACH_HEIGHT_MM = 12;
const STRIKE_REBOUND_HEIGHT_MM = 4;
const STRIKE_PLAYBACK_SECONDS = 0.9;
const YIELD_INTERVAL_MS = 30;
const EDGE_UNSET = -1;
// The eight neighbours of a cell, row by row, with their unit directions.
const NEIGHBOUR_DX = [-1, 0, 1, -1, 1, -1, 0, 1];
const NEIGHBOUR_DY = [-1, -1, -1, 0, 0, 1, 1, 1];
const NEIGHBOUR_DIR_X = NEIGHBOUR_DX.map((dx, n) => dx / Math.hypot(dx, NEIGHBOUR_DY[n]));
const NEIGHBOUR_DIR_Y = NEIGHBOUR_DY.map((dy, n) => dy / Math.hypot(NEIGHBOUR_DX[n], dy));

// The part of the tool low enough to reach the surface, as rectangles in tool coordinates: bands across
// the tool, each with the stretch along the tool that is low enough. Bands follow shapes such as two
// claws or a V edge far more tightly than one rectangle around everything.
interface ActiveKernelRegion {
    threshold: number;
    bandCount: number;
    bounds: Float64Array; // per band: across low, across high, along low, along high (mm)
}

// Centres a stroke on the plate so the mark stays on the surface for any drag direction.
export const getStrokeStart = (widthMm: number, heightMm: number, directionDeg: number, lengthMm: number = STROKE_LENGTH_MM) => {
    if (!Number.isFinite(widthMm) || widthMm <= 0) {
        throw new Error('widthMm must be a positive finite number');
    }
    if (!Number.isFinite(heightMm) || heightMm <= 0) {
        throw new Error('heightMm must be a positive finite number');
    }
    if (!Number.isFinite(directionDeg)) {
        throw new Error('directionDeg must be a finite number');
    }
    if (!Number.isFinite(lengthMm) || lengthMm <= 0) {
        throw new Error('lengthMm must be a positive finite number');
    }
    const rad = directionDeg * Math.PI / 180;
    return {
        x: widthMm / 2 - Math.cos(rad) * lengthMm / 2,
        y: heightMm / 2 - Math.sin(rad) * lengthMm / 2
    };
};

export const buildSurfaceMeshIndices = (width: number, height: number, detached: Uint8Array): Uint32Array => {
    if (!Number.isInteger(width) || width <= 1) {
        throw new Error('width must be an integer greater than 1');
    }
    if (!Number.isInteger(height) || height <= 1) {
        throw new Error('height must be an integer greater than 1');
    }
    if (!(detached instanceof Uint8Array)) {
        throw new Error('detached must be a Uint8Array');
    }
    if (detached.length !== width * height) {
        throw new Error('detached length must match width * height');
    }

    let indexCount = 0;
    for (let y = 0; y < height - 1; y++) {
        for (let x = 0; x < width - 1; x++) {
            const a = y * width + x;
            const b = a + 1;
            const c = (y + 1) * width + x;
            const d = c + 1;
            if (detached[a] || detached[b] || detached[c] || detached[d]) {
                continue;
            }
            indexCount += 6;
        }
    }

    const indices = new Uint32Array(indexCount);
    let out = 0;
    for (let y = 0; y < height - 1; y++) {
        for (let x = 0; x < width - 1; x++) {
            const a = y * width + x;
            const b = a + 1;
            const c = (y + 1) * width + x;
            const d = c + 1;
            if (detached[a] || detached[b] || detached[c] || detached[d]) {
                continue;
            }
            indices[out++] = a;
            indices[out++] = c;
            indices[out++] = b;
            indices[out++] = b;
            indices[out++] = c;
            indices[out++] = d;
        }
    }

    return indices;
};

export class ForensicPhysicsEngine {
    surface: SurfaceMap;
    private plasticStrain: Float32Array;
    private damage: Float32Array;
    private detached: Uint8Array;
    private edgeLift: Float32Array;
    private debrisHeight: Float32Array;
    // Pile-up and smear resting on each cell: material that was moved there, not part of the plate.
    private looseHeight: Float32Array;
    private random!: () => number;
    private randomSeed: number;
    private toolPath: ToolPathPoint[];
    private surfaceDetailMap: SurfaceDetailMap | null;
    private maxSurfaceHeight = 0;
    private passHighestPileUp = 0;
    private cutSummary: CutSummary | null = null;
    private activeKernelRegions = new WeakMap<ToolKernel, ActiveKernelRegion>();
    // Cells carved by the current kernel stamp, kept as a sparse set so pile-up can find the contact edge.
    private carvedCount = 0;
    private carvedIndex = new Int32Array(256);
    private carvedFlowDepth = new Float64Array(256);
    // Where each carved cell sat under the tool, in tool coordinates.
    private carvedAlong = new Float64Array(256);
    private carvedAcross = new Float64Array(256);
    private debrisStencil: { radius: number; count: number; totalWeight: number; dx: Int32Array; dy: Int32Array; weight: Float64Array } | null = null;
    // Scratch grids for finding the edges of one stamp's contact.
    private contactOccupied = new Uint8Array(0);
    private contactSideLow = new Int32Array(0);
    private contactSideHigh = new Int32Array(0);
    private contactFront = new Int32Array(0);
    private carvedSlot: Int32Array | null = null;
    // Cells the current pass carved.
    private passTouched: Uint8Array | null = null;

    constructor(widthMM: number, heightMM: number, resolution: number, randomSeed: number) {
        this.validatePositiveFinite(widthMM, 'widthMM');
        this.validatePositiveFinite(heightMM, 'heightMM');
        if (!Number.isFinite(resolution) || resolution <= 0 || !Number.isInteger(resolution)) {
            throw new Error('resolution must be a positive integer');
        }
        if (!Number.isFinite(randomSeed)) {
            throw new Error('randomSeed must be a finite number');
        }
        if (!Number.isInteger(randomSeed)) {
            throw new Error('randomSeed must be an integer');
        }
        const w = Math.floor(widthMM * resolution);
        const h = Math.floor(heightMM * resolution);

        this.surface = {
            width: w,
            height: h,
            resolution: resolution,
            data: new Float64Array(w * h).fill(0)
        };
        this.plasticStrain = new Float32Array(w * h).fill(0);
        this.damage = new Float32Array(w * h).fill(0);
        this.detached = new Uint8Array(w * h).fill(0);
        this.edgeLift = new Float32Array(w * h).fill(0);
        this.debrisHeight = new Float32Array(w * h).fill(0);
        this.looseHeight = new Float32Array(w * h).fill(0);
        this.randomSeed = randomSeed;
        this.resetRandom();
        this.toolPath = [];
        this.surfaceDetailMap = null;
        
        this.generateBaseTopography();
    }

    private generateBaseTopography() {
        const { width, height, data } = this.surface;
        const res = this.surface.resolution;
        const primaryAngular = (2 * Math.PI) / 1.05;
        const secondaryAngular = (2 * Math.PI) / 0.42;
        const grainAngular = (2 * Math.PI) / 30;
        
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = y * width + x;
                const xMm = x / res;
                const yMm = y / res;
                const noise = Math.sin(xMm * primaryAngular) * 0.005 +
                              Math.sin(xMm * secondaryAngular + yMm * grainAngular) * 0.002 +
                              (this.coordinateNoise(xMm, yMm) - 0.5) * 0.002;
                data[idx] = noise;
            }
        }
    }

    reset() {
        this.resetRandom();
        this.generateBaseTopography();
        this.plasticStrain.fill(0);
        this.damage.fill(0);
        this.detached.fill(0);
        this.edgeLift.fill(0);
        this.debrisHeight.fill(0);
        this.looseHeight.fill(0);
        this.toolPath = [];
        this.surfaceDetailMap = null;
        this.cutSummary = null;
    }

    getCutSummary(): CutSummary | null {
        return this.cutSummary ? { ...this.cutSummary } : null;
    }

    getToolPath(): ToolPathPoint[] {
        return this.toolPath.slice();
    }

    getSurfaceDetailMap(): SurfaceDetailMap | null {
        return this.surfaceDetailMap;
    }

    getFractureState(): FractureState {
        return {
            damage: this.damage,
            detached: this.detached,
            edgeLift: this.edgeLift,
            debrisHeight: this.debrisHeight
        };
    }

    // Height of the surface at a point in mm, including lifted edges and debris.
    // NaN off the plate and over a hole.
    getSurfaceHeightAt(xMm: number, yMm: number): number {
        this.validateFinite(xMm, 'xMm');
        this.validateFinite(yMm, 'yMm');
        const res = this.surface.resolution;
        const gridX = xMm * res;
        const gridY = yMm * res;
        if (gridX < 0 || gridY < 0 || gridX > this.surface.width - 1 || gridY > this.surface.height - 1) {
            return NaN;
        }
        const x0 = Math.min(this.surface.width - 2, Math.floor(gridX));
        const y0 = Math.min(this.surface.height - 2, Math.floor(gridY));
        const fx = gridX - x0;
        const fy = gridY - y0;
        const a = y0 * this.surface.width + x0;
        const b = a + 1;
        const c = a + this.surface.width;
        const d = c + 1;
        if (this.detached[a] || this.detached[b] || this.detached[c] || this.detached[d]) {
            return NaN;
        }
        const top = this.getEffectiveHeight(a) * (1 - fx) + this.getEffectiveHeight(b) * fx;
        const bottom = this.getEffectiveHeight(c) * (1 - fx) + this.getEffectiveHeight(d) * fx;
        return top * (1 - fy) + bottom * fy;
    }

    getSurfaceFieldSample(mapX: number, mapY: number): SurfaceFieldSample {
        return this.computeFieldSample(mapX, mapY);
    }

    private resetRandom() {
        this.random = createSeededRandom(this.randomSeed);
    }

    createToolKernel(
        type: string,
        sizeMM: number,
        wear: number,
        angleDeg: number,
        directionDeg: number,
        options: ToolKernelOptions
    ): ToolKernel {
        if (!Number.isFinite(sizeMM) || sizeMM <= 0) {
            throw new Error('sizeMM must be a positive finite number');
        }
        if (!Number.isFinite(wear) || wear < 0 || wear > 1) {
            throw new Error('wear must be between 0 and 1');
        }
        if (!Number.isFinite(angleDeg) || angleDeg <= 0 || angleDeg > 90) {
            throw new Error('angleDeg must be greater than 0 and at most 90 degrees');
        }
        if (!Number.isFinite(directionDeg)) {
            throw new Error('directionDeg must be a finite number');
        }
        if (!options || typeof options !== 'object') {
            throw new Error('Tool kernel options are required');
        }
        if (typeof options.baseRandom !== 'function') {
            throw new Error('baseRandom must be a function');
        }
        if (typeof options.striationRandom !== 'function') {
            throw new Error('striationRandom must be a function');
        }
        if (typeof options.striationsEnabled !== 'boolean') {
            throw new Error('striationsEnabled must be a boolean');
        }

        // The grid is fixed to the tool, with its outer samples exactly on the tool's edges, so the same tool
        // has the same profile whatever direction it is dragged in. The drag direction is applied when stamping.
        const res = this.surface.resolution;
        const halfSize = sizeMM / 2;
        const gridCells = Math.max(1, Math.round(sizeMM * res));
        const spacing = sizeMM / gridCells;
        const gridW = gridCells + 1;
        const gridH = gridW;
        const kernel = new Float64Array(gridW * gridH).fill(999);
        // The smooth shape without surface texture: it decides which faces look forward.
        const nominal = new Float64Array(gridW * gridH).fill(999);

        const wearMag = wear * 0.2; 
        let sharpness = 0.5;
        const striationConfig = this.getStriationConfig(type, options.striationConfigOverride);
        const striationProfile = this.createToolStriationProfile(striationConfig, sizeMM, wear, options.striationRandom);
        const shearConfig = this.getToolShearConfig(type);

        const tiltSlope = Math.min(Math.tan((90 - angleDeg) * Math.PI / 180), 1);

        for (let y = 0; y < gridH; y++) {
            for (let x = 0; x < gridW; x++) {
                const idx = y * gridW + x;
                
                // toolDx is aligned with Motion Vector.
                // toolDy is Perpendicular to Motion Vector.
                const toolDx = x === gridCells ? halfSize : -halfSize + x * spacing;
                const toolDy = y === gridCells ? halfSize : -halfSize + y * spacing;

                let z = 0;
                
                if (type === 'screwdriver') {
                    // Flat blade. Width is across the motion (perpendicular).
                    // So we check toolDy (perpendicular) for width.
                    if (Math.abs(toolDy) > sizeMM/2) z = 999;
                    else z = Math.abs(toolDy) > (sizeMM/2 - 0.2) ? (Math.abs(toolDy) - (sizeMM/2 - 0.2)) : 0;
                    sharpness = 0.3;
                } else if (type === 'knife') {
                    const edgeRadius = KNIFE_EDGE_RADIUS_MM + wear * 0.08;
                    const bevelSlope = Math.tan(this.degreesToRadians(KNIFE_BEVEL_HALF_ANGLE_DEG + wear * 18));
                    const edgeDistance = Math.abs(toolDy);
                    const alongLimit = sizeMM * 2.5;
                    if (Math.abs(toolDx) > alongLimit) {
                        z = 999;
                    } else if (edgeDistance <= edgeRadius) {
                        z = (edgeDistance * edgeDistance) / (2 * edgeRadius);
                    } else {
                        z = (edgeRadius / 2) + (edgeDistance - edgeRadius) * bevelSlope;
                    }
                    sharpness = 0.95;
                } else if (type === 'crowbar') {
                    // Round tip
                    const r = sizeMM / 2;
                    const d = Math.sqrt(toolDx*toolDx + toolDy*toolDy);
                    if (d > r) z = 999;
                    else z = r - Math.sqrt(r*r - d*d);
                    sharpness = 0.1;
                } else if (type === 'hammer_face') {
                    const r = sizeMM / 2;
                    const d = Math.sqrt(toolDx*toolDx + toolDy*toolDy);
                    if (d > r) z = 999;
                    else if (d > r * 0.8) z = (d - r * 0.8);
                    else z = 0;
                    sharpness = 0.05;
                } else if (type === 'hammer_claw') {
                    // Claws aligned with motion
                    const clawWidth = sizeMM * 0.4;
                    const gap = sizeMM * 0.15;
                    
                    if (Math.abs(toolDy) < gap) { // Perpendicular axis
                        z = 999;
                    } else if (Math.abs(toolDy) > clawWidth) {
                        z = 999;
                    } else {
                        const prongCenter = gap + (clawWidth - gap)/2;
                        const localP = Math.abs(Math.abs(toolDy) - prongCenter);
                        z = localP * 1.5; 
                        // Curve along Length (toolDx)
                        const curve = (toolDx * toolDx) * 0.2;
                        z += curve;
                    }
                    sharpness = 0.6;
                } else if (type === 'spoon') {
                    // Ellipsoidal Bowl
                    // sizeMM is width (approx 30mm usually)
                    // Let's assume standard teaspoon: 30mm width, 45mm length
                    // Depth approx 10mm
                    
                    // Simple paraboloid approximation: z = (x^2 / A) + (y^2 / B)
                    // toolDy is Width axis. toolDx is Length axis.
                    
                    const A = sizeMM * 0.8; // Curvature factor Width
                    const B = sizeMM * 1.5; // Curvature factor Length (flatter lengthwise)
                    
                    z = (toolDy * toolDy) / A + (toolDx * toolDx) / B;
                    
                    sharpness = 0.2; // Smooth but firm
                }

                // 3. Apply Angle of Attack Tilt
                // We assume "Dragging" (Pulling). 
                // Direction of motion is +toolDx.
                // The Handle (High Z) leads. The Tip (Low Z) trails.
                // So as toolDx increases (forward), Z should increase (go up).
                // Previous was -toolDx (Pushing).
                
                z += toolDx * tiltSlope; // Tilt along the drag axis

                const microNoise = Math.sin(toolDy * 50) * 0.01 + Math.sin(toolDy * 120) * 0.005;
                const damage = (options.baseRandom() > 0.95 ? -1 : 1) * options.baseRandom() * wearMag;
                const striationOffset = options.striationsEnabled
                    ? getStriationOffset(striationProfile, toolDy + sizeMM / 2)
                    : 0;
                
                // Temporarily store potentially valid Z. 
                // We don't clamp with 999 yet, we need to find minZ of the SHAPE first.
                // But we must distinguish "Outside Shape" from "Deep Shape".
                // We use the shape logic result (if z was set to 999 above, it stays 999)
                
                if (z < 500) { // If it was a valid point (not 999)
                    kernel[idx] = z + microNoise + (damage * 0.1) + striationOffset;
                    nominal[idx] = z;
                } else {
                    kernel[idx] = 999;
                }
            }
        }

        // CORRECTION: Normalize Z
        // Find the lowest point (minimum Z) in the kernel (that is not 999)
        // Shift kernel so that minZ = 0.
        // This ensures the "contact point" is what determines depth, not the tool center.
        let minZ = 1000;
        for(let i=0; i<kernel.length; i++) {
            if (kernel[i] < minZ) minZ = kernel[i];
        }
        
        // If valid tool found
        if (minZ < 500) {
            for(let i=0; i<kernel.length; i++) {
                if (kernel[i] < 500) {
                    kernel[i] -= minZ; // Shift up. Now lowest point is 0.
                }
            }
        }

        const { contactPatchLUT, maxProfileDepth } = this.buildContactPatchLUT(kernel, nominal, gridW, gridH, spacing);

        // The kernel is anchored at the centroid of its first contact patch, so the tool path is the line the mark follows.
        const anchorDepth = maxProfileDepth * ANCHOR_DEPTH_FRACTION;
        let contactSumX = 0;
        let contactSumY = 0;
        let contactCells = 0;
        for (let y = 0; y < gridH; y++) {
            for (let x = 0; x < gridW; x++) {
                if (kernel[y * gridW + x] <= anchorDepth) {
                    contactSumX += x;
                    contactSumY += y;
                    contactCells++;
                }
            }
        }
        if (contactCells === 0) {
            throw new Error('tool kernel has no contact cells');
        }

        return {
            profile: kernel,
            width: gridW,
            height: gridH,
            spacingMm: spacing,
            halfSizeMm: halfSize,
            anchorAlongMm: -halfSize + (contactSumX / contactCells) * spacing,
            anchorAcrossMm: -halfSize + (contactSumY / contactCells) * spacing,
            directionDeg,
            tiltSlope,
            sharpness,
            contactPatchLUT,
            maxProfileDepth,
            striationProfile,
            angleDeg,
            type,
            shearEfficiency: shearConfig.shearEfficiency,
            edgeDragFactor: shearConfig.edgeDragFactor
        };
    }

    /**
     * Executes the simulation loop with high-fidelity physics.
     * Generator function yields progress (0-100).
     */
    *simulateCutGenerator(
        startX: number, startY: number, 
        angleDir: number, 
        force: number, 
        toolKernel: ToolKernel,
        materialType: MaterialType,
        materialThicknessMm: number,
        toolHardnessMohs: number,
        speed: number,
        chatterParam: number,
        timeStep: number
    ): Generator<number> {
        this.validateFinite(startX, 'startX');
        this.validateFinite(startY, 'startY');
        this.validateFinite(angleDir, 'angleDir');
        this.validateNonNegativeFinite(force, 'force');
        this.validateToolKernel(toolKernel);
        this.validatePositiveFinite(materialThicknessMm, 'materialThicknessMm');
        this.validateToolHardness(toolHardnessMohs);
        this.validatePositiveFinite(speed, 'speed');
        this.validateRange(chatterParam, 'chatterParam', 0, 1);
        this.validatePositiveFinite(timeStep, 'timeStep');
        this.resetRandom();
        const mat = MATERIALS[materialType];
        if (!mat) {
            throw new Error(`Missing material constants for "${materialType}"`);
        }
        this.validateMaterialConstants(mat, materialType);
        const elasticPlastic = new ElasticPlasticModel(getElasticPlasticMaterial(materialType));
        
        // Physics Loop Parameters
        const totalDist = STROKE_LENGTH_MM; // mm length of cut
        let currentDist = 0;
        
        let cx = startX;
        let cy = startY;
        
        const rad = angleDir * Math.PI / 180;
        const dirX = Math.cos(rad);
        const dirY = Math.sin(rad);

        const velocity = speed; // mm/s
        
        const angleRad = this.degreesToRadians(toolKernel.angleDeg);
        const normalForce = force * Math.sin(angleRad);
        const hardnessFactor = this.computeToolHardnessFactor(toolHardnessMohs, mat.hardnessMPa);
        const effectiveNormalForce = normalForce * hardnessFactor;
        const targetContactAreaMm2 = effectiveNormalForce / mat.hardnessMPa;
        const penetrationScale = Math.sqrt(Math.sin(angleRad));
        const rawPenetration = this.getDepthForContactArea(toolKernel, targetContactAreaMm2, true);
        const penetration = rawPenetration * penetrationScale;
        // Shear acts on the area that carries the load.
        const contactAreaMm2 = penetration > 0 ? targetContactAreaMm2 : 0;
        const shearResponse = this.computeShearResponse(
            force,
            normalForce,
            contactAreaMm2,
            mat,
            toolKernel,
            speed,
            dirX,
            dirY
        );

        // Fracture Threshold
        const fractureThreshold = 0.5;

        let stepsTaken = 0;
        let elapsedTime = 0;
        const maxSpatialStepMm = Math.min(0.05, 1 / (this.surface.resolution * 2));
        // Steps far below the grid spacing add cost without adding detail.
        const minSpatialStepMm = maxSpatialStepMm / 8;
        const pathSampleStep = 0.25;
        let lastSampleDist = -pathSampleStep;
        this.toolPath = [];
        this.surfaceDetailMap = null;
        this.toolPath.push({ x: cx, y: cy, toolZ: -penetration, time: 0 });
        
        // CORRECTION 2: Natural Frequency Chatter
        // Chatter is a temporal vibration (Hz).
        // Natural freq of hand/tool system approx 50-100Hz?
        // Let's say 20Hz base freq for visible wobbles.
        const naturalFreq = 20 + (chatterParam * 50); // Hz
        let chatterPhase = 0;

        const summary = this.beginPass();
        let lastYieldTime = performance.now();

        const tremorPhases = HAND_TREMOR_COMPONENTS.map(() => this.random() * 2 * Math.PI);
        const lateralOffsetAt = (time: number) => {
            let offset = 0;
            for (let i = 0; i < HAND_TREMOR_COMPONENTS.length; i++) {
                const component = HAND_TREMOR_COMPONENTS[i];
                offset += component.amplitudeMm * (
                    Math.sin(2 * Math.PI * component.frequencyHz * time + tremorPhases[i]) - Math.sin(tremorPhases[i])
                );
            }
            return offset;
        };
        // The tool is pressed into the surface once per stamp spacing of travel. Shorter time steps refine
        // the timing of chatter and tremor without multiplying the carving work.
        let sinceStampMm = 0;
        let stamped = false;
        const stamp = (penetrationDepth: number) => {
            // 1. Carve
            this.carvedCount = 0;
            if (penetrationDepth > 0) {
                const characteristicLength = this.getCharacteristicLength(toolKernel, penetrationDepth, true);
                const substepScale = stamped ? Math.min(1, sinceStampMm / maxSpatialStepMm) : 1;
                // The trailing edge swept the distance travelled since the previous stamp.
                this.applyKernel(cx, cy, -penetrationDepth, toolKernel, mat, materialThicknessMm, elasticPlastic, characteristicLength, shearResponse, substepScale, sinceStampMm, 'plough');
            }

            // 2. Fracture
            // Cracks are spawned per millimetre of travel so their density does not depend on the step size.
            if (
                mat.brittleness > 0.5 &&
                penetrationDepth > fractureThreshold &&
                this.carvedCount > 0 &&
                this.random() < CRACKS_PER_MM * mat.brittleness * sinceStampMm
            ) {
                // A crack starts in material the tool is cutting right now, not under a gap in the tool.
                const origin = this.carvedIndex[Math.floor(this.random() * this.carvedCount)];
                const originX = origin % this.surface.width;
                const originY = (origin - originX) / this.surface.width;
                const side = this.random() < 0.5 ? -1 : 1;
                this.generateCrack(
                    (originX + 0.5) / this.surface.resolution,
                    (originY + 0.5) / this.surface.resolution,
                    dirX,
                    dirY,
                    side,
                    penetrationDepth * 2,
                    mat,
                    materialThicknessMm,
                    shearResponse
                );
            }
            sinceStampMm = 0;
            stamped = true;
        };
        let penetrationDepth = penetration;

        while (totalDist - currentDist > 1e-9) {
            const tickDistance = Math.min(Math.max(velocity * timeStep, minSpatialStepMm), totalDist - currentDist);
            const substepCount = Math.max(1, Math.ceil(tickDistance / maxSpatialStepMm));
            const stepDistance = tickDistance / substepCount;
            const stepDuration = (tickDistance / velocity) / substepCount;

            for (let substep = 0; substep < substepCount; substep++) {
                // Chatter / Stick-Slip Update
                // Phase increment = 2*PI * freq * dt
                // dt is the user-configured time step, subdivided only when needed to
                // keep deformation samples spatially stable along the cut.
                const phaseStep = 2 * Math.PI * naturalFreq * stepDuration;
                chatterPhase += phaseStep;

                // Vibration swings the load, and the depth follows the same contact law as the steady force.
                const forceScale = 1 + Math.sin(chatterPhase) * chatterParam * CHATTER_FORCE_MODULATION;
                penetrationDepth = penetration > 0
                    ? this.getDepthForContactArea(toolKernel, targetContactAreaMm2 * forceScale, true) * penetrationScale
                    : 0;

                if (!stamped || sinceStampMm >= maxSpatialStepMm - 1e-9) {
                    stamp(penetrationDepth);
                }

                if (currentDist - lastSampleDist >= pathSampleStep) {
                    this.toolPath.push({ x: cx, y: cy, toolZ: -penetrationDepth, time: elapsedTime });
                    lastSampleDist = currentDist;
                }

                // 3. Move
                currentDist += stepDistance;
                sinceStampMm += stepDistance;
                stepsTaken++;
                elapsedTime += stepDuration;
                const lateralOffset = lateralOffsetAt(elapsedTime);
                cx = startX + dirX * currentDist - dirY * lateralOffset;
                cy = startY + dirY * currentDist + dirX * lateralOffset;

                // Yield on a time budget so the caller can keep the UI responsive whatever the kernel size.
                if (stepsTaken % 8 === 0 && performance.now() - lastYieldTime >= YIELD_INTERVAL_MS) {
                    yield (currentDist / totalDist) * 90; // Go up to 90%
                    lastYieldTime = performance.now();
                }
            }
        }

        // The end of the stroke gets its own stamp, so the mark reaches the last path point.
        if (sinceStampMm > 0) {
            stamp(penetrationDepth);
        }

        this.toolPath.push({ x: cx, y: cy, toolZ: this.toolPath[this.toolPath.length - 1].toolZ, time: elapsedTime });

        this.finishPass(summary);

        if (penetration > 0) {
            this.surfaceDetailMap = this.createSurfaceDetailMap(
                startX,
                startY,
                angleDir,
                totalDist,
                toolKernel,
                penetration,
                this.getDepthForContactArea(toolKernel, targetContactAreaMm2 * (1 + chatterParam * CHATTER_FORCE_MODULATION), true) * penetrationScale,
                chatterParam,
                shearResponse
            );
        }

        yield 100;
    }

    /**
     * A single blow: the tool is driven straight into the surface and lifts off again.
     * The blow's energy is spent as plastic work against the material's hardness (Tabor's dynamic
     * hardness), so the impression displaces a volume of energy / hardness.
     */
    *simulateStrikeGenerator(
        x: number,
        y: number,
        energyJ: number,
        toolKernel: ToolKernel,
        materialType: MaterialType,
        materialThicknessMm: number,
        toolHardnessMohs: number
    ): Generator<number> {
        this.validateFinite(x, 'x');
        this.validateFinite(y, 'y');
        this.validateNonNegativeFinite(energyJ, 'energyJ');
        this.validateToolKernel(toolKernel);
        this.validatePositiveFinite(materialThicknessMm, 'materialThicknessMm');
        this.validateToolHardness(toolHardnessMohs);
        this.resetRandom();
        const mat = MATERIALS[materialType];
        if (!mat) {
            throw new Error(`Missing material constants for "${materialType}"`);
        }
        this.validateMaterialConstants(mat, materialType);
        const elasticPlastic = new ElasticPlasticModel(getElasticPlasticMaterial(materialType));

        // Only the velocity component normal to the surface indents, and energy goes with velocity squared.
        const normalShare = Math.sin(this.degreesToRadians(toolKernel.angleDeg)) ** 2;
        const hardnessFactor = this.computeToolHardnessFactor(toolHardnessMohs, mat.hardnessMPa);
        const plasticWorkNmm = energyJ * 1000 * normalShare * hardnessFactor;
        const penetration = this.getDepthForDisplacedVolume(toolKernel, plasticWorkNmm / mat.hardnessMPa);

        const summary = this.beginPass();
        this.toolPath = [];
        this.surfaceDetailMap = null;
        yield 10;

        if (penetration > 0) {
            const yawRad = this.degreesToRadians(toolKernel.directionDeg);
            const restingContact: ShearResponse = {
                stressRatio: 0,
                lateralDisplacement: 0,
                smearDepth: 0,
                prowFraction: 0,
                tearRoughness: 0,
                trailingX: -Math.cos(yawRad),
                trailingY: -Math.sin(yawRad)
            };
            this.applyKernel(
                x,
                y,
                -penetration,
                toolKernel,
                mat,
                materialThicknessMm,
                elasticPlastic,
                this.getCharacteristicLength(toolKernel, penetration, false),
                restingContact,
                1,
                0,
                'indent'
            );
        }
        yield 90;

        this.toolPath = [
            { x, y, toolZ: STRIKE_APPROACH_HEIGHT_MM, time: 0 },
            { x, y, toolZ: -penetration, time: STRIKE_PLAYBACK_SECONDS * 0.4 },
            { x, y, toolZ: -penetration, time: STRIKE_PLAYBACK_SECONDS * 0.5 },
            { x, y, toolZ: STRIKE_REBOUND_HEIGHT_MM, time: STRIKE_PLAYBACK_SECONDS },
        ];
        this.finishPass(summary);

        yield 100;
    }

    private beginPass(): CutSummary {
        this.maxSurfaceHeight = this.findMaxSurfaceHeight();
        this.passHighestPileUp = 0;
        if (!this.passTouched) {
            this.passTouched = new Uint8Array(this.surface.data.length);
        } else {
            this.passTouched.fill(0);
        }
        const summary: CutSummary = { maxCutDepthMm: 0, maxPileUpMm: 0, carvedVolumeMm3: 0, detachedCells: 0 };
        this.cutSummary = summary;
        return summary;
    }

    // Depth and pile-up are read from the finished surface, after smear and pile-up have settled.
    private finishPass(summary: CutSummary) {
        const touched = this.passTouched;
        if (!touched) {
            throw new Error('finishPass called before beginPass');
        }
        const data = this.surface.data;
        let lowest = 0;
        for (let i = 0; i < data.length; i++) {
            if (touched[i] && !this.detached[i] && data[i] < lowest) {
                lowest = data[i];
            }
        }
        summary.maxCutDepthMm = -lowest;
        summary.maxPileUpMm = this.passHighestPileUp;
    }

    // The depth at which the tool, pressed into a flat surface, has displaced the given volume.
    private getDepthForDisplacedVolume(kernel: ToolKernel, targetVolumeMm3: number): number {
        this.validateNonNegativeFinite(targetVolumeMm3, 'targetVolumeMm3');
        if (targetVolumeMm3 === 0) {
            return 0;
        }
        const profile = kernel.profile;
        const sampleAreaMm2 = kernel.spacingMm * kernel.spacingMm;
        const volumeAt = (depth: number) => {
            let sum = 0;
            for (let i = 0; i < profile.length; i++) {
                if (profile[i] < depth) {
                    sum += depth - profile[i];
                }
            }
            return sum * sampleAreaMm2;
        };
        if (volumeAt(kernel.maxProfileDepth) <= targetVolumeMm3) {
            return kernel.maxProfileDepth;
        }
        let low = 0;
        let high = kernel.maxProfileDepth;
        for (let i = 0; i < 40; i++) {
            const mid = (low + high) / 2;
            if (volumeAt(mid) < targetVolumeMm3) {
                low = mid;
            } else {
                high = mid;
            }
        }
        return (low + high) / 2;
    }

    // Presses the tool into the surface at one position. The tool height over each surface cell is
    // interpolated from the tool grid at the cell's exact position under the tool, so the mark does not
    // depend on how the path or the tool edges line up with the surface grid.
    private applyKernel(
        cx: number,
        cy: number,
        cz: number,
        kernel: ToolKernel,
        mat: MaterialConstants,
        materialThicknessMm: number,
        elasticPlastic: ElasticPlasticModel,
        characteristicLength: number,
        shearResponse: ShearResponse,
        substepScale: number,
        sweepBackMm: number,
        pileUp: 'plough' | 'indent'
    ) {
        this.validateMaterialConstants(mat, 'material');
        this.validatePositiveFinite(materialThicknessMm, 'materialThicknessMm');
        this.validateRange(substepScale, 'substepScale', 0, 1);
        this.validateNonNegativeFinite(sweepBackMm, 'sweepBackMm');
        const res = this.surface.resolution;
        const cellAreaMm2 = 1 / (res * res);

        let displacedVolume = 0;
        let flowVolume = 0;
        let freshVolume = 0;
        let smearVolume = 0;
        this.carvedCount = 0;
        // How much material flows vs flies away? Pressing straight in cuts no chips: what does not flow is compacted.
        const chipRatio = kernel.sharpness * mat.brittleness; // 0 to 1
        const virginFlowFraction = pileUp === 'plough' ? mat.flow * (1 - chipRatio) : mat.flow;

        // Tearing and chipping leave the cut rough. The roughness is fixed to the surface position, so pressing
        // the tool over the same spot again leaves the same surface instead of carving it a second time.
        const tearAmount = (chipRatio > 0.5 ? chipRatio * CHIP_ROUGHNESS_MM : 0) + shearResponse.tearRoughness;
        const tearDepthShare = Math.min(1, tearAmount / MAX_TEAR_ROUGHNESS_MM) * TEAR_DEPTH_FRACTION;

        const elasticStrainLimit = elasticPlastic.getInitialElasticStrainLimit();
        // No cell can be pressed deeper than the gap between the highest surface point and the tool tip,
        // so a stamp that stays elastic there stays elastic everywhere.
        if ((this.maxSurfaceHeight - cz) / characteristicLength <= elasticStrainLimit) {
            return;
        }
        // Only the part of the tool low enough to reach the highest point of the surface can touch it.
        const region = this.getActiveKernelRegion(kernel, this.maxSurfaceHeight - cz);
        const surfaceWidth = this.surface.width;
        const surfaceHeight = this.surface.height;
        const data = this.surface.data;
        const profile = kernel.profile;
        const kernelWidth = kernel.width;
        const lastCell = kernel.width - 2;
        const halfSize = kernel.halfSizeMm;
        const invSpacing = 1 / kernel.spacingMm;
        const yawRad = this.degreesToRadians(kernel.directionDeg);
        const cosYaw = Math.cos(yawRad);
        const sinYaw = Math.sin(yawRad);

        // Pass 1: Carve
        for (let band = 0; band < region.bandCount; band++) {
        const acrossLow = region.bounds[band * 4];
        const acrossHigh = region.bounds[band * 4 + 1];
        // The trailing edge is often the lowest line of the tool. A cell it passed over since the last stamp
        // is cut to the edge height, as if the tool had swept over it continuously.
        const sweepsTrailingEdge = region.bounds[band * 4 + 2] <= -halfSize + TOOL_BOUND_EPSILON_MM;
        const alongLow = sweepsTrailingEdge ? -halfSize - sweepBackMm : region.bounds[band * 4 + 2];
        const alongHigh = region.bounds[band * 4 + 3];

        // Rows of the surface grid that the band covers.
        let minDy = Infinity;
        let maxDy = -Infinity;
        for (let corner = 0; corner < 4; corner++) {
            const along = (corner & 1 ? alongHigh : alongLow) - kernel.anchorAlongMm;
            const across = (corner & 2 ? acrossHigh : acrossLow) - kernel.anchorAcrossMm;
            const dy = along * sinYaw + across * cosYaw;
            if (dy < minDy) minDy = dy;
            if (dy > maxDy) maxDy = dy;
        }
        const firstRow = Math.max(0, Math.ceil((cy + minDy) * res - 1e-9));
        const lastRow = Math.min(surfaceHeight - 1, Math.floor((cy + maxDy) * res + 1e-9));

        for (let mapY = firstRow; mapY <= lastRow; mapY++) {
            // Along this row: along = alongAtZero + x * cosYaw, across = acrossAtZero - x * sinYaw (x in mm).
            const dy = mapY / res - cy;
            const alongAtZero = -cx * cosYaw + dy * sinYaw + kernel.anchorAlongMm;
            const acrossAtZero = cx * sinYaw + dy * cosYaw + kernel.anchorAcrossMm;
            let xLow = -Infinity;
            let xHigh = Infinity;
            if (Math.abs(cosYaw) > 1e-12) {
                const a = (alongLow - alongAtZero) / cosYaw;
                const b = (alongHigh - alongAtZero) / cosYaw;
                xLow = Math.max(xLow, Math.min(a, b));
                xHigh = Math.min(xHigh, Math.max(a, b));
            } else if (alongAtZero < alongLow || alongAtZero > alongHigh) {
                continue;
            }
            if (Math.abs(sinYaw) > 1e-12) {
                const a = (acrossAtZero - acrossLow) / sinYaw;
                const b = (acrossAtZero - acrossHigh) / sinYaw;
                xLow = Math.max(xLow, Math.min(a, b));
                xHigh = Math.min(xHigh, Math.max(a, b));
            } else if (acrossAtZero < acrossLow || acrossAtZero > acrossHigh) {
                continue;
            }
            const firstColumn = Math.max(0, Math.ceil(xLow * res - 1e-9));
            const lastColumn = Math.min(surfaceWidth - 1, Math.floor(xHigh * res + 1e-9));
            const rowIdx = mapY * surfaceWidth;

            for (let mapX = firstColumn; mapX <= lastColumn; mapX++) {
                const idx = rowIdx + mapX;
                if (this.detached[idx]) {
                    continue;
                }
                const x = mapX / res;
                let along = alongAtZero + x * cosYaw;
                const across = acrossAtZero - x * sinYaw;
                if (along < -halfSize) {
                    along = -halfSize;
                }
                const gridX = (along + halfSize) * invSpacing;
                const gridY = (across + halfSize) * invSpacing;
                const cellX = Math.max(0, Math.min(lastCell, Math.floor(gridX)));
                const cellY = Math.max(0, Math.min(lastCell, Math.floor(gridY)));
                const fx = Math.max(0, Math.min(1, gridX - cellX));
                const fy = Math.max(0, Math.min(1, gridY - cellY));
                const k = cellY * kernelWidth + cellX;
                const z00 = profile[k];
                const z10 = profile[k + 1];
                const z01 = profile[k + kernelWidth];
                const z11 = profile[k + kernelWidth + 1];
                // A cell that reaches past the tool's outline (round tips, the gap between claws) is not under the tool.
                if (z00 + z10 + z01 + z11 >= 500) {
                    continue;
                }
                let toolHeight = cz + z00 + (z10 - z00) * fx + (z01 - z00) * fy + (z00 - z10 - z01 + z11) * fx * fy;
                const currentHeight = data[idx];

                if (toolHeight < currentHeight) {
                    if (tearDepthShare > 0 && toolHeight < 0) {
                        toolHeight += this.coordinateNoise(x + 0.173, mapY / res + 0.719) * -toolHeight * tearDepthShare;
                        if (toolHeight >= currentHeight) {
                            continue;
                        }
                    }
                    const penetration = currentHeight - toolHeight;
                    // Hardening only raises the elastic limit, so strain below the initial limit leaves no mark.
                    if (penetration / characteristicLength <= elasticStrainLimit) {
                        continue;
                    }
                    const currentPlasticStrain = this.plasticStrain[idx];
                    let freshFraction = 1;
                    const result = elasticPlastic.computePermanentDepth(
                        penetration,
                        characteristicLength,
                        currentPlasticStrain
                    );

                    if (result.permanentDepth > 0) {
                        displacedVolume += result.permanentDepth * cellAreaMm2;
                        data[idx] = currentHeight - result.permanentDepth;
                        // A cut as deep as the plate is thick has gone through it.
                        if (data[idx] <= -materialThicknessMm) {
                            this.recordCarvedCell(idx, 0, along, across);
                            this.detachCell(mapX, mapY, cellAreaMm2, materialThicknessMm, result.permanentDepth, mat, shearResponse);
                            continue;
                        }
                        // Loose material resting on the cell was piled up or smeared there earlier: it has already
                        // flowed once and moves on whole, so only the plate itself loses a share to chips and smear.
                        const looseDepth = Math.min(result.permanentDepth, this.looseHeight[idx]);
                        this.looseHeight[idx] -= looseDepth;
                        const freshDepth = result.permanentDepth - looseDepth;
                        const flowDepth = looseDepth + freshDepth * virginFlowFraction;
                        flowVolume += flowDepth * cellAreaMm2;
                        freshVolume += freshDepth * cellAreaMm2;
                        this.recordCarvedCell(idx, flowDepth, along, across);
                        smearVolume += this.applyShearSmear(mapX, mapY, freshDepth, shearResponse) * cellAreaMm2;
                        // Pushing loose material aside does not strain or damage the plate underneath.
                        freshFraction = freshDepth / result.permanentDepth;
                        if (freshDepth > 0) {
                            this.accumulateDamage(
                                mapX,
                                mapY,
                                penetration * freshFraction,
                                freshDepth,
                                result.plasticStrainIncrement * freshFraction,
                                characteristicLength,
                                cellAreaMm2,
                                materialThicknessMm,
                                mat,
                                shearResponse,
                                substepScale
                            );
                        }
                    }

                    if (result.plasticStrainIncrement > 0) {
                        this.plasticStrain[idx] = currentPlasticStrain + result.plasticStrainIncrement * freshFraction;
                    }
                }
            }
        }
        }

        // Pass 2: Pile-up vs Chip Formation (New)
        if (displacedVolume > 0) {
            // Loose material pushed along by the tool is cut again and again; only the plate itself counts.
            if (this.cutSummary) {
                this.cutSummary.carvedVolumeMm3 += freshVolume;
            }
            // Smeared material was already put back on the surface, so it is not piled up a second time.
            if (flowVolume > smearVolume) {
                if (pileUp === 'plough') {
                    this.depositPileUp(1 - smearVolume / flowVolume, -cz, shearResponse, kernel, cx, cy);
                } else {
                    this.depositIndentationPileUp(1 - smearVolume / flowVolume, cz, characteristicLength, kernel, cx, cy);
                }
            }
        }
    }

    private findMaxSurfaceHeight(): number {
        const data = this.surface.data;
        let max = -Infinity;
        for (let i = 0; i < data.length; i++) {
            if (data[i] > max) max = data[i];
        }
        return max;
    }

    private getActiveKernelRegion(kernel: ToolKernel, requiredProfile: number): ActiveKernelRegion {
        const cached = this.activeKernelRegions.get(kernel);
        if (cached && cached.threshold >= requiredProfile) {
            return cached;
        }

        const threshold = requiredProfile + ACTIVE_CELL_MARGIN_MM;
        const kernelProfile = kernel.profile;
        const gridCells = kernel.height - 1;
        const maxBands = Math.min(ACTIVE_REGION_BANDS, gridCells);
        const bounds = new Float64Array(maxBands * 4);
        const toMm = (cell: number) => Math.max(-kernel.halfSizeMm, Math.min(kernel.halfSizeMm, -kernel.halfSizeMm + cell * kernel.spacingMm));
        let bandCount = 0;

        for (let band = 0; band < maxBands; band++) {
            // Grid cells [firstCell, lastCell) across the tool; their corners are rows firstCell..lastCell.
            const firstCell = Math.floor(band * gridCells / maxBands);
            const lastCell = Math.floor((band + 1) * gridCells / maxBands);
            let minX = Infinity;
            let maxX = -Infinity;
            for (let y = firstCell; y <= lastCell; y++) {
                const row = y * kernel.width;
                for (let x = 0; x < kernel.width; x++) {
                    if (kernelProfile[row + x] < threshold) {
                        if (x < minX) minX = x;
                        if (x > maxX) maxX = x;
                    }
                }
            }
            if (minX > maxX) {
                continue;
            }
            // Between samples the interpolated tool can only be this low next to a sample that is, so one cell of margin covers it.
            bounds[bandCount * 4] = toMm(firstCell);
            bounds[bandCount * 4 + 1] = toMm(lastCell);
            bounds[bandCount * 4 + 2] = toMm(minX - 1);
            bounds[bandCount * 4 + 3] = toMm(maxX + 1);
            bandCount++;
        }

        const region: ActiveKernelRegion = { threshold, bandCount, bounds };
        this.activeKernelRegions.set(kernel, region);
        return region;
    }

    private recordCarvedCell(idx: number, flowDepth: number, alongMm: number, acrossMm: number) {
        if (!this.carvedSlot) {
            this.carvedSlot = new Int32Array(this.surface.data.length);
        }
        if (this.carvedCount === this.carvedIndex.length) {
            const capacity = this.carvedIndex.length * 2;
            const index = new Int32Array(capacity);
            index.set(this.carvedIndex);
            this.carvedIndex = index;
            const grow = (values: Float64Array) => {
                const grown = new Float64Array(capacity);
                grown.set(values);
                return grown;
            };
            this.carvedFlowDepth = grow(this.carvedFlowDepth);
            this.carvedAlong = grow(this.carvedAlong);
            this.carvedAcross = grow(this.carvedAcross);
        }
        this.carvedIndex[this.carvedCount] = idx;
        this.carvedFlowDepth[this.carvedCount] = flowDepth;
        this.carvedAlong[this.carvedCount] = alongMm;
        this.carvedAcross[this.carvedCount] = acrossMm;
        this.carvedSlot[idx] = this.carvedCount;
        this.carvedCount++;
        if (this.passTouched) {
            this.passTouched[idx] = 1;
        }
    }

    private getCarvedSlot(idx: number): number {
        if (!this.carvedSlot) {
            return -1;
        }
        const slot = this.carvedSlot[idx];
        return slot < this.carvedCount && this.carvedIndex[slot] === idx ? slot : -1;
    }

    // Displaced material is pushed ahead of the tool as a prow; what the prow cannot hold escapes
    // sideways into ridges along the groove. Nothing is put back behind the tool, in the fresh cut.
    // The edges of the contact are found in tool coordinates, so the ridges do not depend on the drag direction.
    private depositPileUp(
        flowScale: number,
        penetrationDepth: number,
        shearResponse: ShearResponse,
        kernel: ToolKernel,
        cx: number,
        cy: number
    ) {
        const count = this.carvedCount;
        const res = this.surface.resolution;
        const binMm = 1 / res;
        const along = this.carvedAlong;
        const across = this.carvedAcross;
        let minAlong = Infinity;
        let maxAlong = -Infinity;
        let minAcross = Infinity;
        let maxAcross = -Infinity;
        for (let slot = 0; slot < count; slot++) {
            if (along[slot] < minAlong) minAlong = along[slot];
            if (along[slot] > maxAlong) maxAlong = along[slot];
            if (across[slot] < minAcross) minAcross = across[slot];
            if (across[slot] > maxAcross) maxAcross = across[slot];
        }

        // The carved cells, binned on a grid aligned with the tool.
        const alongBins = Math.round((maxAlong - minAlong) * res) + 1;
        const acrossBins = Math.round((maxAcross - minAcross) * res) + 1;
        const binCount = alongBins * acrossBins;
        if (this.contactOccupied.length < binCount) {
            this.contactOccupied = new Uint8Array(binCount * 2);
            this.contactSideLow = new Int32Array(binCount * 2);
            this.contactSideHigh = new Int32Array(binCount * 2);
            this.contactFront = new Int32Array(binCount * 2);
        }
        const occupied = this.contactOccupied;
        const sideLow = this.contactSideLow;
        const sideHigh = this.contactSideHigh;
        const front = this.contactFront;
        occupied.fill(0, 0, binCount);
        for (let slot = 0; slot < count; slot++) {
            const a = Math.round((along[slot] - minAlong) * res);
            const b = Math.round((across[slot] - minAcross) * res);
            occupied[a * acrossBins + b] = 1;
        }

        // Runs of contact across the tool at each position along it. The surface grid is turned against
        // the tool, so a single empty bin inside a run is a sampling gap, not an edge.
        for (let a = 0; a < alongBins; a++) {
            const row = a * acrossBins;
            let runStart = -1;
            for (let b = 0; b <= acrossBins; b++) {
                const filled = b < acrossBins && (
                    occupied[row + b] === 1 ||
                    (b > 0 && b + 1 < acrossBins && occupied[row + b - 1] === 1 && occupied[row + b + 1] === 1)
                );
                if (filled) {
                    if (runStart < 0) runStart = b;
                } else if (runStart >= 0) {
                    for (let k = runStart; k < b; k++) {
                        sideLow[row + k] = runStart;
                        sideHigh[row + k] = b - 1;
                    }
                    runStart = -1;
                }
            }
        }
        // Front of the contact at each position across the tool.
        for (let b = 0; b < acrossBins; b++) {
            let runFront = -1;
            for (let a = alongBins - 1; a >= 0; a--) {
                const bin = a * acrossBins + b;
                const filled = occupied[bin] === 1 ||
                    (a > 0 && a + 1 < alongBins && occupied[bin - acrossBins] === 1 && occupied[bin + acrossBins] === 1);
                if (filled) {
                    if (runFront < 0) runFront = a;
                    front[bin] = runFront;
                } else {
                    runFront = -1;
                }
            }
        }

        const width = this.surface.width;
        const height = this.surface.height;
        const data = this.surface.data;
        const yawRad = this.degreesToRadians(kernel.directionDeg);
        const cosYaw = Math.cos(yawRad);
        const sinYaw = Math.sin(yawRad);
        const prowHeightLimit = PROW_HEIGHT_DEPTHS * penetrationDepth;
        // Only material within reach of the groove edge flows sideways; the rest leaves as chips.
        const sideFlowReachCells = Math.max(2, SIDE_FLOW_REACH_DEPTHS * penetrationDepth * res);
        // Each cell drops its share at four points across the ridge width. The points are shifted from cell
        // to cell so that together they fill the width evenly.
        const ringSpacingCells = Math.max(1, RIDGE_WIDTH_DEPTHS * penetrationDepth * res / PILE_UP_RING_WEIGHTS.length);

        for (let slot = 0; slot < count; slot++) {
            const a = Math.round((along[slot] - minAlong) * res);
            const b = Math.round((across[slot] - minAcross) * res);
            const bin = a * acrossBins + b;
            const flowDepth = this.carvedFlowDepth[slot] * flowScale;
            const alongOffset = along[slot] - kernel.anchorAlongMm;
            const acrossOffset = across[slot] - kernel.anchorAcrossMm;

            // Prow: filled first, up to its height limit. What it cannot hold joins the sideways flow.
            const prowBudget = flowDepth * shearResponse.prowFraction;
            let sideDepth = flowDepth - prowBudget;
            if (prowBudget > 0) {
                let prowLeft = prowBudget;
                for (let ring = 0; ring < PILE_UP_RING_WEIGHTS.length; ring++) {
                    const targetAlong = minAlong + (front[bin] + 1 + ring) * binMm - kernel.anchorAlongMm;
                    const x = Math.round((cx + targetAlong * cosYaw - acrossOffset * sinYaw) * res);
                    const y = Math.round((cy + targetAlong * sinYaw + acrossOffset * cosYaw) * res);
                    if (x < 0 || x >= width || y < 0 || y >= height) {
                        continue;
                    }
                    const amount = Math.min(
                        prowBudget * PILE_UP_RING_WEIGHTS[ring] / PILE_UP_WEIGHT_SUM,
                        prowHeightLimit - data[y * width + x]
                    );
                    if (amount > 0 && this.safeAdd(x, y, amount)) {
                        prowLeft -= amount;
                    }
                }
                sideDepth += prowLeft;
            }

            // Ridges on both sides of the contact.
            for (let side = 0; side < 2; side++) {
                const edgeBin = side === 0 ? sideHigh[bin] : sideLow[bin];
                const outward = side === 0 ? 1 : -1;
                const ridgeDepth = sideDepth / 2 * Math.max(0, 1 - Math.abs(edgeBin - b) / sideFlowReachCells);
                if (ridgeDepth <= 0) {
                    continue;
                }
                const shift = ringSpacingCells > 1
                    ? this.coordinateNoise(along[slot] + cx + side, across[slot] + cy)
                    : 0;
                for (let ring = 0; ring < PILE_UP_RING_WEIGHTS.length; ring++) {
                    const ringCells = 1 + (ring + shift) * ringSpacingCells;
                    const targetAcross = minAcross + (edgeBin + outward * ringCells) * binMm - kernel.anchorAcrossMm;
                    this.safeAdd(
                        Math.round((cx + alongOffset * cosYaw - targetAcross * sinYaw) * res),
                        Math.round((cy + alongOffset * sinYaw + targetAcross * cosYaw) * res),
                        ridgeDepth * PILE_UP_RING_WEIGHTS[ring] / PILE_UP_WEIGHT_SUM
                    );
                }
            }
        }
    }

    // Pressing straight in squeezes material out around the impression. Each carved cell feeds the nearest
    // point of the rim, and only material within reach of the rim gets out; the rest is compacted below.
    // The rim then spreads outwards as a bank that is highest at the impression and falls away from it.
    private depositIndentationPileUp(
        flowScale: number,
        toolZ: number,
        contactSizeMm: number,
        kernel: ToolKernel,
        cx: number,
        cy: number
    ) {
        const penetrationDepth = -toolZ;
        const count = this.carvedCount;
        const width = this.surface.width;
        const height = this.surface.height;
        const data = this.surface.data;
        const reachCells = Math.max(2, SIDE_FLOW_REACH_DEPTHS * penetrationDepth * this.surface.resolution);
        const heightLimit = INDENT_RIM_HEIGHT_DEPTHS * penetrationDepth;
        const rimWidthCells = Math.max(
            2,
            Math.ceil(Math.max(RIDGE_WIDTH_DEPTHS * penetrationDepth, INDENT_RIM_WIDTH_CONTACT_SHARE * contactSizeMm) * this.surface.resolution)
        );
        const neighbourX = [1, -1, 0, 0];
        const neighbourY = [0, 0, 1, -1];

        // The rim: cells next to the impression that the tool did not press in. Each carved cell is given
        // the rim cell nearest to it. Neighbours hand each other candidates until nobody finds a nearer one.
        const rimSupply = new Map<number, number>();
        const nearestRim = new Int32Array(count).fill(EDGE_UNSET);
        const rimDistance = new Float64Array(count).fill(Infinity);
        const pending: number[] = [];
        let minX = width;
        let maxX = -1;
        let minY = height;
        let maxY = -1;
        for (let slot = 0; slot < count; slot++) {
            const idx = this.carvedIndex[slot];
            const x = idx % width;
            const y = (idx - x) / width;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
            for (let n = 0; n < 4; n++) {
                const nx = x + neighbourX[n];
                const ny = y + neighbourY[n];
                if (nx < 0 || nx >= width || ny < 0 || ny >= height) {
                    continue;
                }
                const neighbour = ny * width + nx;
                if (this.getCarvedSlot(neighbour) < 0 && !this.detached[neighbour]) {
                    // Every rim cell takes part in sharing out the material, also those that collect none.
                    rimSupply.set(neighbour, 0);
                    if (nearestRim[slot] === EDGE_UNSET) {
                        nearestRim[slot] = neighbour;
                        rimDistance[slot] = 1;
                        pending.push(slot);
                    }
                }
            }
        }
        for (let head = 0; head < pending.length; head++) {
            const slot = pending[head];
            const idx = this.carvedIndex[slot];
            const x = idx % width;
            const y = (idx - x) / width;
            const rim = nearestRim[slot];
            const rimX = rim % width;
            const rimY = (rim - rimX) / width;
            if (rimDistance[slot] >= reachCells) {
                continue;
            }
            for (let n = 0; n < 4; n++) {
                const nx = x + neighbourX[n];
                const ny = y + neighbourY[n];
                if (nx < 0 || nx >= width || ny < 0 || ny >= height) {
                    continue;
                }
                const neighbourSlot = this.getCarvedSlot(ny * width + nx);
                if (neighbourSlot < 0) {
                    continue;
                }
                const distance = Math.hypot(rimX - nx, rimY - ny);
                if (distance < rimDistance[neighbourSlot] - 1e-6) {
                    nearestRim[neighbourSlot] = rim;
                    rimDistance[neighbourSlot] = distance;
                    pending.push(neighbourSlot);
                }
            }
        }

        // What each rim cell collects is the material that flows out there.
        let totalSupply = 0;
        for (let slot = 0; slot < count; slot++) {
            if (nearestRim[slot] === EDGE_UNSET) {
                continue;
            }
            const share = this.carvedFlowDepth[slot] * flowScale * Math.max(0, 1 - rimDistance[slot] / reachCells);
            if (share > 0) {
                rimSupply.set(nearestRim[slot], (rimSupply.get(nearestRim[slot]) ?? 0) + share);
                totalSupply += share;
            }
        }
        if (totalSupply <= 0) {
            return;
        }

        // Deep inside the impression many rim cells are almost equally near, so a few of them collect the
        // material of whole sectors. Material that travels far also spreads sideways on the way: averaging
        // along the rim, over a stretch that grows with the reach, shares it out.
        const smoothingPasses = Math.min(MAX_RIM_SMOOTHING_PASSES, Math.max(MIN_RIM_SMOOTHING_PASSES, Math.round(2 * reachCells)));
        let smoothed = rimSupply;
        for (let pass = 0; pass < smoothingPasses; pass++) {
            const next = new Map<number, number>();
            for (const [rim, supply] of smoothed) {
                const x = rim % width;
                let sum = supply;
                let members = 1;
                for (let n = 0; n < NEIGHBOUR_DX.length; n++) {
                    const nx = x + NEIGHBOUR_DX[n];
                    if (nx < 0 || nx >= width) {
                        continue;
                    }
                    const neighbourSupply = smoothed.get(rim + NEIGHBOUR_DY[n] * width + NEIGHBOUR_DX[n]);
                    if (neighbourSupply !== undefined) {
                        sum += neighbourSupply;
                        members++;
                    }
                }
                next.set(rim, sum / members);
            }
            smoothed = next;
        }

        // The bank: every free cell within the rim width takes the supply of its nearest rim cell and
        // stands lower the farther out it is. The search runs in a window around the impression.
        const windowX = Math.max(0, minX - rimWidthCells - 1);
        const windowY = Math.max(0, minY - rimWidthCells - 1);
        const windowWidth = Math.min(width - 1, maxX + rimWidthCells + 1) - windowX + 1;
        const windowHeight = Math.min(height - 1, maxY + rimWidthCells + 1) - windowY + 1;
        const bankRim = new Int32Array(windowWidth * windowHeight).fill(EDGE_UNSET);
        const bankDistance = new Float64Array(windowWidth * windowHeight).fill(Infinity);
        const bankQueue: number[] = [];
        for (const rim of smoothed.keys()) {
            const x = rim % width;
            const y = (rim - x) / width;
            const cell = (y - windowY) * windowWidth + (x - windowX);
            bankRim[cell] = rim;
            bankDistance[cell] = 0;
            bankQueue.push(cell);
        }
        for (let head = 0; head < bankQueue.length; head++) {
            const cell = bankQueue[head];
            const localX = cell % windowWidth;
            const localY = (cell - localX) / windowWidth;
            const rim = bankRim[cell];
            const rimX = rim % width;
            const rimY = (rim - rimX) / width;
            for (let n = 0; n < 4; n++) {
                const nx = localX + neighbourX[n];
                const ny = localY + neighbourY[n];
                if (nx < 0 || nx >= windowWidth || ny < 0 || ny >= windowHeight) {
                    continue;
                }
                const surfaceX = nx + windowX;
                const surfaceY = ny + windowY;
                const surfaceIdx = surfaceY * width + surfaceX;
                if (this.detached[surfaceIdx] || this.getCarvedSlot(surfaceIdx) >= 0) {
                    continue;
                }
                const distance = Math.hypot(rimX - surfaceX, rimY - surfaceY);
                const neighbourCell = ny * windowWidth + nx;
                if (distance < rimWidthCells && distance < bankDistance[neighbourCell] - 1e-6) {
                    bankRim[neighbourCell] = rim;
                    bankDistance[neighbourCell] = distance;
                    bankQueue.push(neighbourCell);
                }
            }
        }
        // Bank heights in the window, then evened out between neighbours: sectors fed by different rim
        // cells would otherwise meet in sharp steps.
        let bankGrid = new Float64Array(bankRim.length);
        for (let cell = 0; cell < bankRim.length; cell++) {
            if (bankRim[cell] !== EDGE_UNSET) {
                bankGrid[cell] = smoothed.get(bankRim[cell])! * (1 - bankDistance[cell] / rimWidthCells);
            }
        }
        for (let pass = 0; pass < BANK_SMOOTHING_PASSES; pass++) {
            const next = new Float64Array(bankRim.length);
            for (let cell = 0; cell < bankRim.length; cell++) {
                if (bankRim[cell] === EDGE_UNSET) {
                    continue;
                }
                const localX = cell % windowWidth;
                let sum = bankGrid[cell];
                let members = 1;
                if (localX > 0 && bankRim[cell - 1] !== EDGE_UNSET) {
                    sum += bankGrid[cell - 1];
                    members++;
                }
                if (localX < windowWidth - 1 && bankRim[cell + 1] !== EDGE_UNSET) {
                    sum += bankGrid[cell + 1];
                    members++;
                }
                if (cell >= windowWidth && bankRim[cell - windowWidth] !== EDGE_UNSET) {
                    sum += bankGrid[cell - windowWidth];
                    members++;
                }
                if (cell < bankRim.length - windowWidth && bankRim[cell + windowWidth] !== EDGE_UNSET) {
                    sum += bankGrid[cell + windowWidth];
                    members++;
                }
                next[cell] = sum / members;
            }
            bankGrid = next;
        }
        const bankCells: number[] = [];
        const bankHeights: number[] = [];
        let bankTotal = 0;
        for (let cell = 0; cell < bankRim.length; cell++) {
            if (bankRim[cell] === EDGE_UNSET) {
                continue;
            }
            const localX = cell % windowWidth;
            bankCells.push(((cell - localX) / windowWidth + windowY) * width + localX + windowX);
            bankHeights.push(bankGrid[cell]);
            bankTotal += bankGrid[cell];
        }

        // Scaled so the bank holds exactly what flowed out, then limited by the room there is.
        const scale = totalSupply / bankTotal;
        for (let i = 0; i < bankCells.length; i++) {
            const idx = bankCells[i];
            const x = idx % width;
            const y = (idx - x) / width;
            // Material cannot rise into the tool: under it, the bank fills up to the tool's surface at most.
            const amount = Math.min(
                bankHeights[i] * scale,
                heightLimit - data[idx],
                this.getToolHeightAt(kernel, cx, cy, toolZ, x, y) - data[idx]
            );
            if (amount > 0) {
                this.safeAdd(x, y, amount);
            }
        }
    }

    // Height of the tool over a surface cell, or Infinity where the cell is not under the tool.
    private getToolHeightAt(kernel: ToolKernel, cx: number, cy: number, toolZ: number, mapX: number, mapY: number): number {
        const res = this.surface.resolution;
        const yawRad = this.degreesToRadians(kernel.directionDeg);
        const cosYaw = Math.cos(yawRad);
        const sinYaw = Math.sin(yawRad);
        const dx = mapX / res - cx;
        const dy = mapY / res - cy;
        const halfSize = kernel.halfSizeMm;
        const along = dx * cosYaw + dy * sinYaw + kernel.anchorAlongMm;
        const across = -dx * sinYaw + dy * cosYaw + kernel.anchorAcrossMm;
        if (Math.abs(along) > halfSize || Math.abs(across) > halfSize) {
            return Infinity;
        }
        const lastCell = kernel.width - 2;
        const gridX = (along + halfSize) / kernel.spacingMm;
        const gridY = (across + halfSize) / kernel.spacingMm;
        const cellX = Math.max(0, Math.min(lastCell, Math.floor(gridX)));
        const cellY = Math.max(0, Math.min(lastCell, Math.floor(gridY)));
        const fx = Math.max(0, Math.min(1, gridX - cellX));
        const fy = Math.max(0, Math.min(1, gridY - cellY));
        const k = cellY * kernel.width + cellX;
        const z00 = kernel.profile[k];
        const z10 = kernel.profile[k + 1];
        const z01 = kernel.profile[k + kernel.width];
        const z11 = kernel.profile[k + kernel.width + 1];
        if (z00 + z10 + z01 + z11 >= 500) {
            return Infinity;
        }
        return toolZ + z00 + (z10 - z00) * fx + (z01 - z00) * fy + (z00 - z10 - z01 + z11) * fx * fy;
    }

    private generateCrack(
        cx: number,
        cy: number,
        dirX: number,
        dirY: number,
        side: number,
        energy: number,
        mat: MaterialConstants,
        materialThicknessMm: number,
        shearResponse: ShearResponse
    ) {
        const res = this.surface.resolution;
        let x = cx;
        let y = cy;
        
        let cDx = -dirY * side;
        let cDy = dirX * side;
        
        const length = energy * 4 * mat.brittleness;
        const steps = Math.floor(length * res);
        const cellAreaMm2 = 1 / (res * res);
        
        for(let i=0; i<steps; i++) {
            x += cDx * (1/res);
            y += cDy * (1/res);

            const gx = Math.floor(x * res);
            const gy = Math.floor(y * res);
            
            if (gx >= 0 && gx < this.surface.width && gy >= 0 && gy < this.surface.height) {
                const idx = gy * this.surface.width + gx;
                if (this.detached[idx]) {
                    continue;
                }
                const taper = 1 - (i / Math.max(1, steps));
                // One crack opens near its root and fades into damaged but attached material.
                this.damage[idx] = Math.min(1, this.damage[idx] + taper * mat.brittleness * 1.6);
                this.edgeLift[idx] = Math.min(materialThicknessMm * 0.2, this.edgeLift[idx] + taper * mat.brittleness * 0.01);
                if (this.damage[idx] >= 1) {
                    this.detachCell(gx, gy, cellAreaMm2, materialThicknessMm, energy * 0.1 * taper, mat, shearResponse);
                }

                const field = this.computeFieldSample(gx, gy);
                const damageGradientMagnitude = Math.hypot(field.damageGradientX, field.damageGradientY);
                const heightGradientMagnitude = Math.hypot(field.heightGradientX, field.heightGradientY);
                const releaseX = damageGradientMagnitude > 0
                    ? field.damageGradientX / damageGradientMagnitude
                    : (heightGradientMagnitude > 0 ? field.heightGradientX / heightGradientMagnitude : cDx);
                const releaseY = damageGradientMagnitude > 0
                    ? field.damageGradientY / damageGradientMagnitude
                    : (heightGradientMagnitude > 0 ? field.heightGradientY / heightGradientMagnitude : cDy);
                const blendedX = cDx * 0.82 + releaseX * 0.18;
                const blendedY = cDy * 0.82 + releaseY * 0.18;
                const blendedLen = Math.hypot(blendedX, blendedY);
                if (blendedLen > 0) {
                    cDx = blendedX / blendedLen;
                    cDy = blendedY / blendedLen;
                }
            }
        }
    }

    private safeAdd(x: number, y: number, val: number): boolean {
        if (x >= 0 && x < this.surface.width && y >= 0 && y < this.surface.height) {
            const idx = y * this.surface.width + x;
            if (!this.detached[idx] && this.surface.data[idx] > -0.5) {
                const raised = this.surface.data[idx] + val;
                this.surface.data[idx] = raised;
                this.looseHeight[idx] += val;
                if (raised > this.maxSurfaceHeight) {
                    this.maxSurfaceHeight = raised;
                }
                if (raised > this.passHighestPileUp) {
                    this.passHighestPileUp = raised;
                }
                return true;
            }
        }
        return false;
    }

    private getEffectiveHeight(index: number): number {
        return this.surface.data[index] + this.edgeLift[index] + this.debrisHeight[index];
    }

    private sampleNeighborIndex(x: number, y: number): number {
        const clampedX = Math.max(0, Math.min(this.surface.width - 1, x));
        const clampedY = Math.max(0, Math.min(this.surface.height - 1, y));
        return clampedY * this.surface.width + clampedX;
    }

    private computeFieldSample(mapX: number, mapY: number): SurfaceFieldSample {
        if (!Number.isInteger(mapX) || mapX < 0 || mapX >= this.surface.width) {
            throw new Error('mapX must be an in-bounds integer');
        }
        if (!Number.isInteger(mapY) || mapY < 0 || mapY >= this.surface.height) {
            throw new Error('mapY must be an in-bounds integer');
        }

        const dxMm = 1 / this.surface.resolution;
        const centerIdx = this.sampleNeighborIndex(mapX, mapY);
        const leftIdx = this.sampleNeighborIndex(mapX - 1, mapY);
        const rightIdx = this.sampleNeighborIndex(mapX + 1, mapY);
        const downIdx = this.sampleNeighborIndex(mapX, mapY - 1);
        const upIdx = this.sampleNeighborIndex(mapX, mapY + 1);

        const centerHeight = this.getEffectiveHeight(centerIdx);
        const leftHeight = this.getEffectiveHeight(leftIdx);
        const rightHeight = this.getEffectiveHeight(rightIdx);
        const downHeight = this.getEffectiveHeight(downIdx);
        const upHeight = this.getEffectiveHeight(upIdx);

        const heightGradientX = (rightHeight - leftHeight) / (2 * dxMm);
        const heightGradientY = (upHeight - downHeight) / (2 * dxMm);
        const heightLaplacian = (leftHeight + rightHeight + downHeight + upHeight - 4 * centerHeight) / (dxMm * dxMm);

        const centerDamage = this.damage[centerIdx];
        const leftDamage = this.damage[leftIdx];
        const rightDamage = this.damage[rightIdx];
        const downDamage = this.damage[downIdx];
        const upDamage = this.damage[upIdx];

        const damageGradientX = (rightDamage - leftDamage) / (2 * dxMm);
        const damageGradientY = (upDamage - downDamage) / (2 * dxMm);
        const damageLaplacian = (leftDamage + rightDamage + downDamage + upDamage - 4 * centerDamage) / (dxMm * dxMm);
        const slope = Math.hypot(heightGradientX, heightGradientY);
        const damageGradientMagnitude = Math.hypot(damageGradientX, damageGradientY);
        const strainConcentration = slope + Math.abs(heightLaplacian) * dxMm * 0.35 + damageGradientMagnitude * dxMm * 0.5;

        return {
            heightGradientX,
            heightGradientY,
            heightLaplacian,
            damageGradientX,
            damageGradientY,
            damageLaplacian,
            strainConcentration
        };
    }

    private accumulateDamage(
        mapX: number,
        mapY: number,
        penetration: number,
        permanentDepth: number,
        plasticStrainIncrement: number,
        characteristicLength: number,
        cellAreaMm2: number,
        materialThicknessMm: number,
        mat: MaterialConstants,
        shearResponse: ShearResponse,
        substepScale: number
    ) {
        this.validateNonNegativeFinite(penetration, 'penetration');
        this.validateNonNegativeFinite(permanentDepth, 'permanentDepth');
        this.validateNonNegativeFinite(plasticStrainIncrement, 'plasticStrainIncrement');
        this.validatePositiveFinite(characteristicLength, 'characteristicLength');
        this.validatePositiveFinite(cellAreaMm2, 'cellAreaMm2');
        this.validatePositiveFinite(materialThicknessMm, 'materialThicknessMm');
        this.validateRange(substepScale, 'substepScale', 0, 1);

        const idx = mapY * this.surface.width + mapX;
        if (this.detached[idx] || permanentDepth <= 0 || substepScale <= 0) {
            return;
        }

        const totalStrain = penetration / characteristicLength;
        const normalStressMPa = Math.min(mat.hardnessMPa * 1.5, totalStrain * mat.hardnessMPa);
        const shearStressMPa = shearResponse.stressRatio * mat.shearStrengthMPa;
        const equivalentStressMPa = Math.sqrt((normalStressMPa * normalStressMPa) + (3 * shearStressMPa * shearStressMPa));
        const overloadStressMPa = Math.max(0, equivalentStressMPa - mat.tensileStrengthMPa);

        const cellWidthMm = Math.sqrt(cellAreaMm2);
        const fractureAreaMm2 = cellWidthMm * materialThicknessMm;
        const requiredWorkNmm = mat.fractureEnergyNPerMm * fractureAreaMm2;
        const baseDrivingWorkNmm = overloadStressMPa * permanentDepth * cellWidthMm * FRACTURE_PROCESS_ZONE_MM * (1 + shearResponse.stressRatio * 0.2);
        const baseEnergyRatio = requiredWorkNmm > 0 ? baseDrivingWorkNmm / requiredWorkNmm : 0;

        const accumulatedPlasticStrain = (this.plasticStrain[idx] + plasticStrainIncrement) * REPRESENTATIVE_STRAIN_FACTOR;
        const plasticExcess = Math.max(0, accumulatedPlasticStrain - mat.criticalPlasticStrain);
        const baseBrittleDamage = baseEnergyRatio * (0.45 + mat.brittleness * 1.35);
        const baseDuctileDamage = (plasticExcess / mat.criticalPlasticStrain) * mat.flow * Math.max(baseEnergyRatio, permanentDepth / materialThicknessMm);
        const breakthroughDamage = Math.max(0, (permanentDepth - materialThicknessMm * 0.35) / materialThicknessMm) * (0.25 + mat.brittleness);
        const baseDamage = baseBrittleDamage + baseDuctileDamage + breakthroughDamage;
        if (baseDamage <= 0) {
            return;
        }

        let damageIncrement = baseDamage * substepScale;
        if (baseDamage > 0.02 || this.damage[idx] > 0.15) {
            const field = this.computeFieldSample(mapX, mapY);
            const fieldEnergyFactor = 1 + Math.min(0.9, field.strainConcentration * 0.22 + Math.abs(field.damageLaplacian) * cellAreaMm2 * 0.04);
            const energyRatio = baseEnergyRatio * fieldEnergyFactor;
            const brittleDamage = energyRatio * (0.45 + mat.brittleness * 1.35);
            const ductileDamage = (plasticExcess / mat.criticalPlasticStrain) * mat.flow * Math.max(energyRatio, permanentDepth / materialThicknessMm);
            const thicknessRatio = Math.min(1, permanentDepth / materialThicknessMm);
            const curvatureDamage = Math.min(0.35, Math.abs(field.heightLaplacian) * cellAreaMm2) * thicknessRatio * (0.08 + mat.brittleness * 0.22);
            damageIncrement = (brittleDamage + ductileDamage + breakthroughDamage + curvatureDamage) * substepScale;
        }

        const weakeningDepthMm = materialThicknessMm * LIGAMENT_FULL_DAMAGE_FRACTION * (1 - mat.brittleness);
        if (weakeningDepthMm > 0) {
            damageIncrement *= Math.min(1, Math.max(0, -this.surface.data[idx]) / weakeningDepthMm);
        }
        if (damageIncrement <= 0) {
            return;
        }

        this.damage[idx] = Math.min(1, this.damage[idx] + damageIncrement);
        this.propagateCrackDamage(mapX, mapY, damageIncrement, mat, shearResponse);

        if (this.damage[idx] >= 1) {
            this.detachCell(mapX, mapY, cellAreaMm2, materialThicknessMm, permanentDepth, mat, shearResponse);
        }
    }

    private propagateCrackDamage(
        mapX: number,
        mapY: number,
        damageIncrement: number,
        mat: MaterialConstants,
        shearResponse: ShearResponse
    ) {
        if (damageIncrement <= 0) {
            return;
        }

        const width = this.surface.width;
        const height = this.surface.height;
        const damage = this.damage;
        let bestX = mapX;
        let bestY = mapY;
        let bestScore = -Infinity;
        // Strong or repeated damage follows the damage gradient: a crack grows towards what is already damaged.
        let gradientX = 0;
        let gradientY = 0;
        if (damageIncrement >= 0.01 || damage[mapY * width + mapX] > 0.2) {
            const rowIdx = mapY * width;
            gradientX = damage[rowIdx + Math.min(width - 1, mapX + 1)] - damage[rowIdx + Math.max(0, mapX - 1)];
            gradientY = damage[Math.min(height - 1, mapY + 1) * width + mapX] - damage[Math.max(0, mapY - 1) * width + mapX];
        }
        const gradientMagnitude = Math.hypot(gradientX, gradientY);
        for (let n = 0; n < NEIGHBOUR_DX.length; n++) {
            const nx = mapX + NEIGHBOUR_DX[n];
            const ny = mapY + NEIGHBOUR_DY[n];
            if (nx < 0 || nx >= width || ny < 0 || ny >= height) {
                continue;
            }
            const nIdx = ny * width + nx;
            if (this.detached[nIdx]) {
                continue;
            }

            const dirX = NEIGHBOUR_DIR_X[n];
            const dirY = NEIGHBOUR_DIR_Y[n];
            const alignment = (dirX * shearResponse.trailingX) + (dirY * shearResponse.trailingY);
            const damageGradientAlignment = gradientMagnitude > 0
                ? (dirX * gradientX + dirY * gradientY) / gradientMagnitude
                : 0;
            const score =
                damage[nIdx] * 0.35 +
                alignment * 0.22 +
                damageGradientAlignment * 0.28 +
                mat.brittleness * Math.abs(dirX) * 0.08;
            if (score > bestScore) {
                bestScore = score;
                bestX = nx;
                bestY = ny;
            }
        }

        if (bestScore === -Infinity) {
            return;
        }

        const bestIdx = bestY * this.surface.width + bestX;
        const propagated = damageIncrement * (0.18 + mat.brittleness * 0.28);
        this.damage[bestIdx] = Math.min(1, this.damage[bestIdx] + propagated);
    }

    private detachCell(
        mapX: number,
        mapY: number,
        cellAreaMm2: number,
        materialThicknessMm: number,
        permanentDepth: number,
        mat: MaterialConstants,
        shearResponse: ShearResponse
    ) {
        const idx = mapY * this.surface.width + mapX;
        if (this.detached[idx]) {
            return;
        }

        this.detached[idx] = 1;
        if (this.cutSummary) {
            this.cutSummary.detachedCells++;
        }
        this.damage[idx] = 1;
        this.edgeLift[idx] = 0;
        this.debrisHeight[idx] = 0;
        this.looseHeight[idx] = 0;
        this.surface.data[idx] = Math.min(this.surface.data[idx], -materialThicknessMm);

        const detachedVolumeMm3 = cellAreaMm2 * materialThicknessMm;
        const debrisFraction = Math.min(0.75, 0.22 + mat.flow * 0.28 + mat.brittleness * 0.18);
        this.depositDebris(mapX, mapY, detachedVolumeMm3 * debrisFraction, cellAreaMm2, shearResponse);
        this.liftFractureEdges(mapX, mapY, materialThicknessMm, permanentDepth, mat, shearResponse);
    }

    private depositDebris(
        mapX: number,
        mapY: number,
        volumeMm3: number,
        cellAreaMm2: number,
        shearResponse: ShearResponse
    ) {
        if (volumeMm3 <= 0) {
            return;
        }

        const offsetCells = Math.max(1, Math.round((1.5 + shearResponse.lateralDisplacement) * this.surface.resolution));
        const centerX = mapX + Math.round(shearResponse.trailingX * offsetCells);
        const centerY = mapY + Math.round(shearResponse.trailingY * offsetCells);
        const radius = Math.max(1, Math.ceil(0.5 * this.surface.resolution));
        const stencil = this.getDebrisStencil(radius);
        const width = this.surface.width;
        const height = this.surface.height;
        // Debris is scattered over the whole disc. What would land on a hole or off the plate falls through
        // and is lost, instead of heaping up on the few cells that are left.
        const discWeightedAreaMm2 = stencil.totalWeight * cellAreaMm2;
        for (let i = 0; i < stencil.count; i++) {
            const x = centerX + stencil.dx[i];
            const y = centerY + stencil.dy[i];
            if (x < 0 || x >= width || y < 0 || y >= height) {
                continue;
            }
            const idx = y * width + x;
            if (this.detached[idx]) {
                continue;
            }
            this.debrisHeight[idx] += (volumeMm3 * stencil.weight[i]) / discWeightedAreaMm2;
        }
    }

    // The cells of a disc around a point, row by row, weighted to fall off towards the rim.
    private getDebrisStencil(radius: number) {
        if (this.debrisStencil && this.debrisStencil.radius === radius) {
            return this.debrisStencil;
        }
        const dx: number[] = [];
        const dy: number[] = [];
        const weight: number[] = [];
        let totalWeight = 0;
        for (let y = -radius; y <= radius; y++) {
            for (let x = -radius; x <= radius; x++) {
                const distance = Math.hypot(x, y);
                if (distance <= radius) {
                    dx.push(x);
                    dy.push(y);
                    weight.push(1 - distance / (radius + 1));
                    totalWeight += 1 - distance / (radius + 1);
                }
            }
        }
        this.debrisStencil = {
            radius,
            count: dx.length,
            totalWeight,
            dx: Int32Array.from(dx),
            dy: Int32Array.from(dy),
            weight: Float64Array.from(weight)
        };
        return this.debrisStencil;
    }

    private liftFractureEdges(
        mapX: number,
        mapY: number,
        materialThicknessMm: number,
        permanentDepth: number,
        mat: MaterialConstants,
        shearResponse: ShearResponse
    ) {
        const radius = 2;
        const maxLift = materialThicknessMm * (0.18 + mat.flow * 0.28);
        const baseLift = Math.min(maxLift, permanentDepth * (0.25 + mat.flow * 0.35) + materialThicknessMm * mat.brittleness * 0.035);

        for (let y = mapY - radius; y <= mapY + radius; y++) {
            for (let x = mapX - radius; x <= mapX + radius; x++) {
                if (x < 0 || x >= this.surface.width || y < 0 || y >= this.surface.height) {
                    continue;
                }
                const idx = y * this.surface.width + x;
                if (this.detached[idx]) {
                    continue;
                }
                const distance = Math.hypot(x - mapX, y - mapY);
                if (distance <= 0 || distance > radius) {
                    continue;
                }
                const dx = (x - mapX) / distance;
                const dy = (y - mapY) / distance;
                const shearBias = Math.max(0.35, 1 + dx * shearResponse.trailingX + dy * shearResponse.trailingY);
                const field = this.computeFieldSample(x, y);
                const cellWidthMm = 1 / this.surface.resolution;
                const curvatureBias = 1 + Math.min(0.75, field.strainConcentration * 0.25 + Math.abs(field.heightLaplacian) * cellWidthMm * 0.08);
                const lift = baseLift * (1 - distance / (radius + 1)) * shearBias * curvatureBias;
                this.edgeLift[idx] = Math.min(maxLift, this.edgeLift[idx] + lift);
            }
        }
    }

    // Part of the freshly cut material sticks to the tool and is laid down again just behind the contact.
    // The share grows with the shear response, so soft, sticky, high-friction pairs smear the most.
    private applyShearSmear(mapX: number, mapY: number, freshDepth: number, shearResponse: ShearResponse): number {
        if (shearResponse.smearDepth <= 0 || freshDepth <= 0) {
            return 0;
        }

        const offsetCells = Math.max(1, Math.round(shearResponse.lateralDisplacement * this.surface.resolution));
        const targetX = mapX + Math.round(shearResponse.trailingX * offsetCells);
        const targetY = mapY + Math.round(shearResponse.trailingY * offsetCells);
        const smearHeight = freshDepth * MAX_SMEAR_SHARE * Math.min(1, shearResponse.smearDepth / MAX_SMEAR_DEPTH_MM);

        return this.safeAdd(targetX, targetY, smearHeight) ? smearHeight : 0;
    }

    private createSurfaceDetailMap(
        originX: number,
        originY: number,
        directionDeg: number,
        lengthMm: number,
        kernel: ToolKernel,
        penetration: number,
        peakPenetration: number,
        chatterParam: number,
        shearResponse: ShearResponse
    ): SurfaceDetailMap {
        this.validateFinite(originX, 'originX');
        this.validateFinite(originY, 'originY');
        this.validateFinite(directionDeg, 'directionDeg');
        this.validatePositiveFinite(lengthMm, 'lengthMm');
        this.validateToolKernel(kernel);
        this.validatePositiveFinite(penetration, 'penetration');
        this.validateRange(chatterParam, 'chatterParam', 0, 1);

        const widthMm = Math.min(MAX_DETAIL_WIDTH_MM, Math.max(1 / DETAIL_MAP_RESOLUTION, kernel.striationProfile.widthMm));
        const lengthSamples = Math.max(2, Math.ceil(lengthMm * DETAIL_MAP_RESOLUTION));
        const widthSamples = Math.max(2, Math.ceil(widthMm * DETAIL_MAP_RESOLUTION));
        const data = new Float32Array(lengthSamples * widthSamples);
        const striationScale = Math.min(1, penetration / 0.2);
        let minHeight = Infinity;
        let maxHeight = -Infinity;

        // Terms that only vary along the cut are evaluated once per column.
        const wavinessAngular = 2 * Math.PI / 0.34;
        const chatterByColumn = new Float64Array(lengthSamples);
        const fadeByColumn = new Float64Array(lengthSamples);
        const wavinessSinByColumn = new Float64Array(lengthSamples);
        const wavinessCosByColumn = new Float64Array(lengthSamples);
        for (let x = 0; x < lengthSamples; x++) {
            const alongMm = x / DETAIL_MAP_RESOLUTION;
            chatterByColumn[x] = Math.sin(alongMm * (2 * Math.PI / 1.2)) * chatterParam * 0.003;
            fadeByColumn[x] = Math.max(0, Math.sin(Math.PI * x / (lengthSamples - 1)));
            wavinessSinByColumn[x] = Math.sin(alongMm * wavinessAngular);
            wavinessCosByColumn[x] = Math.cos(alongMm * wavinessAngular);
        }
        const wavinessAmplitude = 0.0015 * kernel.sharpness;
        const tearAmplitude = shearResponse.tearRoughness * 0.18;

        // Lowest point of the tool in each row across the cut. Rows that never reach the surface
        // (beside a narrow edge, between claw prongs) carry no striations.
        const lowestByRow = new Float64Array(kernel.height).fill(Infinity);
        for (let ky = 0; ky < kernel.height; ky++) {
            for (let kx = 0; kx < kernel.width; kx++) {
                const value = kernel.profile[ky * kernel.width + kx];
                if (value < lowestByRow[ky]) {
                    lowestByRow[ky] = value;
                }
            }
        }

        for (let y = 0; y < widthSamples; y++) {
            // Across the cut, measured from the contact line the path follows.
            const acrossMm = widthSamples === 1
                ? 0
                : (y / (widthSamples - 1) - 0.5) * widthMm;
            const toolAcrossMm = acrossMm + kernel.anchorAcrossMm;
            const profilePosition = toolAcrossMm + kernel.striationProfile.widthMm / 2;
            const crossSection = getStriationOffset(kernel.striationProfile, profilePosition) * striationScale;
            const shearSmear = shearResponse.smearDepth * 0.12 * Math.max(0, 1 - Math.abs(acrossMm) / (widthMm / 2));
            const rowBase = crossSection + shearSmear;
            const acrossSin = Math.sin(acrossMm * 1.7);
            const acrossCos = Math.cos(acrossMm * 1.7);
            const row = Math.round((toolAcrossMm + kernel.halfSizeMm) / kernel.spacingMm);
            if (row < 0 || row >= kernel.height || lowestByRow[row] > peakPenetration) {
                continue;
            }

            for (let x = 0; x < lengthSamples; x++) {
                const waviness = (wavinessSinByColumn[x] * acrossCos + wavinessCosByColumn[x] * acrossSin) * wavinessAmplitude;
                const shearTear = tearAmplitude > 0
                    ? (this.coordinateNoise(x / DETAIL_MAP_RESOLUTION + 0.311, acrossMm + 0.577) - 0.5) * tearAmplitude
                    : 0;
                const height = (rowBase + chatterByColumn[x] + waviness + shearTear) * fadeByColumn[x];
                const idx = y * lengthSamples + x;
                data[idx] = height;
                if (height < minHeight) minHeight = height;
                if (height > maxHeight) maxHeight = height;
            }
        }

        if (minHeight > maxHeight) {
            minHeight = 0;
            maxHeight = 0;
        }

        return {
            lengthMm,
            widthMm,
            resolution: DETAIL_MAP_RESOLUTION,
            lengthSamples,
            widthSamples,
            originX,
            originY,
            directionDeg,
            data,
            minHeight,
            maxHeight
        };
    }

    // The size of the loaded patch: the diameter of a circle with the same load-bearing area. Elastic
    // deflection under a contact scales with it, and unlike the patch's outline it grows smoothly with depth
    // even when a rough edge touches down at several separate points.
    private getCharacteristicLength(kernel: ToolKernel, penetrationDepth: number, sliding: boolean): number {
        this.validatePositiveFinite(penetrationDepth, 'penetrationDepth');
        const areaMm2 = this.getContactAreaForDepth(kernel, Math.min(penetrationDepth, kernel.maxProfileDepth), sliding);
        const characteristicLength = CIRCLE_DIAMETER_PER_ROOT_AREA * Math.sqrt(areaMm2);
        if (!Number.isFinite(characteristicLength) || characteristicLength <= 0) {
            throw new Error('characteristicLength must be a positive finite number');
        }
        return characteristicLength;
    }

    private computeShearResponse(
        force: number,
        normalForce: number,
        contactAreaMm2: number,
        mat: MaterialConstants,
        kernel: ToolKernel,
        speed: number,
        dirX: number,
        dirY: number
    ): ShearResponse {
        this.validateNonNegativeFinite(force, 'force');
        this.validateNonNegativeFinite(normalForce, 'normalForce');
        this.validateNonNegativeFinite(contactAreaMm2, 'contactAreaMm2');
        this.validatePositiveFinite(speed, 'speed');
        this.validateToolKernel(kernel);

        if (force === 0 || contactAreaMm2 === 0) {
            return {
                stressRatio: 0,
                lateralDisplacement: 0,
                smearDepth: 0,
                prowFraction: 0,
                tearRoughness: 0,
                trailingX: -dirX,
                trailingY: -dirY
            };
        }

        const tangentialShare = Math.cos(this.degreesToRadians(kernel.angleDeg));
        const tangentialForce = force * tangentialShare;
        const frictionForce = normalForce * mat.frictionCoefficient * kernel.edgeDragFactor;
        const shearStress = ((tangentialForce + frictionForce) * kernel.shearEfficiency) / contactAreaMm2;
        const stressRatio = Math.max(0, shearStress / mat.shearStrengthMPa);
        const boundedStress = Math.min(6, stressRatio);
        const highSpeedInstability = Math.min(0.35, Math.max(0, (speed - 20) / 160));
        const lowSpeedStickSlip = Math.min(0.35, Math.max(0, (20 - speed) / 60) * mat.frictionCoefficient);
        const instability = highSpeedInstability + lowSpeedStickSlip;
        const exceedance = Math.max(0, boundedStress - 1);
        const lateralDisplacement = Math.min(0.45, (0.035 * boundedStress + instability * 0.04) * kernel.shearEfficiency);
        const smearDepth = Math.min(MAX_SMEAR_DEPTH_MM, (0.012 * boundedStress + instability * 0.01) * mat.smearFactor * (1 - mat.brittleness * 0.55));
        const prowFraction = Math.min(0.65, (0.18 * boundedStress + instability * 0.18 + 0.22 * tangentialShare) * (0.4 + mat.flow));
        const tearRoughness = Math.min(MAX_TEAR_ROUGHNESS_MM, exceedance * (0.015 + mat.brittleness * 0.06) + instability * 0.02);
        const dirLen = Math.hypot(dirX, dirY);
        if (dirLen <= 0) {
            throw new Error('drag direction vector must be non-zero');
        }

        return {
            stressRatio,
            lateralDisplacement,
            smearDepth,
            prowFraction,
            tearRoughness,
            trailingX: -dirX / dirLen,
            trailingY: -dirY / dirLen
        };
    }

    // `sliding` selects the forward-facing area: behind the lowest point a sliding tool has lost contact.
    private getDepthForContactArea(kernel: ToolKernel, targetAreaMm2: number, sliding: boolean): number {
        this.validateNonNegativeFinite(targetAreaMm2, 'targetAreaMm2');
        if (targetAreaMm2 === 0) {
            return 0;
        }
        if (!kernel.contactPatchLUT || kernel.contactPatchLUT.length === 0) {
            throw new Error('contactPatchLUT must be a non-empty array');
        }

        const lut = kernel.contactPatchLUT;
        const areaOf = (sample: ContactPatchSample) => (sliding ? sample.leadingAreaMm2 : sample.areaMm2);
        if (targetAreaMm2 <= areaOf(lut[0])) {
            return lut[0].depth * (targetAreaMm2 / areaOf(lut[0]));
        }

        for (let i = 1; i < lut.length; i++) {
            const prev = lut[i - 1];
            const next = lut[i];
            if (targetAreaMm2 <= areaOf(next)) {
                const span = areaOf(next) - areaOf(prev);
                if (span <= 0) {
                    continue;
                }
                const t = (targetAreaMm2 - areaOf(prev)) / span;
                return prev.depth + (next.depth - prev.depth) * t;
            }
        }

        return kernel.maxProfileDepth;
    }

    private getContactAreaForDepth(kernel: ToolKernel, penetrationDepth: number, sliding: boolean): number {
        this.validateNonNegativeFinite(penetrationDepth, 'penetrationDepth');
        if (penetrationDepth === 0) {
            return 0;
        }
        if (!kernel.contactPatchLUT || kernel.contactPatchLUT.length === 0) {
            throw new Error('contactPatchLUT must be a non-empty array');
        }

        const lut = kernel.contactPatchLUT;
        const areaOf = (sample: ContactPatchSample) => (sliding ? sample.leadingAreaMm2 : sample.areaMm2);
        if (penetrationDepth <= lut[0].depth) {
            return areaOf(lut[0]) * (penetrationDepth / lut[0].depth);
        }

        for (let i = 1; i < lut.length; i++) {
            const prev = lut[i - 1];
            const next = lut[i];
            if (penetrationDepth <= next.depth) {
                const span = next.depth - prev.depth;
                if (span <= 0) {
                    continue;
                }
                const t = (penetrationDepth - prev.depth) / span;
                return areaOf(prev) + (areaOf(next) - areaOf(prev)) * t;
            }
        }

        return areaOf(lut[lut.length - 1]);
    }

    private buildContactPatchLUT(
        kernel: Float64Array,
        nominal: Float64Array,
        width: number,
        height: number,
        spacing: number
    ) {
        let maxProfileDepth = 0;
        for (let i = 0; i < kernel.length; i++) {
            const val = kernel[i];
            if (val < 500 && val > maxProfileDepth) {
                maxProfileDepth = val;
            }
        }
        if (!Number.isFinite(maxProfileDepth) || maxProfileDepth <= 0) {
            throw new Error('maxProfileDepth must be a positive finite number');
        }

        const samples = CONTACT_LUT_SAMPLES;
        const minDepth = Math.min(CONTACT_LUT_MIN_DEPTH_MM, maxProfileDepth / samples);
        const logRatio = Math.log(maxProfileDepth / minDepth) / (samples - 1);
        const area = new Float64Array(samples);
        const leadingArea = new Float64Array(samples);
        const sub = CONTACT_LUT_SUBSAMPLES;
        const subAreaMm2 = (spacing * spacing) / (sub * sub);

        // Each grid cell is sampled at sub-cell points of the interpolated surface and binned by depth,
        // so a thin contact strip is measured to a fraction of a cell.
        for (let y = 0; y < height - 1; y++) {
            for (let x = 0; x < width - 1; x++) {
                const k = y * width + x;
                const z00 = kernel[k];
                const z10 = kernel[k + 1];
                const z01 = kernel[k + width];
                const z11 = kernel[k + width + 1];
                if (z00 + z10 + z01 + z11 >= 500) {
                    continue;
                }
                const n00 = nominal[k];
                const n10 = nominal[k + 1];
                const n01 = nominal[k + width];
                const n11 = nominal[k + width + 1];

                for (let sy = 0; sy < sub; sy++) {
                    const fy = (sy + 0.5) / sub;
                    // Forward-facing where the smooth shape does not fall away towards the front.
                    const leading = (n10 - n00) * (1 - fy) + (n11 - n01) * fy >= -1e-12;
                    for (let sx = 0; sx < sub; sx++) {
                        const fx = (sx + 0.5) / sub;
                        const z = z00 + (z10 - z00) * fx + (z01 - z00) * fy + (z00 - z10 - z01 + z11) * fx * fy;
                        const level = z <= minDepth
                            ? 0
                            : Math.min(samples - 1, Math.ceil(Math.log(z / minDepth) / logRatio - 1e-9));
                        area[level] += subAreaMm2;
                        if (leading) {
                            leadingArea[level] += subAreaMm2;
                        }
                    }
                }
            }
        }

        const lut: ContactPatchSample[] = [];
        let areaSum = 0;
        let leadingSum = 0;
        for (let i = 0; i < samples; i++) {
            areaSum += area[i];
            leadingSum += leadingArea[i];
            // Depths too shallow to hold a forward-facing sample yet are covered by interpolating from zero.
            if (leadingSum <= 0) {
                continue;
            }
            lut.push({
                depth: minDepth * Math.exp(logRatio * i),
                areaMm2: areaSum,
                leadingAreaMm2: leadingSum
            });
        }

        if (lut.length === 0) {
            throw new Error('contact patch lookup failed: the tool has no forward-facing contact');
        }

        return { contactPatchLUT: lut, maxProfileDepth };
    }

    private createToolStriationProfile(
        config: StriationConfigOverride,
        sizeMM: number,
        wear: number,
        random: () => number
    ): StriationProfile {
        if (!Number.isFinite(sizeMM) || sizeMM <= 0) {
            throw new Error('sizeMM must be a positive finite number');
        }
        if (!Number.isFinite(wear) || wear < 0 || wear > 1) {
            throw new Error('wear must be between 0 and 1');
        }
        if (typeof random !== 'function') {
            throw new Error('random must be a function');
        }
        if (!config || typeof config !== 'object') {
            throw new Error('striation config is required');
        }
        this.validateStriationConfig(config);

        return createStriationProfile({
            widthMm: sizeMM,
            pitchMm: config.pitchMm,
            amplitudeMm: config.amplitudeMm,
            irregularity: config.irregularity,
            wear,
            random
        });
    }

    private getStriationConfig(type: string, override?: StriationConfigOverride): StriationConfigOverride {
        if (override !== undefined) {
            this.validateStriationConfig(override);
            return override;
        }

        const config = TOOL_STRIATION_CONFIG[type];
        if (!config) {
            throw new Error(`Missing striation config for tool type "${type}"`);
        }

        this.validateStriationConfig(config);
        return config;
    }

    private getToolShearConfig(type: string): ToolShearConstants {
        const config = TOOL_SHEAR_CONFIG[type];
        if (!config) {
            throw new Error(`Missing shear config for tool type "${type}"`);
        }
        this.validateRange(config.shearEfficiency, 'shearEfficiency', 0, 1);
        this.validatePositiveFinite(config.edgeDragFactor, 'edgeDragFactor');
        return config;
    }

    private validateStriationConfig(config: StriationConfigOverride) {
        if (!Number.isFinite(config.pitchMm) || config.pitchMm <= 0) {
            throw new Error('pitchMm must be a positive finite number');
        }
        if (!Number.isFinite(config.amplitudeMm) || config.amplitudeMm < 0) {
            throw new Error('amplitudeMm must be a non-negative finite number');
        }
        if (!Number.isFinite(config.irregularity) || config.irregularity < 0 || config.irregularity > 1) {
            throw new Error('irregularity must be between 0 and 1');
        }
    }

    private validateMaterialConstants(mat: MaterialConstants, materialType: string) {
        if (!mat || typeof mat !== 'object') {
            throw new Error(`Missing material constants for "${materialType}"`);
        }
        this.validatePositiveFinite(mat.hardnessMPa, `${materialType}.hardnessMPa`);
        this.validatePositiveFinite(mat.mohsHardness, `${materialType}.mohsHardness`);
        this.validateRange(mat.flow, `${materialType}.flow`, 0, 1);
        this.validateRange(mat.brittleness, `${materialType}.brittleness`, 0, 1);
        this.validateNonNegativeFinite(mat.frictionCoefficient, `${materialType}.frictionCoefficient`);
        this.validatePositiveFinite(mat.shearStrengthMPa, `${materialType}.shearStrengthMPa`);
        this.validateRange(mat.smearFactor, `${materialType}.smearFactor`, 0, 1);
        this.validatePositiveFinite(mat.tensileStrengthMPa, `${materialType}.tensileStrengthMPa`);
        this.validatePositiveFinite(mat.fractureEnergyNPerMm, `${materialType}.fractureEnergyNPerMm`);
        this.validatePositiveFinite(mat.criticalPlasticStrain, `${materialType}.criticalPlasticStrain`);
        this.validatePositiveFinite(mat.densityMgPerMm3, `${materialType}.densityMgPerMm3`);
        this.validatePositiveFinite(mat.defaultThicknessMm, `${materialType}.defaultThicknessMm`);
    }

    private validateToolKernel(kernel: ToolKernel) {
        if (!kernel || typeof kernel !== 'object') {
            throw new Error('toolKernel is required');
        }
        if (!(kernel.profile instanceof Float64Array)) {
            throw new Error('toolKernel.profile must be a Float64Array');
        }
        if (!Number.isInteger(kernel.width) || kernel.width <= 0) {
            throw new Error('toolKernel.width must be a positive integer');
        }
        if (!Number.isInteger(kernel.height) || kernel.height <= 0) {
            throw new Error('toolKernel.height must be a positive integer');
        }
        if (kernel.profile.length !== kernel.width * kernel.height) {
            throw new Error('toolKernel.profile length must match width * height');
        }
        this.validateRange(kernel.sharpness, 'toolKernel.sharpness', 0, 1);
        this.validateRange(kernel.shearEfficiency, 'toolKernel.shearEfficiency', 0, 1);
        this.validatePositiveFinite(kernel.edgeDragFactor, 'toolKernel.edgeDragFactor');
        this.validatePositiveFinite(kernel.maxProfileDepth, 'toolKernel.maxProfileDepth');
        if (!Number.isFinite(kernel.angleDeg) || kernel.angleDeg <= 0 || kernel.angleDeg > 90) {
            throw new Error('toolKernel.angleDeg must be greater than 0 and at most 90 degrees');
        }
        if (!kernel.contactPatchLUT || kernel.contactPatchLUT.length === 0) {
            throw new Error('toolKernel.contactPatchLUT must be a non-empty array');
        }
    }

    private computeToolHardnessFactor(toolHardnessMohs: number, materialHardnessMPa: number): number {
        this.validateToolHardness(toolHardnessMohs);
        this.validatePositiveFinite(materialHardnessMPa, 'materialHardnessMPa');
        const toolHardnessMPa = this.interpolateMohsHardnessMPa(toolHardnessMohs);
        return Math.min(1, Math.max(0.05, toolHardnessMPa / materialHardnessMPa));
    }

    private interpolateMohsHardnessMPa(mohs: number): number {
        this.validateToolHardness(mohs);
        const lower = Math.floor(mohs);
        const upper = Math.ceil(mohs);
        if (lower === upper) {
            return MOHS_TO_HARDNESS_MPA[lower - 1];
        }
        const lowerValue = MOHS_TO_HARDNESS_MPA[lower - 1];
        const upperValue = MOHS_TO_HARDNESS_MPA[upper - 1];
        const t = mohs - lower;
        return lowerValue + (upperValue - lowerValue) * t;
    }

    private validateToolHardness(value: number) {
        this.validateRange(value, 'toolHardnessMohs', 1, 10);
    }

    private validatePositiveFinite(value: number, label: string) {
        if (!Number.isFinite(value) || value <= 0) {
            throw new Error(`${label} must be a positive finite number`);
        }
    }

    private validateNonNegativeFinite(value: number, label: string) {
        if (!Number.isFinite(value) || value < 0) {
            throw new Error(`${label} must be a non-negative finite number`);
        }
    }

    private validateFinite(value: number, label: string) {
        if (!Number.isFinite(value)) {
            throw new Error(`${label} must be a finite number`);
        }
    }

    private validateRange(value: number, label: string, min: number, max: number) {
        if (!Number.isFinite(value) || value < min || value > max) {
            throw new Error(`${label} must be between ${min} and ${max}`);
        }
    }

    private degreesToRadians(degrees: number) {
        this.validateFinite(degrees, 'degrees');
        return degrees * Math.PI / 180;
    }

    private coordinateNoise(xMm: number, yMm: number): number {
        const xi = Math.round(xMm * 1000);
        const yi = Math.round(yMm * 1000);
        let state = (xi * 374761393 + yi * 668265263 + this.randomSeed * 1442695041) >>> 0;
        state = (state ^ (state >>> 13)) >>> 0;
        state = Math.imul(state, 1274126177) >>> 0;
        state = (state ^ (state >>> 16)) >>> 0;
        return state / 0x100000000;
    }
}
