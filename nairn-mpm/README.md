# NairnMPM Sidecar Prototype

This directory is an isolated prototype for running forensic tool-mark scenarios through an external NairnMPM solver and converting extracted output into app-readable JSON. It does not replace the current React/Three heightfield simulator.

## Requirements

Set both executable paths before running solver commands:

```bash
export NAIRN_MPM_BIN=/absolute/path/to/NairnMPM
export EXTRACT_MPM_BIN=/absolute/path/to/ExtractMPM
```

The sidecar fails fast if either variable is missing, points to a non-file, or points to a non-executable path. NairnMPM source, binaries, and DTD files are not vendored here.

## Commands

```bash
npm run build
npm test
npm run validate-scenario -- fixtures/scenarios/knife_aluminum_baseline.json
npm run generate-input -- fixtures/scenarios/knife_aluminum_baseline.json
npm run run-scenario -- fixtures/scenarios/knife_aluminum_baseline.json
npm run extract-results -- fixtures/scenarios/knife_aluminum_baseline.json fixtures/extract/sample_particles.txt
npm run summarize-result -- runs/knife-aluminum-baseline/result.json
```

Generated files are written under `runs/<scenario-id>/`.

## Scenario Contract

Scenario JSON is intentionally strict. It requires every physical and solver value used by this prototype:

- `units`: currently fixed to `mm`, `s`, `N`, `MPa`, and `mg/mm^3`.
- `simulation`: 2D domain size, target thickness, cell size, particles per element, time step, max time, archive time, and origin.
- `target`: material name, thickness, `IsoPlasticity`, and explicit material properties.
- `tool`: tool type, hardness, force, attack angle, direction, speed, chatter, wear, start point, path length, and tool geometry.
- `solver`: processor count, MPM method, archive fields, and ExtractMPM fields.

No implicit defaults are applied. Missing or extra fields fail validation.

## Current Feature Inventory

| Current browser simulator feature | Sidecar status |
| --- | --- |
| Screwdriver and knife tools | Supported as first rigid-contact geometry pass |
| Crowbar, hammer face, hammer claw, spoon | Declared but fail fast until geometry is specified |
| Aluminum, brass, steel, wood, gold | Supported in schema with explicit per-scenario material properties |
| Hardness, force, angle, direction, speed, chatter, wear | Captured in scenario; speed/direction drive rigid body velocity; force/chatter/wear are currently metadata for calibration follow-up |
| Material thickness | Supported in grid and material point body definitions |
| Deterministic seed | Not used yet by generated XML; add only when a NairnMPM feature needs randomization |
| Surface heightfield | Pending; normalized output currently stores particles |
| Damage/fracture/debris state | Pending; parser includes optional `damage` column when ExtractMPM output provides it |
| Heatmap, normal map, raking light, scale bars | Out of sidecar scope; future React loader can reuse current visualization modes |
| Tool ghost playback | Out of sidecar scope for this prototype |
| JSON handoff to React | Supported as `result.json` with metadata, particle summary, particles, and diagnostics |

## Output Contract

`result.json` is the stable handoff format for future React integration:

- `metadata`: scenario id, output name, units, source paths, generated timestamp, and optional solver command.
- `particleSummary`: particle count, bounds, max displacement, and max damage when available.
- `visualization`: currently `{ "type": "particles", "particles": [...] }`.
- `diagnostics`: warnings emitted by the sidecar.

## NairnMPM Notes

The generated XML follows the documented high-level NairnMPM structure:

- `<Header>` with plane-stress MPM analysis id `10`
- `<MPMHeader>` with timing, archive root, archive fields, GIMP, and multimaterial mode
- `<Mesh>` with a regular 2D grid
- `<MaterialPoints>` with a target body and rigid tool body
- `<Material>` entries for `IsoPlasticity` target material and `RigidContact` tool material

This is a prototype input generator. The first calibration pass should run the two fixtures, inspect actual NairnMPM validation errors if any, and adjust only the Nairn XML mapping, not the scenario schema.
