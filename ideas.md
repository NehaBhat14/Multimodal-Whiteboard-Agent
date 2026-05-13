This summary consolidates your vision for the `WhiteBoardAgent` (Branch `005`), framing the technical requirements for a layout engine that transition from deterministic geometry to AI-driven intent.

---

## Technical Specification: WhiteBoardAgent (Branch 005)

### 1. Spatial Hybrid Layout Intelligence (Slices B & C)
We utilize a **"Math for Clearance, VLM for Intent"** model to ensure AI responses feel natively integrated into the user’s existing visual structure.

* **Geometric Detection (Math):** * **Projection Profiling:** Uses X-axis and Y-axis projection to detect multi-column formats or "research style" verticality. 
    * **Column Matching:** Calculates the average width ($W_{avg}$) of selected shapes to set a dynamic `maxWidth` for the AI text reflower.
* **Semantic Labeling (VLM):** * The VLM provides a `layout_style` tag (e.g., `COLUMNAR`, `MIND_MAP`, `FLOWING`) and a `script_direction` hint instead of raw coordinates.
    * **Intent-Aware Wrapping:** The VLM identifies if the user is building a comparison (columns) or a brainstorm (radial), directing the text planner to match that density.
* **The Fusion Scoring Engine:**
    * **Side Bias:** If `COLUMNAR` is detected, the `below` candidate is heavily weighted to maintain the vertical flow.
    * **Aspect Ratio Match:** Candidates that allow the AI text box to mirror the user's established column width are prioritized over the "shortest path" placement.



---

### 2. Multi-Lingual & Script-Aware Design
The engine is optimized for **English, Hindi, Spanish, and French**, accounting for the unique geometric footprints of each script.

* **Dynamic Footprinting (Slice A):** * **Locale-Aware Segmentation:** Uses `Intl.Segmenter` to find valid line-break points, preventing word-clipping in dense multi-lingual blocks.
    * **Vertical Expansion Buffer:** Applies a script-aware multiplier ($\alpha$) to the bounding box height.
* **Script Specifics:**

| Script / Language | Vertical Multiplier ($\alpha$) | Horizontal Buffer | Logic Detail |
| :--- | :--- | :--- | :--- |
| **English / Latin** | $1.2\times$ | Standard | Base metrics. |
| **Hindi (Devanagari)** | $1.6\times$ | Standard | Space for *Matras* (vowels) above/below the shirorekha. |
| **Spanish / French** | $1.2\times$ | $+15\%$ | Accommodates longer average word lengths. |



---

### 3. Future-Proofing for Diffusion
The current "Typewriter" implementation serves as the architectural scaffold for a future transition to **Diffusion-based Stroke Generation**.

* **Data Collection & Telemetry (Slice D):** * Logs the precise relationship between user stroke-bounds, the VLM's `layout_style` hint, and the final placement success.
    * This builds a ground-truth dataset of "stylistically correct" layouts.
* **Constraint Mapping:** * The geometry rules established now (e.g., Hindi's vertical safety buffer) will serve as the **"Hard Constraints"** for the future diffusion model's latent space.
    * The model will generate "pixels of text" directly into the "Safe Zones" defined by the current math/VLM hybrid planner.

---

**Next Steps for Implementation:**
* Implement the `Intl.Segmenter` logic in the `planTextLayout` path.
* Update the VLM system prompt in the backend to return the `layout_style` schema.
* Ensure the `005` telemetry logs includes the `selectionWidth` and `layout_orientation` for future model training.