import React from 'react';
import * as THREE from 'three';

// Materials
const steelMaterial = new THREE.MeshStandardMaterial({ 
    color: '#888888', 
    metalness: 0.9, 
    roughness: 0.4 
});

const plasticHandleMaterial = new THREE.MeshStandardMaterial({ 
    color: '#cc3333', 
    roughness: 0.2 
});

const woodHandleMaterial = new THREE.MeshStandardMaterial({ 
    color: '#8f5e38', 
    roughness: 0.8 
});

const blackMetalMaterial = new THREE.MeshStandardMaterial({ 
    color: '#333333', 
    metalness: 0.8, 
    roughness: 0.6 
});

export const ScrewdriverModel: React.FC = () => {
    // Tip at 0,0,0. Shaft extends up +Y (or -Z depending on orientation). 
    // We'll align tools so UP is +Y. Tip is at origin.
    return (
        <group rotation={[Math.PI/2, 0, 0]}> 
            {/* Blade Tip (6mm wide, 1mm thick) */}
            <mesh position={[0, 2, 0]} material={steelMaterial}>
                <boxGeometry args={[6, 4, 1]} />
            </mesh>
            {/* Shaft (6mm diam, 100mm long) */}
            <mesh position={[0, 54, 0]} material={steelMaterial}>
                <cylinderGeometry args={[3, 3, 100, 16]} />
            </mesh>
            {/* Handle */}
            <mesh position={[0, 130, 0]} material={plasticHandleMaterial}>
                <cylinderGeometry args={[12, 12, 60, 16]} />
            </mesh>
        </group>
    );
};

export const KnifeModel: React.FC = () => {
    // Blade edge at 0,0,0.
    // Blade is 20mm tall (Y), 100mm long (X)?
    // Physics assumes generic wedge.
    return (
        <group rotation={[Math.PI, 0, 0]}>
            {/* Blade */}
            {/* Using a simple box scaled to look like a blade */}
            <mesh position={[0, 50, 0]} material={steelMaterial}>
                 <boxGeometry args={[2, 100, 20]} /> 
            </mesh>
            {/* Handle */}
            <mesh position={[0, 110, 0]} material={blackMetalMaterial}>
                <boxGeometry args={[10, 30, 25]} />
            </mesh>
             {/* Cutting Edge Indication */}
             <mesh position={[0, 1, 0]}>
                <boxGeometry args={[0.5, 100, 0.5]} />
                <meshBasicMaterial color="#ffff00" opacity={0.5} transparent />
            </mesh>
        </group>
    );
};

export const CrowbarModel: React.FC = () => {
    // Tip at 0,0,0
    return (
        <group rotation={[Math.PI/2, 0, 0]}>
            {/* Curved Tip Area */}
            <mesh position={[0, 10, 5]} rotation={[0.5, 0, 0]} material={blackMetalMaterial}>
                <cylinderGeometry args={[8, 5, 25, 6]} />
            </mesh>
             {/* Main Shaft */}
             <mesh position={[0, 100, 25]} material={blackMetalMaterial}>
                <cylinderGeometry args={[8, 8, 200, 6]} />
            </mesh>
        </group>
    );
};

export const HammerFaceModel: React.FC = () => {
    // Face center at 0,0,0
    // Face is Circle 25mm diam
    return (
        <group rotation={[0, 0, 0]}>
             {/* Head (Horizontal Cylinder) */}
             <mesh position={[0, 20, 0]} rotation={[0, 0, Math.PI/2]} material={steelMaterial}>
                <cylinderGeometry args={[15, 15, 100, 16]} />
             </mesh>
             {/* Face (The striking part) - Visualized at bottom of head */}
             <mesh position={[0, 20, 0]} rotation={[0, 0, Math.PI/2]}>
                 {/* Visual helper to show the face orientation */}
             </mesh>
             {/* Actual Face Plate */}
             <mesh position={[0, 0, 0]} rotation={[Math.PI/2, 0, 0]} material={steelMaterial}>
                 <cylinderGeometry args={[12.5, 14, 10, 32]} />
             </mesh>
             
             {/* Handle */}
             <mesh position={[0, 20, 50]} rotation={[Math.PI/2, 0, 0]} material={woodHandleMaterial}>
                <cylinderGeometry args={[10, 12, 300, 16]} />
             </mesh>
        </group>
    );
};

export const HammerClawModel: React.FC = () => {
     // Claw tips at 0,0,0
     return (
        <group rotation={[0, 0, 0]}>
             {/* Head */}
             <mesh position={[0, 25, 0]} rotation={[0, 0, Math.PI/2]} material={steelMaterial}>
                <cylinderGeometry args={[15, 15, 100, 16]} />
             </mesh>
             {/* Claw Prongs (Curved) */}
             <mesh position={[0, 5, -5]} rotation={[-0.5, 0, 0]} material={steelMaterial}>
                <boxGeometry args={[30, 20, 5]} />
             </mesh>
              {/* Handle */}
             <mesh position={[0, 20, 50]} rotation={[Math.PI/2, 0, 0]} material={woodHandleMaterial}>
                <cylinderGeometry args={[10, 12, 300, 16]} />
             </mesh>
        </group>
    );
};
