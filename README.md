# Forensic Mark Simulator

A small 3D lab for generating forensic-style tool marks.

Pick a tool, pick a material, tune the force/angle/speed, then run the simulation and inspect the mark with forensic visualization modes.

![Forensic Mark Simulator preview](example1.gif)

## What It Does

- Simulates scratches, gouges, and impacts on a 60 mm surface.
- Supports screwdriver, knife, crowbar, hammer face, hammer claw, and spoon profiles.
- Supports aluminum, brass, steel, wood, and gold target materials.
- Models contact patches, plastic deformation, pile-up, springback, chatter, wear, and striation detail.
- Models material thickness, accumulated fracture damage, ductile and brittle tearing, lifted tear edges, detached cells, and deposited debris.
- Renders detached material as real holes in the surface mesh rather than as a color or depth trick.
- Renders the result in a Three.js viewport with orbit controls.
- Includes depth heatmap, normal map, raking light, scale bars, and optional 3D tool display.
- Uses deterministic seeds so a run can be repeated.

## Quick Start

```bash
npm install
npm run dev
```

Then open the local Vite URL shown in the terminal.

## Scripts

```bash
npm run dev      # start the app
npm run build    # typecheck and build
npm run lint     # run ESLint
npm test         # compile and run node tests
npm run preview  # preview the production build
```

## How To Use

1. Choose a tool profile and target material.
2. Adjust hardness, force, angle, direction, speed, chatter, wear, material thickness, and time step.
3. Choose a render resolution and view mode.
4. Click `EXECUTE SIMULATION`.
5. Inspect the mark with raking light, heatmap, normal map, and scale bars.

## Fracture Model

The simulator tracks material damage separately from surface height. Each surface cell stores accumulated damage, detachment state, lifted fracture-edge height, and debris height. When local contact work, shear loading, and plastic strain exceed the material's fracture thresholds, the cell detaches and adjacent triangles are removed from the mesh.

This produces visible holes, ragged raised edges, and debris deposits. Thicker targets require more energy to perforate, brittle materials such as wood fail earlier and propagate cracks more readily, and ductile metals require more plastic strain before detaching.

## Project Shape

```text
src/
  components/
    Controls.tsx       # side panel controls
    ForensicLab.tsx    # Three.js lab viewport
    Tools3D.tsx        # tool models
  utils/
    SimulationEngine.ts # core simulation loop, fracture state, mesh index helpers
    elasticPlastic.ts   # material response helpers
    random.ts           # seeded randomness
    striations.ts       # edge micro-geometry
tests/
  simulationEngine.test.ts
```

## Reality Check

This is an interactive simulator, not validated forensic evidence software.

The fracture model is physically motivated and deterministic, but it is not a full FEM or MPM solver. It uses a local continuum-damage approximation tuned for interactive browser use. See [BACKLOG.md](BACKLOG.md) for the calibration, friction, material, and rendering work that remains.
