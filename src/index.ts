import { compile } from "./compile.js";
import { verifyFold, type FoldVerification } from "./fold.js";
import type { Dieline } from "./model.js";
import { getTemplate, type BoxParameters } from "./templates/index.js";

export { compile } from "./compile.js";
export { foldPanels, verifyFold } from "./fold.js";
export type { FoldCheck, FoldedPanel, FoldVerification, Vec3 } from "./fold.js";
export type { Bounds, Vec2 } from "./geometry.js";
export { impose, measure } from "./metrics.js";
export type { Imposition, ImpositionOptions, Metrics } from "./metrics.js";
export { DielineError } from "./model.js";
export type {
  Crease,
  Dieline,
  DielineErrorCode,
  DielineSpec,
  Guide,
  GuideKind,
  PouchInfo,
  Hinge,
  Panel,
  PanelRole,
  PanelSpec,
} from "./model.js";
export { getTemplate, resolvePouch, templates, verifyPouch } from "./templates/index.js";
export type { BoxParameters, FieldLabels, Template, TemplateKind } from "./templates/index.js";
export { toDxf } from "./export/dxf.js";
export { toPdf } from "./export/pdf.js";
export type { PdfOptions } from "./export/pdf.js";
export { pathData, toSvg } from "./export/svg.js";
export type { SvgOptions } from "./export/svg.js";

export interface GeneratedDieline {
  dieline: Dieline;
  verification: FoldVerification;
}

/**
 * Builds a dieline from a template and compiles it. Cartons are folded in 3D to verify
 * them. Pouches get production checks for seals, zipper and notches instead.
 */
export function generate(templateId: string, parameters: BoxParameters): GeneratedDieline {
  const template = getTemplate(templateId);
  const dieline = compile(template.build(parameters));
  const verification = template.verify ? template.verify(dieline) : verifyFold(dieline);
  return { dieline, verification };
}
