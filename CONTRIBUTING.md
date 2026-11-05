# Contributing

Thanks for helping. Print and packaging knowledge is as valuable here as code.

## Set up

```sh
npm install
npm test
npm run typecheck
```

## Good first contributions

- Cut and fold a generated blank, then report what fit and what did not. Include the box
  style, sizes, board and a photo if you can.
- Add a box style by following [the template guide](docs/adding-a-template.md).
- Check an export in your cutting software or RIP and report problems.

## Pull requests

1. Keep each pull request to one change.
2. Add a test for any behaviour you change.
3. New box styles join the `templates` list, which runs them through the size sweep and
   fold verification automatically.
4. Run `npm run examples` if a change affects generated output.
5. Do not add runtime dependencies without discussing it in an issue first.

Pull requests need passing CI and a maintainer review before merge.

## Conduct

This project follows the [Code of Conduct](CODE_OF_CONDUCT.md).
