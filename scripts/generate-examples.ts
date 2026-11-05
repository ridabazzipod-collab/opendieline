import { mkdirSync, writeFileSync } from "node:fs";
import { generate, templates, toSvg } from "../src/index.js";

mkdirSync("examples", { recursive: true });
for (const template of templates) {
  const { dieline, verification } = generate(template.id, template.defaults);
  if (!verification.passed) throw new Error(`${template.id} failed fold verification`);
  writeFileSync(`examples/${template.id}.svg`, toSvg(dieline));
}
