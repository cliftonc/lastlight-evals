/**
 * Tier/dataset discovery — replaces the old hardcoded `TIERS` map.
 *
 * A **tier** is simply a directory that contains an `instances.json`
 * (alongside, for code-fix tiers, `repos/<id>/` fixtures and `tests/<id>/`
 * held-out tests). Tiers are discovered from up to three roots and merged by
 * name with **overlay > user > built-in** precedence — the same shadow-by-name
 * model core uses for workflow assets, so a deployment can override a shipped
 * tier or add entirely new ones without touching this package.
 *
 *   1. built-in — `<pkg>/datasets/*`            (the shipped "our" samples)
 *   2. user     — `--datasets <dir>` / `LASTLIGHT_EVALS_DATASETS`
 *   3. overlay  — `<overlayDir>/evals/datasets/*`  (a bootstrapped repo)
 *
 * Which workflow a tier runs is resolved per-instance first (the existing,
 * unchanged `instance.workflow` field), then from an optional per-tier
 * `tier.json` (`{ name?, defaultWorkflow, description? }`). Shipping a
 * `tier.json` next to the two built-in datasets turns the former hardcoded map
 * into data with zero changes to the instance files.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import type { SweBenchInstance } from "./schema.js";

export type TierSource = "builtin" | "user" | "overlay";

export interface Tier {
  name: string;
  source: TierSource;
  /** Dir containing `instances.json` (and `repos/`, `tests/` for code-fix). */
  root: string;
  instancesPath: string;
  /** From `tier.json`; fallback when an instance doesn't name its workflow. */
  defaultWorkflow?: string;
  description?: string;
}

interface TierManifest {
  name?: string;
  defaultWorkflow?: string;
  description?: string;
}

/** Scan one root for immediate subdirs that hold an `instances.json`. */
function scanRoot(root: string, source: TierSource): Tier[] {
  if (!root || !existsSync(root)) return [];
  const out: Tier[] = [];
  for (const entry of readdirSync(root)) {
    const dir = join(root, entry);
    let isDir = false;
    try {
      isDir = statSync(dir).isDirectory();
    } catch {
      continue;
    }
    if (!isDir) continue;
    const instancesPath = join(dir, "instances.json");
    if (!existsSync(instancesPath)) continue;

    let manifest: TierManifest = {};
    const manifestPath = join(dir, "tier.json");
    if (existsSync(manifestPath)) {
      try {
        manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as TierManifest;
      } catch {
        /* a malformed tier.json just means no defaultWorkflow — not fatal */
      }
    }
    out.push({
      name: manifest.name || entry,
      source,
      root: dir,
      instancesPath,
      defaultWorkflow: manifest.defaultWorkflow,
      description: manifest.description,
    });
  }
  return out;
}

export interface DiscoverOptions {
  builtinRoot: string;
  userDatasetsDir?: string;
  overlayDir?: string;
}

/**
 * Discover all tiers across the roots, overlay-wins by name. Insertion order
 * (built-in first) is preserved for stable display; later sources overwrite the
 * map value for a shared name.
 */
export function discoverTiers(opts: DiscoverOptions): Map<string, Tier> {
  const tiers = new Map<string, Tier>();
  const add = (list: Tier[]) => {
    for (const t of list) tiers.set(t.name, t);
  };
  add(scanRoot(opts.builtinRoot, "builtin"));
  if (opts.userDatasetsDir) add(scanRoot(resolve(opts.userDatasetsDir), "user"));
  if (opts.overlayDir) add(scanRoot(join(resolve(opts.overlayDir), "evals", "datasets"), "overlay"));
  return tiers;
}

/** Load a tier's instances, with the optional `EVAL_INSTANCE` substring filter. */
export function loadInstances(tier: Tier): SweBenchInstance[] {
  const all = JSON.parse(readFileSync(tier.instancesPath, "utf8")) as SweBenchInstance[];
  const filter = process.env.EVAL_INSTANCE?.trim();
  return filter ? all.filter((i) => i.instance_id.includes(filter)) : all;
}

/**
 * Resolve the workflow to run for one instance: explicit `instance.workflow`
 * wins, else the tier's `defaultWorkflow`. Throws if neither is set — a loud
 * misconfiguration rather than a silent wrong default.
 */
export function workflowFor(tier: Tier, inst: SweBenchInstance): string {
  const wf = inst.workflow ?? tier.defaultWorkflow;
  if (!wf) {
    throw new Error(
      `Tier "${tier.name}": instance "${inst.instance_id}" has no \`workflow\` and the ` +
        `tier has no \`defaultWorkflow\` (add one to ${join(tier.root, "tier.json")}).`,
    );
  }
  return wf;
}
