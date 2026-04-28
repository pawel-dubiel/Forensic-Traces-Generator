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

export interface ToolKernel {
    profile: Float64Array; // 2D grid of the tool tip's Z offsets relative to tool center
    width: number; // grid units
    height: number; // grid units
    centerX: number;
    centerY: number;
    sharpness: number; // 0-1 (1 is razor sharp)
    contactPatchLUT: ContactPatchSample[];
    maxProfileDepth: number;
    striationProfile: StriationProfile;
    angleDeg: number;
}

export interface ToolPathPoint {
    x: number;
    y: number;
    toolZ: number;
    time: number;
}

interface ContactPatchSample {
    depth: number;
    widthMm: number;
    heightMm: number;
    areaMm2: number;
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
}

// Material constants for the simulation loop
export const MATERIALS: Record<MaterialType, MaterialConstants> = {
    // Brittleness: 0 = Clay (100% Flow), 1 = Glass (100% Fracture/Chip)
    aluminum: { hardnessMPa: 245, mohsHardness: 2.75, flow: 0.8, brittleness: 0.1 },
    brass: { hardnessMPa: 900, mohsHardness: 3.0, flow: 0.6, brittleness: 0.2 },
    steel: { hardnessMPa: 1800, mohsHardness: 5.5, flow: 0.3, brittleness: 0.1 },
    wood: { hardnessMPa: 40, mohsHardness: 2.0, flow: 0.1, brittleness: 0.9 }, // High brittleness = Splintering
    gold: { hardnessMPa: 220, mohsHardness: 2.5, flow: 0.95, brittleness: 0.0 }, // Very ductile, piles up easily
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

export class ForensicPhysicsEngine {
    surface: SurfaceMap;
    private plasticStrain: Float32Array;
    private random!: () => number;
    private randomSeed: number;
    private toolPath: ToolPathPoint[];
    private surfaceDetailMap: SurfaceDetailMap | null;

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
        this.toolPath = [];
        this.surfaceDetailMap = null;
    }

    getToolPath(): ToolPathPoint[] {
        return this.toolPath.slice();
    }

    getSurfaceDetailMap(): SurfaceDetailMap | null {
        return this.surfaceDetailMap;
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

        const res = this.surface.resolution;
        const gridW = Math.floor(sizeMM * res);
        const gridH = Math.floor(sizeMM * res);
        if (gridW <= 0 || gridH <= 0) {
            throw new Error('tool kernel dimensions must be positive');
        }
        const kernel = new Float64Array(gridW * gridH).fill(999);
        
        const centerX = Math.floor(gridW / 2);
        const centerY = Math.floor(gridH / 2);

        const wearMag = wear * 0.2; 
        let sharpness = 0.5;
        const striationConfig = this.getStriationConfig(type, options.striationConfigOverride);
        const striationProfile = this.createToolStriationProfile(striationConfig, sizeMM, wear, options.striationRandom);

        // Convert Yaw to Rads
        // We want the tool to align with the drag direction.
        // If direction is 0 (East/Right), and we assume tool points along that axis.
        const yawRad = (directionDeg * Math.PI) / 180;
        const cosYaw = Math.cos(yawRad);
        const sinYaw = Math.sin(yawRad);

        const tiltSlope = Math.min(Math.tan((90 - angleDeg) * Math.PI / 180), 1);

        for (let y = 0; y < gridH; y++) {
            for (let x = 0; x < gridW; x++) {
                const idx = y * gridW + x;
                
                // 1. Center coordinates
                const rawDx = (x - centerX) / res;
                const rawDy = (y - centerY) / res;
                
                // 2. Rotate coordinates into Tool Space (Local Tool Coords)
                // We rotate the GRID point backwards to find where it lands on the TOOL
                // Standard 2D rotation:
                // toolX = x cos - y sin
                // toolY = x sin + y cos
                const toolDx = rawDx * cosYaw + rawDy * sinYaw; // "Width" axis of tool (if moving X)
                const toolDy = -rawDx * sinYaw + rawDy * cosYaw; // "Length" axis of tool (Drag axis)

                // toolDx is aligned with Motion Vector.
                // toolDy is Perpendicular to Motion Vector.

                let z = 0;
                
                if (type === 'screwdriver') {
                    // Flat blade. Width is across the motion (perpendicular).
                    // So we check toolDy (perpendicular) for width.
                    if (Math.abs(toolDy) > sizeMM/2) z = 999;
                    else z = Math.abs(toolDy) > (sizeMM/2 - 0.2) ? (Math.abs(toolDy) - (sizeMM/2 - 0.2)) : 0;
                    sharpness = 0.3;
                } else if (type === 'knife') {
                    // Blade aligned with motion? Or perpendicular (scraping)?
                    // Usually knives cut ALONG the motion.
                    // V-shape based on perpendicular distance (toolDy)
                    z = Math.abs(toolDy) * 2; 
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

        const { contactPatchLUT, maxProfileDepth } = this.buildContactPatchLUT(kernel, gridW, gridH);

        return {
            profile: kernel,
            width: gridW,
            height: gridH,
            centerX,
            centerY,
            sharpness,
            contactPatchLUT,
            maxProfileDepth,
            striationProfile,
            angleDeg
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
        this.validateToolHardness(toolHardnessMohs);
        this.validatePositiveFinite(speed, 'speed');
        this.validateRange(chatterParam, 'chatterParam', 0, 1);
        this.validatePositiveFinite(timeStep, 'timeStep');
        this.resetRandom();
        const mat = MATERIALS[materialType];
        if (!mat) {
            throw new Error(`Missing material constants for "${materialType}"`);
        }
        const elasticPlastic = new ElasticPlasticModel(getElasticPlasticMaterial(materialType));
        
        // Physics Loop Parameters
        const totalDist = 40; // mm length of cut
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
        const penetration = this.getDepthForContactArea(toolKernel, targetContactAreaMm2);

        // Fracture Threshold
        const fractureThreshold = 0.5;

        let stepsTaken = 0;
        let elapsedTime = 0;
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

        while (currentDist < totalDist) {
            
            // Chatter / Stick-Slip Update
            // Phase increment = 2*PI * freq * dt
            // dt is timeStep
            const phaseStep = 2 * Math.PI * naturalFreq * timeStep;
            chatterPhase += phaseStep;
            
            // Amplitude scales with chatter param
            const chatterAmp = chatterParam * 0.15; 
            const vibration = Math.sin(chatterPhase) * chatterAmp; 
            
            // Apply vibration to Z
            const toolZ = penetration > 0 ? -penetration + vibration : 0;
            const penetrationDepth = Math.max(0, -toolZ);

            // 1. Carve
            if (penetrationDepth > 0) {
                const characteristicLength = this.getCharacteristicLength(toolKernel, penetrationDepth);
                this.applyKernel(cx, cy, toolZ, toolKernel, mat, elasticPlastic, characteristicLength);
            }

            // 2. Fracture
            if (mat.brittleness > 0.5 && Math.abs(toolZ) > fractureThreshold) {
                if (this.random() < mat.brittleness * 0.1) {
                    this.generateCrack(cx, cy, dirX, dirY, Math.abs(toolZ) * 2, mat.brittleness);
                }
            }

            if (currentDist - lastSampleDist >= pathSampleStep) {
                this.toolPath.push({ x: cx, y: cy, toolZ, time: elapsedTime });
                lastSampleDist = currentDist;
            }

            // 3. Move
            const tremor = (this.random() - 0.5) * 0.05;
            cx += (dirX * velocity * timeStep) + (-dirY * tremor);
            cy += (dirY * velocity * timeStep) + (dirX * tremor);
            
            currentDist += velocity * timeStep;
            stepsTaken++;
            elapsedTime += timeStep;

            // Yield every 500 steps (approx 10-20ms of work) to keep UI responsive
            if (stepsTaken % 500 === 0) {
                 const prog = (currentDist / totalDist) * 90; // Go up to 90%
                 yield prog;
            }
        }

        if (penetration > 0) {
            this.surfaceDetailMap = this.createSurfaceDetailMap(
                startX,
                startY,
                angleDir,
                totalDist,
                toolKernel,
                penetration,
                chatterParam
            );
        }

        yield 100;
    }

    private applyKernel(
        cx: number,
        cy: number,
        cz: number,
        kernel: ToolKernel,
        mat: MaterialConstants,
        elasticPlastic: ElasticPlasticModel,
        characteristicLength: number
    ) {
        const res = this.surface.resolution;
        const cellAreaMm2 = 1 / (res * res);
        const gx = Math.floor(cx * res);
        const gy = Math.floor(cy * res);
        
        const startX = gx - kernel.centerX;
        const startY = gy - kernel.centerY;
        
        let displacedVolume = 0;
        let maxDepth = 0;

        // Pass 1: Carve
        for (let ky = 0; ky < kernel.height; ky++) {
            for (let kx = 0; kx < kernel.width; kx++) {
                const mapX = startX + kx;
                const mapY = startY + ky;
                
                if (mapX >= 0 && mapX < this.surface.width && mapY >= 0 && mapY < this.surface.height) {
                    const idx = mapY * this.surface.width + mapX;
                    const toolHeight = cz + kernel.profile[ky * kernel.width + kx];
                    const currentHeight = this.surface.data[idx];
                    
                    if (toolHeight < currentHeight) {
                        const penetration = currentHeight - toolHeight;
                        const currentPlasticStrain = this.plasticStrain[idx];
                        const result = elasticPlastic.computePermanentDepth(
                            penetration,
                            characteristicLength,
                            currentPlasticStrain
                        );

                        if (result.permanentDepth > 0) {
                            const newHeight = currentHeight - result.permanentDepth;
                            displacedVolume += result.permanentDepth * cellAreaMm2;
                            this.surface.data[idx] = newHeight;
                            if (Math.abs(newHeight) > maxDepth) maxDepth = Math.abs(newHeight);
                        }

                        if (result.plasticStrainIncrement > 0) {
                            this.plasticStrain[idx] = currentPlasticStrain + result.plasticStrainIncrement;
                        }
                    }
                }
            }
        }

        // Pass 2: Pile-up vs Chip Formation (New)
        if (displacedVolume > 0) {
            // How much material flows vs flies away?
            const chipRatio = kernel.sharpness * mat.brittleness; // 0 to 1
            const flowVolume = displacedVolume * mat.flow * (1 - chipRatio);
            
            if (flowVolume > 0) {
                // CORRECTION 3: Volume Conservation
                // Previous logic added pileUpAmount to EACH pixel in rings, creating massive matter.
                // We need to distribute flowVolume across the total area of the rings.
                
                const range = 4; // Rings
                // Calculate total weights
                // Ring 1 Perimeter approx: 2*(W+H) + 4
                // Ring r Perimeter approx: 2*(W+H) + 8*r
                // Weight = 1/r.
                // We need to sum (Pixels_in_Ring_r * Weight_r) to find normalization factor.
                
                let totalWeightedAreaMm2 = 0;
                const weights: number[] = [];
                
                for(let r=1; r<=range; r++) {
                    // Pixels in this ring = Area(r) - Area(r-1)
                    // Simplified: Perimeter is roughly 2w + 2h + 8r
                    const p = 2*(kernel.width + kernel.height) + 8*r;
                    
                    const weight = 1.0 / r; // Decay
                    weights.push(weight);
                    totalWeightedAreaMm2 += p * cellAreaMm2 * weight;
                }
                
                // Now distribute
                for (let r = 1; r <= range; r++) {
                    const weight = weights[r-1];
                    // Volume for this ring = TotalVolume * ( (Pixels*Weight) / TotalWeightedArea )
                    // Height to add = VolumeRing / PixelsRing
                    // Combined: Height = (TotalVolume * Weight) / TotalWeightedArea
                    
                    const heightToAdd = (flowVolume * weight) / totalWeightedAreaMm2;
                    
                    this.addPileUpRing(startX - r, startY - r, kernel.width + r*2, kernel.height + r*2, heightToAdd);
                }
            }

            // Visualizing "Chips" / Debris? 
            // In a heightfield, we can't show flying particles.
            // But we can leave "roughness" in the cut to simulate torn material.
            if (chipRatio > 0.5) {
                // Roughen the bottom of the cut we just made
                this.roughenCut(startX, startY, kernel.width, kernel.height, chipRatio * 0.05);
            }
        }
    }

    private generateCrack(cx: number, cy: number, dirX: number, dirY: number, energy: number, brittleness: number) {
        const res = this.surface.resolution;
        let x = cx;
        let y = cy;
        
        // Crack shoots out semi-randomly but biased away from the cut direction
        // Normal to cut is (-dirY, dirX)
        const normalX = -dirY;
        const normalY = dirX;
        
        // Randomly choose left or right side + random spread
        const side = this.random() > 0.5 ? 1 : -1;
        const spread = (this.random() - 0.5) * 1.0; // +/- 0.5 rad spread
        
        // Rotate vector by spread
        const cosS = Math.cos(spread);
        const sinS = Math.sin(spread);
        const randNormalX = normalX * cosS - normalY * sinS;
        const randNormalY = normalX * sinS + normalY * cosS;

        const crackDirX = randNormalX * side;
        const crackDirY = randNormalY * side;
        
        // Normalize
        const len = Math.sqrt(crackDirX*crackDirX + crackDirY*crackDirY);
        const cDx = crackDirX / len;
        const cDy = crackDirY / len;
        
        const length = energy * 5 * brittleness; // Crack length in mm
        const steps = Math.floor(length * res);
        
        // Walk the crack
        for(let i=0; i<steps; i++) {
            x += cDx * (1/res);
            y += cDy * (1/res);
            
            // Jitter path (lightning bolt style)
            x += (this.random() - 0.5) * 0.05;
            y += (this.random() - 0.5) * 0.05;

            const gx = Math.floor(x * res);
            const gy = Math.floor(y * res);
            
            if (gx >= 0 && gx < this.surface.width && gy >= 0 && gy < this.surface.height) {
                const idx = gy * this.surface.width + gx;
                // Crack is a thin deep fissure
                // Depth tapers off
                const depth = (1 - (i/steps)) * 0.2; // up to 0.2mm deep crack
                this.surface.data[idx] -= depth;
            }
        }
    }

    private roughenCut(startX: number, startY: number, w: number, h: number, amount: number) {
        for (let ky = 0; ky < h; ky++) {
             for (let kx = 0; kx < w; kx++) {
                 const mapX = startX + kx;
                 const mapY = startY + ky;
                 if (mapX >= 0 && mapX < this.surface.width && mapY >= 0 && mapY < this.surface.height) {
                     const idx = mapY * this.surface.width + mapX;
                     // Only roughen if it's actually cut (negative Z)
                     if (this.surface.data[idx] < -0.01) {
                         this.surface.data[idx] -= this.random() * amount;
                     }
                 }
             }
        }
    }

    private addPileUpRing(x: number, y: number, w: number, h: number, amount: number) {
        for (let i = x; i < x + w; i++) {
            this.safeAdd(i, y, amount);
            this.safeAdd(i, y + h - 1, amount);
        }
        for (let j = y + 1; j < y + h - 1; j++) {
            this.safeAdd(x, j, amount);
            this.safeAdd(x + w - 1, j, amount);
        }
    }

    private safeAdd(x: number, y: number, val: number) {
        if (x >= 0 && x < this.surface.width && y >= 0 && y < this.surface.height) {
            const idx = y * this.surface.width + x;
            if (this.surface.data[idx] > -0.5) { 
                this.surface.data[idx] += val;
            }
        }
    }

    private createSurfaceDetailMap(
        originX: number,
        originY: number,
        directionDeg: number,
        lengthMm: number,
        kernel: ToolKernel,
        penetration: number,
        chatterParam: number
    ): SurfaceDetailMap {
        this.validateFinite(originX, 'originX');
        this.validateFinite(originY, 'originY');
        this.validateFinite(directionDeg, 'directionDeg');
        this.validatePositiveFinite(lengthMm, 'lengthMm');
        this.validateToolKernel(kernel);
        this.validatePositiveFinite(penetration, 'penetration');
        this.validateRange(chatterParam, 'chatterParam', 0, 1);

        const widthMm = Math.min(MAX_DETAIL_WIDTH_MM, Math.max(1 / DETAIL_MAP_RESOLUTION, kernel.height / this.surface.resolution));
        const lengthSamples = Math.max(2, Math.ceil(lengthMm * DETAIL_MAP_RESOLUTION));
        const widthSamples = Math.max(2, Math.ceil(widthMm * DETAIL_MAP_RESOLUTION));
        const data = new Float32Array(lengthSamples * widthSamples);
        const striationScale = Math.min(1, penetration / 0.2);
        let minHeight = Infinity;
        let maxHeight = -Infinity;

        for (let y = 0; y < widthSamples; y++) {
            const acrossMm = widthSamples === 1
                ? 0
                : (y / (widthSamples - 1) - 0.5) * widthMm;
            const profilePosition = acrossMm + kernel.striationProfile.widthMm / 2;
            const crossSection = getStriationOffset(kernel.striationProfile, profilePosition) * striationScale;

            for (let x = 0; x < lengthSamples; x++) {
                const alongMm = x / DETAIL_MAP_RESOLUTION;
                const chatter = Math.sin(alongMm * (2 * Math.PI / 1.2)) * chatterParam * 0.003;
                const waviness = Math.sin(alongMm * (2 * Math.PI / 0.34) + acrossMm * 1.7) * 0.0015 * kernel.sharpness;
                const fade = Math.sin(Math.PI * x / (lengthSamples - 1));
                const height = (crossSection + chatter + waviness) * Math.max(0, fade);
                const idx = y * lengthSamples + x;
                data[idx] = height;
                if (height < minHeight) minHeight = height;
                if (height > maxHeight) maxHeight = height;
            }
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

    private getCharacteristicLength(kernel: ToolKernel, penetrationDepth: number): number {
        if (!Number.isFinite(penetrationDepth) || penetrationDepth < 0) {
            throw new Error('penetrationDepth must be a non-negative finite number');
        }
        if (!kernel.contactPatchLUT || kernel.contactPatchLUT.length === 0) {
            throw new Error('contactPatchLUT must be a non-empty array');
        }
        if (!Number.isFinite(kernel.maxProfileDepth) || kernel.maxProfileDepth <= 0) {
            throw new Error('maxProfileDepth must be a positive finite number');
        }

        const depth = Math.min(penetrationDepth, kernel.maxProfileDepth);
        const lut = kernel.contactPatchLUT;

        if (depth <= lut[0].depth) {
            return Math.max(lut[0].widthMm, lut[0].heightMm);
        }

        for (let i = 1; i < lut.length; i++) {
            const prev = lut[i - 1];
            const next = lut[i];
            if (depth <= next.depth) {
                const span = next.depth - prev.depth;
                if (span <= 0) {
                    throw new Error('contactPatchLUT depth span must be positive');
                }
                const t = (depth - prev.depth) / span;
                const widthMm = prev.widthMm + (next.widthMm - prev.widthMm) * t;
                const heightMm = prev.heightMm + (next.heightMm - prev.heightMm) * t;
                const characteristicLength = Math.max(widthMm, heightMm);
                if (!Number.isFinite(characteristicLength) || characteristicLength <= 0) {
                    throw new Error('characteristicLength must be a positive finite number');
                }
                return characteristicLength;
            }
        }

        const last = lut[lut.length - 1];
        const fallback = Math.max(last.widthMm, last.heightMm);
        if (!Number.isFinite(fallback) || fallback <= 0) {
            throw new Error('characteristicLength must be a positive finite number');
        }
        return fallback;
    }

    private getDepthForContactArea(kernel: ToolKernel, targetAreaMm2: number): number {
        this.validateNonNegativeFinite(targetAreaMm2, 'targetAreaMm2');
        if (targetAreaMm2 === 0) {
            return 0;
        }
        if (!kernel.contactPatchLUT || kernel.contactPatchLUT.length === 0) {
            throw new Error('contactPatchLUT must be a non-empty array');
        }

        const lut = kernel.contactPatchLUT;
        if (targetAreaMm2 <= lut[0].areaMm2) {
            return lut[0].depth * (targetAreaMm2 / lut[0].areaMm2);
        }

        for (let i = 1; i < lut.length; i++) {
            const prev = lut[i - 1];
            const next = lut[i];
            if (targetAreaMm2 <= next.areaMm2) {
                const span = next.areaMm2 - prev.areaMm2;
                if (span <= 0) {
                    continue;
                }
                const t = (targetAreaMm2 - prev.areaMm2) / span;
                return prev.depth + (next.depth - prev.depth) * t;
            }
        }

        return kernel.maxProfileDepth;
    }

    private buildContactPatchLUT(kernel: Float64Array, width: number, height: number) {
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

        const samples = 24;
        const lut: ContactPatchSample[] = [];
        const res = this.surface.resolution;

        for (let i = 0; i < samples; i++) {
            const depth = ((i + 1) / samples) * maxProfileDepth;
            let minX = width;
            let maxX = -1;
            let minY = height;
            let maxY = -1;
            let contactCells = 0;

            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    const val = kernel[y * width + x];
                    if (val < 500 && val <= depth) {
                        contactCells++;
                        if (x < minX) minX = x;
                        if (x > maxX) maxX = x;
                        if (y < minY) minY = y;
                        if (y > maxY) maxY = y;
                    }
                }
            }

            if (maxX < 0 || maxY < 0) {
                throw new Error(`contact patch lookup failed at depth ${depth}`);
            }

            const widthMm = (maxX - minX + 1) / res;
            const heightMm = (maxY - minY + 1) / res;
            const areaMm2 = contactCells / (res * res);
            if (!Number.isFinite(widthMm) || widthMm <= 0 || !Number.isFinite(heightMm) || heightMm <= 0) {
                throw new Error('contact patch dimensions must be positive finite numbers');
            }
            if (!Number.isFinite(areaMm2) || areaMm2 <= 0) {
                throw new Error('contact patch area must be positive finite');
            }

            lut.push({ depth, widthMm, heightMm, areaMm2 });
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
