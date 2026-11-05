# Adding a box style

A template returns panels, the folded size, and how many faces are open by design.

```ts
import { rect } from "../geometry.js";
import { resolveDimensions, type Template } from "./common.js";

export const openBand: Template = {
  id: "open-band",
  name: "Open band",
  description: "A simple four-sided band.",
  defaults: { length: 100, width: 60, depth: 40, thickness: 0.5 },
  build(parameters) {
    const { a, b, depth } = resolveDimensions(parameters, 10);
    return {
      template: "open-band",
      foldedSize: [a, b, depth],
      openFaces: 2,
      panels: [
        { id: "back", role: "wall", polygon: rect(a, 0, a + b, depth) },
        { id: "front", role: "wall", parent: "back", polygon: rect(0, 0, a, depth) },
        // ...more panels
      ],
    };
  },
};
```

## Rules

- Exactly one panel has no `parent`.
- A panel must share one straight edge with its parent.
- Panels that are not parent and child must not share an edge.
- Use `role: "wall"` for outer faces and `role: "flap"` for anything inside the box.
- Add a small relief, such as 0.5 mm, where flaps would otherwise touch at a corner.

## Finish

1. Add the template to `src/templates/index.ts`. The test suite then checks it across
   sizes and proportions.
2. Run `npm test`.
3. Run `npm run examples` and look at the new SVG.
4. Cut and fold a real sample if you can, and mention it in your pull request.
