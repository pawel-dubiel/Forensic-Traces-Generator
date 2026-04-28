// SimulationEngine.ts
// High-Fidelity Discrete Heightfield Simulation
import { ElasticPlasticModel, getElasticPlasticMaterial } from './elasticPlastic.js';
import { createStriationProfile, getStriationOffset } from './striations.js';
import { createSeededRandom } from './random.js';
// Material constants for the simulation loop
export const MATERIALS = {
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
const TOOL_STRIATION_CONFIG = {
    screwdriver: { pitchMm: 0.22, amplitudeMm: 0.015, irregularity: 0.45 },
    knife: { pitchMm: 0.08, amplitudeMm: 0.008, irregularity: 0.25 },
    crowbar: { pitchMm: 0.35, amplitudeMm: 0.02, irregularity: 0.5 },
    hammer_face: { pitchMm: 0.6, amplitudeMm: 0.012, irregularity: 0.6 },
    hammer_claw: { pitchMm: 0.28, amplitudeMm: 0.018, irregularity: 0.55 },
    spoon: { pitchMm: 0.5, amplitudeMm: 0.012, irregularity: 0.35 },
};
const TOOL_SHEAR_CONFIG = {
    screwdriver: { shearEfficiency: 0.65, edgeDragFactor: 1.15 },
    knife: { shearEfficiency: 0.9, edgeDragFactor: 0.85 },
    crowbar: { shearEfficiency: 0.45, edgeDragFactor: 1.05 },
    hammer_face: { shearEfficiency: 0.2, edgeDragFactor: 1.25 },
    hammer_claw: { shearEfficiency: 0.75, edgeDragFactor: 1.2 },
    spoon: { shearEfficiency: 0.3, edgeDragFactor: 0.95 },
};
const KNIFE_EDGE_RADIUS_MM = 0.015;
const KNIFE_BEVEL_HALF_ANGLE_DEG = 17;
export const buildSurfaceMeshIndices = (width, height, detached) => {
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
    surface;
    plasticStrain;
    damage;
    detached;
    edgeLift;
    debrisHeight;
    random;
    randomSeed;
    toolPath;
    surfaceDetailMap;
    constructor(widthMM, heightMM, resolution, randomSeed) {
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
        this.randomSeed = randomSeed;
        this.resetRandom();
        this.toolPath = [];
        this.surfaceDetailMap = null;
        this.generateBaseTopography();
    }
    generateBaseTopography() {
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
        this.toolPath = [];
        this.surfaceDetailMap = null;
    }
    getToolPath() {
        return this.toolPath.slice();
    }
    getSurfaceDetailMap() {
        return this.surfaceDetailMap;
    }
    getFractureState() {
        return {
            damage: this.damage,
            detached: this.detached,
            edgeLift: this.edgeLift,
            debrisHeight: this.debrisHeight
        };
    }
    getSurfaceFieldSample(mapX, mapY) {
        return this.computeFieldSample(mapX, mapY);
    }
    resetRandom() {
        this.random = createSeededRandom(this.randomSeed);
    }
    createToolKernel(type, sizeMM, wear, angleDeg, directionDeg, options) {
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
        const shearConfig = this.getToolShearConfig(type);
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
                    if (Math.abs(toolDy) > sizeMM / 2)
                        z = 999;
                    else
                        z = Math.abs(toolDy) > (sizeMM / 2 - 0.2) ? (Math.abs(toolDy) - (sizeMM / 2 - 0.2)) : 0;
                    sharpness = 0.3;
                }
                else if (type === 'knife') {
                    const edgeRadius = KNIFE_EDGE_RADIUS_MM + wear * 0.08;
                    const bevelSlope = Math.tan(this.degreesToRadians(KNIFE_BEVEL_HALF_ANGLE_DEG + wear * 18));
                    const edgeDistance = Math.abs(toolDy);
                    const alongLimit = sizeMM * 2.5;
                    if (Math.abs(toolDx) > alongLimit) {
                        z = 999;
                    }
                    else if (edgeDistance <= edgeRadius) {
                        z = (edgeDistance * edgeDistance) / (2 * edgeRadius);
                    }
                    else {
                        z = (edgeRadius / 2) + (edgeDistance - edgeRadius) * bevelSlope;
                    }
                    sharpness = 0.95;
                }
                else if (type === 'crowbar') {
                    // Round tip
                    const r = sizeMM / 2;
                    const d = Math.sqrt(toolDx * toolDx + toolDy * toolDy);
                    if (d > r)
                        z = 999;
                    else
                        z = r - Math.sqrt(r * r - d * d);
                    sharpness = 0.1;
                }
                else if (type === 'hammer_face') {
                    const r = sizeMM / 2;
                    const d = Math.sqrt(toolDx * toolDx + toolDy * toolDy);
                    if (d > r)
                        z = 999;
                    else if (d > r * 0.8)
                        z = (d - r * 0.8);
                    else
                        z = 0;
                    sharpness = 0.05;
                }
                else if (type === 'hammer_claw') {
                    // Claws aligned with motion
                    const clawWidth = sizeMM * 0.4;
                    const gap = sizeMM * 0.15;
                    if (Math.abs(toolDy) < gap) { // Perpendicular axis
                        z = 999;
                    }
                    else if (Math.abs(toolDy) > clawWidth) {
                        z = 999;
                    }
                    else {
                        const prongCenter = gap + (clawWidth - gap) / 2;
                        const localP = Math.abs(Math.abs(toolDy) - prongCenter);
                        z = localP * 1.5;
                        // Curve along Length (toolDx)
                        const curve = (toolDx * toolDx) * 0.2;
                        z += curve;
                    }
                    sharpness = 0.6;
                }
                else if (type === 'spoon') {
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
                }
                else {
                    kernel[idx] = 999;
                }
            }
        }
        // CORRECTION: Normalize Z
        // Find the lowest point (minimum Z) in the kernel (that is not 999)
        // Shift kernel so that minZ = 0.
        // This ensures the "contact point" is what determines depth, not the tool center.
        let minZ = 1000;
        for (let i = 0; i < kernel.length; i++) {
            if (kernel[i] < minZ)
                minZ = kernel[i];
        }
        // If valid tool found
        if (minZ < 500) {
            for (let i = 0; i < kernel.length; i++) {
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
    *simulateCutGenerator(startX, startY, angleDir, force, toolKernel, materialType, materialThicknessMm, toolHardnessMohs, speed, chatterParam, timeStep) {
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
        const rawPenetration = this.getDepthForContactArea(toolKernel, targetContactAreaMm2);
        const penetration = rawPenetration * Math.sqrt(Math.sin(angleRad));
        const contactAreaMm2 = this.getContactAreaForDepth(toolKernel, penetration);
        const shearResponse = this.computeShearResponse(force, normalForce, contactAreaMm2, mat, toolKernel, speed, dirX, dirY);
        // Fracture Threshold
        const fractureThreshold = 0.5;
        let stepsTaken = 0;
        let elapsedTime = 0;
        const maxSpatialStepMm = Math.min(0.05, 1 / (this.surface.resolution * 2));
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
            const tickDistance = Math.min(velocity * timeStep, totalDist - currentDist);
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
                // Amplitude scales with chatter param
                const chatterAmp = chatterParam * 0.15;
                const vibration = Math.sin(chatterPhase) * chatterAmp;
                // Apply vibration to Z
                const toolZ = penetration > 0 ? -penetration + vibration : 0;
                const penetrationDepth = Math.max(0, -toolZ);
                // 1. Carve
                if (penetrationDepth > 0) {
                    const characteristicLength = this.getCharacteristicLength(toolKernel, penetrationDepth);
                    const substepScale = Math.min(1, stepDistance / maxSpatialStepMm);
                    this.applyKernel(cx, cy, toolZ, toolKernel, mat, materialThicknessMm, elasticPlastic, characteristicLength, shearResponse, substepScale);
                }
                // 2. Fracture
                if (mat.brittleness > 0.5 && Math.abs(toolZ) > fractureThreshold) {
                    this.generateCrack(cx, cy, dirX, dirY, Math.abs(toolZ) * 2, mat, materialThicknessMm, shearResponse);
                }
                if (currentDist - lastSampleDist >= pathSampleStep) {
                    this.toolPath.push({ x: cx, y: cy, toolZ, time: elapsedTime });
                    lastSampleDist = currentDist;
                }
                // 3. Move
                const tremorScale = Math.min(1, stepDistance / maxSpatialStepMm);
                const tremor = (this.random() - 0.5) * 0.05 * tremorScale;
                cx += (dirX * stepDistance) + (-dirY * tremor);
                cy += (dirY * stepDistance) + (dirX * tremor);
                currentDist += stepDistance;
                stepsTaken++;
                elapsedTime += stepDuration;
                // Yield every 500 steps (approx 10-20ms of work) to keep UI responsive
                if (stepsTaken % 500 === 0) {
                    const prog = (currentDist / totalDist) * 90; // Go up to 90%
                    yield prog;
                }
            }
        }
        if (penetration > 0) {
            this.surfaceDetailMap = this.createSurfaceDetailMap(startX, startY, angleDir, totalDist, toolKernel, penetration, chatterParam, shearResponse);
        }
        yield 100;
    }
    applyKernel(cx, cy, cz, kernel, mat, materialThicknessMm, elasticPlastic, characteristicLength, shearResponse, substepScale) {
        this.validateMaterialConstants(mat, 'material');
        this.validatePositiveFinite(materialThicknessMm, 'materialThicknessMm');
        this.validateRange(substepScale, 'substepScale', 0, 1);
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
                    if (this.detached[idx]) {
                        continue;
                    }
                    const toolHeight = cz + kernel.profile[ky * kernel.width + kx];
                    const currentHeight = this.surface.data[idx];
                    if (toolHeight < currentHeight) {
                        const penetration = currentHeight - toolHeight;
                        const currentPlasticStrain = this.plasticStrain[idx];
                        const result = elasticPlastic.computePermanentDepth(penetration, characteristicLength, currentPlasticStrain);
                        if (result.permanentDepth > 0) {
                            const shearRoughness = this.getShearRoughness(mapX, mapY, shearResponse.tearRoughness * substepScale, result.permanentDepth);
                            const newHeight = currentHeight - result.permanentDepth + shearRoughness;
                            displacedVolume += result.permanentDepth * cellAreaMm2;
                            this.surface.data[idx] = newHeight;
                            if (Math.abs(newHeight) > maxDepth)
                                maxDepth = Math.abs(newHeight);
                            this.applyShearSmear(mapX, mapY, result.permanentDepth, shearResponse, substepScale);
                            this.accumulateDamage(mapX, mapY, penetration, result.permanentDepth, result.plasticStrainIncrement, characteristicLength, cellAreaMm2, materialThicknessMm, mat, shearResponse, substepScale);
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
                const weights = [];
                for (let r = 1; r <= range; r++) {
                    // Pixels in this ring = Area(r) - Area(r-1)
                    // Simplified: Perimeter is roughly 2w + 2h + 8r
                    const p = 2 * (kernel.width + kernel.height) + 8 * r;
                    const weight = 1.0 / r; // Decay
                    weights.push(weight);
                    totalWeightedAreaMm2 += p * cellAreaMm2 * weight;
                }
                // Now distribute
                for (let r = 1; r <= range; r++) {
                    const weight = weights[r - 1];
                    // Volume for this ring = TotalVolume * ( (Pixels*Weight) / TotalWeightedArea )
                    // Height to add = VolumeRing / PixelsRing
                    // Combined: Height = (TotalVolume * Weight) / TotalWeightedArea
                    const heightToAdd = (flowVolume * (1 - shearResponse.asymmetricPileupBias) * weight) / totalWeightedAreaMm2;
                    this.addPileUpRing(startX - r, startY - r, kernel.width + r * 2, kernel.height + r * 2, heightToAdd);
                }
                const biasedVolume = flowVolume * shearResponse.asymmetricPileupBias;
                if (biasedVolume > 0) {
                    this.addBiasedPileUp(startX, startY, kernel.width, kernel.height, biasedVolume, cellAreaMm2, shearResponse);
                }
            }
            // Visualizing "Chips" / Debris? 
            // In a heightfield, we can't show flying particles.
            // But we can leave "roughness" in the cut to simulate torn material.
            if (chipRatio > 0.5 || shearResponse.tearRoughness > 0.01) {
                // Roughen the bottom of the cut we just made
                this.roughenCut(startX, startY, kernel.width, kernel.height, (chipRatio * 0.05 + shearResponse.tearRoughness) * substepScale);
            }
        }
    }
    generateCrack(cx, cy, dirX, dirY, energy, mat, materialThicknessMm, shearResponse) {
        const res = this.surface.resolution;
        let x = cx;
        let y = cy;
        const normalX = -dirY;
        const normalY = dirX;
        const side = ((normalX * shearResponse.trailingX) + (normalY * shearResponse.trailingY)) >= 0 ? 1 : -1;
        const crackDirX = normalX * side;
        const crackDirY = normalY * side;
        const len = Math.sqrt(crackDirX * crackDirX + crackDirY * crackDirY);
        let cDx = crackDirX / len;
        let cDy = crackDirY / len;
        const length = energy * 4 * mat.brittleness;
        const steps = Math.floor(length * res);
        const cellAreaMm2 = 1 / (res * res);
        for (let i = 0; i < steps; i++) {
            x += cDx * (1 / res);
            y += cDy * (1 / res);
            const gx = Math.floor(x * res);
            const gy = Math.floor(y * res);
            if (gx >= 0 && gx < this.surface.width && gy >= 0 && gy < this.surface.height) {
                const idx = gy * this.surface.width + gx;
                if (this.detached[idx]) {
                    continue;
                }
                const taper = 1 - (i / Math.max(1, steps));
                this.damage[idx] = Math.min(1, this.damage[idx] + taper * mat.brittleness * 0.18);
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
    roughenCut(startX, startY, w, h, amount) {
        for (let ky = 0; ky < h; ky++) {
            for (let kx = 0; kx < w; kx++) {
                const mapX = startX + kx;
                const mapY = startY + ky;
                if (mapX >= 0 && mapX < this.surface.width && mapY >= 0 && mapY < this.surface.height) {
                    const idx = mapY * this.surface.width + mapX;
                    if (this.detached[idx]) {
                        continue;
                    }
                    // Only roughen if it's actually cut (negative Z)
                    if (this.surface.data[idx] < -0.01) {
                        this.surface.data[idx] += (this.random() - 0.5) * amount;
                    }
                }
            }
        }
    }
    addPileUpRing(x, y, w, h, amount) {
        for (let i = x; i < x + w; i++) {
            this.safeAdd(i, y, amount);
            this.safeAdd(i, y + h - 1, amount);
        }
        for (let j = y + 1; j < y + h - 1; j++) {
            this.safeAdd(x, j, amount);
            this.safeAdd(x + w - 1, j, amount);
        }
    }
    safeAdd(x, y, val) {
        if (x >= 0 && x < this.surface.width && y >= 0 && y < this.surface.height) {
            const idx = y * this.surface.width + x;
            if (!this.detached[idx] && this.surface.data[idx] > -0.5) {
                this.surface.data[idx] += val;
            }
        }
    }
    getEffectiveHeight(index) {
        return this.surface.data[index] + this.edgeLift[index] + this.debrisHeight[index];
    }
    sampleNeighborIndex(x, y) {
        const clampedX = Math.max(0, Math.min(this.surface.width - 1, x));
        const clampedY = Math.max(0, Math.min(this.surface.height - 1, y));
        return clampedY * this.surface.width + clampedX;
    }
    computeFieldSample(mapX, mapY) {
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
    accumulateDamage(mapX, mapY, penetration, permanentDepth, plasticStrainIncrement, characteristicLength, cellAreaMm2, materialThicknessMm, mat, shearResponse, substepScale) {
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
        const baseDrivingWorkNmm = overloadStressMPa * permanentDepth * cellAreaMm2 * (1 + shearResponse.stressRatio * 0.2);
        const baseEnergyRatio = requiredWorkNmm > 0 ? baseDrivingWorkNmm / requiredWorkNmm : 0;
        const accumulatedPlasticStrain = this.plasticStrain[idx] + plasticStrainIncrement;
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
        if (damageIncrement <= 0) {
            return;
        }
        this.damage[idx] = Math.min(1, this.damage[idx] + damageIncrement);
        this.propagateCrackDamage(mapX, mapY, damageIncrement, mat, shearResponse);
        if (this.damage[idx] >= 1) {
            this.detachCell(mapX, mapY, cellAreaMm2, materialThicknessMm, permanentDepth, mat, shearResponse);
        }
    }
    propagateCrackDamage(mapX, mapY, damageIncrement, mat, shearResponse) {
        if (damageIncrement <= 0) {
            return;
        }
        let bestX = mapX;
        let bestY = mapY;
        let bestScore = -Infinity;
        const useFieldPropagation = damageIncrement >= 0.01 || this.damage[mapY * this.surface.width + mapX] > 0.2;
        const originField = useFieldPropagation ? this.computeFieldSample(mapX, mapY) : null;
        const damageGradientMagnitude = originField ? Math.hypot(originField.damageGradientX, originField.damageGradientY) : 0;
        const hasDamageGradient = damageGradientMagnitude > 0;
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                if (dx === 0 && dy === 0) {
                    continue;
                }
                const nx = mapX + dx;
                const ny = mapY + dy;
                if (nx < 0 || nx >= this.surface.width || ny < 0 || ny >= this.surface.height) {
                    continue;
                }
                const nIdx = ny * this.surface.width + nx;
                if (this.detached[nIdx]) {
                    continue;
                }
                const len = Math.hypot(dx, dy);
                const dirX = dx / len;
                const dirY = dy / len;
                const alignment = (dirX * shearResponse.trailingX) + (dirY * shearResponse.trailingY);
                const damageGradientAlignment = hasDamageGradient
                    ? (dirX * originField.damageGradientX + dirY * originField.damageGradientY) / damageGradientMagnitude
                    : 0;
                const score = this.damage[nIdx] * 0.35 +
                    alignment * 0.22 +
                    damageGradientAlignment * 0.28 +
                    (originField ? originField.strainConcentration : 0) * 0.08 +
                    mat.brittleness * Math.abs(dirX) * 0.08;
                if (score > bestScore) {
                    bestScore = score;
                    bestX = nx;
                    bestY = ny;
                }
            }
        }
        if (bestScore === -Infinity) {
            return;
        }
        const bestIdx = bestY * this.surface.width + bestX;
        const propagated = damageIncrement * (0.18 + mat.brittleness * 0.28);
        this.damage[bestIdx] = Math.min(1, this.damage[bestIdx] + propagated);
    }
    detachCell(mapX, mapY, cellAreaMm2, materialThicknessMm, permanentDepth, mat, shearResponse) {
        const idx = mapY * this.surface.width + mapX;
        if (this.detached[idx]) {
            return;
        }
        this.detached[idx] = 1;
        this.damage[idx] = 1;
        this.edgeLift[idx] = 0;
        this.debrisHeight[idx] = 0;
        this.surface.data[idx] = Math.min(this.surface.data[idx], -materialThicknessMm);
        const detachedVolumeMm3 = cellAreaMm2 * materialThicknessMm;
        const debrisFraction = Math.min(0.75, 0.22 + mat.flow * 0.28 + mat.brittleness * 0.18);
        this.depositDebris(mapX, mapY, detachedVolumeMm3 * debrisFraction, cellAreaMm2, shearResponse);
        this.liftFractureEdges(mapX, mapY, materialThicknessMm, permanentDepth, mat, shearResponse);
    }
    depositDebris(mapX, mapY, volumeMm3, cellAreaMm2, shearResponse) {
        if (volumeMm3 <= 0) {
            return;
        }
        const offsetCells = Math.max(1, Math.round((1.5 + shearResponse.lateralDisplacement) * this.surface.resolution));
        const centerX = mapX + Math.round(shearResponse.trailingX * offsetCells);
        const centerY = mapY + Math.round(shearResponse.trailingY * offsetCells);
        const radius = Math.max(1, Math.ceil(0.5 * this.surface.resolution));
        let totalWeightedAreaMm2 = 0;
        for (let y = centerY - radius; y <= centerY + radius; y++) {
            for (let x = centerX - radius; x <= centerX + radius; x++) {
                if (x < 0 || x >= this.surface.width || y < 0 || y >= this.surface.height) {
                    continue;
                }
                const idx = y * this.surface.width + x;
                if (this.detached[idx]) {
                    continue;
                }
                const distance = Math.hypot(x - centerX, y - centerY);
                if (distance <= radius) {
                    totalWeightedAreaMm2 += (1 - distance / (radius + 1)) * cellAreaMm2;
                }
            }
        }
        if (totalWeightedAreaMm2 <= 0) {
            return;
        }
        for (let y = centerY - radius; y <= centerY + radius; y++) {
            for (let x = centerX - radius; x <= centerX + radius; x++) {
                if (x < 0 || x >= this.surface.width || y < 0 || y >= this.surface.height) {
                    continue;
                }
                const idx = y * this.surface.width + x;
                if (this.detached[idx]) {
                    continue;
                }
                const distance = Math.hypot(x - centerX, y - centerY);
                if (distance <= radius) {
                    const weight = 1 - distance / (radius + 1);
                    this.debrisHeight[idx] += (volumeMm3 * weight) / totalWeightedAreaMm2;
                }
            }
        }
    }
    liftFractureEdges(mapX, mapY, materialThicknessMm, permanentDepth, mat, shearResponse) {
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
    applyShearSmear(mapX, mapY, permanentDepth, shearResponse, substepScale) {
        if (shearResponse.smearDepth <= 0 || permanentDepth <= 0) {
            return;
        }
        this.validateRange(substepScale, 'substepScale', 0, 1);
        const offsetCells = Math.max(1, Math.round(shearResponse.lateralDisplacement * this.surface.resolution));
        const targetX = mapX + Math.round(shearResponse.trailingX * offsetCells);
        const targetY = mapY + Math.round(shearResponse.trailingY * offsetCells);
        const smearHeight = Math.min(permanentDepth * 0.35, shearResponse.smearDepth * substepScale);
        this.safeAdd(targetX, targetY, smearHeight);
    }
    addBiasedPileUp(startX, startY, width, height, volumeMm3, cellAreaMm2, shearResponse) {
        if (volumeMm3 <= 0) {
            return;
        }
        const offsetCells = Math.max(1, Math.round((1 + shearResponse.lateralDisplacement) * this.surface.resolution));
        const centerX = startX + Math.floor(width / 2) + Math.round(shearResponse.trailingX * offsetCells);
        const centerY = startY + Math.floor(height / 2) + Math.round(shearResponse.trailingY * offsetCells);
        const radius = Math.max(1, Math.ceil(Math.max(width, height) * 0.22));
        let totalWeightedAreaMm2 = 0;
        for (let y = centerY - radius; y <= centerY + radius; y++) {
            for (let x = centerX - radius; x <= centerX + radius; x++) {
                if (x < 0 || x >= this.surface.width || y < 0 || y >= this.surface.height) {
                    continue;
                }
                const idx = y * this.surface.width + x;
                if (this.detached[idx]) {
                    continue;
                }
                const distance = Math.hypot(x - centerX, y - centerY);
                if (distance <= radius) {
                    totalWeightedAreaMm2 += (1 - distance / (radius + 1)) * cellAreaMm2;
                }
            }
        }
        if (totalWeightedAreaMm2 <= 0) {
            return;
        }
        for (let y = centerY - radius; y <= centerY + radius; y++) {
            for (let x = centerX - radius; x <= centerX + radius; x++) {
                if (x < 0 || x >= this.surface.width || y < 0 || y >= this.surface.height) {
                    continue;
                }
                const idx = y * this.surface.width + x;
                if (this.detached[idx]) {
                    continue;
                }
                const distance = Math.hypot(x - centerX, y - centerY);
                if (distance <= radius) {
                    const weight = 1 - distance / (radius + 1);
                    this.safeAdd(x, y, (volumeMm3 * weight) / totalWeightedAreaMm2);
                }
            }
        }
    }
    getShearRoughness(mapX, mapY, amount, permanentDepth) {
        if (amount <= 0) {
            return 0;
        }
        this.validatePositiveFinite(permanentDepth, 'permanentDepth');
        const xMm = mapX / this.surface.resolution;
        const yMm = mapY / this.surface.resolution;
        const signedNoise = (this.coordinateNoise(xMm + 0.173, yMm + 0.719) - 0.5) * amount;
        const depthBound = permanentDepth * 0.2;
        return Math.max(-depthBound, Math.min(depthBound, signedNoise));
    }
    createSurfaceDetailMap(originX, originY, directionDeg, lengthMm, kernel, penetration, chatterParam, shearResponse) {
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
                const shearTear = (this.coordinateNoise(alongMm + 0.311, acrossMm + 0.577) - 0.5) * shearResponse.tearRoughness * 0.18;
                const shearSmear = shearResponse.smearDepth * 0.12 * Math.max(0, 1 - Math.abs(acrossMm) / (widthMm / 2));
                const fade = Math.sin(Math.PI * x / (lengthSamples - 1));
                const height = (crossSection + chatter + waviness + shearTear + shearSmear) * Math.max(0, fade);
                const idx = y * lengthSamples + x;
                data[idx] = height;
                if (height < minHeight)
                    minHeight = height;
                if (height > maxHeight)
                    maxHeight = height;
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
    getCharacteristicLength(kernel, penetrationDepth) {
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
    computeShearResponse(force, normalForce, contactAreaMm2, mat, kernel, speed, dirX, dirY) {
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
                asymmetricPileupBias: 0,
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
        const smearDepth = Math.min(0.08, (0.012 * boundedStress + instability * 0.01) * mat.smearFactor * (1 - mat.brittleness * 0.55));
        const asymmetricPileupBias = Math.min(0.65, (0.18 * boundedStress + instability * 0.18 + 0.22 * tangentialShare) * (0.4 + mat.flow));
        const tearRoughness = Math.min(0.12, exceedance * (0.015 + mat.brittleness * 0.06) + instability * 0.02);
        const dirLen = Math.hypot(dirX, dirY);
        if (dirLen <= 0) {
            throw new Error('drag direction vector must be non-zero');
        }
        return {
            stressRatio,
            lateralDisplacement,
            smearDepth,
            asymmetricPileupBias,
            tearRoughness,
            trailingX: -dirX / dirLen,
            trailingY: -dirY / dirLen
        };
    }
    getDepthForContactArea(kernel, targetAreaMm2) {
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
    getContactAreaForDepth(kernel, penetrationDepth) {
        this.validateNonNegativeFinite(penetrationDepth, 'penetrationDepth');
        if (penetrationDepth === 0) {
            return 0;
        }
        if (!kernel.contactPatchLUT || kernel.contactPatchLUT.length === 0) {
            throw new Error('contactPatchLUT must be a non-empty array');
        }
        const lut = kernel.contactPatchLUT;
        if (penetrationDepth <= lut[0].depth) {
            return lut[0].areaMm2 * (penetrationDepth / lut[0].depth);
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
                return prev.areaMm2 + (next.areaMm2 - prev.areaMm2) * t;
            }
        }
        return lut[lut.length - 1].areaMm2;
    }
    buildContactPatchLUT(kernel, width, height) {
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
        const lut = [];
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
                        if (x < minX)
                            minX = x;
                        if (x > maxX)
                            maxX = x;
                        if (y < minY)
                            minY = y;
                        if (y > maxY)
                            maxY = y;
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
    createToolStriationProfile(config, sizeMM, wear, random) {
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
    getStriationConfig(type, override) {
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
    getToolShearConfig(type) {
        const config = TOOL_SHEAR_CONFIG[type];
        if (!config) {
            throw new Error(`Missing shear config for tool type "${type}"`);
        }
        this.validateRange(config.shearEfficiency, 'shearEfficiency', 0, 1);
        this.validatePositiveFinite(config.edgeDragFactor, 'edgeDragFactor');
        return config;
    }
    validateStriationConfig(config) {
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
    validateMaterialConstants(mat, materialType) {
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
    validateToolKernel(kernel) {
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
    computeToolHardnessFactor(toolHardnessMohs, materialHardnessMPa) {
        this.validateToolHardness(toolHardnessMohs);
        this.validatePositiveFinite(materialHardnessMPa, 'materialHardnessMPa');
        const toolHardnessMPa = this.interpolateMohsHardnessMPa(toolHardnessMohs);
        return Math.min(1, Math.max(0.05, toolHardnessMPa / materialHardnessMPa));
    }
    interpolateMohsHardnessMPa(mohs) {
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
    validateToolHardness(value) {
        this.validateRange(value, 'toolHardnessMohs', 1, 10);
    }
    validatePositiveFinite(value, label) {
        if (!Number.isFinite(value) || value <= 0) {
            throw new Error(`${label} must be a positive finite number`);
        }
    }
    validateNonNegativeFinite(value, label) {
        if (!Number.isFinite(value) || value < 0) {
            throw new Error(`${label} must be a non-negative finite number`);
        }
    }
    validateFinite(value, label) {
        if (!Number.isFinite(value)) {
            throw new Error(`${label} must be a finite number`);
        }
    }
    validateRange(value, label, min, max) {
        if (!Number.isFinite(value) || value < min || value > max) {
            throw new Error(`${label} must be between ${min} and ${max}`);
        }
    }
    degreesToRadians(degrees) {
        this.validateFinite(degrees, 'degrees');
        return degrees * Math.PI / 180;
    }
    coordinateNoise(xMm, yMm) {
        const xi = Math.round(xMm * 1000);
        const yi = Math.round(yMm * 1000);
        let state = (xi * 374761393 + yi * 668265263 + this.randomSeed * 1442695041) >>> 0;
        state = (state ^ (state >>> 13)) >>> 0;
        state = Math.imul(state, 1274126177) >>> 0;
        state = (state ^ (state >>> 16)) >>> 0;
        return state / 0x100000000;
    }
}
