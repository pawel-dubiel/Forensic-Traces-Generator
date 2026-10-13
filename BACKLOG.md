# Development Backlog

## P0 - Correctness And Model Integrity

- Calibrate the tangential friction/shear model against measured groove asymmetry, pile-up, and tearing.
- Extend `Tool Speed` coupling with strain-rate material response and validate chatter wavelength against known ranges.
- Validate the finite-difference field and continuum-damage fracture model against fracture toughness, stress intensity, and perforation thresholds.
- Extend volume accounting tests to pile-up near the plate edge, where material can be clipped.
- Extend the reference checks (ball scratch width against ASTM G171, ball impression against impact energy) to expected width/depth ranges for each tool/material pair.
- Calibrate where displaced material goes: the prow share, the side-flow reach, ridge and rim widths, the smear share, and the tear roughness are set by rule of thumb, not by measurement.
- Calibrate the fracture heuristics added for consistency: the share of thickness a cut must remove before a ductile plate tears, and the fixed width over which plastic work feeds a crack.
- Give a blow a short skid: a strike now indents only, and the tangential part of an angled blow is ignored.
- Account for rebound in a blow: all of the normal energy is treated as plastic work, and the elastic share only shows as springback.
- Check the material table for consistency: steel pairs a 1800 MPa hardness with a 250 MPa yield strength, about twice the ratio of the other metals.
- The tool tilt is capped at 45 degrees, so attack angles below 45 degrees change the load split but not the tool geometry.

## P1 - Forensic Detail Fidelity

- The striation overlay now follows the tool path and lies on the surface, but its texture is still generated for a straight stroke; generate it along the path for curved strokes.
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
- Add renderer regression coverage for dynamic plate thickness, fracture-wall geometry, and through-hole visibility.
- Add quantitative measurement tools for groove depth, width, pile-up height, and striation spacing.
- Add exportable cross-sections and CSV/JSON reports for simulation outputs.
- Add scale-aware microscope views with selectable magnification.
- Add visual comparison mode for two simulated marks.

## P4 - Performance And Architecture

- Move simulation work to a Web Worker so long runs do not block React rendering. Runs yield on a time budget, but the final detail map, a blow, and the mesh update still block for a few hundred milliseconds.
- Replace `example1.gif`, which shows an earlier interface, with a recording of the current one.
- Add detail-quality presets: Fine, Forensic, Extreme.
- Tile high-resolution detail maps for long or curved paths.
- Add deterministic simulation snapshots for debugging and test fixtures.
- Split physics constants, tool definitions, and render-only code into separate modules.
- Consider a FEM/MPM research path for non-interactive high-fidelity fracture comparisons.
- NairnMPM sidecar: run the fixtures through the real solver. The generated input now passes the solver's schema, but the analysis mode, the archive field names, and the top-view 2D setup are unverified (see `nairn-mpm/README.md`).

## Validation Backlog

- Build a small reference dataset of measured marks: force, speed, tool, material, groove depth, width, pile-up, and striation pitch.
- Add golden tests that compare simulation outputs to the reference dataset within tolerance.
- Document model limitations in the UI and README so outputs are not mistaken for validated forensic evidence.
