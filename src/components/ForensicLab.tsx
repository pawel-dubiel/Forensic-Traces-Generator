import React, { useMemo, useRef, useEffect, useState, useCallback } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Environment, Grid, Lightformer } from '@react-three/drei';
import * as THREE from 'three';
import { Box, Typography } from '@mui/material';
import type { SimulationState } from '../App';
import { buildSurfaceMeshIndices, ForensicPhysicsEngine, getStrokeStart } from '../utils/SimulationEngine';
import type { FractureState, SurfaceDetailMap, ToolPathPoint } from '../utils/SimulationEngine';
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
const MIN_HEIGHT_RANGE_MM = 0.005;
const SHADOW_EXTENT_MM = 45;
// The striation overlay is draped over the mark: sampled this finely across it and lifted clear of the surface.
const DETAIL_RIBBON_SAMPLES_PER_MM = 12;
const DETAIL_RIBBON_MAX_SEGMENTS = 96;
const DETAIL_RIBBON_LIFT_MM = 0.02;

export interface DetailRibbon {
  positions: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
}

// Where the middle of the tool's face sits relative to the contact point that the tool path follows.
export interface ToolCentreOffset {
  alongMm: number;
  acrossMm: number;
  upMm: number;
  directionDeg: number;
}

export interface DetailOverlay {
  map: SurfaceDetailMap;
  ribbon: DetailRibbon;
}

const getRenderResolution = (value: number) => {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    throw new Error('resolution must be a positive integer');
  }
  if (value > MAX_RENDER_RESOLUTION) {
    throw new Error(`resolution must be ${MAX_RENDER_RESOLUTION} pts/mm or lower for the current renderer`);
  }
  return value;
};

const createPlateShellGeometry = (
  widthMm: number,
  heightMm: number,
  resolution: number,
  thicknessMm: number,
  surfaceData: ArrayLike<number>,
  fractureState: FractureState
) => {
  if (!Number.isFinite(widthMm) || widthMm <= 0) {
    throw new Error('widthMm must be a positive finite number');
  }
  if (!Number.isFinite(heightMm) || heightMm <= 0) {
    throw new Error('heightMm must be a positive finite number');
  }
  if (!Number.isFinite(resolution) || !Number.isInteger(resolution) || resolution <= 0) {
    throw new Error('resolution must be a positive integer');
  }
  if (!Number.isFinite(thicknessMm) || thicknessMm <= 0) {
    throw new Error('thicknessMm must be a positive finite number');
  }
  const { detached, edgeLift, debrisHeight } = fractureState;
  const gridWidth = Math.floor(widthMm * resolution);
  const gridHeight = Math.floor(heightMm * resolution);
  const expectedLength = gridWidth * gridHeight;
  if (
    surfaceData.length !== expectedLength ||
    detached.length !== expectedLength ||
    edgeLift.length !== expectedLength ||
    debrisHeight.length !== expectedLength
  ) {
    throw new Error('plate shell inputs must match width * height * resolution');
  }

  const halfWidth = widthMm / 2;
  const halfHeight = heightMm / 2;
  const bottomY = -thicknessMm;
  const cellWidth = gridWidth - 1;
  const cellHeight = gridHeight - 1;
  const presentCells = new Uint8Array(cellWidth * cellHeight);
  let hasDetached = false;
  let hasPresentCell = false;

  for (let i = 0; i < detached.length; i++) {
    if (detached[i]) {
      hasDetached = true;
      break;
    }
  }

  for (let y = 0; y < cellHeight; y++) {
    for (let x = 0; x < cellWidth; x++) {
      const a = y * gridWidth + x;
      const b = a + 1;
      const c = (y + 1) * gridWidth + x;
      const d = c + 1;
      if (!detached[a] && !detached[b] && !detached[c] && !detached[d]) {
        presentCells[y * cellWidth + x] = 1;
        hasPresentCell = true;
      }
    }
  }

  const positions: number[] = [];
  const indices: number[] = [];
  const xFor = (x: number) => (x / (gridWidth - 1)) * widthMm - halfWidth;
  const zFor = (y: number) => (y / (gridHeight - 1)) * heightMm - halfHeight;
  const topYFor = (index: number) => Math.max(
    bottomY,
    surfaceData[index] + edgeLift[index] + debrisHeight[index]
  );
  const addVertex = (x: number, y: number, z: number) => {
    positions.push(x, y, z);
    return (positions.length / 3) - 1;
  };
  const cellPresent = (x: number, y: number) => (
    x >= 0 &&
    x < cellWidth &&
    y >= 0 &&
    y < cellHeight &&
    presentCells[y * cellWidth + x] === 1
  );
  const addWallSegment = (ax: number, ay: number, bx: number, by: number) => {
    const aIndex = ay * gridWidth + ax;
    const bIndex = by * gridWidth + bx;
    const xA = xFor(ax);
    const zA = zFor(ay);
    const xB = xFor(bx);
    const zB = zFor(by);
    const topA = addVertex(xA, topYFor(aIndex), zA);
    const topB = addVertex(xB, topYFor(bIndex), zB);
    const bottomA = addVertex(xA, bottomY, zA);
    const bottomB = addVertex(xB, bottomY, zB);
    indices.push(topA, bottomA, topB, topB, bottomA, bottomB);
  };

  const geometry = new THREE.BufferGeometry();

  if (hasPresentCell) {
    for (let y = 0; y < cellHeight; y++) {
      for (let x = 0; x < cellWidth; x++) {
        if (!cellPresent(x, y)) {
          continue;
        }
        if (!cellPresent(x, y - 1)) {
          addWallSegment(x, y, x + 1, y);
        }
        if (!cellPresent(x + 1, y)) {
          addWallSegment(x + 1, y, x + 1, y + 1);
        }
        if (!cellPresent(x, y + 1)) {
          addWallSegment(x + 1, y + 1, x, y + 1);
        }
        if (!cellPresent(x - 1, y)) {
          addWallSegment(x, y + 1, x, y);
        }
      }
    }
  }

  if (hasPresentCell && !hasDetached) {
    const a = addVertex(-halfWidth, bottomY, -halfHeight);
    const b = addVertex(halfWidth, bottomY, -halfHeight);
    const c = addVertex(halfWidth, bottomY, halfHeight);
    const d = addVertex(-halfWidth, bottomY, halfHeight);
    indices.push(a, c, b, a, d, c);
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
};

// A strip that follows the recorded tool path and lies on the surface, so the striations stay in the mark
// when the tool wanders sideways. Texture u runs along the stroke, v across it.
const createDetailRibbon = (
  detailMap: SurfaceDetailMap,
  toolPath: ToolPathPoint[],
  sampleHeight: (xMm: number, yMm: number) => number
): DetailRibbon | null => {
  if (toolPath.length < 2) {
    return null;
  }
  const directionRad = detailMap.directionDeg * Math.PI / 180;
  const dirX = Math.cos(directionRad);
  const dirY = Math.sin(directionRad);
  const segments = Math.max(2, Math.min(DETAIL_RIBBON_MAX_SEGMENTS, Math.ceil(detailMap.widthMm * DETAIL_RIBBON_SAMPLES_PER_MM)));
  const rowSize = segments + 1;
  const positions = new Float32Array(toolPath.length * rowSize * 3);
  const uvs = new Float32Array(toolPath.length * rowSize * 2);
  const onSurface = new Uint8Array(toolPath.length * rowSize);

  for (let i = 0; i < toolPath.length; i++) {
    const point = toolPath[i];
    const previous = toolPath[Math.max(0, i - 1)];
    const next = toolPath[Math.min(toolPath.length - 1, i + 1)];
    const tangentLength = Math.hypot(next.x - previous.x, next.y - previous.y);
    // Two samples on the same spot give no heading; the stroke direction is the fallback.
    const tangentX = tangentLength > 0 ? (next.x - previous.x) / tangentLength : dirX;
    const tangentY = tangentLength > 0 ? (next.y - previous.y) / tangentLength : dirY;
    const alongMm = (point.x - detailMap.originX) * dirX + (point.y - detailMap.originY) * dirY;
    const u = Math.max(0, Math.min(1, alongMm / detailMap.lengthMm));

    for (let j = 0; j <= segments; j++) {
      const acrossMm = (j / segments - 0.5) * detailMap.widthMm;
      const x = point.x - tangentY * acrossMm;
      const y = point.y + tangentX * acrossMm;
      const height = sampleHeight(x, y);
      const vertex = i * rowSize + j;
      onSurface[vertex] = Number.isFinite(height) ? 1 : 0;
      positions[vertex * 3] = x - WIDTH_MM / 2;
      positions[vertex * 3 + 1] = (Number.isFinite(height) ? height : 0) + DETAIL_RIBBON_LIFT_MM;
      positions[vertex * 3 + 2] = y - HEIGHT_MM / 2;
      uvs[vertex * 2] = u;
      // The canvas texture is flipped, so its first row (the low side across the mark) is at v = 1.
      uvs[vertex * 2 + 1] = 1 - j / segments;
    }
  }

  // Quads over a hole or off the plate are left out.
  const indices: number[] = [];
  for (let i = 0; i < toolPath.length - 1; i++) {
    for (let j = 0; j < segments; j++) {
      const a = i * rowSize + j;
      const b = a + 1;
      const c = a + rowSize;
      const d = c + 1;
      if (onSurface[a] && onSurface[b] && onSurface[c] && onSurface[d]) {
        indices.push(a, b, c, b, d, c);
      }
    }
  }

  return { positions, uvs, indices: Uint32Array.from(indices) };
};

// Drawn on a canvas so the labels need no font download.
const ScaleLabel: React.FC<{ text: string; position: [number, number, number]; rotation?: [number, number, number] }> = ({ text, position, rotation }) => {
    const texture = useMemo(() => {
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 64;
        const context = canvas.getContext('2d');
        if (!context) {
            throw new Error('2D canvas context is required for scale labels');
        }
        context.fillStyle = 'white';
        context.font = 'bold 44px monospace';
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText(text, canvas.width / 2, canvas.height / 2);
        const canvasTexture = new THREE.CanvasTexture(canvas);
        canvasTexture.colorSpace = THREE.SRGBColorSpace;
        return canvasTexture;
    }, [text]);

    useEffect(() => () => texture.dispose(), [texture]);

    return (
        <mesh position={position} rotation={rotation}>
            <planeGeometry args={[8, 2]} />
            <meshBasicMaterial map={texture} transparent depthWrite={false} />
        </mesh>
    );
};

const ForensicScaleBar: React.FC = () => {
    // ABFO-style L-ruler
    // 20mm x 20mm scale
    const size = 20; 
    const thick = 0.5;

    return (
        // Laid flat on the plate in the corner nearest the default camera: local Y runs away from the viewer.
        <group position={[-WIDTH_MM/2 + 3, 0.15, HEIGHT_MM/2 - 3]} rotation={[-Math.PI/2, 0, 0]}>
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
            <ScaleLabel text="10mm" position={[10, -1.7, 0]} />
            <ScaleLabel text="10mm" position={[-1.7, 10, 0]} rotation={[0, 0, Math.PI/2]} />
        </group>
    );
};

const MaterialSurface: React.FC<{
  simState: SimulationState;
  setSimState?: React.Dispatch<React.SetStateAction<SimulationState>>;
  onToolPathUpdate?: (path: ToolPathPoint[], centreOffset?: ToolCentreOffset) => void;
  onDetailMapUpdate?: (detail: DetailOverlay | null) => void;
  onHeightRangeUpdate?: (rangeMm: number) => void;
}> = ({ simState, setSimState, onToolPathUpdate, onDetailMapUpdate, onHeightRangeUpdate }) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const shellRef = useRef<THREE.Mesh>(null);
  const fullIndexRef = useRef<THREE.BufferAttribute | null>(null);
  const activeRunRef = useRef<symbol | null>(null);
  
  // Initialize Engine
  const resolution = getRenderResolution(simState.resolution);
  const engine = useMemo(
    () => new ForensicPhysicsEngine(WIDTH_MM, HEIGHT_MM, resolution, simState.randomSeed),
    [simState.randomSeed, resolution]
  );
  useEffect(() => {
    fullIndexRef.current = null;
  }, [resolution]);
  const {
    action,
    angle,
    chatter,
    direction,
    force,
    impactEnergy,
    material,
    materialThicknessMm,
    randomSeed,
    speed,
    timeStep,
    toolHardness,
    toolType,
    toolWear
  } = simState;

  const materialColor = useMemo(() => {
    switch(material) {
        case 'aluminum': return '#d6d6d6';
        case 'brass': return '#e6c35c';
        case 'steel': return '#757980';
        case 'wood': return '#8a5e3a';
        case 'gold': return '#ffd700';
    }
    throw new Error(`Unsupported material "${material}"`);
  }, [material]);
  const plateShellGeometry = useMemo(
    () => createPlateShellGeometry(
      WIDTH_MM,
      HEIGHT_MM,
      resolution,
      materialThicknessMm,
      engine.surface.data,
      engine.getFractureState()
    ),
    [engine, materialThicknessMm, resolution]
  );

  useEffect(() => () => plateShellGeometry.dispose(), [plateShellGeometry]);

  const rebuildPlateShell = useCallback((fractureState: FractureState) => {
    if (!shellRef.current) {
      return;
    }
    const previousGeometry = shellRef.current.geometry;
    const nextGeometry = createPlateShellGeometry(
      WIDTH_MM,
      HEIGHT_MM,
      resolution,
      materialThicknessMm,
      engine.surface.data,
      fractureState
    );
    shellRef.current.geometry = nextGeometry;
    if (previousGeometry !== plateShellGeometry) {
      previousGeometry.dispose();
    }
  }, [engine.surface.data, materialThicknessMm, plateShellGeometry, resolution]);

  const rebuildSurfaceIndex = useCallback((geometry: THREE.BufferGeometry, detached: Uint8Array) => {
    if (!fullIndexRef.current) {
      const index = geometry.getIndex();
      if (!index) {
        throw new Error('surface geometry must have an index buffer');
      }
      fullIndexRef.current = index.clone();
    }

    let hasDetached = false;
    for (let i = 0; i < detached.length; i++) {
      if (detached[i]) {
        hasDetached = true;
        break;
      }
    }

    if (!hasDetached) {
      const currentIndex = geometry.getIndex();
      if (!currentIndex || currentIndex.count !== fullIndexRef.current.count) {
        geometry.setIndex(fullIndexRef.current.clone());
      }
      return;
    }

    geometry.setIndex(new THREE.BufferAttribute(
      buildSurfaceMeshIndices(engine.surface.width, engine.surface.height, detached),
      1
    ));
  }, [engine.surface.height, engine.surface.width]);

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
    const fractureState = engine.getFractureState();
    const { damage, detached, edgeLift, debrisHeight } = fractureState;
    if (
      damage.length !== engineData.length ||
      detached.length !== engineData.length ||
      edgeLift.length !== engineData.length ||
      debrisHeight.length !== engineData.length
    ) {
      throw new Error('fracture state arrays must match surface heightfield length');
    }
    rebuildSurfaceIndex(geometry, detached);
    rebuildPlateShell(fractureState);
    const baseColor = new THREE.Color(materialColor);
    const fractureColor = new THREE.Color('#f2d6ba');
    const debrisColor = new THREE.Color('#6b5a47');
    const positionArray = positions.array as Float32Array;
    const colorArray = colors.array as Float32Array;
    const vertexCount = Math.min(positions.count, engineData.length);

    // The false-colour scale spans the relief that is actually there: real marks are tens of microns deep.
    let heightRange = MIN_HEIGHT_RANGE_MM;
    for (let i = 0; i < vertexCount; i++) {
        const z = engineData[i] + edgeLift[i] + debrisHeight[i];
        positionArray[i * 3 + 2] = z;
        if (!detached[i] && Math.abs(z) > heightRange) {
            heightRange = Math.abs(z);
        }
    }

    for (let i = 0; i < vertexCount; i++) {
        // Heatmap Coloring
        // Map Z to RGB
        // Deep (negative) = Blue, High (positive/pileup) = Red
        const t = Math.max(-1, Math.min(1, positionArray[i * 3 + 2] / heightRange)); // -1 to 1

        let r=0, g=0, b=0;
        if (detached[i]) {
            r = 0.02;
            g = 0.02;
            b = 0.02;
        } else if (simState.viewMode === 'standard') {
            const fractureMix = Math.min(1, damage[i] * 0.75 + edgeLift[i] * 2);
            const debrisMix = Math.min(1, debrisHeight[i] * 3);
            r = baseColor.r + (fractureColor.r - baseColor.r) * fractureMix;
            g = baseColor.g + (fractureColor.g - baseColor.g) * fractureMix;
            b = baseColor.b + (fractureColor.b - baseColor.b) * fractureMix;
            r += (debrisColor.r - r) * debrisMix;
            g += (debrisColor.g - g) * debrisMix;
            b += (debrisColor.b - b) * debrisMix;
        } else if (t < 0) {
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
        colorArray[i * 3] = r;
        colorArray[i * 3 + 1] = g;
        colorArray[i * 3 + 2] = b;
    }

    positions.needsUpdate = true;
    colors.needsUpdate = true;
    geometry.computeVertexNormals();
    if (onHeightRangeUpdate) {
      onHeightRangeUpdate(heightRange);
    }
  }, [engine, materialColor, onHeightRangeUpdate, rebuildPlateShell, rebuildSurfaceIndex, simState.viewMode]);

  const runSimulation = useCallback(async () => {
    if (!meshRef.current) return;
    const run = Symbol('simulation run');
    activeRunRef.current = run;
    let errorMessage: string | null = null;

    try {
      if (onToolPathUpdate) {
        onToolPathUpdate([]);
      }
      if (onDetailMapUpdate) {
        onDetailMapUpdate(null);
      }

      // 1. Create Tool Kernel
      let toolSize = 6;
      if (toolType === 'crowbar') toolSize = 10;
      if (toolType === 'knife') toolSize = 4;
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

      // 2. Execute Physics Loop (Generator Pattern)
      let generator: Generator<number>;
      if (action === 'strike') {
        generator = engine.simulateStrikeGenerator(
            WIDTH_MM / 2, HEIGHT_MM / 2,
            impactEnergy,
            kernel,
            material,
            materialThicknessMm,
            toolHardness
        );
      } else {
        if (!Number.isFinite(timeStep) || timeStep <= 0) {
          throw new Error('timeStep must be a positive finite number');
        }
        const start = getStrokeStart(WIDTH_MM, HEIGHT_MM, direction);
        generator = engine.simulateCutGenerator(
            start.x, start.y,
            direction,
            force,
            kernel,
            material,
            materialThicknessMm,
            toolHardness,
            speed,
            chatter,
            timeStep
        );
      }

      // Iterate through generator to allow UI updates
      for (const progress of generator) {
          if (setSimState) {
              setSimState(prev => ({ ...prev, progress }));
          }
          // Yield to event loop to let React render progress bar
          await new Promise(resolve => setTimeout(resolve, 0));
          // The surface this run belongs to is gone (new engine or unmount).
          if (activeRunRef.current !== run) {
              return;
          }
      }

      // 3. Update Mesh at the end
      updateMeshFromEngine();
      if (onToolPathUpdate) {
        onToolPathUpdate(engine.getToolPath(), {
          alongMm: -kernel.anchorAlongMm,
          acrossMm: -kernel.anchorAcrossMm,
          upMm: -kernel.anchorAlongMm * kernel.tiltSlope,
          directionDeg: kernel.directionDeg
        });
      }
      if (onDetailMapUpdate) {
        const detailMap = engine.getSurfaceDetailMap();
        const ribbon = detailMap
          ? createDetailRibbon(detailMap, engine.getToolPath(), (xMm, yMm) => engine.getSurfaceHeightAt(xMm, yMm))
          : null;
        onDetailMapUpdate(detailMap && ribbon ? { map: detailMap, ribbon } : null);
      }
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
    } finally {
      // Reset simulation flag, also after a failure, so the lab never stays locked.
      const lastRun = errorMessage === null && activeRunRef.current === run ? engine.getCutSummary() : null;
      if (setSimState) {
          setSimState(prev => ({ ...prev, isSimulating: false, progress: 100, error: errorMessage, lastRun }));
      }
      if (activeRunRef.current === run) {
        activeRunRef.current = null;
      }
    }
  }, [
    action,
    angle,
    chatter,
    direction,
    engine,
    force,
    impactEnergy,
    material,
    materialThicknessMm,
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
    // One run per EXECUTE: a re-render while a run is in flight must not start a second one on the same surface.
    if (simState.isSimulating && !activeRunRef.current) {
        runSimulation();
    }
  }, [runSimulation, simState.isSimulating]);

  useEffect(() => {
    // A new engine is a blank plate, so the previous plate's overlays and readout no longer apply.
    if (onToolPathUpdate) {
      onToolPathUpdate([]);
    }
    if (onDetailMapUpdate) {
      onDetailMapUpdate(null);
    }
    if (setSimState) {
      setSimState(prev => (prev.lastRun ? { ...prev, lastRun: null } : prev));
    }
    return () => {
      activeRunRef.current = null;
    };
  }, [engine, onDetailMapUpdate, onToolPathUpdate, setSimState]);

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
        if (setSimState) {
          setSimState(prev => (prev.lastRun || prev.error ? { ...prev, lastRun: null, error: null } : prev));
        }
    }
  }, [engine, onDetailMapUpdate, onToolPathUpdate, setSimState, simState.isResetting, updateMeshFromEngine]);

  return (
    <>
      <mesh ref={shellRef} geometry={plateShellGeometry} receiveShadow castShadow>
        <meshStandardMaterial
          color={materialColor}
          roughness={simState.material === 'wood' ? 0.95 : 0.6}
          metalness={simState.material === 'wood' ? 0.0 : 0.35}
          side={THREE.DoubleSide}
        />
      </mesh>

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
              color="white"
              vertexColors={true}
              roughness={simState.material === 'wood' ? 0.9 : 0.55}
              metalness={simState.material === 'wood' ? 0.0 : 0.35}
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
    </>
  );
};

const DetailMapOverlay: React.FC<{ detail: DetailOverlay | null }> = ({ detail }) => {
  const detailMap = detail ? detail.map : null;
  const ribbon = detail ? detail.ribbon : null;
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
      // Exactly zero means the tool never touched that strip, so nothing is drawn there.
      const alpha = detailMap.data[i] === 0 ? 0 : Math.round(Math.min(180, 40 + Math.abs(normalized) * 160));
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

  const geometry = useMemo(() => {
    if (!ribbon) return null;
    const ribbonGeometry = new THREE.BufferGeometry();
    ribbonGeometry.setAttribute('position', new THREE.BufferAttribute(ribbon.positions, 3));
    ribbonGeometry.setAttribute('uv', new THREE.BufferAttribute(ribbon.uvs, 2));
    ribbonGeometry.setIndex(new THREE.BufferAttribute(ribbon.indices, 1));
    return ribbonGeometry;
  }, [ribbon]);

  useEffect(() => () => texture?.dispose(), [texture]);
  useEffect(() => () => geometry?.dispose(), [geometry]);

  if (!texture || !geometry) {
    return null;
  }

  return (
    <mesh geometry={geometry}>
      {/* Pulled towards the camera in depth so the strip does not flicker against the surface it lies on. */}
      <meshBasicMaterial
        map={texture}
        transparent
        opacity={0.7}
        depthWrite={false}
        side={THREE.DoubleSide}
        polygonOffset
        polygonOffsetFactor={-2}
        polygonOffsetUnits={-2}
      />
    </mesh>
  );
};

const ToolVisualizer: React.FC<{
  simState: SimulationState;
  toolPath: ToolPathPoint[];
  centreOffset: ToolCentreOffset | null;
}> = ({
  simState,
  toolPath,
  centreOffset
}) => {
    const groupRef = useRef<THREE.Group>(null);
    const playbackRef = useRef({ startTime: 0, index: 0, lastElapsed: 0 });

    // Map the stroke start to World Coordinates
    // Physics: 0..60. World: -30..+30 centered.
    // A blow lands in the middle of the plate.
    const strokeStart = simState.action === 'strike'
      ? { x: WIDTH_MM / 2, y: HEIGHT_MM / 2 }
      : getStrokeStart(WIDTH_MM, HEIGHT_MM, simState.direction);
    const startX = strokeStart.x - WIDTH_MM / 2;
    const startZ = strokeStart.y - HEIGHT_MM / 2;

    // Hover animation
    useEffect(() => {
        playbackRef.current = { startTime: 0, index: 0, lastElapsed: 0 };
    }, [toolPath, simState.isSimulating, simState.direction, simState.angle, simState.loopGhost, simState.action]);

    // The hammer model is built around the middle of its face, but a tilted hammer touches down on its
    // rim: the model is shifted so that the rim, not the middle, meets the mark.
    let offsetX = 0;
    let offsetY = 0;
    let offsetZ = 0;
    if (simState.toolType === 'hammer_face' && centreOffset) {
        const offsetRad = centreOffset.directionDeg * Math.PI / 180;
        offsetX = centreOffset.alongMm * Math.cos(offsetRad) - centreOffset.acrossMm * Math.sin(offsetRad);
        offsetZ = centreOffset.alongMm * Math.sin(offsetRad) + centreOffset.acrossMm * Math.cos(offsetRad);
        offsetY = centreOffset.upMm;
    }

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
            groupRef.current.position.set(worldX + offsetX, last.toolZ + offsetY, worldZ + offsetZ);
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

        groupRef.current.position.set(worldX + offsetX, interpZ + offsetY, worldZ + offsetZ);
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
                
                {/* Force Vector Arrow: runs beside the tool shaft (Local Z) and points down it at the tip */}
                {/* Models are Z-aligned. Handle is Z+. Tip is 0. */}
                <arrowHelper args={[new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 4, 55), 40, 0xff0000]} />
            </group>
        </group>
    );
};

const formatHeight = (valueMm: number) => (
  valueMm < 1 ? `${Math.round(valueMm * 1000)} µm` : `${valueMm.toFixed(2)} mm`
);

const HeightLegend: React.FC<{ rangeMm: number }> = ({ rangeMm }) => (
  <Box sx={{ position: 'absolute', left: 16, bottom: 16, width: 240, p: 1, borderRadius: 1, bgcolor: 'rgba(0, 0, 0, 0.7)', pointerEvents: 'none' }}>
    <Box sx={{ height: 10, borderRadius: 1, background: 'linear-gradient(to right, rgb(0,0,255), rgb(0,255,0), rgb(255,0,0))' }} />
    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
      <Typography variant="caption">-{formatHeight(rangeMm)}</Typography>
      <Typography variant="caption">0</Typography>
      <Typography variant="caption">+{formatHeight(rangeMm)}</Typography>
    </Box>
  </Box>
);

const ForensicLab: React.FC<LabProps> = ({ simState, setSimState }) => {
  // Calculate light pos for main scene component too if needed, or just pass state down?
  // Actually, we can just render the light here.
  const [toolPath, setToolPath] = useState<ToolPathPoint[]>([]);
  const [toolCentreOffset, setToolCentreOffset] = useState<ToolCentreOffset | null>(null);
  const handleToolPathUpdate = useCallback((path: ToolPathPoint[], centreOffset?: ToolCentreOffset) => {
    setToolPath(path);
    setToolCentreOffset(centreOffset ?? null);
  }, []);
  const [detail, setDetail] = useState<DetailOverlay | null>(null);
  const [heightRange, setHeightRange] = useState(MIN_HEIGHT_RANGE_MM);
  
  const rRad = simState.rakingLightAngle * Math.PI / 180;
  const lightH = 50 * Math.sin(rRad); // Height from surface (Y)
  const lightDist = 50 * Math.cos(rRad); // Distance laterally (X)

  return (
    <>
    <Canvas shadows dpr={[1, 2]} camera={{ position: [0, 55, 55], fov: 45 }}>
      <color attach="background" args={['#050505']} />
      
      <ambientLight intensity={0.05} />
      
      {/* RAKING LIGHT (Directional for uniform grazing) */}
      <directionalLight 
        position={[lightDist, lightH, 0]} 
        intensity={3.0} 
        castShadow 
        shadow-mapSize={[2048, 2048]} 
        shadow-bias={-0.0001}
        shadow-camera-left={-SHADOW_EXTENT_MM}
        shadow-camera-right={SHADOW_EXTENT_MM}
        shadow-camera-top={SHADOW_EXTENT_MM}
        shadow-camera-bottom={-SHADOW_EXTENT_MM}
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
          onToolPathUpdate={handleToolPathUpdate}
          onDetailMapUpdate={setDetail}
          onHeightRangeUpdate={setHeightRange}
        />
        {simState.viewMode === 'standard' && simState.showDetail && <DetailMapOverlay detail={detail} />}
        
        {simState.showScales && <ForensicScaleBar />}

        <Grid infiniteGrid fadeDistance={60} sectionColor="#00e5ff" cellColor="#1a1a1a" position={[0,-0.1,0]} />
        {simState.showTool && <ToolVisualizer simState={simState} toolPath={toolPath} centreOffset={toolCentreOffset} />}
      </group>
      
      {/* Built from scene lights so the lab has no runtime download, and kept dim so the raking light dominates. */}
      <Environment resolution={256} environmentIntensity={0.6}>
        <Lightformer form="rect" intensity={1.5} position={[0, 30, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[60, 60, 1]} />
        <Lightformer form="rect" intensity={0.8} position={[0, 10, -40]} scale={[80, 20, 1]} />
        <Lightformer form="rect" intensity={0.5} position={[0, 10, 40]} rotation={[0, Math.PI, 0]} scale={[80, 20, 1]} />
      </Environment>
    </Canvas>
    {simState.viewMode === 'heatmap' && <HeightLegend rangeMm={heightRange} />}
    </>
  );
};

export default ForensicLab;
