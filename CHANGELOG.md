# Changelog

## 0.3.0

- The mockup studio now reads finished dieline pictures that do not match a built-in
  pack style. It finds the four wall panels, the lid and the glue flap from the outline of a
  PNG with a transparent background, ignores a thin sticker outline, and builds a carton
  from them, so the artwork is placed exactly as designed.
- Added panel lines under the picture to correct any edge, and a choice of which panel
  carries the lid.
- `generate` accepts a template object as well as a template id.

## 0.2.1

- Fixed designs that would not open in previews that block image links.
- Fixed a page error in previews without the Claude save dialog.

## 0.2.0

- Added flat zip pouch and stand-up zip pouch templates, with seals, zipper, tear notches,
  hang hole and bottom gusset.
- Added seal and zipper layers to SVG, PDF and DXF export, and inner cuts for holes.
- Added the mockup studio: place a full dieline design or a front image, turn the box,
  and download a PNG with a transparent or white background.
- Fixed the fold direction so the printed side ends up outside. Fold checks were not
  affected, but artwork would have appeared mirrored.

## 0.1.0

First release.

- Six box styles: reverse tuck end, straight tuck end, sleeve, open tray, mailer box and
  regular slotted carton.
- Panel-based compiler that derives cut and crease lines and rejects invalid blanks.
- 3D fold verification.
- SVG, PDF and DXF export.
- Blank metrics and a simple sheet count.
- Command-line tool and browser playground.
