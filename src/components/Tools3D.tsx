import React from 'react';
import * as THREE from 'three';

// Materials
const steelMaterial = new THREE.MeshStandardMaterial({ 
    color: '#888888', 
    metalness: 0.9, 
    roughness: 0.2 
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
    return (
        <group rotation={[Math.PI/2, 0, 0]}> 
            <mesh position={[0, 2, 0]} material={steelMaterial}>
                <boxGeometry args={[6, 4, 1]} />
            </mesh>
            <mesh position={[0, 54, 0]} material={steelMaterial}>
                <cylinderGeometry args={[3, 3, 100, 16]} />
            </mesh>
            <mesh position={[0, 130, 0]} material={plasticHandleMaterial}>
                <cylinderGeometry args={[12, 12, 60, 16]} />
            </mesh>
        </group>
    );
};

export const KnifeModel: React.FC = () => {
    return (
        <group rotation={[Math.PI, 0, 0]}>
            <mesh position={[0, 50, 0]} material={steelMaterial}>
                 <boxGeometry args={[2, 100, 20]} /> 
            </mesh>
            <mesh position={[0, 110, 0]} material={blackMetalMaterial}>
                <boxGeometry args={[10, 30, 25]} />
            </mesh>
             <mesh position={[0, 1, 0]}>
                <boxGeometry args={[0.5, 100, 0.5]} />
                <meshBasicMaterial color="#ffff00" opacity={0.5} transparent />
            </mesh>
        </group>
    );
};

export const CrowbarModel: React.FC = () => {
    return (
        <group rotation={[Math.PI/2, 0, 0]}>
            <mesh position={[0, 10, 5]} rotation={[0.5, 0, 0]} material={blackMetalMaterial}>
                <cylinderGeometry args={[8, 5, 25, 6]} />
            </mesh>
             <mesh position={[0, 100, 25]} material={blackMetalMaterial}>
                <cylinderGeometry args={[8, 8, 200, 6]} />
            </mesh>
        </group>
    );
};

export const HammerFaceModel: React.FC = () => {
    return (
        <group rotation={[0, 0, 0]}>
             <mesh position={[0, 25, 0]} rotation={[0, 0, Math.PI/2]} material={steelMaterial}>
                <cylinderGeometry args={[15, 15, 100, 16]} />
             </mesh>
             {/* Face Plate - Shifted so surface is at 0 */}
             {/* Cylinder height 10. Center was 0. Surface was -5. Move to +5. */}
             <mesh position={[0, 5, 0]} rotation={[Math.PI/2, 0, 0]} material={steelMaterial}>
                 <cylinderGeometry args={[12.5, 14, 10, 32]} />
             </mesh>
             
             <mesh position={[0, 25, 50]} rotation={[Math.PI/2, 0, 0]} material={woodHandleMaterial}>
                <cylinderGeometry args={[10, 12, 300, 16]} />
             </mesh>
        </group>
    );
};

export const HammerClawModel: React.FC = () => {
     return (
        <group rotation={[0, 0, 0]}>
             <mesh position={[0, 25, 0]} rotation={[0, 0, Math.PI/2]} material={steelMaterial}>
                <cylinderGeometry args={[15, 15, 100, 16]} />
             </mesh>
             <mesh position={[0, 5, -5]} rotation={[-0.5, 0, 0]} material={steelMaterial}>
                <boxGeometry args={[30, 20, 5]} />
             </mesh>
             <mesh position={[0, 20, 50]} rotation={[Math.PI/2, 0, 0]} material={woodHandleMaterial}>
                <cylinderGeometry args={[10, 12, 300, 16]} />
             </mesh>
        </group>
    );
};

export const SpoonModel: React.FC = () => {
    // Spoon Bowl + Handle
    // Bowl oriented so "bottom" touches 0,0,0
    return (
       <group rotation={[Math.PI/2, 0, 0]}>
            {/* Bowl (Ellipsoid-ish) */}
            <mesh position={[0, 15, 0]} scale={[1, 1.5, 0.5]} material={steelMaterial}>
               <sphereGeometry args={[12, 32, 16, 0, Math.PI * 2, 0, Math.PI/2]} /> 
            </mesh>
            
            {/* Neck */}
            <mesh position={[0, 35, 2]} rotation={[0.2, 0, 0]} material={steelMaterial}>
                <cylinderGeometry args={[3, 5, 20, 8]} />
            </mesh>

            {/* Handle */}
            <mesh position={[0, 80, 8]} rotation={[0.1, 0, 0]} material={steelMaterial}>
                <boxGeometry args={[10, 100, 2]} />
            </mesh>
       </group>
   );
};