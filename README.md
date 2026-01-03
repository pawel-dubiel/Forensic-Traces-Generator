# Forensic Tool Mark Simulator

## Introduction
The **Forensic Tool Mark Simulator** is a high-fidelity scientific application designed to reconstruct and visualize the microscopic interactions between tools and material surfaces. It acts as a "virtual lab bench," allowing examiners to simulate scratches, gouges, and impacts without the need for destructive physical testing.

The core of this project is a **Physics Engine** that simulates how different metals behave when stressed. It doesn't just "draw" lines; it calculates how the material yields, flows, or breaks under pressure.

---

## 🔬 The Physics: Explained for Laymen

Imagine pressing a knife into a stick of butter versus a block of wood. The physics engine handles these differences using real Material Science principles.

### 1. Hardness & Penetration (Meyer's Law)
**"How deep does it cut?"**
*   **The Concept:** Hardness is a material's resistance to being dented.
*   **In Simulation:** We use **Meyer's Law**.
    *   **Sharp Tools (Knife):** Behave like a needle. They concentrate all force onto a tiny point, allowing them to penetrate deep with very little effort ($Depth \propto \sqrt{Force}$).
    *   **Blunt Tools (Hammer):** Behave like a stamp. They spread the force over a wide area, requiring massive effort to make even a shallow dent ($Depth \propto Force$).
*   **Example:** 50N of force with a Knife will slice deep into Aluminum. 50N with a Hammer will barely scratch it.

### 2. Plasticity vs. Brittleness
**"Does it flow or does it snap?"**
*   **Ductile Materials (Gold, Aluminum, Brass):**
    *   Think of **Modeling Clay**. When you push your finger into it, the clay doesn't disappear; it squishes out to the sides, forming raised "lips" or ridges.
    *   **Simulation:** The engine uses **Volume Conservation**. It calculates exactly how much material the tool displaced and piles it up on the edges of the cut. Gold "flows" the most, creating high ridges.
*   **Brittle Materials (Wood, Hardened Steel):**
    *   Think of **Dry Toast** or **Glass**. When you scratch it, it crumbles, chips, or snaps. It doesn't squish.
    *   **Simulation:** The engine calculates a "Chip Ratio". If the material is brittle, the simulated tool "tears" chunks out of the surface (deleting them) instead of piling them up.

### 3. Fracture Mechanics
**"When does it crack?"**
*   **The Concept:** If you push a brittle material too hard, the stress has nowhere to go, so it shoots out cracks.
*   **In Simulation:** If you drag a tool deep into **Wood** or **Hardened Steel**, the engine runs a "lightning bolt" algorithm. It generates random branching cracks that shoot out sideways from the main cut, mimicking real-world fracture patterns.

### 4. Chatter (Stick-Slip Friction)
**"Why is the scratch wavy?"**
*   **The Concept:** Have you ever dragged a sneaker across a gym floor and heard it squeak? That's **Stick-Slip**. The tool "sticks" to the metal, builds up tension, and then "slips" forward, vibrating like a guitar string.
*   **In Simulation:** We simulate this vibration frequency (approx. 20Hz).
    *   **Speed Matters:** If you drag **Slowly**, the ripples are packed tight together. If you drag **Fast**, the ripples stretch out. Forensic examiners use this to estimate how fast a suspect swiped a tool.

### 5. Micro-Striations (The "Fingerprint")
**"No two tools are alike."**
*   **The Concept:** Even a brand-new screwdriver has microscopic jagged edges from the factory grinder. As it wears down, it gets nicks and chips.
*   **In Simulation:** We generate a unique random "signature" for the tool edge. This signature carves parallel lines (striations) inside the main groove. Increasing the **Wear** slider makes these lines messier and more unique, just like a damaged tool.

---

## 🛠 Features

### Tool Lab
*   **Tools:** Screwdriver, Knife, Crowbar, Hammer (Face & Claw).
*   **Materials:** Gold (Soft/Ductile), Aluminum, Brass, Steel, Wood (Brittle).

### Forensic Visualization ("CSI Mode")
*   **Raking Light:** Move a light source to grazing angles (0-5°) to reveal shadows in microscopic scratches.
*   **Depth Heatmap:** False-color view (Blue=Deep, Red=High).
*   **Scale Bars:** ABFO-style rulers for measuring traces.

## Installation & Usage

1.  **Install:** `npm install`
2.  **Run:** `npm run dev`
3.  **Controls:** Use the sidebar to set Tool, Material, and Physics parameters.
4.  **Execute:** Click **EXECUTE SIMULATION** and wait for the physics engine to compute the interaction (progress bar included).