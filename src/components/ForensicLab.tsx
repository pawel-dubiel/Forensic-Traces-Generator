import React, { useMemo, useRef, useEffect } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Environment, Grid, Text } from '@react-three/drei';
import * as THREE from 'three';
import type { SimulationState } from '../App';
import { ForensicPhysicsEngine } from '../utils/SimulationEngine';

interface LabProps {
  simState: SimulationState;
  setSimState?: React.Dispatch<React.SetStateAction<SimulationState>>;
}

// Resolution Settings
// 60mm plate size. 
// 15 pts/mm = 900x900 = 810k verts (Medium)
// 30 pts/mm = 1800x1800 = 3.24M verts (High Fidelity - Forensically Accurate)
const RESOLUTION = 30; 
const WIDTH_MM = 60;
const HEIGHT_MM = 60;
const SEGMENTS = Math.floor(WIDTH_MM * RESOLUTION);

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

const MaterialSurface: React.FC<{ simState: SimulationState, setSimState?: React.Dispatch<React.SetStateAction<SimulationState>> }> = ({ simState, setSimState }) => {
  const meshRef = useRef<THREE.Mesh>(null);
  
  // Initialize Engine
  const engine = useMemo(() => new ForensicPhysicsEngine(WIDTH_MM, HEIGHT_MM, RESOLUTION), []);

  useEffect(() => {
    // Reset geometry to base topography on mount or reset
    updateMeshFromEngine();
  }, []); // Run once

  useEffect(() => {
    if (simState.isSimulating) {
        // Run Simulation (Blocking main thread is fine as per user request "don't care about speed")
        runSimulation();
    }
  }, [simState.isSimulating]);

  useEffect(() => {
    if (simState.isResetting) {
        engine.reset();
        updateMeshFromEngine();
    }
  }, [simState.isResetting]);

  const runSimulation = async () => {
    if (!meshRef.current) return;

    // 1. Create Tool Kernel
    let toolSize = 6;
    if (simState.toolType === 'crowbar') toolSize = 10;
    if (simState.toolType === 'knife') toolSize = 1;
    if (simState.toolType === 'hammer_face') toolSize = 25;
    if (simState.toolType === 'hammer_claw') toolSize = 30;

    const kernel = engine.createToolKernel(
        simState.toolType,
        toolSize,
        simState.toolWear,
        simState.angle,
        simState.direction
    );

    // 2. Execute Physics Loop (Generator Pattern)
    const generator = engine.simulateCutGenerator(
        10, 30, // Start X, Y
        simState.direction, 
        simState.force,
        kernel,
        simState.material,
        simState.speed,
        simState.chatter
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
    
    // Reset simulation flag
    if (setSimState) {
        setSimState(prev => ({ ...prev, isSimulating: false, progress: 100 }));
    }
  };

  const updateMeshFromEngine = () => {
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
            // Deep (negative) = Blue, High (positive/pileup) = Red, Zero = Green/Grey
            // Scale: +/- 0.5mm range
            const t = Math.max(-1, Math.min(1, z / 0.5)); // -1 to 1
            
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
  };

  const materialColor = useMemo(() => {
    switch(simState.material) {
        case 'aluminum': return '#d6d6d6';
        case 'brass': return '#e6c35c';
        case 'steel': return '#757980';
        case 'wood': return '#8a5e3a';
        case 'gold': return '#ffd700';
        default: return '#888';
    }
  }, [simState.material]);

  return (
    <mesh ref={meshRef} rotation={[-Math.PI / 2, 0, 0]} receiveShadow castShadow>
      <planeGeometry args={[WIDTH_MM, HEIGHT_MM, SEGMENTS-1, SEGMENTS-1]} />
      
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

const ToolVisualizer: React.FC<{ simState: SimulationState }> = ({ simState }) => {
    const groupRef = useRef<THREE.Group>(null);
    useFrame((state) => {
        if (groupRef.current) {
            groupRef.current.position.z = 5 + Math.sin(state.clock.elapsedTime) * 0.5;
        }
    });
    const angleRad = (simState.angle * Math.PI) / 180;
    const dirRad = (simState.direction * Math.PI) / 180;

    return (
        <group ref={groupRef} position={[0, 0, 5]} rotation={[0, 0, dirRad]}> 
            <group rotation={[0, -angleRad, 0]}>
                <mesh position={[0, 0, 5]}>
                    <cylinderGeometry args={[0.5, 2, 10, 16]} />
                    <meshStandardMaterial color="#ff3333" transparent opacity={0.6} wireframe />
                </mesh>
                <arrowHelper args={[new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 0, 0), 6, 0xff0000]} />
            </group>
        </group>
    );
};

const ForensicLab: React.FC<LabProps> = ({ simState, setSimState }) => {
  // Calculate light pos for main scene component too if needed, or just pass state down?
  // Actually, we can just render the light here.
  
  const rRad = simState.rakingLightAngle * Math.PI / 180;
  const lightH = 50 * Math.sin(rRad); // Height from surface (Y)
  const lightDist = 50 * Math.cos(rRad); // Distance laterally (X)

  return (
    <Canvas shadows dpr={[1, 2]} camera={{ position: [0, 40, 40], fov: 45 }}>
      <color attach="background" args={['#050505']} />
      
      <ambientLight intensity={0.1} />
      
      {/* RAKING LIGHT */}
      <spotLight 
        position={[lightDist, lightH, 0]} 
        target-position={[0, 0, 0]}
        angle={0.5} 
        penumbra={0.5} 
        intensity={2.0} 
        castShadow 
        shadow-mapSize={[2048, 2048]} 
        shadow-bias={-0.0001}
      />

      <pointLight position={[-20, 20, -20]} intensity={0.2} color="#00e5ff" />
      
      <OrbitControls makeDefault minPolarAngle={0} maxPolarAngle={Math.PI / 1.5} />
      
      <group position={[0, 0, 0]}>
        <MaterialSurface simState={simState} setSimState={setSimState} />
        
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
        <ToolVisualizer simState={simState} />
      </group>
      
      <Environment preset="studio" />
    </Canvas>
  );
};

export default ForensicLab;
