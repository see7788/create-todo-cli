import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Mustache from "mustache";

export type TemplateContext = Record<string, unknown>;

export function tplRender(templatePath: string, context: TemplateContext): string {
  const templateText = fs.readFileSync(templatePath, "utf-8");
  return Mustache.render(templateText, context);
}

export function tplRenderFromRoot(relativePath: string, context: TemplateContext): string {
  return tplRender(path.join(templateRootGet(), relativePath), context);
}

export function templateRootGet(): string {
  return path.dirname(fileURLToPath(import.meta.url));
}
