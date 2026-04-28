# Development Backlog

## P0 - Correctness And Model Integrity

- Add a tangential friction/shear model so drag force, friction coefficient, and material response affect groove shape.
- Make `Tool Speed` physically meaningful by coupling it to chatter wavelength, stick-slip, strain-rate effects, and tearing.
- Replace visual/random brittle cracking with a fracture model using fracture toughness, stress intensity, and material anisotropy.
- Add integration tests for volume accounting, especially pile-up near surface boundaries where material can be clipped.
- Add regression tests that compare representative groove width/depth against expected ranges for each tool/material pair.

## P1 - Forensic Detail Fidelity

- Make the high-resolution detail map follow the actual tremor/tool path instead of rendering as a straight strip.
- Add asymmetric edge defects, burrs, bevel angle, edge radius, and worn/chipped tool geometry.
- Model tool wear evolution during a pass, especially when a softer or damaged tool contacts harder materials.
- Add multi-pass interactions: re-entry, hesitation, slip, overrun, repeated scraping, and partially overlapping marks.
- Add material transfer and debris: metal flakes, wood fibers, smeared material, and loose chips.

## P2 - Material Realism

- Add anisotropic base materials: wood grain, brushed metal, rolled sheet direction, and machined finish.
- Add material-specific friction coefficients and ductility/fracture parameters.
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

## Validation Backlog

- Build a small reference dataset of measured marks: force, speed, tool, material, groove depth, width, pile-up, and striation pitch.
- Add golden tests that compare simulation outputs to the reference dataset within tolerance.
- Document model limitations in the UI and README so outputs are not mistaken for validated forensic evidence.
