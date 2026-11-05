# Roadmap

Priorities may change as people use the project.

## Engine

- [ ] Publish the package to npm
- [ ] Crash-lock and auto-bottom cartons
- [ ] Gable, pillow and display boxes
- [ ] Curved edges and arcs in exports, with no line approximation
- [ ] Printer-specific allowance profiles for paperboard and corrugated board
- [ ] Collision checks between folded panels
- [ ] Multi-blank nesting on a sheet

## Design

- [ ] Place artwork on panels with correct rotation for each face
- [ ] Safe zones and fold-aware barcode placement
- [ ] Render the folded box with artwork

## Hosted service

- [ ] HTTP API for dieline generation
- [ ] Web editor with saved projects
- [ ] AI assistant that turns a product description into validated box parameters
- [ ] AI-assisted artwork that follows each panel's position

The engine stays open source. AI output will go through the same verifier as every
other dieline, so a model can suggest a box but cannot skip the checks.
