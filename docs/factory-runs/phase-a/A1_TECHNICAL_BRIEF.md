# TECHNICAL_BRIEF.md — Phase A, PR A-1 "Gates tell the truth"

> Feature Factory run, by-hand mode. Agent 03 (Spec Writer), read-only. 2026-10-04.
> Inputs: `docs/factory-runs/phase-a/USER_STORY.md` (CP1 approved), `docs/factory-runs/phase-a/RESEARCHER_REPORT.md`, plus the source code in `/Users/enriqueibarra/cypher-claude-skills`. Where a document and the code disagree, the code wins.
> Scope: groups F, G, P, V, C, i.e. AC-1..AC-33, AC-58..AC-60, AC-62..AC-64, AC-66..AC-70, plus the **reading** side of AC-65. **Out of scope (PR A-2):** AC-34..AC-57, AC-61, AC-71..AC-79, and the writing side of AC-65.

## 0. Prior specification patterns

No memory tools were available, so this section draws on git history and the Researcher report.
- **Pattern that worked: inject the dependency.** `OrchestrationOptions.invoke` (orch:185-190) is why the orchestrator is testable offline. The gate seam (AC-1) and the CLI entry point (AC-63) use the same shape.
- **Pattern that worked: source-scanning guard tests** (`no-cwd-in-gates.test.ts`). AC-2/3/4/13/15/26/27/58/69 and the drift test use the same style.
- **Pattern that worked: tests that tie two code sites together.** `output-schemas.test.ts` scrapes the stage-gate source so the gates and the agents cannot disagree. This brief extends it rather than adding a parallel test.
- **Recurring mistake to avoid:** a gate judging evidence that never reaches it (A1), and a default value that silently passes (`0 < 0`, `|| 0`). Every new criterion here fails closed when its input is missing.

## 1. Overview

This repo is a TypeScript library plus a CLI. It has **no HTTP API, no database and no UI**. "Data model" here means the `FeatureState` / `state.json` shape. "API" means the exported TypeScript surface and the CLI.

**Builder ownership:**
- **The Backend Builder (04) implements everything in this brief.**
- **The Frontend Builder (05) is not needed.** No file in FILE_LIST matches the orchestrator's frontend heuristic (`.tsx/.jsx/.vue/.svelte`, or a path segment `components|pages|app|views|screens`), and there are no UI components. The orchestrator itself would skip it.

A-1 makes five things true:
1. Gates 1.5 and 2 fail closed and measure correctly.
2. The Stage 4 gate judges real evidence: Test Verifier and Validator outputs, the Gate 2 measurement, a regression reference, and tri-state security checks.
3. Every agent gets absolute paths to the upstream artifacts that exist, and a rule never to read `.factory/_archive/`.
4. A bounded loop-back: a Validator CRITICAL issue goes back to the builder that owns the file.
5. SKILL.md is checked against the code by a test.

## 2. Design decisions (with rationale)

### D-1 Gate-injection seam (AC-1)
In `feature-factory-orchestrator.ts`:
```ts
export interface OrchestrationGates {
  auditInfrastructure: (projectRoot: string) => Promise<InfrastructureAudit>;
  auditExecution: (projectRoot: string) => Promise<ExecutionAudit>;
}
export const DEFAULT_GATES: Readonly<OrchestrationGates> = { auditInfrastructure, auditExecution };
// OrchestrationOptions:
gates?: Partial<OrchestrationGates>;
```
- The orchestrator resolves `const gates = { ...DEFAULT_GATES, ...options.gates }` and calls only `gates.auditInfrastructure(cwd)` / `gates.auditExecution(cwd)`.
- Only the *audits* are injected. `validateInfrastructureGate` / `validateExecutionGate` stay real, so tests exercise the real decision logic against audit fixtures.
- **Why not `jest.mock`:** no test uses it today, and injection mirrors the `invoke` rationale at orch:185-190.

### D-2 CLI entry point (AC-63)
`cli.ts` gains:
```ts
export interface CliDependencies {
  createInvoker: (config: SdkInvokerConfig) => AgentInvoker;
  approver: (checkpoint: CheckpointRequest) => Promise<boolean>; // asked only when isTTY() && !--yes
  isTTY: () => boolean;
  exit: (code: number) => void;
  log: (message: string) => void;
  error: (message: string) => void;
  gates?: Partial<OrchestrationGates>;                            // pass-through to runFeatureFactory
}
export function realCliDependencies(): CliDependencies;          // createSdkInvoker, readline askHuman, process.stdin.isTTY, process.exit, console
export async function runCli(argv: string[], deps: CliDependencies): Promise<number>; // always calls deps.exit(code) once, then returns code
```
- `main()` is replaced by `runCli`. The bottom of the file becomes `if (require.main === module) { void runCli(process.argv.slice(2), realCliDependencies()); }`.
- Approval wiring:
  - `--yes` → always approve.
  - `isTTY()` → `deps.approver`.
  - Otherwise → log the "no TTY" message and return `false`. This is the current fail-closed behaviour; AC-77's pause is A-2.
- Thrown errors → `deps.error(msg)`, then `deps.exit(1)`.
- The CLI stays thin: parse, wire, print. `parseArgs` is unchanged in A-1 (`--feature` is still required; AC-37 is A-2).

### D-3 Execution gate rewrite: stdout+stderr parsing, Node-based timeout (AC-8..15, AC-64)
- **One process primitive:** `runShellCommand(command, cwd, timeoutMs)` uses `child_process.spawn(command, { cwd, shell: true, detached: true, stdio: ['ignore','pipe','pipe'] })`.
  - It collects stdout and stderr separately.
  - On timeout it kills the **process group** (`process.kill(-pid, 'SIGTERM')`, then `SIGKILL` after 2 s).
  - **Why not `spawnSync({timeout})`:** it kills only the shell and then blocks until the npm→node grandchild closes the pipes, which is the hang GNU `timeout` was papering over.
  - No `execSync`, no `timeout` binary, no `Promise.all`.
- **Checks run sequentially:** `await build; await test; await dev`.
- **Script presence** comes from `package.json` scripts in `projectRoot`:
  - missing `build` or `dev` → result `SKIPPED` plus a WARNING in `audit.warnings` (AC-11/12);
  - missing `test` → `FAILED` ("no test script").
- **Parsing uses the combined text.** `parseTestOutput(stripAnsi(stdout + '\n' + stderr))`, on success and on failure (fixes execution-gates:63-83, where stderr is dropped on success).
  - Not `--json`: the `test` script is project-defined and may not be Jest. Appending `-- --json` would break other runners and change the output the human sees.
  - Order-independent extraction from Jest's `Tests:` line (`(\d+) failed`, `(\d+) passed`, `(\d+) skipped`, `(\d+) todo`, `(\d+) total`).
  - Vitest's `Tests  … (N)` line and Mocha's `N passing / N failing / N pending` are also supported.
  - Returns **`null`** when nothing is detected or total is 0. There is no fallback token counting (the "Fallback" block at :246-255 is deleted).
- **Pass rule:** `passRate = passed / (passed + failed)` (skipped is reported, not counted; see I-10). A test check `PASSED` requires all of:
  - `exitCode === 0` and not timed out;
  - `stats !== null` and `stats.total > 0`;
  - `stats.failed === 0` and `stats.passed > 0`.
- `validateExecutionGate` blockers:
  - `null` stats → exactly `"no tests detected …"` (AC-9);
  - non-zero exit, timeout, `failed > 0`;
  - build `FAILED` (AC-64);
  - dev `FAILED` (AC-14).
  `SKIPPED` checks produce `warnings`, not blockers.
- **Failed test names:** `parseFailedTestNames(output)` collects Jest `● <name>` headers (excluding `● Console`) and `✕ <name>` lines, deduplicated. These populate `audit.failedTests` (AC-10; fixes :393).
- **Dev server:** `verifyDevServer` runs `npm run dev` for `devTimeoutMs` (default 15 000, overridable via `ExecutionGateOptions`).
  - Exits non-zero before the timeout, or output matches `DEV_SERVER_ERROR_PATTERN` → `FAILED`, CRITICAL (AC-14).
  - Still running at the timeout and clean → killed, `PASSED`.
  - `DEV_SERVER_ERROR_PATTERN` is exported. It replaces `/error|failed|cannot|undefined/i` (which matches "0 errors") with `/\b[A-Za-z]*Error:|npm ERR!|npm error|EADDRINUSE|Failed to compile|Cannot find module/`.

### D-4 IMPORTANT findings (AC-17)
- `StageContract.acceptance.requireAll` is **removed** (stage-gates:32, :318-320).
- `canAdvance = allCriticalPass && missingArtifacts.length === 0 && noValidatorThrew`. A criterion whose validator *throws* blocks whatever its severity (fail closed).
- `StageAdvancementDecision` gains:
  - `importantFindings: string[]`: failed IMPORTANT criteria, formatted `"[Stage N] <criterion>: <details>"`;
  - `missingArtifacts: string[]`.
- IMPORTANT failures no longer go into `blockers`.
- **How findings reach state:** the orchestrator calls the pure `recordImportantFindings(state, stage, source, messages)` after every stage-gate evaluation, from three sources:
  - stage gates: source `'stage-gate'`;
  - Gate 1.5 and Gate 2 warnings: `'gate-1.5'` / `'gate-2'`;
  - the Validator's IMPORTANT issues: `'07-validator'`.
- The list persists in `state.importantFindings`. A-2's CP3 (AC-44) reads it.

### D-5 Stage 4 metadata: where each value comes from (AC-18, 21, 22, 62, 67, 68)
`buildStageContext` gets `artifactDir?` and `harness?: HarnessMeasurements`.

**Agent-side (derived in stage-context from `outputs`):**
- `acceptanceCriteriaTotalCount`, `acceptanceCriteriaTestedCount`, `acceptanceCriteriaNotCoverableCount` come from `outputs.test`.
- `storyAcceptanceCriteriaCount` comes from `outputs.story.details.acceptanceCriteria.length`.
- `criticalIssuesCount` comes from `outputs.validator`.
- `securityIssuesCount` and `securityBlockers` come from `evaluateSecurityChecks(outputs.validator.details.security, outputs.spec?.details.securitySurface)`.
- `details.regressions` is **no longer read** (stage-context:319 deleted).

**Harness-side (passed by the orchestrator, never by an agent):**
- `executionMeasurement` is the latest Gate 2 `{total, passed, failed, passRate}`.
- `regressionReferenceCount` is undefined when there is no reference.

**Artifacts:**
- `readArtifactContents` also reads top-level regular files in `<cwd>/<artifactDir>/`, keyed by basename, filling keys not already set. That is how the harness-rendered `TEST_REPORT.md` reaches `ctx.artifacts`.
- `canAdvanceStage` now checks every `contract.artifacts.required` name against `ctx.artifacts` (AC-21).

**Typing:** `export interface Stage4Metadata` in `stage-gates.ts` names these keys. The AC-62 test builds its metadata as `const metadata: Stage4Metadata = …`, so a wrong key is a compile error. That is the long-term guard against the `acTestedCount` mistake (stage-gates.test:228).

**Criteria:**
- `validateAcceptanceTestsComplete` fails when:
  - `total === 0`; or
  - `storyCount` is undefined or `total !== storyCount`; or
  - `tested + notCoverable < total` (AC-18).
- `validateNoRegressions` fails when:
  - `executionMeasurement` is missing; or
  - `passRate < 1`; or
  - a reference is defined and `total < reference`.
  With no reference, only the 100% rule applies (AC-22, AC-66).
- `validateSecurityPassed` fails when `securityIssuesCount > 0`, with `securityBlockers` as its blockers.

**Contract artifact lists:**
- Stage 3 `artifacts.required` becomes `[]`; optional becomes `['BACKEND_SUMMARY.md','API_CONTRACT.md','FRONTEND_SUMMARY.md','LOOP_LOG.json']` (see I-4).
- Stage 4 required stays `['TEST_REPORT.md','VALIDATION_REPORT.md']`.

### D-6 Tri-state security and the brief's "no such surface" declaration (AC-67/68)
In `agent-output-schema.ts`:
```ts
export const SECURITY_CHECKS = ['authImplemented','inputValidated','noHardcodedSecrets','sqlInjectionProtected','xssProtected'] as const;
export type SecurityCheckName = typeof SECURITY_CHECKS[number];
export type SecurityCheckValue = boolean | 'not_applicable';
export type SecuritySurfaceName = 'auth' | 'userInput' | 'secrets' | 'sqlDatabase' | 'htmlRendering';
export const SECURITY_CHECK_SURFACE: Readonly<Record<SecurityCheckName, SecuritySurfaceName>> = {
  authImplemented: 'auth', inputValidated: 'userInput', noHardcodedSecrets: 'secrets',
  sqlInjectionProtected: 'sqlDatabase', xssProtected: 'htmlRendering'
};
export type SecuritySurfaceDeclaration = Record<SecuritySurfaceName, 'PRESENT' | 'ABSENT'> & { notes?: string };
// SpecWriterOutput.details:
securitySurface?: SecuritySurfaceDeclaration;            // optional in TS + validateOutputSchema (absent ⇒ every surface PRESENT ⇒ fail-closed); REQUIRED in the SDK schema
// ValidatorOutput.details.security:
security: Record<SecurityCheckName, SecurityCheckValue> & {
  notApplicableReasons?: Partial<Record<SecurityCheckName, string>>;
  issues?: string[];
};
export type ValidatorIssue = ValidatorOutput['details']['issues'][number];
```
`harness/security-checks.ts` defines `evaluateSecurityChecks(security, surface): SecurityEvaluation`:
- `false` → blocking.
- `true` → ok.
- `'not_applicable'` → ok only if **both** hold:
  - `notApplicableReasons[check]?.trim()` is non-empty; and
  - `surface?.[SECURITY_CHECK_SURFACE[check]] === 'ABSENT'`.
  Otherwise it blocks with a message naming which condition failed.
- Any other value (undefined, string) → blocking (fail closed).
- Each `security.issues[]` entry → blocking.

SDK schema (`output-schemas.ts`):
- Each Validator check becomes `{ anyOf: [{type:'boolean'},{type:'string',enum:['not_applicable']}] }`.
- `notApplicableReasons` is an optional object of strings.
- The Spec Writer gets a required `securitySurface` object with five `PRESENT|ABSENT` enums.
- The Spec Writer contract asks for a matching "Security surface" section in TECHNICAL_BRIEF.md. The **structured field is authoritative.**

### D-7 Harness-rendered documents (AC-21, AC-25)
New module `harness/harness-documents.ts`:
```ts
export const HARNESS_RENDERED_ARTIFACTS = ['BACKEND_SUMMARY.md','API_CONTRACT.md','FRONTEND_SUMMARY.md','TEST_REPORT.md'] as const;
export type HarnessRenderedArtifact = typeof HARNESS_RENDERED_ARTIFACTS[number];
export function harnessGeneratedLabel(agent: string): string; // first line of every doc: "> **Harness-generated** from <agent>'s structured output. Not written by the agent; not a claimed file."
export function renderBackendSummary(o: BackendBuilderOutput): string;   // files, services, tests, patterns
export function renderApiContract(o: BackendBuilderOutput): string;      // implementation.routes (+ services) table
export function renderFrontendSummary(o: FrontendBuilderOutput): string;
export function renderTestReport(o: TestVerifierOutput): string;         // AC counts, per-AC results, execution counts, issues
export function writeHarnessDocument(cwd: string, artifactDir: string, name: HarnessRenderedArtifact, content: string): string; // returns absolute path; throws on a name outside the list
```
When the orchestrator writes each document:
- after the Backend Builder passes (and after each validator-round re-invocation): BACKEND_SUMMARY and API_CONTRACT;
- after the Frontend Builder passes: FRONTEND_SUMMARY;
- after the Test Verifier passes the AC-19 checks: TEST_REPORT.

Placement and separation:
- These files go only into `artifactDir`.
- They never enter `filesModified` or the materialization `claimedFiles`.
- Claimed files are computed by one exported `claimedFilesFromBuilders(backend, frontend)` in stage-context.ts, used by both the orchestrator and `buildStageContext`. This removes the duplicate at orch:785-792 versus stage-context:271-277.

Validator report:
- `VALIDATION_REPORT.md` is the Validator's own document. `REQUIRED_ARTIFACTS['07-validator'] = ['VALIDATION_REPORT.md']`, and the Validator is already in `HARNESS_PERSISTED_AGENTS`.
- The orchestrator calls `persist({ validator })` right after schema validation.

Root-write fix:
- `checkStageGate` **no longer calls `persistArtifacts`** (orch:1150). That call, with no `artifactDir`, is what would have written Validator and Consolidator documents into the project root.
- Every agent's documents are persisted once, immediately after it returns.
- The Consolidator also gets `persist({consolidator})` into the run directory plus `outputs.consolidator = …`. This is a supporting fix; the Stage 5 gate is still only logged in A-1.

### D-8 Shared prompt helpers (AC-24, AC-28)
`harness/upstream-artifacts.ts`:
```ts
export const UPSTREAM_ARTIFACTS = ['RESEARCHER_REPORT.md','USER_STORY.md','TECHNICAL_BRIEF.md','FILE_LIST.md',
  'BACKEND_SUMMARY.md','API_CONTRACT.md','FRONTEND_SUMMARY.md','TEST_REPORT.md','VALIDATION_REPORT.md'] as const;
export type UpstreamArtifact = typeof UPSTREAM_ARTIFACTS[number];
export const UPSTREAM_FOR_AGENT: Readonly<Record<FeatureFactoryAgent, readonly UpstreamArtifact[]>>;
// 01: []; 02: [RR]; 03: [RR, US]; 04: [RR, US, TB, FL]; 05: 04 + [BS, AC]; 06: 05 + [FS]; 07: 06 + [TR]; 08: 07 + [VR]
export function existingUpstreamArtifacts(cwd: string, artifactDir: string, names: readonly UpstreamArtifact[]): Array<{ name: UpstreamArtifact; absolutePath: string }>; // existsSync-filtered, resolve(cwd, artifactDir, name)
export const ARCHIVE_RULE: string; // "Do not read anything under .factory/_archive/ — it holds finished runs and is not part of this run."
export function runDirectoryRules(cwd: string, artifactDir: string): string; // ARCHIVE_RULE + "this run's directory is <abs>; other .factory/ dirs belong to unrelated runs — ignore them"
```
`harness/agent-prompts.ts` holds every prompt builder: `researcherPrompt`, `storyPrompt`, `specPrompt`, `builderPrompt`, `testVerifierPrompt`, `validatorPrompt`, `consolidatorPrompt`, plus `retryBriefing` / `BuilderFailure`, moved from orch:88-146.
- Every prompt for 01..08 includes `runDirectoryRules(...)` and the *existing* upstream absolute paths for that agent. A prompt never names an artifact that is not on disk (AC-24).
- The Test Verifier prompt says the harness renders `TEST_REPORT.md`, so the agent must not write one.
- **Kept extensible for A-2:** `runDirectoryRules` takes an options bag `{ readableRunDir?: string }`, unused in A-1. That is where the `--consolidate` exception (AC-28/47) slots in.

### D-9 Validator CRITICAL loop-back (AC-29..33, AC-69, AC-70)
`harness/loop-rules.ts`, re-exported from the orchestrator:
```ts
export const MAX_BUILDER_ATTEMPTS = 3;
export const MAX_VALIDATOR_ROUNDS = 2;
export type LoopBackSituation = 'BUILDER_TESTS_FAIL' | 'BUILDER_SCHEMA_INVALID' | 'GATE_2_FAILS' | 'TEST_VERIFIER_FAILS'
  | 'VALIDATOR_CRITICAL_ROUTABLE' | 'VALIDATOR_CRITICAL_UNROUTABLE' | 'VALIDATOR_ESCALATES';
export interface LoopBackRule { situation: LoopBackSituation; action: 'RETRY_SAME_BUILDER' | 'RETRY_OWNING_BUILDER' | 'ESCALATE'; bound?: number; }
export const LOOP_BACK_RULES: readonly LoopBackRule[] = [
  { situation: 'BUILDER_TESTS_FAIL', action: 'RETRY_SAME_BUILDER', bound: MAX_BUILDER_ATTEMPTS },
  { situation: 'BUILDER_SCHEMA_INVALID', action: 'RETRY_SAME_BUILDER', bound: MAX_BUILDER_ATTEMPTS },
  { situation: 'GATE_2_FAILS', action: 'ESCALATE' },
  { situation: 'TEST_VERIFIER_FAILS', action: 'ESCALATE' },
  { situation: 'VALIDATOR_CRITICAL_ROUTABLE', action: 'RETRY_OWNING_BUILDER', bound: MAX_VALIDATOR_ROUNDS },
  { situation: 'VALIDATOR_CRITICAL_UNROUTABLE', action: 'ESCALATE' },
  { situation: 'VALIDATOR_ESCALATES', action: 'ESCALATE' }
];
```
`harness/frontend-files.ts`:
- `isFrontendPath(path)` holds the regexes moved from orch:672-675. It is the **only** copy.
- `specRequiresFrontend(spec)` replaces orch:670-676.

`harness/validator-routing.ts`:
```ts
export interface IssueOwners { backend: string[]; frontend: string[]; }
export type UnroutableReason = 'NO_FILE' | 'CANNOT_FIX' | 'NOT_OWNED';
export interface ValidatorRouting { backend: ValidatorIssue[]; frontend: ValidatorIssue[]; unroutable: Array<{ issue: ValidatorIssue; reason: UnroutableReason }>; }
export function criticalIssues(issues: ValidatorIssue[] | undefined): ValidatorIssue[];
export function routeCriticalIssues(issues: ValidatorIssue[], owners: IssueOwners, cwd: string): ValidatorRouting;
export function mergeBuilderOutput<T extends BackendBuilderOutput | FrontendBuilderOutput>(previous: T, next: T): T; // next wins; filesModified = union by normalised path (next's entry wins)
```
Routing rules:
- No `file` → `NO_FILE`.
- `canFix === false` → `CANNOT_FIX`.
- The file is normalised with exported `normalisePath(path, cwd)`: an absolute path under `cwd` becomes relative; leading `./` and `/` are stripped. Then:
  - only backend owns it → backend;
  - only frontend owns it → frontend;
  - both own it → `isFrontendPath(file) ? frontend : backend` (AC-69);
  - neither → `NOT_OWNED`.

Orchestrator Stage 4 sequence after the Test Verifier, with `round = 0`:
1. Gate 2. Record `executionGateHistory`. Blocking result or throw → escalate (AC-6/7).
2. Invoke the Validator.
   - Schema invalid → `SCHEMA_VALIDATION`.
   - Otherwise persist `VALIDATION_REPORT.md` and set `outputs.validator`.
3. Status `ESCALATE` → record the step `ESCALATED`, then escalate `CRITICAL_ISSUE` (AC-20).
4. `crit = criticalIssues(...)`:
   - `crit.length === 0 && status === 'PASS'` → record PASS and exit the loop;
   - `crit.length === 0` (status FAIL/LOOP_BACK) → record FAIL and escalate (I-6);
   - otherwise record the step FAIL and continue.
5. If `round === MAX_VALIDATOR_ROUNDS` → escalate "CRITICAL issues remain after 2 rounds" (AC-32).
6. `routing = routeCriticalIssues(crit, owners)`. If `unroutable.length > 0` → escalate immediately with every issue listed in `context.issues`. No builder runs (AC-31).
7. `round++`, then `recordValidatorRound`.
8. For backend, then frontend, whichever has issues: `runBuilderLoop(half, { validatorRound: { round, issues } })`.
   - The loop runs up to `MAX_BUILDER_ATTEMPTS` attempts **in this round**.
   - Attempts are counted in `builderAttempts[agent].validatorRounds[round]` and never in `.stage3` (AC-70).
   - Exhausted → escalate `MAX_LOOPS` at stage 4.
9. `outputs.backend/frontend = mergeBuilderOutput(prev, next)`, then re-render BACKEND_SUMMARY / API_CONTRACT / FRONTEND_SUMMARY.
10. Gate 1 (materialization over the merged claimed files), then the Stage 3 stage gate on the merged outputs (I-8), then Gate 1.5. Any failure → escalate.
11. Back to step 1.

Throughout:
- `state.currentStage` stays 4. The old `advanceToStage(state, 3)` at orch:1016 is deleted (AC-33).
- Escalations in this loop use stage 4.
- Builder step records keep stage 3 and carry `{ phase: 'validator-round', round }`.

`BuilderFailure` gains `{ kind: 'validator'; round: number; maxRounds: number; issues: ValidatorIssue[] }`. `builderPrompt` always includes the validator briefing during a round, from attempt 1:
- header "Validator round r of 2";
- each issue as `[file:line] message — suggestion`.

On attempts 2–3 of a round it adds the usual test/schema briefing. The Stage 3 attempt header ("attempt N of 3") is unchanged, so existing retry-briefing tests stay green.

### D-10 Drift test (AC-59, AC-60)
- The orchestrator exports `CHECKPOINTS` (D-11) and re-exports `LOOP_BACK_RULES`.
- SKILL.md carries this machine-readable block:
  ````
  <!-- factory-claims -->
  ```json
  { "agents": ["01-researcher", …, "08-feature-consolidator"], "checkpoints": [1, 2], "loopBackRules": [ …identical to LOOP_BACK_RULES… ] }
  ```
  ````
- `factory/test/contracts/doc-drift.test.ts` asserts:
  - the agents list equals `Object.keys(AGENT_STAGE)`;
  - checkpoint ids equal `Object.values(CHECKPOINTS).map(c => c.id)`, **and** the set of every `/CHECKPOINT (\d+)/g` in SKILL.md prose equals the same set;
  - `loopBackRules` deep-equals `LOOP_BACK_RULES`;
  - plus the other AC-59/60 items (§6).
- In A-1 SKILL.md therefore mentions **no `CHECKPOINT 3`**. A-2 adds CP3 to both sides at once.

### D-11 Checkpoint shape, kept extensible for A-2
```ts
export interface CheckpointDefinition { readonly id: number; readonly name: string; readonly stage: 1 | 2 | 3 | 4 | 5; }
export const CHECKPOINTS = {
  STORY: { id: 1, name: 'CHECKPOINT 1: Approve the story', stage: 2 },
  BRIEF: { id: 2, name: 'CHECKPOINT 2: Approve the technical brief', stage: 2 }
} as const satisfies Record<string, CheckpointDefinition>;
export interface CheckpointRequest { name: string; stage: number; summary: string; }  // A-2 adds artifact text/paths/hash
approveCheckpoint?: (checkpoint: CheckpointRequest) => Promise<boolean>;            // A-2 widens the return type
```
- The internal `checkpoint(def: CheckpointDefinition, summary)` takes a definition. No `checkpoint('CHECKPOINT` string literal remains.
- Names are unchanged, so `checkpoints.test.ts` regexes still match.

### D-12 Regression reference: read side (AC-22, AC-65 reading, AC-66)
`harness/regression-baseline.ts`:
```ts
export const BASELINE_FILENAME = 'baseline.json';
export interface RegressionBaseline { schemaVersion: 1; runId: string; testCount: number; recordedAt: string; }
export class RegressionBaselineError extends Error {}
export function baselineFilePath(cwd: string): string;                                  // <cwd>/.factory/baseline.json
export function readRegressionBaseline(cwd: string): RegressionBaseline | undefined;    // undefined if absent; throws RegressionBaselineError if unreadable/invalid
export function regressionReference(priorEvaluations: readonly ExecutionGateRecord[] | undefined,
                                    baseline: RegressionBaseline | undefined): number | undefined;
// prior non-empty → prior[0].total; else baseline?.testCount; else undefined
```
- The file is a regular file in `.factory/`. `clearStaleArtifacts` removes only directories (stage-context:118-119), so it survives cleanup. A-2's archiving moves directories only.
- **A-2 dependency:** A-2 adds `writeRegressionBaseline` at SUCCESS using this exact type.
- Gate 2 evaluation:
  1. compute `reference = regressionReference(history, round === 0 ? readRegressionBaseline(cwd) : undefined)`;
  2. run the audit;
  3. push `ExecutionGateRecord { round, total, passed, failed, passRate, canAdvance, referenceCount: reference }`;
  4. commit.
- The Stage 4 gate gets the latest record as `executionMeasurement` and its `referenceCount`.
- A corrupt baseline throws, reaching the outer catch → ESCALATED (fail closed).
- `detectRegressions`, `testBaselineBefore` and `testBaselineAfter` (orch:899-908, :1024-1041, :1164-1180) are deleted.

### D-13 Schema validation must not throw (AC-16)
- `validateOutputSchema` returns `{valid:false, errors:['output is not an object']}` for `null` or a non-object.
- When `details` is missing or not an object, it returns immediately after the base checks, with an error that names `details`. It never dereferences `output.details.*` (agent-output-schema:598-606).
- Builder code paths use `candidate.details?.testing` / `candidate.details?.summary`.

### D-14 Test Verifier and Validator verdicts (AC-19, AC-20)
- **Test Verifier:** after the schema check, anything other than `status === 'PASS'`, or `testExecution.failed > 0`, or any `issues[].severity === 'CRITICAL'`:
  - record the step `FAIL` (`ESCALATED` if the status is ESCALATE);
  - escalate `CRITICAL_ISSUE` with the failing ACs and issues in context;
  - do not run Gate 2 or the Validator.
- Only then: `outputs.test = testOutput` and record PASS. This fixes A1 at orch:930.
- **Validator:** see D-9 step 3.

### D-15 Dead code (AC-58)
- Delete from the orchestrator:
  - `getStageNameLowerCase`;
  - the imports `StageContext`, `MaterializationAudit`, `getFixCodeTemplate`, `ResearcherOutput`, `StoryWriterOutput`, `SpecWriterOutput`, `TestVerifierOutput`, `ValidatorOutput`, `FeatureConsolidatorOutput`;
  - `let infrastructureAudit/executionAudit = null`;
  - `backendPassed`.
- **`maxAttempts` is removed** from `AgentInvocation` (invoke-agent.ts:38) and from all eight call sites. Nothing honours it.
- `getFixCodeTemplate` itself stays in error-categories.ts, because error-categories.test uses it.

## 3. Exact type and interface changes

**`harness/stage-gates.ts`**
- `StageContract.acceptance` → `{ criteria: StageCriterion[] }` (`requireAll` removed).
- `StageAdvancementDecision` gains `importantFindings: string[]; missingArtifacts: string[]`.
- New exports:
  - `interface ExecutionMeasurement { total: number; passed: number; failed: number; passRate: number }`
  - `interface Stage4Metadata { acceptanceCriteriaTotalCount?: number; acceptanceCriteriaTestedCount?: number; acceptanceCriteriaNotCoverableCount?: number; storyAcceptanceCriteriaCount?: number; criticalIssuesCount?: number; securityIssuesCount?: number; securityBlockers?: string[]; executionMeasurement?: ExecutionMeasurement; regressionReferenceCount?: number }`
- Stage 3 `artifacts` changed as in D-5.

**`harness/stage-context.ts`**
- `BuildStageContextInput` gains `artifactDir?: string; harness?: { execution?: ExecutionMeasurement; regressionReferenceCount?: number }`.
- `export function normalisePath(path: string, cwd?: string): string` (was the private `normalise`).
- `export function claimedFilesFromBuilders(backend?: BackendBuilderOutput, frontend?: FrontendBuilderOutput): ArtifactRef[]`.
- `readArtifactContents(outputs, cwd, artifactDir?)`.

**`harness/execution-gates.ts`**
- New and changed types:
  - `TestStats`
  - `ExecutionCheckStatus = 'PASSED'|'FAILED'|'SKIPPED'`
  - `ExecutionResult { type; command; status: ExecutionCheckStatus; passed: boolean /* status !== 'FAILED' */; exitCode: number|null; timedOut: boolean; stdout; stderr; duration; failureReason?: string; skipReason?: string; testStats?: TestStats }`
  - `ExecutionAudit` gains `warnings: string[]`
  - `ExecutionGateDecision` gains `warnings: string[]; testStats?: TestStats`
  - `ExecutionGateOptions { testTimeoutMs?; buildTimeoutMs?; devTimeoutMs? }` and `DEFAULT_EXECUTION_TIMEOUTS` (30 min / 15 min / 15 s)
  - `CommandOutcome`
  - `DEV_SERVER_ERROR_PATTERN`
- Function signatures:
  - `runShellCommand(command, cwd, timeoutMs): Promise<CommandOutcome>`
  - `parseTestOutput(output: string): TestStats | null` (now exported)
  - `parseFailedTestNames(output: string): string[]`
  - `runTestSuite(projectRoot, options?)`, `runBuild(projectRoot, options?)`, `verifyDevServer(projectRoot, options?)`
  - `auditExecution(projectRoot: string, options?: ExecutionGateOptions): Promise<ExecutionAudit>` (the positional command parameters are removed; the only caller is the orchestrator)

**`harness/infrastructure-gates.ts`**
- `export function parseJsonc` (for the AC-4 test, so the logic is not duplicated).

**`harness/agent-output-schema.ts`**
- D-6 types and constants; `ValidatorIssue`.
- `validateOutputSchema` behaviour per D-13. The signature is unchanged.

**`harness/state-tracker.ts`**
```ts
export interface ImportantFinding { stage: number; source: string; message: string; recordedAt: string; }
export interface ExecutionGateRecord { round: number; total: number; passed: number; failed: number; passRate: number; canAdvance: boolean; referenceCount?: number; recordedAt: string; }
export type BuilderAgent = '04-backend-builder' | '05-frontend-builder';
export interface BuilderAttemptCounts { stage3: number; validatorRounds: Record<number, number>; }
export type StepPhase = { phase?: 'stage3' | 'validator-round'; round?: number };
// FeatureState gains (optional for old state files; createFeatureState initialises them):
importantFindings?: ImportantFinding[];
executionGateHistory?: ExecutionGateRecord[];
builderAttempts?: Partial<Record<BuilderAgent, BuilderAttemptCounts>>;
validatorRoundsCompleted?: number;
// AgentStepRecord and StageLoopBack gain: phase?: 'stage3' | 'validator-round'; round?: number;
export function recordImportantFindings(state: FeatureState, stage: number, source: string, messages: string[]): FeatureState;
export function recordExecutionGate(state: FeatureState, record: Omit<ExecutionGateRecord, 'recordedAt'>): FeatureState;
export function recordBuilderAttempt(state: FeatureState, agent: BuilderAgent, at: { phase: 'stage3' } | { phase: 'validator-round'; round: number }): FeatureState;
export function recordValidatorRound(state: FeatureState, round: number): FeatureState;
// recordAgentStep(..., output?, error?, phase?: StepPhase); recordLoopBack(..., fixApplied?, phase?: StepPhase)
```
- `recordBuilderAttempt` is called and committed **before** each builder invocation, so the count survives a kill. A-2's AC-36 reads it.

**`runner/invoke-agent.ts`**
- `AgentInvocation` → `{ stage: number; agent: string; prompt: string }`.

**`runner/agent-registry.ts`**
- `REQUIRED_ARTIFACTS['07-validator'] = ['VALIDATION_REPORT.md']`.

**`runner/output-schemas.ts`**
- Validator security tri-state plus `notApplicableReasons`; Spec Writer `securitySurface` (required) — both per D-6.

**`contracts/feature-spec.ts`**
- `acceptFeatureSpec(featureSpec, cwd, artifactDir?: string)`. When given, it persists into `artifactDir` (see I-11). Callers without the argument are unchanged.

**`feature/workflows/feature-factory-orchestrator.ts`**
- New exports: `OrchestrationGates`, `DEFAULT_GATES`, `CheckpointDefinition`, `CHECKPOINTS`, `CheckpointRequest`, and re-exports of `LOOP_BACK_RULES`, `MAX_BUILDER_ATTEMPTS`, `MAX_VALIDATOR_ROUNDS`.
- `OrchestrationOptions` gains `gates?`.
- `runFeatureFactory` keeps its signature.

**`runner/cli.ts`**
- D-2.

## 4. Process flow after A-1

1. **Startup:** `clearStaleArtifacts`, unchanged (A-3 is A-2).
2. **Stages 1–2:** unchanged control flow (the gate split is A-2). Changes:
   - prompts come from `agent-prompts.ts`;
   - the stage gate records important findings;
   - the Stage 2 escalation adds `blockers` (cheap and harmless; AC-57 proper is A-2).
3. **Stage 3:** `runBuilderLoop('backend', {phase:'stage3'})`, then write BACKEND_SUMMARY and API_CONTRACT, then `runBuilderLoop('frontend')` if `specRequiresFrontend`, then FRONTEND_SUMMARY. Then Gate 1 (materialization over `claimedFilesFromBuilders`), then the Stage 3 gate.
4. **Stage 4:**
   - Gate 1.5: throw → `INFRASTRUCTURE_FAILURE`; block → `INFRASTRUCTURE_FAILURE`; warnings → findings.
   - Test Verifier: schema check, then the D-14 verdict, then `TEST_REPORT.md`.
   - The D-9 loop: Gate 2 → Validator → routing.
   - Validator IMPORTANT issues → findings.
   - Stage 4 gate with harness measurements. Failure escalates with `blockers`.
5. **Stage 5:** advance to 5; the Consolidator prompt carries upstream paths; persist to the run directory; Stage 5 gate logged; `finish(SUCCESS)`. Unchanged semantics until A-2.

**Idempotency and retry:**
- Every builder attempt, Gate 2 record, validator round and important-finding batch is `commit()`ed.
- No new background jobs.
- The only new long-running work is the Gate 2 commands, now bounded by Node timeouts.

## 5. Traceability (every in-scope AC)

Abbreviations:
- **OG** = `factory/test/harness/orchestrator-gates.test.ts`
- **VL** = `factory/test/harness/validator-loop-back.test.ts`
- **UA** = `factory/test/harness/upstream-artifacts.test.ts`
- **EG** = `factory/test/harness/execution-gates.test.ts`
- **SG** = `factory/test/harness/stage-gates.test.ts`
- **SC** = `factory/test/harness/security-checks.test.ts`
- **AOS** = `factory/test/harness/agent-output-schema.test.ts`
- **CLI** = `factory/test/runner/cli.test.ts`
- **RH** = `factory/test/contracts/repo-hygiene.test.ts`
- **DD** = `factory/test/contracts/doc-drift.test.ts`

Every test title starts with its AC ID.

| AC | Change(s) | Test file → title |
|---|---|---|
| AC-1 | D-1 seam; DEFAULT_GATES | OG → "AC-1 injected gates are called at Gate 1.5 and Gate 2 and no child process is spawned" (spies on `child_process.spawn/spawnSync/execSync`); RH → "AC-1 DEFAULT_GATES are the real audit functions and the orchestrator calls audits only through the gates object" |
| AC-2 | `factory/test/fixtures/*`; migrate checkpoints/retry-briefing/state-persistence/feature-spec tests | RH → "AC-2 no orchestrator or CLI test defines its own researcher/story/spec/builder fixture" |
| AC-3 | delete `factory/test/orchestrator.test.ts` | RH → "AC-3 orchestrator.test.ts is absent or every test in it calls runFeatureFactory" |
| AC-4 | tsconfig `exclude` gains the 4 root files | RH → "AC-4 tsconfig excludes run-cpf-factory.ts, run-frontend-only.ts, probe-cwd.ts, probe-cwd.mjs" (+ builder's local `npm run typecheck` with files present; I-2) |
| AC-5 | orchestrator Gate 1.5 catch → escalate | OG → "AC-5 a throwing infrastructure gate escalates INFRASTRUCTURE_FAILURE and the Test Verifier is never invoked" |
| AC-6 | Gate 2 catch → escalate | OG → "AC-6 a throwing execution gate escalates EXECUTION_FAILURE and the Validator is never invoked" |
| AC-7 | Gate 2 block → escalate with details, no loop | OG → "AC-7 a blocking execution result escalates with failing details, no Validator, no Test Verifier re-run" |
| AC-8 | D-3 stdout+stderr parse | EG → "AC-8 a green suite whose summary is on stderr only reports 2/2 at 100% and does not block" |
| AC-9 | `parseTestOutput` order-independent; null → "no tests detected" | EG → "AC-9 parses 'Tests: 1 failed, 4 passed, 5 total' as 1/4/5"; EG → "AC-9 output with no counts blocks with 'no tests detected', never 0/0 pass" |
| AC-10 | `parseFailedTestNames`; audit.failedTests | EG → "AC-10 failedTests lists the failing test names from the output" |
| AC-11 | dev SKIPPED + warning | EG → "AC-11 missing dev script is skipped with a WARNING and does not block" |
| AC-12 | build SKIPPED + warning | EG → "AC-12 missing build script is skipped with a WARNING and does not block" |
| AC-13 | `runShellCommand` + process-group kill | EG → "AC-13 a dev script that never exits is stopped within the configured timeout"; RH → "AC-13 execution-gates.ts invokes no shell timeout command" |
| AC-14 | dev non-zero / error pattern → FAILED | EG → "AC-14 a dev script that exits non-zero before the timeout fails CRITICAL and blocks" |
| AC-15 | sequential awaits | RH → "AC-15 execution-gates.ts uses neither Promise.all nor execSync" |
| AC-16 | D-13 | AOS → "AC-16 output with no details returns a schema failure naming details and does not throw"; OG → "AC-16 an invoker output with no details escalates SCHEMA_VALIDATION, not MANUAL" |
| AC-17 | D-4 | SG → "AC-17 an IMPORTANT failure with all CRITICAL passing advances and is returned as an important finding"; SG → "AC-17 recordImportantFindings appends the finding to the run's list" |
| AC-18 | D-5 criterion + story-count cross-check | OG → "AC-18 story with 5 ACs and 3 tested / 0 not coverable fails 'Acceptance Tests Complete'"; SG → "AC-18 totalAC 0 fails"; SG → "AC-18 tested+notCoverable ≥ totalAC equal to the story count passes"; SG → "AC-18 totalAC different from the story count fails" |
| AC-19 | D-14 | OG → it.each "AC-19 Test Verifier %s is not recorded PASS, escalates, Validator never invoked" (status FAIL, status ESCALATE, failed>0, CRITICAL issue) |
| AC-20 | D-9 step 3 | OG → "AC-20 Validator status ESCALATE escalates and is never recorded PASS" |
| AC-21 | D-5 required-artifact check; D-7 TEST_REPORT render, VALIDATION_REPORT persist, checkStageGate no longer persists | OG → "AC-21 TEST_REPORT.md and VALIDATION_REPORT.md exist in the run dir and not in the project root"; SG → "AC-21 a missing required Stage 4 artifact fails canAdvanceStage" |
| AC-22 | D-5 `validateNoRegressions`; D-12 reference | OG → "AC-22 a Gate 2 count below the baseline reference fails No Regressions"; OG → "AC-22 a count at or above the reference with 100% passes"; OG → "AC-22 Validator details.regressions is ignored"; VL → "AC-22 in a validator round the reference is the run's first Gate 2 count" |
| AC-23 | Gate 2 only in Stage 4 loop | OG → "AC-23 the execution gate is first called after the Test Verifier, once per Gate 2 evaluation" |
| AC-24 | D-8 helpers in prompts 05–08 | UA → "AC-24 prompts for 05, 06, 07, 08 name the absolute run-dir path of every existing upstream artifact, and each named path exists at invocation" |
| AC-25 | D-7 renderers + `claimedFilesFromBuilders` | UA → "AC-25 BACKEND_SUMMARY, API_CONTRACT, FRONTEND_SUMMARY are harness-labelled and absent from the materialization audit" |
| AC-26 | fix 6 contracts, README:915, GAP doc :85 | RH → "AC-26 no repo file contains the wrong feature-factory skill path segment" (scope per I-1) |
| AC-27 | strip `mcp__memorykit__` from contracts 01–08 | RH → "AC-27 no agent contract names an mcp__memorykit__ tool" |
| AC-28 | `ARCHIVE_RULE` in every prompt | UA → "AC-28 every agent prompt in a normal run says .factory/_archive/ must not be read" |
| AC-29 | D-9 | VL → "AC-29 a fixable CRITICAL in a backend-owned file re-invokes the Backend Builder with a validator briefing, reruns Gates 1, 1.5, 2, then the Validator" |
| AC-30 | D-9 | VL → "AC-30 a fixable CRITICAL in a frontend-owned file re-invokes the Frontend Builder" |
| AC-31 | D-9 step 6 | VL → it.each "AC-31 a CRITICAL issue with %s escalates immediately and no builder is re-invoked" (no file, canFix false, unowned file) |
| AC-32 | `MAX_VALIDATOR_ROUNDS` | VL → "AC-32 CRITICAL issues remaining after 2 rounds escalate; the Validator runs at most 3 times" |
| AC-33 | delete `advanceToStage(3)` | VL → "AC-33 an escalation during Stage 4 leaves currentStage 4" (covers both the unroutable and the exhausted cases) |
| AC-58 | D-15 | RH → "AC-58 orchestrator contains none of the A11 dead code and maxAttempts is removed" |
| AC-59 | D-10 | DD → "AC-59 agent count equals AGENT_STAGE"; "AC-59 every listed agent file exists and is registered"; "AC-59 CHECKPOINT entries equal CHECKPOINTS"; "AC-59 loop-back rules equal LOOP_BACK_RULES"; "AC-59 no SKILL.md or README text claims 100% certainty"; "AC-59 every skill assignment path maps to a skill in skills/" |
| AC-60 | SKILL.md rewrite | DD → "AC-60 SKILL.md makes none of the retired claims"; DD → "AC-60 SKILL.md states that Gate 2 and Test Verifier failures escalate in Phase A" |
| AC-62 | rewrite stage-gates.test:225-238 with `Stage4Metadata` | SG → "AC-62 Stage 4 passes on real metadata keys"; SG → "AC-62 Stage 4 with empty metadata fails (no vacuous pass)" |
| AC-63 | D-2 | CLI → "AC-63 a full CLI invocation with injected fakes spawns no process and reports the exit code via the injected exit"; CLI → "AC-63 with no TTY and no --yes the approver is not called and exit is 1"; CLI → "AC-63 real main calls runCli with realCliDependencies" ([S] source scan, plus `realCliDependencies().createInvoker === createSdkInvoker`) |
| AC-64 | build non-zero → FAILED | EG → "AC-64 a build script that exits non-zero fails CRITICAL and blocks" |
| AC-65 (read) | D-12 reader | OG → "AC-65 a baseline file in .factory/ survives cleanup and is used as the first Gate 2 reference" |
| AC-66 | `regressionReference` undefined | OG → "AC-66 with no baseline the first Gate 2 evaluation applies only the 100% rule" |
| AC-67 | D-6 | SC → "AC-67 false blocks, true passes, not_applicable with reason and declared-absent surface passes"; OG → "AC-67 brief declaring no auth surface and a Validator auth not_applicable with reason does not block Stage 4" |
| AC-68 | D-6 | SC → it.each "AC-68 not_applicable blocks when %s" (reason missing, reason blank, surface PRESENT, no securitySurface) |
| AC-69 | `isFrontendPath` single copy; routing | VL (unit block) → "AC-69 a file owned by both builders routes to frontend when the heuristic matches, else backend"; VL ([O]) → "AC-69 a shared .tsx file re-invokes the Frontend Builder"; RH → "AC-69 the frontend-file regexes exist only in frontend-files.ts" |
| AC-70 | `builderAttempts` per phase | VL → "AC-70 a builder that used 3 Stage 3 attempts is re-invoked by a validator round without its Stage 3 count changing"; VL → "AC-70 three failed attempts within one round escalate MAX_LOOPS" |

**Supporting test changes (no new AC).** `output-schemas.test.ts` widens both sides:
- "demanded" = literal `ctx.artifacts['…']` lookups ∪ every contract's `artifacts.required`;
- "produced" = `REQUIRED_ARTIFACTS` ∪ `HARNESS_RENDERED_ARTIFACTS`.

## 6. Test plan

**Fixtures (AC-2).** `factory/test/fixtures/` is not matched by jest's `testMatch`; filenames must not end `.test.ts`.
- `agent-outputs.ts`:
  - `researcher()`
  - `story({ acCount = 3 })`: writes matching Given/When/Then prose
  - `spec({ files, ui, securitySurface })`
  - `backend({ files, testsFailed, failingError })`
  - `frontend({ files })`
  - `testVerifier({ totalAC, tested, notCoverable, failed, status, criticalIssue })`
  - `validator({ status, issues, security, notApplicableReasons, regressions })`
  - `consolidator()`
  - `ALL_SURFACES_PRESENT`
- `gates.ts`: `infraAudit({ critical, warnings })`, `executionAudit({ total, passed, failed, buildFailed, warnings })`, `throwingGate(msg)`, `recordingGates(script)` (records the call order).
- `harness-run.ts`: `tempProject()` (mkdtemp + cleanup), `scriptedInvoker(script)` (captures `{agent, prompt}`, lets the script vary per call count, writes the builder's claimed files to disk), and `runToEnd(overrides)` (fills `logger`, `approveCheckpoint: async () => true`, `gates`).

**Existing tests that change:**
- `stage-gates.test.ts:225-238`: rewritten (AC-62).
- `stage-gates.test.ts:211-223`: re-expressed with `executionMeasurement` / `regressionReferenceCount` below the reference; it must still fail.
- New AC-17/18/21 cases. Existing Stage 1 and Stage 3 tests keep passing: Stage 1 provides `RESEARCHER_REPORT.md`, and Stage 3 required is now `[]`.
- `factory/test/orchestrator.test.ts`: **deleted**. Its assertions are on literals the test built itself; real coverage moves to OG/VL/UA.
- `checkpoints.test.ts`, `retry-briefing.test.ts`, `state-persistence.test.ts`, `feature-spec.test.ts`: switch to the fixtures. Assertions are unchanged, except that retry-briefing's `failingBackend` fixture had `filesModified: ['src/a.ts']` (strings); the fixture uses objects.
- `agent-output-schema.test.ts`: AC-16 case added.
- `output-schemas.test.ts`: widened per §5, plus a case asserting the Validator security tri-state schema and the Spec Writer `securitySurface` requirement.

**[G] tests** (EG) use a temp project whose `package.json` scripts call tiny `node <file>.js` scripts written into it, e.g. `console.error('Tests:       2 passed, 2 total')`. Use per-test timeouts of 20 s and `devTimeoutMs: 1500` in the AC-13 test, which asserts elapsed time < 10 s.

**CI note:** `npm test` must stay offline. No test may call the real `auditExecution` through the orchestrator; only EG calls it directly, against temp projects.

## 7. Implementation order (Backend Builder)

Follows Researcher §7, restricted to A-1.

1. **Foundations.**
   1. tsconfig exclude (AC-4).
   2. Fixtures; migrate the 4 test files (AC-2).
   3. Delete orchestrator.test.ts (AC-3).
   4. Gate seam (AC-1).
   5. `runCli` (AC-63).

   *Gate before continuing:* `npm test` and `npm run typecheck` green.
2. **A11 + A9.**
   1. Dead code and `maxAttempts` (AC-58).
   2. Contract path and memory fixes (AC-26, AC-27); README:915; GAP doc :85.
3. **A6 + execution gate.**
   1. `validateOutputSchema` guard (AC-16).
   2. Execution-gate rewrite (AC-8..15, AC-64).
   3. Orchestrator fail-closed catches (AC-5, AC-6, AC-7).

   *Dependency:* step 3.2 lands before any test drives a real Gate 2.
4. **A1.**
   1. IMPORTANT findings (AC-17) with the state-tracker additions.
   2. Required-artifact check, Stage 3 contract change, and removal of `persistArtifacts` from `checkStageGate` (AC-21).
   3. Wire `outputs.test` / `outputs.validator` / `outputs.consolidator`.
   4. Test Verifier and Validator verdicts (AC-19, AC-20).
   5. AC-count cross-check (AC-18).
   6. Security tri-state, schemas and contracts (AC-67, AC-68).
   7. AC-62 test rewrite.
5. **A8.** `regression-baseline.ts`, Gate 2 history, `validateNoRegressions` (AC-22, AC-23, AC-65 read, AC-66). Depends on step 3 and step 4.2.
6. **A7.** `upstream-artifacts.ts`, `agent-prompts.ts`, `harness-documents.ts` (AC-24, AC-25, AC-28). Depends on step 4 for TEST_REPORT and VALIDATION_REPORT.
7. **A5.** `loop-rules.ts`, `frontend-files.ts`, `validator-routing.ts`, the `runBuilderLoop` refactor, the round loop (AC-29..33, AC-69, AC-70). Depends on steps 5 and 6.
8. **A12, last.** SKILL.md rewrite with the claims block, `CHECKPOINTS` export, drift test (AC-59, AC-60).

*Definition of done:* `npm test` and `npm run typecheck` pass, with the 4 untracked root files present locally.

## 8. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Turning Stage 4 on causes false blocks (Researcher §5) | The security tri-state (D-6) and the stderr parsing (D-3) land in the same PR, before the gate binds; the order above enforces it. |
| A detached process group outlives a test or a run | `runShellCommand` always kills the group on timeout and on the error path. EG tests use short timeouts. POSIX only (I-14). |
| SDK structured output may not support `anyOf` | `output-schemas.test` pins the shape. Recommend one live smoke run of the Validator after merge (I-13). The fallback shape is `{type:['boolean','string'], enum:[true,false,'not_applicable']}`. |
| Validator loop-back multiplies cost (no aggregate budget, GAP-3) | Hard bounds: 2 rounds × 3 attempts per builder. Every attempt is recorded in state. |
| Builder writes outside the target during extra rounds (GAP-5) | Out of scope; unchanged exposure per invocation. Noted. |
| Removing `persistArtifacts` from `checkStageGate` leaves a document unpersisted | Each agent's documents are persisted immediately after it returns: researcher, story and spec (existing); validator and consolidator (new). An OG test asserts each document exists in the run dir at Stage 4. |
| Old `state.json` files lack the new fields | All new fields are optional, and readers treat undefined as empty. |

**What changes for people running `npm run factory`:**
1. IMPORTANT criteria no longer block any stage. They are recorded as findings.
2. Gate 1.5 and Gate 2 errors escalate instead of continuing.
3. Gate 2 actually passes green Jest suites; previously it blocked at 0.0%.
   - Missing build/dev scripts are skipped with a warning.
   - Skipped tests no longer lower the pass rate.
   - The dev check needs no GNU `timeout`.
4. The Stage 4 gate is real:
   - AC counts must match the story;
   - security booleans can block (a `"not_applicable"` needs a reason plus a brief declaration);
   - "No Regressions" uses harness counts and `.factory/baseline.json` (nothing writes it until A-2).
5. A Test Verifier FAIL escalates.
6. A Validator CRITICAL issue loops back to the owning builder for up to 2 rounds, or escalates.
7. Schema changes:
   - the Spec Writer must emit `securitySurface`;
   - the Validator must return `VALIDATION_REPORT.md` and use tri-state security values.
8. Prompts change: absolute paths and the archive rule.
9. Consolidator documents land in the run dir, not the project root.
10. Contracts no longer instruct memory calls.
11. The CLI's exit codes are unchanged (0 = SUCCESS, else 1).
12. SUCCESS still does not involve a third checkpoint (I-9).

## 9. Data model / API / Frontend sections (template)

- **Data model:** `state.json` gains the optional fields in §3. New file `.factory/baseline.json` (read-only in A-1). No migrations; no multi-tenant concerns.
- **API:** no HTTP endpoints. The public TypeScript surface is in §3. CLI flags are unchanged in A-1.
- **Frontend:** none. Frontend Builder not needed.

## 10. A-2 dependencies created (deliberately extensible)

- `CheckpointRequest` and the boolean approver: A-2 widens these to PAUSE/REJECT, hashes the presented text, and adds CP3 to `CHECKPOINTS` and SKILL.md together.
- `runDirectoryRules({ readableRunDir })` is the hook for the `--consolidate` exception.
- `RegressionBaseline` / `baselineFilePath`: A-2 adds the writer at SUCCESS.
- `builderAttempts`, `validatorRoundsCompleted`, `executionGateHistory`, `importantFindings`, and step `phase/round` in state: A-2 resume and CP3 read these.
- `runCli(argv, deps)`: A-2 adds its flags here. `parseArgs` stays separate.
- `knowledgeStored: true` (orch:1091) and Stage 5 semantics: left for A-2 (AC-48, AC-76).

## 11. Rules honoured

- No new runtime dependencies; only `child_process`, `fs` and `path` from Node.
- No `process.cwd()` in harness or workflow code; `no-cwd-in-gates.test` covers the new modules.
- Logic lives in harness modules. The orchestrator sequences; the CLI wires.

## 12. Issues for the operator

**I-1 — AC-26 cannot be satisfied as written.** `docs/factory-runs/phase-a/USER_STORY.md:83`, `RESEARCHER_REPORT.md` and this brief all contain the literal segment, and so does `docs/HARNESS_GAP_ANALYSIS.md:85`.
- Recommendation: rewrite the GAP doc line without the literal, and have the scan **exclude `docs/factory-runs/`** (run transcripts quote the bug).
- The test builds its needle by string concatenation, so it does not match itself.

**I-2 — AC-4's "typecheck passes while they are present" cannot be shown in CI.** The four files are untracked, so they are absent in CI. The [S] test proves the exclusion; the builder must run `npm run typecheck` locally with the files present. (`probe-cwd.mjs` is not matched by `include: **/*.ts` anyway; it is excluded as written.)

**I-3 — AC-17 is a global change.** Removing `requireAll` makes IMPORTANT non-blocking in every stage: Stage 1 Risks/Patterns, Stage 3 TODOs/Patterns, Stage 2 File List (still blocked via the required artifact), and all of Stage 5. This answers Researcher OQ-1 ("not intended"). Please confirm.

**I-4 — AC-21 forces a Stage 3 contract change.** The Stage 3 contract requires `BACKEND_BUILDER_SUMMARY.md` and `FRONTEND_BUILDER_SUMMARY.md`, which nothing produces. Enforcing `artifacts.required` would block every Stage 3. I set Stage 3 `required: []` and made the harness-rendered summaries optional. A gate checking documents the harness itself wrote would prove nothing.

**I-5 — TEST_REPORT.md is harness-rendered.** It is generated from the Test Verifier's structured output, not written by the agent; AC-21 does not say who writes it. Please confirm.

**I-6 — I filled two status cases the ACs leave open, failing closed.** AC-20 covers only Validator `ESCALATE`.
- Validator FAIL or LOOP_BACK with **no** CRITICAL issue → escalate.
- Test Verifier `LOOP_BACK` → treated like FAIL (AC-19).

**I-7 — AC-24 prompts name more than the listed artifacts.** They also include `FILE_LIST.md` (and `VALIDATION_REPORT.md` for 08) when those files exist.

**I-8 — AC-29 lists Gates 1, 1.5 and 2.** I also re-run the Stage 3 stage gate on the merged builder outputs each round. Please confirm.

**I-9 — In A-1, SUCCESS still means "Stage 4 gate passed and the consolidator ran".** There is no third checkpoint, and the fabricated `knowledgeStored: true` stays until A-2. SKILL.md says this plainly and does not mention a CHECKPOINT 3.

**I-10 — Pass rate is now `passed/(passed+failed)`.** Skipped and todo tests are reported but no longer count against 100%. Please confirm.

**I-11 — Pre-supplied spec documents now go to the run directory.** `acceptFeatureSpec` gains an optional `artifactDir`, so the orchestrator's pre-supplied path persists into the run dir. Without it, AC-24 prompts would point at nothing. This overlaps AC-55 (A-2) in part; the CP1/CP2 behaviour for that path is untouched.

**I-12 — Removing memory instructions affects in-session subagents too.** Once you symlink `~/.claude/agents` to these contracts (OQ-7), in-session subagents also lose their memory instructions. This is consistent with C-8 and should be a conscious choice.

**I-13 — `anyOf` support in the Agent SDK's `outputFormat` is unverified.** One live smoke run is recommended after merge.

**I-14 — The dev-server process-group kill is POSIX-only.** Windows is not supported; the repo targets macOS and Linux.


## 13. Operator resolutions (Checkpoint 2, 2026-10-04) — BINDING

The operator approved Checkpoint 2 and accepted every recommendation below. Where this section and §1–§12 differ, **this section wins**.

| Issue | Resolution |
|---|---|
| I-1 | Accepted. The AC-26 scan excludes `docs/factory-runs/` (run records quote the bug); `docs/HARNESS_GAP_ANALYSIS.md:85` is reworded without the literal segment; the test builds its needle by concatenation. |
| I-2 | Accepted. CI proves the exclusion ([S]); the builder runs `npm run typecheck` locally with the four root files present and reports the result. |
| I-3 | Accepted. Only CRITICAL criteria block, in every stage (`requireAll` removed). |
| I-4 | Accepted. Stage 3 `artifacts.required = []`; harness-rendered summaries are optional. |
| I-5 | Accepted. `TEST_REPORT.md` is rendered by the harness from the Test Verifier's structured output; the agent does not write it. |
| I-6 | Accepted. Validator FAIL/LOOP_BACK with no CRITICAL issue → escalate; Test Verifier LOOP_BACK → treated as FAIL. |
| I-7 | Accepted. Prompts also name `FILE_LIST.md` and (for 08) `VALIDATION_REPORT.md` when they exist. |
| I-8 | Accepted. Each validator round re-runs the Stage 3 stage gate on the merged builder outputs. |
| I-9 | Accepted. In A-1, SUCCESS = Stage 4 gate passed + consolidator ran; no CP3; SKILL.md says so and does not mention CHECKPOINT 3. |
| I-10 | **Accepted with a change:** pass rate = `passed / (passed + failed)`, **and whenever skipped or todo tests are > 0, Gate 2 adds a warning that the orchestrator records as an IMPORTANT finding** (source `'gate-2'`, message naming the skipped/todo counts). Add an EG test: "I-10 skipped tests are reported as a warning, not counted against 100%" and an OG assertion that the warning lands in `state.importantFindings`. |
| I-11 | Accepted. `acceptFeatureSpec(…, artifactDir?)` persists into the run directory. |
| I-12 | Accepted. Memory is handled by the operator's session, not by agents. |
| I-13 | Accepted. One live Validator smoke run after merge; fallback schema shape as specified in §8. |
| I-14 | Accepted. POSIX-only process-group kill; Windows is not a target. |

Builder rules for this run: work only inside `/Users/enriqueibarra/cypher-claude-skills` on branch `feat/phase-a1-gates`; do **not** commit, push, or touch `~/.claude/**`, `docs/factory-runs/**` (except reading), or the four untracked root scripts.

─────────────────────────────────────────────────────────────────
✅ CHECKPOINT 2 — BRIEF REVIEW — APPROVED (operator, 2026-10-04)
─────────────────────────────────────────────────────────────────
