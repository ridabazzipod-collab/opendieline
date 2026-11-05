# Architecture

## The main idea

Most dieline tools draw cut lines and crease lines by hand, then add a 3D preview
separately. Those three things can drift apart. OpenDieline has one source of truth: a
tree of flat panels.

```text
Template  →  compile()  →  Dieline  →  verifyFold()  →  exporters
(panels)     (derive and   (cut path,  (fold in 3D      (SVG, PDF,
              validate)     creases)    and measure)     DXF)
```

## Coordinates

The blank lies in the `z = 0` plane, in millimetres, with `+x` right and `+y` down. The
printed side is the outside of the box. The root panel stays still, and every other panel
folds away from the printed side.

## Compiling

`src/compile.ts` does the following:

1. Validates ids, areas and the parent tree.
2. Splits edges at T-junctions, so a narrow flap can sit on a longer panel edge.
3. Classifies edges. Two panels make a crease. One panel makes a cut.
4. Requires that any two touching panels have a parent-child hinge along one straight line.
5. Traces the cut edges. Every point must join exactly two edges, in a single loop.
6. Rejects a cut path that crosses itself.
7. Compares the panels' combined area with the area inside the outline to detect overlaps.

## Board thickness

A crease sits in the middle of the board, so each crease-to-crease size is the inside
size plus one thickness. A wall with a free top edge, such as a tray wall, adds half.

## Fold verification

`src/fold.ts` gives each panel a transform: its parent's transform multiplied by a
rotation about its hinge. At full fold, `verifyFold()` checks four things:

| Check | Question |
| --- | --- |
| `size` | Does the box measure the expected size? |
| `walls` | Does each wall lie flat on a face of the box? |
| `closure` | Are the right number of faces at least 90% covered? |
| `containment` | Does every flap stay inside the box? |

These are geometric checks on thin sheets. They do not model how board behaves.

## Exports

Exporters take a compiled `Dieline`, so they cannot produce an unvalidated blank. They
have no dependencies and are safe to run in a browser.
