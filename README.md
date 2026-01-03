# Forensic Tool Mark Simulator

## Introduction
The **Forensic Tool Mark Simulator** is a high-fidelity scientific application designed to reconstruct and visualize the microscopic physical interactions between tools and surfaces. It allows forensic examiners, researchers, and students to simulate **Class Characteristics** and **Sub-Class Characteristics** of tool marks without the need for physical destructive testing.

Unlike standard 3D modeling software, this application is driven by a **Discrete Element Physics Engine** that calculates material yield, plastic flow, fracture mechanics, and dynamic friction in real-time.

## 🔬 Scientific Capabilities

The simulator utilizes a 64-bit double-precision physics kernel to ensure mathematical accuracy at the micrometer scale.

### 1. Material Physics
The engine differentiates between material types based on physical constants:
*   **Plastic Flow (Ductility):** Simulates the "pile-up" effect (ridges) seen in soft metals like **Gold** and **Aluminum**, strictly enforcing conservation of volume.
*   **Fracture Mechanics (Brittleness):** Simulates chipping and crack propagation in brittle materials like **Wood** or Hardened Steel.
*   **Yield Strength (Hardness):** Uses **Meyer’s Law** to calculate penetration depth based on tool sharpness and force ($d \propto \sqrt{F}$ for sharp tools, $d \propto F$ for blunt tools).

### 2. Dynamic Tool Interaction
*   **Stick-Slip Chatter:** Simulates the harmonic vibration of the tool as it drags across the surface. The wavelength of these "chatter marks" is correctly coupled to the **Speed** slider ($\lambda = v / f$), allowing for speed reconstruction analysis.
*   **Angle of Attack:** Calculates the 3D trigonometric projection of the tool shape based on **Yaw** (Direction) and **Pitch** (Angle), simulating "plowing" vs. "cutting" vs. "scraping" actions.
*   **Micro-Striations:** Procedurally generates unique "fingerprints" for tool edges based on wear and manufacturing defects, creating the fine parallel lines used for forensic matching.

### 3. Tool Library
*   **Screwdriver (Flat):** Creates striated linear scrapes.
*   **Knife (Wedge):** Creates deep, V-shaped cuts with high stress concentration.
*   **Crowbar (Round):** Creates wide, U-shaped gouges.
*   **Hammer (Face):** Simulates blunt force smearing/crushing (25mm diameter).
*   **Hammer (Claw):** Simulates dual-track gouging with a central ridge.

## 🕵️ Forensic Visualization Suite
The application includes a "CSI-style" inspection mode to analyze traces:

*   **Raking Light:** A movable light source (0-90°) to cast long shadows. Set to **0-5°** to reveal microscopic topography invisible under direct light.
*   **Depth Heatmap:** False-color rendering (Blue = Deep, Red = High) for quantitative depth analysis.
*   **Normal Map:** Visualizes surface slope to isolate texture from color.
*   **Reference Scales:**
    *   **Surface L-Scale:** Standard ABFO-style 20mm ruler on the plate.
    *   **HUD Scale:** Floating ruler hovering 15mm above the sample for unobstructed measurement.

## 🚀 Getting Started

### Prerequisites
*   Node.js (v18+)

### Installation
```bash
npm install
```

### Running the Simulator
```bash
npm run dev
```

### Usage Guide
1.  **Configure:** Select your Tool and Material from the sidebar.
2.  **Physics:** Adjust Force (Newtons), Angle, and Direction.
    *   *Tip:* Use **Speed** to control chatter wavelength.
    *   *Tip:* Use **Wear** to add "noise" to the cut.
3.  **Execute:** Click **"EXECUTE SIMULATION"**. 
    *   *Note:* The simulation is computationally heavy (calculating ~3.2 million interactions). A progress bar will indicate status.
4.  **Inspect:** Use the **Raking Light** slider and **View Mode** to analyze the result.

## Technical Details
*   **Engine:** Custom TypeScript Physics Engine using `Float64Array`.
*   **Rendering:** Three.js / React-Three-Fiber.
*   **Resolution:** 30 points/mm (900 points/mm²).
