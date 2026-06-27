# lastlight-evals — agent orientation

Human-facing usage (how to run, how to add a case) lives in `README.md`. This
file is the *why* — the seams and invariants to preserve when changing the
harness.

This is a **standalone package** that depends on `lastlight` (npm). It used to
live inside the core repo at `lastlight/evals`; it now consumes core through the
public `lastlight/evals` barrel. Source is under `src/`; the shipped sample
`datasets/` and `models.json` sit at the package root.

## Package architecture (the extraction seams)

- **The barrel — the ONLY core coupling.** `run-instance.ts` imports
  `getWorkflow`, `runWorkflow`, `ExecutorConfig`, `TemplateContext` from
  `lastlight/evals` (core's `src/evals-api.ts`). Never reach into
  `lastlight/dist/...` deep paths — the barrel is the stable contract. `init.ts`
  also pulls `detectGh` / `bootstrapOverlayRepo` from it.
- **The asset-bootstrap footgun (`bootstrap.ts`).** Core's `getWorkflow`
  resolves built-in workflows/skills/agent-context from `DEFAULT_ROOT =
  resolve(".")` (the cwd). In-repo that was the core checkout; here the cwd is
  wherever the user ran the CLI. So `run.ts` MUST call `bootstrapAssets()`
  (→ `configureWorkflowAssets({ builtInRoot, overlayRoot })`) **before any
  `getWorkflow`/`runWorkflow`**. `builtInRoot` is the installed `lastlight`
  package root (or `LASTLIGHT_CORE_DIR`). Forget the call and workflows silently
  fail to resolve. It is the first thing `runEval` does.
- **Discovery, not a hardcoded map (`discovery.ts`).** Tiers are directories
  with an `instances.json`, discovered from built-in (`<pkg>/datasets`), user
  (`--datasets`), and overlay (`<overlay>/evals/datasets`) roots —
  overlay-wins-by-name. `defaultWorkflow` comes from a per-tier `tier.json`
  (or the per-instance `workflow`). Adding a tier = dropping a directory; no
  code change.
- **Overlay parity.** `--overlay <dir>` (or `LASTLIGHT_OVERLAY_DIR`) wires BOTH
  the workflow/skill overlay (via `bootstrapAssets`) and the dataset overlay
  (via discovery) from one flag — a bootstrapped `init` repo is exactly such an
  overlay.

## The one invariant

These evals run the **real** production workflows (`issue-triage`, `build`, …)
— their actual YAML, prompts, and skills, unmodified. The only deviations from
production are the two we can't do unattended:

1. **GitHub is mocked**, not bypassed — the agent's `github_*` calls hit an
   in-process fake and are recorded.
2. **Approval gates are disabled** so runs never pause.

If a change makes the eval diverge from prod in any *other* way, it's wrong —
the whole point is to test what ships.

## How the mock actually works (don't break these)

- **The base-URL seam.** The `github_*` tools are agentic-pi's *built-in*
  extension (not a swappable MCP server). agentic-pi ≥ 0.2.11 exposes
  `githubApiBaseUrl`; Last Light threads it `ExecutorConfig.githubApiBaseUrl →
  agenticRun`. `run-instance.ts` sets it to the fake server's URL. This is the
  whole mechanism — our `mechanism.test.ts` guards the consumer side; core has
  its own slim guard (`src/engine/agent-executor.seam.test.ts`) proving it still
  forwards the URL.
- **Static-token mode.** The harness sets `GITHUB_TOKEN` (a dummy) and
  *unsets* `GITHUB_APP_ID`/`GITHUB_APP_INSTALLATION_ID`, so the GitHub
  extension loads but no real installation token is ever minted. The workflow's
  `profile` (issues-write / repo-write, derived from the workflow name) still
  decides which tools exist.
- **Seeding without a clone.** `runWorkflow` only clones from GitHub when
  `ctx.prePopulateBranch` is set. The eval **never sets it**, so no clone
  happens and the agent's cwd is the workspace root `<stateDir>/sandboxes/
  <taskId>` — exactly the dir `seed.ts` pre-populates (fixture @ base_commit +
  a local bare `origin`, so `git push` works offline). If you ever set
  `prePopulateBranch`, the runner will try to clone real GitHub.
- **Gates need a DB.** A phase only pauses when `db && workflowId && the gate is
  enabled`. The eval passes **no `db`** and an **empty `approvalConfig`**, so
  every gate is a no-op. Don't add a db just for metrics (see below).

## Metrics gotcha

Token/cost come from the session jsonl the executor's shim writes — and the
*final* result envelope is flushed **fire-and-forget** (`void shim.flush()` in
`agent-executor.ts`). So it can land after `runWorkflow` resolves.
`run-instance.ts` calls `drainSessions()` (wait for the jsonl tree to go quiet)
before `collectMetrics()` and before deleting the temp workspace. Remove the
drain and cost silently reads 0.

## Test vs script (keep the split)

- `src/mechanism.test.ts` — a **real test** in the default `npm test` suite:
  deterministic, AI-free (fake GitHub + the base-URL seam + seed/grade
  red→green). It *should* fail the build if the mock plumbing breaks.
- `src/run.ts` — a **script** (`lastlight-evals run`), a measurement. It exits
  non-zero only on harness error, never because a model scored badly.
- `datasets/**/*.test.ts` are **fixtures** (held-out tests run inside a seeded
  workspace), NOT harness tests — excluded from `vitest.config.ts` (and outside
  `tsconfig`'s `src` rootDir). Keep them excluded or the default suite tries to
  run raw fixture tests.

## Grading = two deterministic signals

- **Execution** (`gradeExecution`): copy the held-out tests in, run them, require
  every `FAIL_TO_PASS` green and every `PASS_TO_PASS` still green — SWE-bench's
  resolved criterion. Held-out tests live in `datasets/<tier>/tests/<id>/`, kept
  out of the seeded repo so the agent can't edit them.
- **Behavioral** (`gradeBehavioral` / `gradeTriage`): assert the recorded
  GitHub mutations (labels, comments, PRs) against the instance's
  `expect_github` / `triage_gold`. Primary signal for triage.

No LLM-as-judge — by design.

## Models

The model list lives in `models.json` (`default` + a `compare` set); `env.ts`
reads it. Each `compare` entry is key-gated by its `envKey`, so
`npm run eval:compare` only runs models whose provider key is present — adding
an entry with no key is a silent no-op, not an error. `id` must be a spec
pi-ai's registry resolves (`provider/model`); Fireworks ids are the long
`fireworks/accounts/fireworks/models/<x>` form. Provider keys are read from
`process.env` by agentic-pi directly (the harness loads `.env`), so a new
provider just needs its key set + a registry id — no harness change.

## Adding a workflow/tier

When pointing the harness at a new real workflow, check:
- `gitAccessProfileForWorkflow` (in core, `lastlight`'s `workflows/runner.ts`)
  maps it to a profile → which `github_*` tools the agent gets. This lives in
  the installed `lastlight` package now, not here.
- `fake-github.ts` implements every REST endpoint that profile's tools call.
  Unimplemented routes return 404 on purpose (loud, not silent) — add the route
  rather than masking it.
- A tier is just a directory with `instances.json` + `tier.json` (its
  `defaultWorkflow`). No `TIERS` map to edit — `discovery.ts` finds it. The
  workflow itself must be resolvable by core's `getWorkflow` (a built-in, or an
  overlay workflow under `<overlay>/workflows/`).

## Parallelism (across provider families)

`run.ts` runs provider families (OpenAI / Anthropic / Fireworks — keyed by each
model's `envKey`) **concurrently**, serial within a family (so one provider's
rate limit is never hammered). Per-run workspaces were always isolated (a fresh
`mkdtemp` stateDir + a private fake-GitHub port each), so the *only* blocker to
in-process concurrency was shared `process.env`. The fix:

- **Hoist the GitHub env once per batch.** `applyEvalEnv()` installs the
  static-token env (`GITHUB_TOKEN=eval-fake-token`, App vars unset) ONCE around
  the whole run; every `runInstance` is called with `manageEnv: false` so it
  doesn't splice/restore env itself. Every eval run wants the *same* values, so
  a single stable baseline is race-free where per-run splicing would not be.
- **No `process.chdir`.** The `sandbox:"none"` executor threads a per-run `cwd`
  to agentic-pi + child processes; it never changes the process-wide cwd. (If
  that ever changes, in-process concurrency breaks.)
- **`console` is silenced once** for the parallel batch — the per-run `quiet()`
  swap is not concurrency-safe (nested save/restore), so parallel mode drops
  `console.*` for the batch instead. The clack spinner is unaffected (it writes
  via `process.stdout.write`).
- **Live HTML writes don't race** despite concurrency: `summarize`/`writeHtml`
  run synchronously to completion within one event-loop turn, so concurrent
  family loops never interleave a write (and the temp-file+rename stays atomic).

Force serial with `--serial`; single-family runs (e.g. the default single
model) are serial anyway and keep the per-run spinner + captured logs.

## Known sharp edges

- The agent can pick the **wrong owner/repo** for GitHub calls on tiny synthetic
  fixtures (it has no real remote to infer from). That's a model/fixture-tuning
  matter, not a harness bug — surfaces as `behavioral✗` (no PR). Stronger models
  fare better; this is the kind of thing the eval is meant to reveal.
