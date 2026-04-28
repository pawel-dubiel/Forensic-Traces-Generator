import React, { useMemo, useRef, useEffect, useState, useCallback } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Environment, Grid, Text } from '@react-three/drei';
import * as THREE from 'three';
import type { SimulationState } from '../App';
import { ForensicPhysicsEngine } from '../utils/SimulationEngine';
import type { SurfaceDetailMap, ToolPathPoint } from '../utils/SimulationEngine';
import { ScrewdriverModel, KnifeModel, CrowbarModel, HammerFaceModel, HammerClawModel, SpoonModel } from './Tools3D';
import { createSeededRandom, deriveSeed } from '../utils/random';

interface LabProps {
  simState: SimulationState;
  setSimState?: React.Dispatch<React.SetStateAction<SimulationState>>;
}

// Resolution Settings
// 60mm plate size. 
// 15 pts/mm = 900x900 = 810k verts (Medium)
// 30 pts/mm = 1800x1800 = 3.24M verts (High Fidelity - Forensically Accurate)
export const MAX_RENDER_RESOLUTION = 40;
const WIDTH_MM = 60;
const HEIGHT_MM = 60;

const getRenderResolution = (value: number) => {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    throw new Error('resolution must be a positive integer');
  }
  if (value > MAX_RENDER_RESOLUTION) {
    throw new Error(`resolution must be ${MAX_RENDER_RESOLUTION} pts/mm or lower for the current renderer`);
  }
  return value;
};

const ForensicScaleBar: React.FC<{ position?: [number, number, number], rotation?: [number, number, number] }> = ({ position, rotation }) => {
    // ABFO-style L-ruler
    // 20mm x 20mm scale
    const size = 20; 
    const thick = 0.5;

    return (
        <group position={position || [-WIDTH_MM/2 + 2, -HEIGHT_MM/2 + 2, 0.1]} rotation={rotation || [0,0,0]}>
            {/* L-Shape Body */}
            <mesh position={[size/2, -thick/2, 0]}>
                <boxGeometry args={[size, thick, 0.1]} />
                <meshBasicMaterial color="white" />
            </mesh>
            <mesh position={[-thick/2, size/2, 0]}>
                <boxGeometry args={[thick, size, 0.1]} />
                <meshBasicMaterial color="white" />
            </mesh>

            {/* Ticks X Axis */}
            {Array.from({length: size}).map((_, i) => (
                <group key={`x-${i}`} position={[i, 0, 0.06]}>
                     <mesh position={[0, -thick/2, 0]}>
                        <planeGeometry args={[0.2, i % 5 === 0 ? thick : thick/2]} />
                        <meshBasicMaterial color="black" />
                     </mesh>
                </group>
            ))}
            
            {/* Ticks Y Axis */}
            {Array.from({length: size}).map((_, i) => (
                <group key={`y-${i}`} position={[0, i, 0.06]}>
                     <mesh position={[-thick/2, 0, 0]} rotation={[0,0,Math.PI/2]}>
                        <planeGeometry args={[0.2, i % 5 === 0 ? thick : thick/2]} />
                        <meshBasicMaterial color="black" />
                     </mesh>
                </group>
            ))}

            {/* Labels */}
            <Text position={[10, -2, 0]} fontSize={2} color="white" anchorX="center" anchorY="top">
                10mm
            </Text>
            <Text position={[-2, 10, 0]} fontSize={2} color="white" rotation={[0,0,Math.PI/2]} anchorX="center" anchorY="bottom">
                10mm
            </Text>
        </group>
    );
};

const MaterialSurface: React.FC<{
  simState: SimulationState;
  setSimState?: React.Dispatch<React.SetStateAction<SimulationState>>;
  onToolPathUpdate?: (path: ToolPathPoint[]) => void;
  onDetailMapUpdate?: (detailMap: SurfaceDetailMap | null) => void;
}> = ({ simState, setSimState, onToolPathUpdate, onDetailMapUpdate }) => {
  const meshRef = useRef<THREE.Mesh>(null);
  
  // Initialize Engine
  const resolution = getRenderResolution(simState.resolution);
  const engine = useMemo(
    () => new ForensicPhysicsEngine(WIDTH_MM, HEIGHT_MM, resolution, simState.randomSeed),
    [simState.randomSeed, resolution]
  );
  const {
    angle,
    chatter,
    direction,
    force,
    material,
    randomSeed,
    speed,
    timeStep,
    toolHardness,
    toolType,
    toolWear
  } = simState;

  const updateMeshFromEngine = useCallback(() => {
    if (!meshRef.current) return;
    const geometry = meshRef.current.geometry;
    const positions = geometry.attributes.position;

    // Check/Init colors attribute if needed for Heatmap
    if (!geometry.attributes.color) {
        geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(positions.count * 3), 3));
    }
    const colors = geometry.attributes.color;

    const engineData = engine.surface.data;

    // Fast pass if needed, or fixed scale (-2mm to +2mm)
    // Let's use fixed scale for consistency: Blue = -1mm, Green = 0, Red = +1mm

    for (let i = 0; i < positions.count; i++) {
        if (i < engineData.length) {
            const z = engineData[i];
            positions.setZ(i, z);

            // Heatmap Coloring
            // Map Z to RGB
            // Deep (negative) = Blue, High (positive/pileup) = Red
            // Scale: +/- 2.0mm range (Auto-scaling or wider fixed)
            const t = Math.max(-1, Math.min(1, z / 2.0)); // -1 to 1

            let r=0, g=0, b=0;
            if (t < 0) {
                // Negative: Green (0) to Blue (-1)
                g = 1 + t; // 1 to 0
                b = -t;    // 0 to 1
                r = 0;
            } else {
                // Positive: Green (0) to Red (1)
                g = 1 - t; // 1 to 0
                r = t;     // 0 to 1
                b = 0;
            }
            colors.setXYZ(i, r, g, b);
        }
    }

    positions.needsUpdate = true;
    colors.needsUpdate = true;
    geometry.computeVertexNormals();
  }, [engine]);

  const runSimulation = useCallback(async () => {
    if (!meshRef.current) return;
    if (onToolPathUpdate) {
      onToolPathUpdate([]);
    }
    if (onDetailMapUpdate) {
      onDetailMapUpdate(null);
    }

    // 1. Create Tool Kernel
    let toolSize = 6;
    if (toolType === 'crowbar') toolSize = 10;
    if (toolType === 'knife') toolSize = 1;
    if (toolType === 'hammer_face') toolSize = 25;
    if (toolType === 'hammer_claw') toolSize = 30;
    if (toolType === 'spoon') toolSize = 30;

    const baseRandom = createSeededRandom(randomSeed);
    const striationRandom = createSeededRandom(deriveSeed(randomSeed, 1));

    const kernel = engine.createToolKernel(
        toolType,
        toolSize,
        toolWear,
        angle,
        direction,
        {
          baseRandom,
          striationRandom,
          striationsEnabled: true
        }
    );

    if (!Number.isFinite(timeStep) || timeStep <= 0) {
      throw new Error('timeStep must be a positive finite number');
    }

    // 2. Execute Physics Loop (Generator Pattern)
    const generator = engine.simulateCutGenerator(
        10, 30, // Start X, Y
        direction,
        force,
        kernel,
        material,
        toolHardness,
        speed,
        chatter,
        timeStep
    );

    // Iterate through generator to allow UI updates
    for (const progress of generator) {
        if (setSimState) {
            setSimState(prev => ({ ...prev, progress }));
        }
        // Yield to event loop to let React render progress bar
        await new Promise(resolve => setTimeout(resolve, 0));
    }

    // 3. Update Mesh at the end
    updateMeshFromEngine();
    if (onToolPathUpdate) {
      onToolPathUpdate(engine.getToolPath());
    }
    if (onDetailMapUpdate) {
      onDetailMapUpdate(engine.getSurfaceDetailMap());
    }
    
    // Reset simulation flag
    if (setSimState) {
        setSimState(prev => ({ ...prev, isSimulating: false, progress: 100 }));
    }
  }, [
    angle,
    chatter,
    direction,
    engine,
    force,
    material,
    onDetailMapUpdate,
    onToolPathUpdate,
    randomSeed,
    setSimState,
    speed,
    timeStep,
    toolHardness,
    toolType,
    toolWear,
    updateMeshFromEngine
  ]);

  useEffect(() => {
    updateMeshFromEngine();
  }, [updateMeshFromEngine]);

  useEffect(() => {
    if (simState.isSimulating) {
        runSimulation();
    }
  }, [runSimulation, simState.isSimulating]);

  useEffect(() => {
    if (simState.isResetting) {
        engine.reset();
        updateMeshFromEngine();
        if (onToolPathUpdate) {
          onToolPathUpdate([]);
        }
        if (onDetailMapUpdate) {
          onDetailMapUpdate(null);
        }
    }
  }, [engine, onDetailMapUpdate, onToolPathUpdate, simState.isResetting, updateMeshFromEngine]);

  const materialColor = useMemo(() => {
    switch(simState.material) {
        case 'aluminum': return '#d6d6d6';
        case 'brass': return '#e6c35c';
        case 'steel': return '#757980';
        case 'wood': return '#8a5e3a';
        case 'gold': return '#ffd700';
    }
    throw new Error(`Unsupported material "${simState.material}"`);
  }, [simState.material]);

  return (
    <mesh ref={meshRef} rotation={[-Math.PI / 2, 0, 0]} receiveShadow castShadow>
      <planeGeometry
        args={[
          WIDTH_MM,
          HEIGHT_MM,
          Math.floor(WIDTH_MM * resolution) - 1,
          Math.floor(HEIGHT_MM * resolution) - 1
        ]}
      />
      
      {simState.viewMode === 'standard' && (
          <meshStandardMaterial 
            color={materialColor} 
            roughness={simState.material === 'wood' ? 0.9 : 0.4} 
            metalness={simState.material === 'wood' ? 0.0 : 0.8}
            side={THREE.DoubleSide}
            flatShading={false}
          />
      )}

      {simState.viewMode === 'heatmap' && (
          <meshBasicMaterial 
            vertexColors={true}
            side={THREE.DoubleSide}
          />
      )}

      {simState.viewMode === 'normal' && (
          <meshNormalMaterial side={THREE.DoubleSide} />
      )}
    </mesh>
  );
};

const DetailMapOverlay: React.FC<{ detailMap: SurfaceDetailMap | null }> = ({ detailMap }) => {
  const texture = useMemo(() => {
    if (!detailMap) return null;

    const canvas = document.createElement('canvas');
    canvas.width = detailMap.lengthSamples;
    canvas.height = detailMap.widthSamples;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('2D canvas context is required for detail map texture');
    }

    const image = context.createImageData(canvas.width, canvas.height);
    const range = Math.max(Math.abs(detailMap.minHeight), Math.abs(detailMap.maxHeight), 0.001);

    for (let i = 0; i < detailMap.data.length; i++) {
      const normalized = Math.max(-1, Math.min(1, detailMap.data[i] / range));
      const shade = Math.round(128 + normalized * 105);
      const alpha = Math.round(Math.min(180, 40 + Math.abs(normalized) * 160));
      const out = i * 4;
      image.data[out] = shade;
      image.data[out + 1] = shade;
      image.data[out + 2] = shade;
      image.data[out + 3] = alpha;
    }

    context.putImageData(image, 0, 0);
    const canvasTexture = new THREE.CanvasTexture(canvas);
    canvasTexture.wrapS = THREE.ClampToEdgeWrapping;
    canvasTexture.wrapT = THREE.ClampToEdgeWrapping;
    canvasTexture.minFilter = THREE.LinearFilter;
    canvasTexture.magFilter = THREE.LinearFilter;
    canvasTexture.colorSpace = THREE.SRGBColorSpace;
    canvasTexture.needsUpdate = true;
    return canvasTexture;
  }, [detailMap]);

  useEffect(() => () => texture?.dispose(), [texture]);

  if (!detailMap || !texture) {
    return null;
  }

  const directionRad = detailMap.directionDeg * Math.PI / 180;
  const centerX = detailMap.originX + Math.cos(directionRad) * detailMap.lengthMm / 2 - WIDTH_MM / 2;
  const centerZ = detailMap.originY + Math.sin(directionRad) * detailMap.lengthMm / 2 - HEIGHT_MM / 2;

  return (
    <group position={[centerX, 0.06, centerZ]} rotation={[0, -directionRad, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[detailMap.lengthMm, detailMap.widthMm]} />
        <meshBasicMaterial
          map={texture}
          transparent
          opacity={0.7}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
};

const ToolVisualizer: React.FC<{ simState: SimulationState; toolPath: ToolPathPoint[] }> = ({
  simState,
  toolPath
}) => {
    const groupRef = useRef<THREE.Group>(null);
    const playbackRef = useRef({ startTime: 0, index: 0, lastElapsed: 0 });

    // Map Physics Start (10, 30) to World Coordinates
    // Physics: 0..60. World: -30..+30 centered.
    const startX = 10 - 30;
    const startZ = 30 - 30; // 0

    // Hover animation
    useEffect(() => {
        playbackRef.current = { startTime: 0, index: 0, lastElapsed: 0 };
    }, [toolPath, simState.isSimulating, simState.direction, simState.angle, simState.loopGhost]);

    useFrame((state) => {
        if (!groupRef.current) return;

        if (toolPath.length < 2 || simState.isSimulating) {
            const hoverY = 2 + Math.sin(state.clock.elapsedTime * 2) * 0.5;
            groupRef.current.position.set(startX, hoverY, startZ);
            return;
        }

        const duration = toolPath[toolPath.length - 1].time;
        if (!Number.isFinite(duration) || duration <= 0) {
            throw new Error('toolPath duration must be a positive finite number');
        }

        if (playbackRef.current.startTime === 0) {
            playbackRef.current.startTime = state.clock.elapsedTime;
            playbackRef.current.index = 0;
            playbackRef.current.lastElapsed = 0;
        }

        const rawElapsed = state.clock.elapsedTime - playbackRef.current.startTime;
        if (!simState.loopGhost && rawElapsed >= duration) {
            const last = toolPath[toolPath.length - 1];
            const worldX = last.x - WIDTH_MM / 2;
            const worldZ = last.y - HEIGHT_MM / 2;
            groupRef.current.position.set(worldX, last.toolZ, worldZ);
            return;
        }

        const elapsed = simState.loopGhost ? rawElapsed % duration : rawElapsed;
        let idx = playbackRef.current.index;

        if (elapsed < playbackRef.current.lastElapsed) {
            idx = 0;
        }

        while (idx < toolPath.length - 2 && toolPath[idx + 1].time < elapsed) {
            idx += 1;
        }
        playbackRef.current.index = idx;
        playbackRef.current.lastElapsed = elapsed;

        const current = toolPath[idx];
        const next = toolPath[idx + 1];
        const span = next.time - current.time;
        const t = span > 0 ? (elapsed - current.time) / span : 0;

        const interpX = current.x + (next.x - current.x) * t;
        const interpY = current.y + (next.y - current.y) * t;
        const interpZ = current.toolZ + (next.toolZ - current.toolZ) * t;

        const worldX = interpX - WIDTH_MM / 2;
        const worldZ = interpY - HEIGHT_MM / 2;

        groupRef.current.position.set(worldX, interpZ, worldZ);
    });

    const dirRad = (simState.direction * Math.PI) / 180;
    
    // Rotation Logic:
    // 1. Yaw: Align Physics X (0 deg) with Tool Z (Default).
    // Physics +X = Right. Tool +Z = Back (or Forward depending on cam).
    // We need standard Compass rotation.
    // Let's use: yaw = -dirRad (Clockwise from X). And offset by -PI/2 to align Model Z to X.
    const yawRad = -dirRad - Math.PI/2;
    
    // 2. Pitch: Tilt "Back" (Handle Up).
    // Positive Angle = Tilt Back. 
    // Rotation around X axis. Positive rotation lifts Y+ -> Z+.
    // If Tool points Z, handle is Z+. Tip is Z-.
    // Wait, Screwdriver points +Y in definition, rotated +90 X.
    // So it points +Z?
    // Let's assume Pitch = -angle.
    const pitchRad = -(simState.angle * Math.PI) / 180;

    // Which model to render?
    const renderTool = () => {
        switch(simState.toolType) {
            case 'screwdriver': return <ScrewdriverModel />;
            case 'knife': return <KnifeModel />;
            case 'crowbar': return <CrowbarModel />;
            case 'hammer_face': return <HammerFaceModel />;
            case 'hammer_claw': return <HammerClawModel />;
            case 'spoon': return <SpoonModel />;
        }
        throw new Error(`Unsupported tool type "${simState.toolType}"`);
    };

    return (
        // Position y=2 (Hover above surface). X/Z matched to start point.
        <group ref={groupRef} position={[startX, 2, startZ]} rotation={[0, yawRad, 0]}> 
            
            <group rotation={[pitchRad, 0, 0]}>
                {renderTool()}
                
                {/* Force Vector Arrow: Aligned with Tool Shaft (Local Z) */}
                {/* Points towards TIP (Contact Point) which is usually Z- or Z+ depending on model? */}
                {/* Models are Z-aligned. Handle is Z+. Tip is 0. */}
                {/* Vector (0,0,-1) points towards origin/tip. */}
                <arrowHelper args={[new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 30, 0), 40, 0xff0000]} />
            </group>
        </group>
    );
};

const ForensicLab: React.FC<LabProps> = ({ simState, setSimState }) => {
  // Calculate light pos for main scene component too if needed, or just pass state down?
  // Actually, we can just render the light here.
  const [toolPath, setToolPath] = useState<ToolPathPoint[]>([]);
  const [detailMap, setDetailMap] = useState<SurfaceDetailMap | null>(null);
  
  const rRad = simState.rakingLightAngle * Math.PI / 180;
  const lightH = 50 * Math.sin(rRad); // Height from surface (Y)
  const lightDist = 50 * Math.cos(rRad); // Distance laterally (X)

  return (
    <Canvas shadows dpr={[1, 2]} camera={{ position: [0, 40, 40], fov: 45 }}>
      <color attach="background" args={['#050505']} />
      
      <ambientLight intensity={0.05} />
      
      {/* RAKING LIGHT (Directional for uniform grazing) */}
      <directionalLight 
        position={[lightDist, lightH, 0]} 
        intensity={3.0} 
        castShadow 
        shadow-mapSize={[2048, 2048]} 
        shadow-bias={-0.0001}
      />
      
      {/* Visual Helper for Light Position */}
      <mesh position={[lightDist, lightH, 0]}>
        <sphereGeometry args={[1, 16, 16]} />
        <meshBasicMaterial color="#ffff00" />
      </mesh>

      <pointLight position={[-20, 20, -20]} intensity={0.2} color="#00e5ff" />
      
      <OrbitControls makeDefault minPolarAngle={0} maxPolarAngle={Math.PI / 1.5} />
      
      <group position={[0, 0, 0]}>
        <MaterialSurface
          simState={simState}
          setSimState={setSimState}
          onToolPathUpdate={setToolPath}
          onDetailMapUpdate={setDetailMap}
        />
        <DetailMapOverlay detailMap={detailMap} />
        
        {simState.showScales && (
            <>
                {/* Surface Scale (Bottom Left) */}
                <ForensicScaleBar position={[-WIDTH_MM/2 + 2, -HEIGHT_MM/2 + 2, 0.1]} />
                
                {/* Floating Scale (Top Right, hovering) */}
                <ForensicScaleBar 
                    position={[WIDTH_MM/2 - 2, HEIGHT_MM/2 - 2, 15]} 
                    rotation={[0, 0, Math.PI]} // Rotated 180 to face center
                />
            </>
        )}

        <Grid infiniteGrid fadeDistance={60} sectionColor="#00e5ff" cellColor="#1a1a1a" position={[0,-0.1,0]} />
        {simState.showTool && <ToolVisualizer simState={simState} toolPath={toolPath} />}
      </group>
      
      <Environment preset="studio" />
    </Canvas>
  );
};

export default ForensicLab;
