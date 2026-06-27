/**
 * `lastlight-evals init [dir]` — scaffold a fresh overlay + evals repo, seeded
 * from the shipped defaults, then optionally version it as a private GitHub repo.
 *
 * The result is a self-contained deployment overlay: it carries its own
 * `workflows/` / `skills/` / `agent-context/` (which shadow the built-ins by
 * logical name) AND its own `evals/datasets/` + `evals/models.json`. Point the
 * runner at it with `lastlight-evals run --overlay <dir>` (or run from inside
 * it with `--overlay .`). It's pure data/config — no node deps; the globally
 * installed CLI supplies the runtime.
 *
 * Git/GitHub bootstrap reuses core's `detectGh` + `bootstrapOverlayRepo` (the
 * same flow behind `lastlight server setup`) via the `lastlight/evals` barrel —
 * git init + initial commit + an offered `gh repo create --private`.
 */
import { existsSync, mkdirSync, writeFileSync, cpSync } from "node:fs";
import { join, resolve, basename } from "node:path";

import * as p from "@clack/prompts";
import chalk from "chalk";
import { detectGh, bootstrapOverlayRepo } from "lastlight/evals";

import { builtinDatasetsRoot, builtinModelsPath } from "./paths.js";

const CONFIG_YAML = `# Last Light — eval/overlay config (merged over the core config/default.yaml).
# Arrays replace, maps deep-merge, env vars override. See the lastlight docs.
#
# managedRepos:
#   - your-org/your-repo
#
# models:
#   default: openai/gpt-5.5
`;

const GITIGNORE = `# Eval run output (scorecards, predictions) — regenerated, never commit.
eval-results/

# Local secrets / env.
.env
secrets/*
!secrets/.env.example
*.pem
`;

function readmeFor(name: string): string {
  return `# ${name}

A Last Light **eval + overlay** workspace, created by \`lastlight-evals init\`.

## Layout

- \`workflows/\`, \`skills/\`, \`agent-context/\` — overlay assets. Files here
  **shadow** the built-in Last Light assets by name, or add new ones.
- \`evals/datasets/<tier>/\` — your eval datasets (\`instances.json\` +
  \`tier.json\`, plus \`repos/\` + \`tests/\` for code-fix tiers). Seeded with the
  shipped \`triage\` / \`code-fix\` samples — edit or replace them.
- \`evals/models.json\` — the model registry these evals run against.
- \`config.yaml\` — overlay config (managed repos, models, …).

## Run

\`\`\`bash
# from inside this repo
lastlight-evals run --overlay .
# or a specific tier
lastlight-evals run code-fix --overlay .
\`\`\`

Override which core build the evals test with \`LASTLIGHT_CORE_DIR=/path/to/lastlight\`.
`;
}

/** Write the default files/dirs into `dir`, never overwriting what exists. */
function scaffoldEvalRepo(dir: string): string[] {
  const created: string[] = [];
  const writeIfMissing = (rel: string, content: string): void => {
    const abs = join(dir, rel);
    if (existsSync(abs)) return;
    mkdirSync(resolve(abs, ".."), { recursive: true });
    writeFileSync(abs, content, "utf8");
    created.push(rel);
  };

  // Overlay asset dirs (empty placeholders the user fills in).
  for (const d of ["workflows", "skills", "agent-context"]) {
    const keep = join(d, ".gitkeep");
    writeIfMissing(keep, "");
  }

  // Seed datasets + models from the shipped defaults (a starting point to edit).
  const datasetsDst = join(dir, "evals", "datasets");
  if (!existsSync(datasetsDst)) {
    mkdirSync(datasetsDst, { recursive: true });
    cpSync(builtinDatasetsRoot(), datasetsDst, { recursive: true });
    created.push("evals/datasets/ (seeded triage + code-fix)");
  }
  const modelsDst = join(dir, "evals", "models.json");
  if (!existsSync(modelsDst)) {
    cpSync(builtinModelsPath(), modelsDst);
    created.push("evals/models.json");
  }

  writeIfMissing("config.yaml", CONFIG_YAML);
  writeIfMissing(".gitignore", GITIGNORE);
  writeIfMissing("README.md", readmeFor(basename(dir)));
  return created;
}

export async function runInit(dirArg?: string): Promise<number> {
  p.intro(chalk.bold(`Last Light ${chalk.yellow("·")} eval init`));

  const dir = resolve(dirArg ?? "lastlight-evals-workspace");
  p.log.step(`Scaffolding ${chalk.cyan(dir)}`);
  const created = scaffoldEvalRepo(dir);
  if (created.length) {
    p.log.success(`Created:\n  ${created.join("\n  ")}`);
  } else {
    p.log.info("Nothing to scaffold — every default file already existed.");
  }

  // Offer to version it + create a private GitHub repo (reuses core's flow).
  try {
    const gh = await detectGh();
    await bootstrapOverlayRepo(dir, { gh });
  } catch (err) {
    p.log.warn(`Skipped git/GitHub bootstrap: ${(err as Error).message}`);
  }

  p.outro(
    chalk.green(
      `done — run it with: ${chalk.bold(`lastlight-evals run --overlay ${dir === process.cwd() ? "." : dir}`)}`,
    ),
  );
  return 0;
}
