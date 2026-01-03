# Forensic Tool Mark Simulator

## Introduction
The **Forensic Tool Mark Simulator** is a high-fidelity scientific application designed to reconstruct and visualize the microscopic physical interactions between tools and material surfaces. It acts as a "virtual lab bench," allowing examiners to simulate scratches, gouges, and impacts under controlled variables.

Unlike standard 3D modeling software, this application is driven by a **Discrete Element Physics Engine** (running in 64-bit precision) that calculates material yield, plastic flow, fracture mechanics, and dynamic friction in real-time.

---

## 🔬 Physics Engine Mechanics

The simulation is built upon several core pillars of material science and forensic physics.

### 1. Contact Mechanics & Plastic Deformation
The engine models the physical displacement of material when subjected to stress beyond its yield point.
*   **Depth & Contact Patch:** Penetration depth is calculated using **Meyer’s Law**, which differentiates between the high stress concentration of sharp tools (knives) versus the distributed load of blunt tools (hammers). The contact patch shape is dynamically generated based on the tool's 3D geometry and its angle of attack relative to the surface.
*   **Plastic Flow & Pile-up:** In ductile materials like Gold or Aluminum, material is not destroyed; it flows. The simulator strictly enforces **conservation of volume**, meaning the material displaced from the groove is redistributed to the edges, creating realistic "lips" or pile-up ridges characteristic of soft metals.
*   **Elastic Recovery:** The system accounts for "springback"—the tendency of elastic materials to recover slightly after the cutting force is removed, affecting the final depth measurement.

### 2. Microscopic Striation Modeling
Tool marks are rarely smooth; they contain a unique signature of parallel lines (striations) caused by imperfections in the tool edge.
*   **Edge Micro-Geometry:** The simulator procedurally generates a unique "fingerprint" for the tool edge, simulating manufacturing grinding marks and irregularities.
*   **Wear & Damage:** The **Wear** parameter introduces stochastic chips, nicks, and dull spots along the blade. As these imperfections drag through the material, they leave distinct, matching striations in the trench, which are critical for forensic matching.

### 3. Surface Topography Synthesis
Real surfaces are never perfectly flat. The engine synthesizes a realistic base topology before the tool even touches the surface.
*   **Anisotropic Roughness:** Simulates manufacturing finishes (like brushed metal) by generating directional grain noise.
*   **Stochastic Pits:** Randomly distributes microscopic defects and pits across the surface, providing landmark features that help provide scale and realism to the macroscopic tool mark.

### 4. Stick-Slip Dynamics & Stability
The interaction between tool and surface is dynamic, not static.
*   **Stick-Slip (Chatter):** As a tool moves, friction causes it to momentarily stick to the material, build tension, and then slip forward. This cycle creates a harmonic vibration known as "chatter."
*   **Speed Dependency:** The simulator couples this vibration to the **Speed** control. Following the wave equation, faster tool speeds elongate the wavelength of these chatter marks, allowing examiners to infer the velocity of the original tool application.
*   **Hand Tremor:** Subtle randomized movements are superimposed on the trajectory to simulate human instability during the cut.

### 5. Fracture Mechanics
For brittle materials, the simulator switches from plastic flow to fracture logic.
*   **Chip Formation:** In materials like Wood or Hardened Steel, high stress causes chunks of material to tear away (chip detachment) rather than flow, leaving a roughened, jagged trench floor.
*   **Crack Propagation:** High-force impact events trigger a branching algorithm that shoots randomized cracks outward from the impact site, simulating the brittle failure of the material structure.

---

## 🛠 Features

### Tool Lab
*   **Tools:** Screwdriver, Knife, Crowbar, Hammer (Face & Claw).
*   **Materials:** Gold (Soft/Ductile), Aluminum, Brass, Steel, Wood (Brittle).
*   **3D Tool Visualization:** Real-time 3D representation of the tool geometry, orienting itself to match your Angle and Direction settings.

### Forensic Visualization Suite
*   **Raking Light:** A movable light source (0-90°) to cast long shadows. Set to **0-5°** to reveal microscopic topography invisible under direct light.
*   **Depth Heatmap:** False-color view (Blue=Deep, Red=High) for quantitative depth analysis.
*   **Normal Map:** Visualizes surface slope to isolate texture from color.
*   **Scale Bars:** ABFO-style rulers (Surface & HUD) for measuring trace dimensions.

## Installation & Usage

1.  **Install:** `npm install`
2.  **Run:** `npm run dev`
3.  **Controls:** Use the sidebar to set Tool, Material, and Physics parameters.
4.  **Execute:** Click **EXECUTE SIMULATION** and wait for the physics engine to compute the interaction.
