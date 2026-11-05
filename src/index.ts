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
  Hinge,
  Panel,
  PanelRole,
  PanelSpec,
} from "./model.js";
export { getTemplate, templates } from "./templates/index.js";
export type { BoxParameters, Template } from "./templates/index.js";
export { toDxf } from "./export/dxf.js";
export { toPdf } from "./export/pdf.js";
export type { PdfOptions } from "./export/pdf.js";
export { pathData, toSvg } from "./export/svg.js";
export type { SvgOptions } from "./export/svg.js";

export interface GeneratedDieline {
  dieline: Dieline;
  verification: FoldVerification;
}

/** Builds a dieline from a template, compiles it and folds it to verify the result. */
export function generate(templateId: string, parameters: BoxParameters): GeneratedDieline {
  const dieline = compile(getTemplate(templateId).build(parameters));
  return { dieline, verification: verifyFold(dieline) };
}
