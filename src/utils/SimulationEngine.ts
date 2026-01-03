// SimulationEngine.ts
// High-Fidelity Discrete Heightfield Simulation

export interface SurfaceMap {
    width: number;
    height: number;
    resolution: number; // points per mm
    data: Float64Array; // High-precision Height values (Z)
}

export interface ToolKernel {
    profile: Float64Array; // 2D grid of the tool tip's Z offsets relative to tool center
    width: number; // grid units
    height: number; // grid units
    centerX: number;
    centerY: number;
    sharpness: number; // 0-1 (1 is razor sharp)
}

// Material constants for the simulation loop
export const MATERIALS = {
    // Brittleness: 0 = Clay (100% Flow), 1 = Glass (100% Fracture/Chip)
    aluminum: { hardness: 0.5, flow: 0.8, elasticSpringback: 0.02, brittleness: 0.1 },
    brass: { hardness: 0.7, flow: 0.6, elasticSpringback: 0.05, brittleness: 0.2 },
    steel: { hardness: 0.9, flow: 0.3, elasticSpringback: 0.08, brittleness: 0.1 },
    wood: { hardness: 0.2, flow: 0.1, elasticSpringback: 0.15, brittleness: 0.9 }, // High brittleness = Splintering
    gold: { hardness: 0.3, flow: 0.95, elasticSpringback: 0.01, brittleness: 0.0 }, // Very ductile, piles up easily
};

export class ForensicPhysicsEngine {
    surface: SurfaceMap;

    constructor(widthMM: number, heightMM: number, resolution: number = 20) {
        const w = Math.floor(widthMM * resolution);
        const h = Math.floor(heightMM * resolution);
        
        this.surface = {
            width: w,
            height: h,
            resolution: resolution,
            data: new Float64Array(w * h).fill(0)
        };
        
        this.generateBaseTopography();
    }

    private generateBaseTopography() {
        const { width, height, data } = this.surface;
        const freqX = 0.1;
        const freqY = 0.005; 
        
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = y * width + x;
                const noise = Math.sin(x * freqX * 2) * 0.005 + 
                              Math.sin(x * freqX * 5 + y * freqY) * 0.002 + 
                              (Math.random() - 0.5) * 0.002;
                data[idx] = noise;
            }
        }
    }

    reset() {
        this.generateBaseTopography();
    }

    createToolKernel(type: string, sizeMM: number, wear: number, angleDeg: number, directionDeg: number): ToolKernel {
        const res = this.surface.resolution;
        const gridW = Math.floor(sizeMM * res);
        const gridH = Math.floor(sizeMM * res);
        const kernel = new Float64Array(gridW * gridH).fill(999);
        
        const centerX = Math.floor(gridW / 2);
        const centerY = Math.floor(gridH / 2);

        const wearMag = wear * 0.2; 
        let sharpness = 0.5;

        for (let y = 0; y < gridH; y++) {
            for (let x = 0; x < gridW; x++) {
                const idx = y * gridW + x;
                const dx = (x - centerX) / res;
                const dy = (y - centerY) / res;
                
                let z = 0;
                
                if (type === 'screwdriver') {
                    if (Math.abs(dx) > sizeMM/2) z = 999;
                    else z = Math.abs(dx) > (sizeMM/2 - 0.2) ? (Math.abs(dx) - (sizeMM/2 - 0.2)) : 0;
                    sharpness = 0.3;
                } else if (type === 'knife') {
                    z = Math.abs(dx) * 2; 
                    sharpness = 0.95;
                } else if (type === 'crowbar') {
                    const r = sizeMM / 2;
                    const d = Math.sqrt(dx*dx);
                    if (d > r) z = 999;
                    else z = r - Math.sqrt(r*r - d*d);
                    sharpness = 0.1;
                } else if (type === 'hammer_face') {
                    // Large flat circle with beveled edge
                    // sizeMM is diameter
                    const r = sizeMM / 2;
                    const dist = Math.sqrt(dx*dx + dy*dy);
                    if (dist > r) z = 999;
                    else if (dist > r * 0.8) z = (dist - r * 0.8); // Bevel
                    else z = 0; // Flat face
                    sharpness = 0.05; // Very blunt
                } else if (type === 'hammer_claw') {
                    // Two wedges separated by gap
                    // Claw curve in Y direction
                    const clawWidth = sizeMM * 0.4; // width of total assembly
                    const gap = sizeMM * 0.15;
                    
                    if (Math.abs(dx) < gap) {
                        z = 999; // Gap
                    } else if (Math.abs(dx) > clawWidth) {
                        z = 999; // Outside
                    } else {
                        // The claw prongs
                        // Tapered points
                        // Base shape is curved wedge
                        const prongCenter = gap + (clawWidth - gap)/2;
                        const localDx = Math.abs(Math.abs(dx) - prongCenter);
                        
                        // Sharpness of the claw tip
                        z = localDx * 1.5; 
                        
                        // Curve along Y (hook shape)
                        const curveY = (dy * dy) * 0.2;
                        z += curveY;
                    }
                    sharpness = 0.6;
                }

                const tiltSlope = Math.tan((90 - angleDeg) * Math.PI / 180);
                z += dy * tiltSlope;

                const microNoise = Math.sin(dx * 50) * 0.01 + Math.sin(dx * 120) * 0.005;
                const damage = (Math.random() > 0.95 ? -1 : 1) * Math.random() * wearMag;
                
                if (z < 10) {
                     kernel[idx] = z + microNoise + (damage * 0.1);
                } else {
                     kernel[idx] = 999;
                }
            }
        }

        return { profile: kernel, width: gridW, height: gridH, centerX, centerY, sharpness };
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
        materialType: 'aluminum' | 'brass' | 'steel' | 'wood' | 'gold',
        speed: number,
        chatterParam: number
    ): Generator<number> {
        const mat = MATERIALS[materialType];
        const { data } = this.surface;
        
        // Physics Loop Parameters
        const timeStep = 0.0005; // 0.5ms steps
        const totalDist = 40; // mm length of cut
        let currentDist = 0;
        
        let cx = startX;
        let cy = startY;
        
        const rad = angleDir * Math.PI / 180;
        const dirX = Math.cos(rad);
        const dirY = Math.sin(rad);

        let velocity = speed;
        const penetration = (force / (mat.hardness * 1000)) * 2.0;

        // Fracture Threshold
        const fractureThreshold = 0.5;

        let stepsTaken = 0;

        while (currentDist < totalDist) {
            
            // Chatter / Stick-Slip
            const chatterAmp = chatterParam * 0.2; 
            const vibration = Math.sin(currentDist * 10) * chatterAmp; 
            const toolZ = -penetration + vibration;

            // 1. Carve
            this.applyKernel(cx, cy, toolZ, toolKernel, mat);

            // 2. Fracture
            if (mat.brittleness > 0.5 && Math.abs(toolZ) > fractureThreshold) {
                if (Math.random() < mat.brittleness * 0.1) {
                    this.generateCrack(cx, cy, dirX, dirY, Math.abs(toolZ) * 2, mat.brittleness);
                }
            }

            // 3. Move
            const tremor = (Math.random() - 0.5) * 0.05;
            cx += (dirX * velocity * timeStep) + (-dirY * tremor);
            cy += (dirY * velocity * timeStep) + (dirX * tremor);
            
            currentDist += velocity * timeStep;
            stepsTaken++;

            // Yield every 500 steps (approx 10-20ms of work) to keep UI responsive
            if (stepsTaken % 500 === 0) {
                 const prog = (currentDist / totalDist) * 90; // Go up to 90%
                 yield prog;
            }
        }

        // 4. Elastic Springback (Global Pass) - Heavy!
        if (mat.elasticSpringback > 0) {
             for(let i=0; i<data.length; i++) {
                 if (data[i] < 0) { 
                     data[i] += Math.abs(data[i]) * mat.elasticSpringback;
                 }
             }
        }
        
        yield 100;
    }

    private applyKernel(cx: number, cy: number, cz: number, kernel: ToolKernel, mat: any) {
        const res = this.surface.resolution;
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
                        const diff = currentHeight - toolHeight;
                        displacedVolume += diff;
                        this.surface.data[idx] = toolHeight; // Carve
                        if (Math.abs(toolHeight) > maxDepth) maxDepth = Math.abs(toolHeight);
                    }
                }
            }
        }

        // Pass 2: Pile-up vs Chip Formation (New)
        if (displacedVolume > 0) {
            // How much material flows vs flies away?
            // High sharpness + High brittleness = High Chip Ratio (Low Pile-up)
            // Low sharpness (blunt) + Low brittleness (ductile) = High Pile-up
            
            const chipRatio = kernel.sharpness * mat.brittleness; // 0 to 1
            const flowVolume = displacedVolume * mat.flow * (1 - chipRatio);
            
            if (flowVolume > 0) {
                const pileUpAmount = flowVolume / (kernel.width * 2 + kernel.height * 2); 
                const range = 4;
                for (let r = 1; r <= range; r++) {
                    this.addPileUpRing(startX - r, startY - r, kernel.width + r*2, kernel.height + r*2, pileUpAmount / r);
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
        const side = Math.random() > 0.5 ? 1 : -1;
        const spread = (Math.random() - 0.5) * 1.0; // +/- 0.5 rad spread
        
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
        
        let length = energy * 5 * brittleness; // Crack length in mm
        let steps = Math.floor(length * res);
        
        // Walk the crack
        for(let i=0; i<steps; i++) {
            x += cDx * (1/res);
            y += cDy * (1/res);
            
            // Jitter path (lightning bolt style)
            x += (Math.random()-0.5) * 0.05;
            y += (Math.random()-0.5) * 0.05;

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
                         this.surface.data[idx] -= Math.random() * amount;
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
}