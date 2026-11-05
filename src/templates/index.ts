import { DielineError } from "../model.js";
import type { Template } from "./common.js";
import { regularSlottedCarton } from "./rsc.js";
import { sleeve } from "./sleeve.js";
import { mailer, tray } from "./tray.js";
import { reverseTuckEnd, straightTuckEnd } from "./tuck.js";

export type { BoxParameters, Template } from "./common.js";

export const templates: readonly Template[] = [
  reverseTuckEnd,
  straightTuckEnd,
  sleeve,
  tray,
  mailer,
  regularSlottedCarton,
];

export function getTemplate(id: string): Template {
  const template = templates.find((candidate) => candidate.id === id);
  if (!template) {
    const known = templates.map((candidate) => candidate.id).join(", ");
    throw new DielineError("UNKNOWN_TEMPLATE", `Unknown template "${id}". Available: ${known}.`);
  }
  return template;
}
