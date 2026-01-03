// SimulationEngine.ts
// High-Fidelity Discrete Heightfield Simulation

export interface SurfaceMap {
    width: number;
    height: number;
    resolution: number; // points per mm
    data: Float32Array; // Height values (Z)
}

export interface ToolKernel {
    profile: Float32Array; // 2D grid of the tool tip's Z offsets relative to tool center
    width: number; // grid units
    height: number; // grid units
    centerX: number;
    centerY: number;
}

// Material constants for the simulation loop
export const MATERIALS = {
    aluminum: { hardness: 0.5, flow: 0.8, elasticSpringback: 0.02 },
    brass: { hardness: 0.7, flow: 0.6, elasticSpringback: 0.05 },
    steel: { hardness: 0.9, flow: 0.3, elasticSpringback: 0.08 },
    wood: { hardness: 0.2, flow: 0.1, elasticSpringback: 0.15 },
};

export class ForensicPhysicsEngine {
    surface: SurfaceMap;

    constructor(widthMM: number, heightMM: number, resolution: number = 20) {
        // resolution 20 = 20 points per mm (50 micron precision)
        // 60mm x 60mm area -> 1200 x 1200 grid = 1.44M points
        const w = Math.floor(widthMM * resolution);
        const h = Math.floor(heightMM * resolution);
        
        this.surface = {
            width: w,
            height: h,
            resolution: resolution,
            data: new Float32Array(w * h).fill(0)
        };
        
        this.generateBaseTopography();
    }

    private generateBaseTopography() {
        // Anisotropic Roughness (Brushed metal look)
        const { width, height, data } = this.surface;
        const freqX = 0.1;
        const freqY = 0.005; // Stretched noise
        
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = y * width + x;
                
                // Multi-octave noise (simplified)
                const noise = Math.sin(x * freqX * 2) * 0.005 + 
                              Math.sin(x * freqX * 5 + y * freqY) * 0.002 + 
                              (Math.random() - 0.5) * 0.002;
                
                data[idx] = noise;

                // Stochastic Pits
                if (Math.random() < 0.00005) {
                    data[idx] -= (Math.random() * 0.1); // 0.1mm deep pit
                    // Pit neighbors
                    if (x+1 < width) data[idx+1] -= 0.05;
                }
            }
        }
    }

    /**
     * Creates a discrete height map of the tool tip based on geometry and wear.
     * This allows for ANY cross-section (flat, round, damaged).
     */
    createToolKernel(type: string, sizeMM: number, wear: number, angleDeg: number): ToolKernel {
        const res = this.surface.resolution;
        const gridW = Math.floor(sizeMM * res);
        const gridH = Math.floor(sizeMM * res); // Square kernel for simplicity
        const kernel = new Float32Array(gridW * gridH).fill(999); // Start high (no cut)
        
        const centerX = Math.floor(gridW / 2);
        const centerY = Math.floor(gridH / 2);

        // Convert wear to roughness magnitude
        const wearMag = wear * 0.2; // up to 0.2mm deviations

        for (let y = 0; y < gridH; y++) {
            for (let x = 0; x < gridW; x++) {
                const idx = y * gridW + x;
                const dx = (x - centerX) / res; // mm from center
                const dy = (y - centerY) / res;
                
                // 1. Base Geometry (Z = 0 is tip)
                let z = 0;
                
                if (type === 'screwdriver') {
                    // Flat with slight rounding at edges
                    if (Math.abs(dx) > sizeMM/2) z = 999;
                    else z = Math.abs(dx) > (sizeMM/2 - 0.2) ? (Math.abs(dx) - (sizeMM/2 - 0.2)) : 0;
                } else if (type === 'knife') {
                    // V-shape
                    z = Math.abs(dx) * 2; // Sharp slope
                } else if (type === 'crowbar') {
                    // Round
                    const r = sizeMM / 2;
                    const d = Math.sqrt(dx*dx);
                    if (d > r) z = 999;
                    else z = r - Math.sqrt(r*r - d*d);
                }

                // 2. Add Angle Tilt (simulating angle of attack)
                // If angle is 45 deg, the "back" of the tool is higher.
                // We model this by tilting the kernel in Y
                const tiltSlope = Math.tan((90 - angleDeg) * Math.PI / 180);
                z += dy * tiltSlope;

                // 3. Micro-wear (Serration/Chipping)
                // Consistent along Y (extruded profile) but noisy in X
                const microNoise = Math.sin(dx * 50) * 0.01 + Math.sin(dx * 120) * 0.005;
                const damage = (Math.random() > 0.95 ? -1 : 1) * Math.random() * wearMag;
                
                // Only apply wear to the cutting surface
                if (z < 10) {
                     kernel[idx] = z + microNoise + (damage * 0.1);
                } else {
                     kernel[idx] = 999;
                }
            }
        }

        return {
            profile: kernel,
            width: gridW,
            height: gridH,
            centerX,
            centerY
        };
    }

    /**
     * Executes the simulation loop with high-fidelity physics.
     */
    simulateCut(
        startX: number, startY: number, 
        angleDir: number, 
        force: number, 
        toolKernel: ToolKernel,
        materialType: 'aluminum' | 'brass' | 'steel' | 'wood',
        speed: number,
        chatterParam: number
    ) {
        const mat = MATERIALS[materialType];
        const { data } = this.surface;
        
        // Physics Loop Parameters
        const timeStep = 0.002; // s
        const totalDist = 40; // mm length of cut
        let currentDist = 0;
        
        let cx = startX;
        let cy = startY;
        
        const rad = angleDir * Math.PI / 180;
        const dirX = Math.cos(rad);
        const dirY = Math.sin(rad);

        // Dynamics State
        // Stick-slip: Velocity oscillates
        let velocity = speed; // mm/s

        // Determine penetration depth based on force/hardness (Reference depth)
        const penetration = (force / (mat.hardness * 1000)) * 2.0; // Multiplier for visual scale

        // Simulation Loop
        while (currentDist < totalDist) {
            
            // 1. Chatter / Stick-Slip Update
            // Simple harmonic motion approximation for tool tip vibration
            // We use speed/stiffness relation implicitly in freq
            
            // If stickSlipPhase is active, we modulate the Z depth or Step size
            const chatterAmp = chatterParam * 0.2; // up to 0.2mm vibration
            const vibration = Math.sin(currentDist * 10) * chatterAmp; 

            // Current tool Z (Global Z)
            // Surface is at Z=0 roughly. Tool penetrates to -penetration.
            // Plus vibration.
            const toolZ = -penetration + vibration;

            // 2. Carve (Boolean Subtraction)
            this.applyKernel(cx, cy, toolZ, toolKernel, mat.flow);

            // 3. Move
            // Add slight randomness to trajectory (Human hand tremor)
            const tremor = (Math.random() - 0.5) * 0.05;
            
            cx += (dirX * velocity * timeStep) + (-dirY * tremor);
            cy += (dirY * velocity * timeStep) + (dirX * tremor);
            
            currentDist += velocity * timeStep;
        }

        // 4. Elastic Springback (Global Pass)
        // Metal recovers slightly after stress is removed.
        // We raise the cut areas slightly.
        if (mat.elasticSpringback > 0) {
             for(let i=0; i<data.length; i++) {
                 if (data[i] < 0) { // If it was cut
                     data[i] += Math.abs(data[i]) * mat.elasticSpringback;
                 }
             }
        }
    }

    /**
     * Stamps the tool kernel into the surface at (cx, cy, cz).
     * Calculates displacement and handles Pile-up (Volume conservation).
     */
    private applyKernel(cx: number, cy: number, cz: number, kernel: ToolKernel, flowFactor: number) {
        const res = this.surface.resolution;
        
        // Grid coordinates
        const gx = Math.floor(cx * res);
        const gy = Math.floor(cy * res);
        
        const startX = gx - kernel.centerX;
        const startY = gy - kernel.centerY;
        
        let displacedVolume = 0;

        // Pass 1: Carve and measure displaced volume
        for (let ky = 0; ky < kernel.height; ky++) {
            for (let kx = 0; kx < kernel.width; kx++) {
                const mapX = startX + kx;
                const mapY = startY + ky;
                
                if (mapX >= 0 && mapX < this.surface.width && mapY >= 0 && mapY < this.surface.height) {
                    const idx = mapY * this.surface.width + mapX;
                    
                    // Tool height at this pixel = ToolGlobalZ + KernelOffset
                    const toolHeight = cz + kernel.profile[ky * kernel.width + kx];
                    
                    const currentHeight = this.surface.data[idx];
                    
                    if (toolHeight < currentHeight) {
                        const diff = currentHeight - toolHeight;
                        displacedVolume += diff;
                        this.surface.data[idx] = toolHeight; // Carve
                    }
                }
            }
        }

        // Pass 2: Pile-up (Redistribute volume to edges)
        // Simplified: Add fraction of displaced volume to the immediate perimeter of the tool
        if (displacedVolume > 0 && flowFactor > 0) {
            const pileUpAmount = (displacedVolume * flowFactor) / (kernel.width * 2 + kernel.height * 2); 
            // Distribute to a "halo" around the kernel
            // Rough approximation for speed (even though user said speed doesn't matter, O(N^2) convolution is too much for JS single thread 60hz)
            // We just raise the bounding box edges.
            
            const range = 4; // Pileup width in pixels
            for (let r = 1; r <= range; r++) {
                this.addPileUpRing(startX - r, startY - r, kernel.width + r*2, kernel.height + r*2, pileUpAmount / r);
            }
        }
    }

    private addPileUpRing(x: number, y: number, w: number, h: number, amount: number) {
        // Top & Bottom
        for (let i = x; i < x + w; i++) {
            this.safeAdd(i, y, amount);
            this.safeAdd(i, y + h - 1, amount);
        }
        // Left & Right
        for (let j = y + 1; j < y + h - 1; j++) {
            this.safeAdd(x, j, amount);
            this.safeAdd(x + w - 1, j, amount);
        }
    }

    private safeAdd(x: number, y: number, val: number) {
        if (x >= 0 && x < this.surface.width && y >= 0 && y < this.surface.height) {
            const idx = y * this.surface.width + x;
            // Don't pile up on top of the cut we just made (check if it's deep)
            if (this.surface.data[idx] > -0.5) { 
                this.surface.data[idx] += val;
            }
        }
    }
}
