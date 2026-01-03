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

        // Convert Yaw to Rads
        // We want the tool to align with the drag direction.
        // If direction is 0 (East/Right), and we assume tool points along that axis.
        const yawRad = (directionDeg * Math.PI) / 180;
        const cosYaw = Math.cos(yawRad);
        const sinYaw = Math.sin(yawRad);

        const tiltSlope = Math.tan((90 - angleDeg) * Math.PI / 180);

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
                const damage = (Math.random() > 0.95 ? -1 : 1) * Math.random() * wearMag;
                
                // Temporarily store potentially valid Z. 
                // We don't clamp with 999 yet, we need to find minZ of the SHAPE first.
                // But we must distinguish "Outside Shape" from "Deep Shape".
                // We use the shape logic result (if z was set to 999 above, it stays 999)
                
                if (z < 500) { // If it was a valid point (not 999)
                    kernel[idx] = z + microNoise + (damage * 0.1);
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

        let velocity = speed; // mm/s
        
        // CORRECTION 1: Non-Linear Contact Mechanics (Meyer's Law / Hardness)
        // Depth d is related to Force F. 
        // For Sharp (Cone/Wedge): F = k * d^2  ->  d = sqrt(F/k)
        // For Blunt (Flat Punch): F = k * d    ->  d = F/k
        // We assume a hybrid based on tool sharpness.
        
        // Base penetration (Linear ref)
        const hardnessMPa = mat.hardness * 1000; // Arbitrary scale
        const baseDepth = force / hardnessMPa; 
        
        // Adjust based on tool profile
        // Sharp tools (Knife) follow Square Root law (penetrate easier initially, harder deeper)
        // Blunt tools (Hammer) follow Linear law
        let penetration = 0;
        if (toolKernel.sharpness > 0.8) {
             // Knife/Sharp: Power law 0.5
             // Scaling factor to match visual expectations
             penetration = Math.sqrt(baseDepth) * 2.0; 
        } else {
             // Blunt: Linear-ish
             penetration = baseDepth * 2.0;
        }

        // Fracture Threshold
        const fractureThreshold = 0.5;

        let stepsTaken = 0;
        
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
                
                let totalWeightedArea = 0;
                const weights: number[] = [];
                const ringPixels: number[] = [];
                
                for(let r=1; r<=range; r++) {
                    // Pixels in this ring = Area(r) - Area(r-1)
                    // Simplified: Perimeter is roughly 2w + 2h + 8r
                    const p = 2*(kernel.width + kernel.height) + 8*r;
                    
                    const weight = 1.0 / r; // Decay
                    weights.push(weight);
                    ringPixels.push(p);
                    totalWeightedArea += p * weight;
                }
                
                // Now distribute
                for (let r = 1; r <= range; r++) {
                    const weight = weights[r-1];
                    // Volume for this ring = TotalVolume * ( (Pixels*Weight) / TotalWeightedArea )
                    // Height to add = VolumeRing / PixelsRing
                    // Combined: Height = (TotalVolume * Weight) / TotalWeightedArea
                    
                    const heightToAdd = (flowVolume * weight) / totalWeightedArea;
                    
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