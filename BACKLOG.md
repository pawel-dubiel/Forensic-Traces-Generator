# Development Backlog

## P0 - Correctness And Model Integrity

- Calibrate the tangential friction/shear model against measured groove asymmetry, pile-up, and tearing.
- Extend `Tool Speed` coupling with strain-rate material response and validate chatter wavelength against known ranges.
- Validate the local continuum-damage fracture model against fracture toughness, stress intensity, and perforation thresholds.
- Add integration tests for volume accounting, especially pile-up near surface boundaries where material can be clipped.
- Add regression tests that compare representative groove width/depth against expected ranges for each tool/material pair.

## P1 - Forensic Detail Fidelity

- Make the high-resolution detail map follow the actual tremor/tool path instead of rendering as a straight strip.
- Add asymmetric edge defects, burrs, bevel angle, edge radius, and worn/chipped tool geometry.
- Model tool wear evolution during a pass, especially when a softer or damaged tool contacts harder materials.
- Add multi-pass interactions: re-entry, hesitation, slip, overrun, repeated scraping, and partially overlapping marks.
- Extend material transfer and debris beyond deposited heightfields: metal flakes, wood fibers, smeared transfer, and loose chip bodies.

## P2 - Material Realism

- Add anisotropic base materials: wood grain, brushed metal, rolled sheet direction, and machined finish.
- Calibrate material-specific friction coefficients, ductility, fracture energy, tensile strength, critical strain, and thickness defaults from reference data.
- Add thermal effects for high speed or high friction: softening, burnishing, smearing, and wood darkening.
- Calibrate material constants from reference data instead of using broad plausible values.
- Separate display material labels from calculation materials/alloys, e.g. mild steel vs hardened steel.

## P3 - Rendering And Measurement

- Render the detail map as a normal/displacement detail layer instead of only a grayscale overlay.
- Add quantitative measurement tools for groove depth, width, pile-up height, and striation spacing.
- Add exportable cross-sections and CSV/JSON reports for simulation outputs.
- Add scale-aware microscope views with selectable magnification.
- Add visual comparison mode for two simulated marks.

## P4 - Performance And Architecture

- Move simulation work to a Web Worker so long runs do not block React rendering.
- Add detail-quality presets: Fine, Forensic, Extreme.
- Tile high-resolution detail maps for long or curved paths.
- Add deterministic simulation snapshots for debugging and test fixtures.
- Split physics constants, tool definitions, and render-only code into separate modules.
- Consider a FEM/MPM research path for non-interactive high-fidelity fracture comparisons.

## Validation Backlog

- Build a small reference dataset of measured marks: force, speed, tool, material, groove depth, width, pile-up, and striation pitch.
- Add golden tests that compare simulation outputs to the reference dataset within tolerance.
- Document model limitations in the UI and README so outputs are not mistaken for validated forensic evidence.
