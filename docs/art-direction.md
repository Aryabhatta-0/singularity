# Art direction

Singularity looks like a crash-test lab that grew into a toy world. The landing page already had the look: a yellow crash-test dummy, ink outlines, hazard tape, and calibration targets. The 3D game now uses the same look, so a screenshot reads as Singularity right away.

## The visual grammar

Each colour or mark means one thing everywhere. Do not reuse a meaning for decoration.

| You see | It means | Where it is made |
| --- | --- | --- |
| Red-orange and white stripes, padded | A hazard: it pushes you or blocks you | `buildStatic` (hurdles), movers |
| Yellow and ink stripes on an edge | Grip tape: hands can hold this ledge | `buildStatic` (blocks, overhead bars) |
| Big eyes on a moving thing | A moving hazard; the eyes follow you | `CourseView.buildMover` |
| Two flag poles and a dashed line, yellow then mint | A checkpoint; it turns mint when it is saved | `CourseView.buildCheckpoint` |
| Checkered banner on an arch | The finish | `CourseView.buildFinish` |
| Crash-test target, cyan chevrons and a light column | Deliver here | `CourseView.buildDelivery` |
| Bobbing gold gem over a prop | The objective: carry it or throw it | `PropView` |
| A prop outline that warms to gold | A hand is close enough to grab it | `PropView.update` |
| A pale pulsing outline on a limb | This is the limb that you steer | `CharacterView.setHighlight` |
| Team colour plus a glyph (●, ▲, ■ …) on the jersey | Team identity (it does not use colour only) | `CharacterView`, nameplates |

The tokens are in `src/game/visual-theme.ts`: palette, per-course themes (sky, fog, lights, water, surfaces) and motion timings. The CSS uses the same ink, dummy yellow, tape, mint and cyan values.

## Modules

- `visual-theme.ts`: design tokens and the five course themes.
- `materials.ts`: cached toy materials (soft rim light, families such as plastic, matte, rubber, metal, ice, glow and cloth), the ink outline and canvas textures.
- `environment-kit.ts`: procedural primitives and the `GeometryBatcher`. The batcher bakes colours into vertices and merges each material family into a few meshes per course chunk.
- `course-decor.ts`: styles each collision box by its function and builds the checkpoints, finish, delivery target and hoop.
- `course-scenery.ts`: the set pieces of each course.
- `character-view.ts`: the dummy (faces, squash and stretch, highlight, contact shadow).
- `prop-view.ts`: props with identity and the objective marker.
- `effects.ts`: pooled VFX library. `atmosphere.ts`: sky, clouds, water, foam and weather. `camera-rig.ts`: the camera.

## Rules that keep the game honest

- Collision comes only from `levels.ts`. Visuals can be bigger or richer, but they must not suggest a surface that is not there. Put dressing outside the walkable area, or below it (bridge stilts, island skirts).
- Feedback is in proportion: a step gets a puff, a fall gets a little shake, a basket gets rings, confetti, crowd and a camera kick. Shake and FOV kicks are off with `prefers-reduced-motion`.
- Performance: add static dressing through the batcher (never as loose meshes). Use the `scenery` batcher for far set pieces. Keep tessellation low. Measure with `tests/browser/render_stats.py` and `tests/browser/layer_cost.py`.

## To dress a new course

1. Add the level to `levels.ts` (collision and objectives) and a theme to `COURSE_THEMES`.
2. The generic styling comes free from `kind` (ground, block, bridge, ramp, hurdle, wall, pedestal, ferry, gate).
3. Add a function to `course-scenery.ts` for the landmarks: one vertical landmark that you can see from the start, set pieces off the path, and islets for depth.
4. Run `python tests/browser/visual_tour.py <label>` and look at the screenshots.
