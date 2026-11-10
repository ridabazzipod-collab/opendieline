import { DielineError } from "../model.js";
import type { Template } from "./common.js";
import { standUpPouch, zipPouch } from "./pouch.js";
import { regularSlottedCarton } from "./rsc.js";
import { sleeve } from "./sleeve.js";
import { mailer, tray } from "./tray.js";
import { reverseTuckEnd, straightTuckEnd } from "./tuck.js";

export type { BoxParameters, FieldLabels, Template, TemplateKind } from "./common.js";
export { resolvePouch, verifyPouch } from "./pouch.js";

export const templates: readonly Template[] = [
  reverseTuckEnd,
  straightTuckEnd,
  sleeve,
  tray,
  mailer,
  regularSlottedCarton,
  zipPouch,
  standUpPouch,
];

export function getTemplate(id: string): Template {
  const template = templates.find((candidate) => candidate.id === id);
  if (!template) {
    const known = templates.map((candidate) => candidate.id).join(", ");
    throw new DielineError("UNKNOWN_TEMPLATE", `Unknown template "${id}". Available: ${known}.`);
  }
  return template;
}
