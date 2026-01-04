export interface TraceProfile {
    depthProfile: number[]; // Cross-section depth shape (normalized -1 to 1)
    maxDepth: number; // mm
    width: number; // mm
    pileUpHeight: number; // mm (material pushed to sides)
    striationMap: number[]; // 1D High-res array representing tool edge irregularities
    chatterFreq: number; // Spatial frequency of chatter
    chatterAmp: number; // Amplitude of chatter
}

const MATERIAL_PROPERTIES = {
    aluminum: { yieldStrength: 95, hardness: 167 }, // MPa, Brinell approx
    brass: { yieldStrength: 200, hardness: 120 },
    steel: { yieldStrength: 350, hardness: 490 }, // Hardened steel
    wood: { yieldStrength: 40, hardness: 30 }, // Janka approx
};

const TOOL_GEOMETRY = {
    screwdriver: { tipWidth: 6, sharpness: 0.3, profile: 'flat' },
    knife: { tipWidth: 0.5, sharpness: 0.95, profile: 'wedge' },
    crowbar: { tipWidth: 20, sharpness: 0.1, profile: 'round' },
};

/**
 * Generates a consistent microscopic edge signature for the tool
 * simulating manufacturing grinding marks + wear.
 */
const generateToolSignature = (_width: number, wear: number, random: () => number): number[] => {
    // Width isn't strictly needed for the 1D signature pattern generation itself, 
    // but kept in signature for potential future scaling.
    const resolution = 100; // samples across the width
    const signature: number[] = [];
    
    // Base manufacturing marks (regular grinding)
    if (typeof random !== 'function') {
        throw new Error('random must be a function');
    }
    const grindFreq = 10 + random() * 20;
    
    for (let i = 0; i < resolution; i++) {
        const x = i / resolution;
        
        // 1. Base geometric profile (flat vs round vs wedge handled in main loop, this is micro-deviation)
        let microZ = 0;
        
        // 2. Grinding marks (Sine waves)
        microZ += Math.sin(x * grindFreq * Math.PI * 2) * 0.05;
        
        // 3. Wear (Random high-freq noise + notches)
        const wearNoise = (random() - 0.5) * wear * 0.5;
        
        // Occasional deep notches (chips in blade)
        if (random() < wear * 0.1) {
             microZ -= (random() * wear * 1.0); 
        }

        signature.push(microZ + wearNoise);
    }
    return signature;
};

export const calculateTracePhysics = (
    toolType: 'screwdriver' | 'knife' | 'crowbar',
    material: 'aluminum' | 'brass' | 'steel' | 'wood',
    force: number,
    angle: number,
    speed: number,
    chatter: number,
    toolWear: number,
    toolHardness: number,
    random: () => number
): TraceProfile => {
    
    if (typeof random !== 'function') {
        throw new Error('random must be a function');
    }
    
    const mat = MATERIAL_PROPERTIES[material];
    const tool = TOOL_GEOMETRY[toolType];

    // --- 1. Contact Mechanics & Depth ---
    // Effective Downward Force (Normal Force)
    const angleRad = (angle * Math.PI) / 180;
    const Fn = force * Math.sin(angleRad);
    const Ft = force * Math.cos(angleRad); // Tangential force (drag)

    // Plastic Deformation Depth Estimation (Simplified Meyer's Law-ish)
    // Depth is proportional to Force / Hardness. 
    // We adjust for tool sharpness (Stress Concentrator).
    const stressConcentration = 1 / (1 - tool.sharpness + 0.01);
    
    // Hardness differential (Tool must be harder than material to cut effectively)
    // If tool is softer, it deforms/dulls, effective force reduced.
    const hardnessRatio = Math.min(2, Math.max(0, toolHardness * 20 / mat.hardness)); // Rough mapping
    
    let maxDepth = (Fn * stressConcentration * hardnessRatio) / (mat.yieldStrength * 5);
    maxDepth = Math.min(Math.max(maxDepth, 0), 15); // Clamp 0-15mm

    // --- 2. Width & Profile ---
    // Width depends on depth and tool geometry.
    // Flat: Width is constant (tipWidth) unless depth is tiny.
    // Wedge/Round: Width grows with depth.
    let width = tool.tipWidth;
    if (tool.profile === 'wedge') {
        width = Math.min(tool.tipWidth, maxDepth * 0.5); // Thin cut
    } else if (tool.profile === 'round') {
        width = Math.min(tool.tipWidth, Math.sqrt(maxDepth * tool.tipWidth)); // Chord of circle
    }

    // --- 3. Pile-up (Material Displacement) ---
    // In plastic deformation, material isn't just deleted, it's pushed up to the sides.
    // Harder materials pile up less (brittle fracture) vs soft (ductile flow).
    // Pile-up height is approx 10-20% of depth for ductile metals.
    const ductility = material === 'aluminum' || material === 'brass' ? 1.5 : 1.0;
    const pileUpHeight = maxDepth * 0.15 * ductility;

    // --- 4. Chatter / Stick-Slip ---
    // Chatter frequency increases with speed and material stiffness.
    // f ~ sqrt(k/m). We simulate this as a spatial frequency.
    const baseFreq = 0.5; // per mm
    const chatterFreq = baseFreq * (1 + speed / 50); 
    
    // Amplitude depends on unstable friction (stick-slip)
    // Higher Tangential Force (Ft) + low speed = more stick-slip instability.
    // We model this by scaling the user chatter param with Ft.
    const instabilityFactor = (Ft / 100) * (1 + (100 / speed)); // High drag, low speed -> unstable
    const chatterAmp = chatter * (maxDepth * 0.2) * instabilityFactor;

    // --- 5. Micro-Striations ---
    const striationMap = generateToolSignature(width, toolWear, random);

    return {
        depthProfile: [], // Calculated in renderer per vertex for speed
        maxDepth,
        width,
        pileUpHeight,
        striationMap,
        chatterFreq,
        chatterAmp
    };
};
