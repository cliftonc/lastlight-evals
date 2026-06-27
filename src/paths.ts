/**
 * Filesystem anchors for the eval package.
 *
 * Built-in assets (the shipped sample `datasets/` + `models.json`) live at the
 * PACKAGE ROOT — one level above this file's dir, which is `src/` under tsx in
 * dev and `dist/` when built+installed. Resolving relative to `import.meta.url`
 * (not `process.cwd()`) keeps them findable no matter where the CLI is invoked
 * from — including out of `node_modules/lastlight-evals/`.
 *
 * Run OUTPUT, by contrast, is written under the caller's cwd (an installed
 * package dir is read-only), overridable via `LASTLIGHT_EVALS_OUT`.
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Package root: the dir holding `datasets/`, `models.json`, `package.json`. */
export function packageRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..");
}

/** Shipped sample datasets root (`<pkg>/datasets`). */
export function builtinDatasetsRoot(): string {
  return resolve(packageRoot(), "datasets");
}

/** Shipped default model registry (`<pkg>/models.json`). */
export function builtinModelsPath(): string {
  return resolve(packageRoot(), "models.json");
}

/** Where scorecards/artifacts are written (cwd-relative, NOT the package dir). */
export function resultsRoot(): string {
  return process.env.LASTLIGHT_EVALS_OUT
    ? resolve(process.env.LASTLIGHT_EVALS_OUT)
    : resolve(process.cwd(), "eval-results");
}
