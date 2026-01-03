import React, { useMemo, useRef, useEffect } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Environment, Grid } from '@react-three/drei';
import * as THREE from 'three';
import type { SimulationState } from '../App';
import { ForensicPhysicsEngine } from '../utils/SimulationEngine';

interface LabProps {
  simState: SimulationState;
}

// Resolution Settings
// 60mm plate size. 
// 10 pts/mm = 600x600 = 360k verts. (Playable)
// 20 pts/mm = 1200x1200 = 1.44M verts. (Heavy but "Speed doesn't matter")
// Let's go with 15 pts/mm for a balance of detail and browser crash safety (900x900 ~800k verts)
const RESOLUTION = 15; 
const WIDTH_MM = 60;
const HEIGHT_MM = 60;
const SEGMENTS = Math.floor(WIDTH_MM * RESOLUTION);

const MaterialSurface: React.FC<{ simState: SimulationState }> = ({ simState }) => {
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

  const runSimulation = () => {
    if (!meshRef.current) return;

    // 1. Create Tool Kernel
    const kernel = engine.createToolKernel(
        simState.toolType,
        simState.toolType === 'crowbar' ? 10 : (simState.toolType === 'screwdriver' ? 6 : 1), // Size MM
        simState.toolWear,
        simState.angle
    );

    // 2. Execute Physics Loop
    // Start slightly off-center left
    engine.simulateCut(
        10, 30, // Start X, Y (mm)
        simState.direction, 
        simState.force,
        kernel,
        simState.material,
        simState.speed,
        simState.chatter
    );

    // 3. Update Mesh
    updateMeshFromEngine();
  };

  const updateMeshFromEngine = () => {
    if (!meshRef.current) return;
    const geometry = meshRef.current.geometry;
    const positions = geometry.attributes.position;
    
    // Engine data is Z heights [y*w + x]
    // PlaneGeometry is row-major?
    // PlaneGeometry creates (seg+1)*(seg+1) vertices.
    const engineData = engine.surface.data;
    
    for (let i = 0; i < positions.count; i++) {
        // PlaneGeo is centered at 0,0. Engine is 0..W, 0..H.
        // We need to map correctly. 
        // Ideally we just map the Z values directly if dimensions match.
        // PlaneGeometry vertices are ordered row by row.
        
        // Safety check
        if (i < engineData.length) {
            positions.setZ(i, engineData[i]);
        }
    }

    positions.needsUpdate = true;
    geometry.computeVertexNormals();
  };

  const materialColor = useMemo(() => {
    switch(simState.material) {
        case 'aluminum': return '#d6d6d6';
        case 'brass': return '#e6c35c';
        case 'steel': return '#757980';
        case 'wood': return '#8a5e3a';
        default: return '#888';
    }
  }, [simState.material]);

  return (
    <mesh ref={meshRef} rotation={[-Math.PI / 2, 0, 0]} receiveShadow castShadow>
      <planeGeometry args={[WIDTH_MM, HEIGHT_MM, SEGMENTS-1, SEGMENTS-1]} />
      <meshStandardMaterial 
        color={materialColor} 
        roughness={simState.material === 'wood' ? 0.9 : 0.4} 
        metalness={simState.material === 'wood' ? 0.0 : 0.8}
        side={THREE.DoubleSide}
        flatShading={false}
      />
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

const ForensicLab: React.FC<LabProps> = ({ simState }) => {
  return (
    <Canvas shadows dpr={[1, 2]} camera={{ position: [0, -40, 50], fov: 45 }}>
      <color attach="background" args={['#050505']} />
      
      <ambientLight intensity={0.2} />
      {/* High contrast lighting for striations */}
      <spotLight position={[30, 30, 40]} angle={0.2} penumbra={0.5} intensity={1} castShadow shadow-mapSize={[2048, 2048]} />
      <pointLight position={[-20, -20, 10]} intensity={0.3} color="#00e5ff" />
      
      <OrbitControls makeDefault minPolarAngle={0} maxPolarAngle={Math.PI / 1.5} />
      
      <group position={[0, 0, 0]}>
        <MaterialSurface simState={simState} />
        <Grid infiniteGrid fadeDistance={60} sectionColor="#00e5ff" cellColor="#1a1a1a" position={[0,0,-0.1]} />
        <ToolVisualizer simState={simState} />
      </group>
      
      <Environment preset="studio" />
    </Canvas>
  );
};

export default ForensicLab;
