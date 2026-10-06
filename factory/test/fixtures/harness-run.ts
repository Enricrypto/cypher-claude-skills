/**
 * Harness-run fixtures (AC-2): a temp project, a scripted invoker, and a run-to-the-end helper.
 *
 * The invoker is the seam the orchestrator already had (`OrchestrationOptions.invoke`); the
 * gates are the seam added for AC-1. Together they let a test drive `runFeatureFactory` through
 * all five stages with no network and no child process.
 */

import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, isAbsolute, join, resolve } from 'path';

import {
  CheckpointDecision,
  CheckpointRequest,
  OrchestrationOptions,
  runFeatureFactory
} from '../../feature/workflows/feature-factory-orchestrator';
import { AgentInvocation, AgentInvoker } from '../../runner/invoke-agent';
import { FeatureFactoryAgent } from '../../runner/agent-registry';
import {
  completeFeature,
  createFeatureState,
  FeatureState,
  recordEscalation,
  recordPause,
  ValidatorEvaluation
} from '../../harness/state-tracker';
import { RunClass } from '../../harness/run-lifecycle';
import { loadState, saveState } from '../../harness/state-store';
import { ARCHIVE_DIRNAME } from '../../harness/run-directory';
import { REVIEW_DIR_PREFIX } from '../../harness/review-copy';
import {
  backend,
  consolidator,
  followup,
  placeholder,
  researcher,
  skeptic,
  spec,
  story,
  testVerifier,
  validator
} from './agent-outputs';
import { fakeChangeTracker } from './changes';
import { recordingGates } from './gates';
import { nonDurableStateWriter } from './state-writer';

export interface TempProject {
  dir: string;
  cleanup: () => void;
}

/**
 * Remove `path` and everything below it, also when it holds a sealed (read-only) review copy
 * (PR B-2 D-3): every directory below it is made writable first. Symlinks are never followed.
 */
export function removeTree(path: string): void {
  const unseal = (dir: string): void => {
    const stat = lstatSync(dir, { throwIfNoEntry: false });
    if (!stat?.isDirectory()) return;
    chmodSync(dir, 0o700);
    for (const name of readdirSync(dir)) unseal(join(dir, name));
  };
  unseal(path);
  rmSync(path, { recursive: true, force: true });
}

/** The names in `dir`, or none when it is not a real directory (a test may make `.factory` a file). */
function namesInDirectory(dir: string): string[] {
  try {
    return lstatSync(dir).isDirectory() ? readdirSync(dir) : [];
  } catch {
    return [];
  }
}

/** The ids of every run recorded in `dir`'s `.factory/` (archived runs included). */
function runIdsIn(dir: string): string[] {
  const factory = join(dir, '.factory');
  const ids = namesInDirectory(factory).filter(name => name !== ARCHIVE_DIRNAME);
  return [...ids, ...namesInDirectory(join(factory, ARCHIVE_DIRNAME))];
}

/**
 * Remove the review copies the runs of `dir` made under the OS temp directory (the production
 * review root, used by a run that was not given one, e.g. through the CLI). A test that deletes
 * `<dir>/.factory` itself calls this first: the copies are found by the run ids recorded there.
 */
export function removeTmpReviewCopies(dir: string): void {
  const root = realpathSync(tmpdir());
  const prefixes = runIdsIn(dir).map(id => `${REVIEW_DIR_PREFIX}${id}-e`);
  if (prefixes.length === 0) return;
  for (const name of readdirSync(root)) {
    if (prefixes.some(prefix => name.startsWith(prefix))) removeTree(join(root, name));
  }
}

/**
 * A fresh, empty project directory under the OS temp dir. Call `cleanup` in afterEach: it removes
 * the project, its sibling review root `<dir>-review` (runToEnd's default, PR B-2 D-20), and any
 * review copy one of its runs made under the OS temp directory.
 */
export function tempProject(prefix = 'ff-test-'): TempProject {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return {
    dir,
    cleanup: () => {
      try {
        removeTmpReviewCopies(dir);
      } finally {
        removeTree(`${dir}-review`);
        removeTree(dir);
      }
    }
  };
}

/**
 * What an agent returns: a fixed output (cloned per call, because the orchestrator rewrites
 * artifact paths in place), or a function of the call and the agent's 1-based call number.
 */
export type ScriptEntry = object | ((call: AgentInvocation, callNumber: number) => unknown);
export type InvokerScript = Partial<Record<FeatureFactoryAgent, ScriptEntry>>;

export interface ScriptedInvoker {
  invoke: AgentInvoker;
  /** Every invocation, in order. */
  calls: AgentInvocation[];
  /** The agents invoked, in order. */
  agents: () => string[];
  /** The prompts one agent received, in order. */
  promptsFor: (agent: string) => string[];
}

const BUILDERS = new Set(['04-backend-builder', '05-frontend-builder']);

/**
 * Builders write their own code. A fake builder's claimed files must therefore exist on disk,
 * or the materialization gate correctly reports a hallucination.
 */
function materializeClaimedFiles(output: any, cwd: string): void {
  if (!output || !BUILDERS.has(output.agent)) return;
  const files = output.details?.filesModified;
  if (!Array.isArray(files)) return;

  for (const file of files) {
    const path = typeof file === 'string' ? file : file?.path;
    if (typeof path !== 'string') continue;
    const absolute = isAbsolute(path) ? path : resolve(cwd, path);
    if (existsSync(absolute)) continue;
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, 'export const fixture = true;\n');
  }
}

/**
 * An invoker that plays back `script`. An agent with no entry gets a schema-invalid
 * placeholder, which stops the run at that agent. With `cwd`, builders' claimed files are
 * written to disk so the materialization gate sees real files.
 */
export function scriptedInvoker(script: InvokerScript = {}, options: { cwd?: string } = {}): ScriptedInvoker {
  const calls: AgentInvocation[] = [];

  const invoke: AgentInvoker = async call => {
    calls.push({ ...call });
    const callNumber = calls.filter(c => c.agent === call.agent).length;
    const entry = script[call.agent as FeatureFactoryAgent];

    const output =
      entry === undefined
        ? placeholder(call.stage, call.agent)
        : typeof entry === 'function'
          ? await entry(call, callNumber)
          : structuredClone(entry);

    if (options.cwd) materializeClaimedFiles(output, options.cwd);
    return output;
  };

  return {
    invoke,
    calls,
    agents: () => calls.map(c => c.agent),
    promptsFor: agent => calls.filter(c => c.agent === agent).map(c => c.prompt)
  };
}

/**
 * A script under which every agent passes, so a run with passing gates reaches SUCCESS. The
 * skeptic UPHOLDS by default, so a CRITICAL Validator issue keeps its Phase A route.
 */
export function passingScript(): InvokerScript {
  return {
    '01-researcher': researcher(),
    '02-story-writer': story(),
    '03-spec-writer': spec(),
    '04-backend-builder': backend(),
    '06-test-verifier': testVerifier(),
    '07-validator': validator(),
    '07b-validator-followup': followup(),
    '07c-validator-skeptic': skeptic({ verdict: 'UPHELD' }),
    '08-feature-consolidator': consolidator()
  };
}

/**
 * Run the orchestrator with test defaults: silent logger, an approver that approves every
 * checkpoint, passing recorded gates, a fake change tracker (so no test but change-diff's runs
 * git), the non-durable state writer (AC-104: same file and bytes, no fsync) and the review root
 * `<cwd>-review` (PR B-2 D-20). Anything in
 * `overrides` wins, `stateWriter` included. Tests that call runFeatureFactory directly stay durable.
 */
export function runToEnd(
  overrides: Partial<OrchestrationOptions> & Pick<OrchestrationOptions, 'cwd' | 'invoke'>
): Promise<FeatureState> {
  return runFeatureFactory({
    featureName: 'fixture-run',
    featureDescription: 'add 2FA',
    logger: () => {},
    approveCheckpoint: async () => true,
    gates: recordingGates().gates,
    changes: fakeChangeTracker(),
    stateWriter: nonDurableStateWriter,
    // PR B-2 D-20: review copies go beside the project, outside it, and tempProject removes them.
    reviewRoot: `${overrides.cwd}-review`,
    ...overrides
  });
}

/** One scripted answer: a decision, a legacy boolean, any other value (tests I-18), or a function of the request. */
export type ScriptedDecision = CheckpointDecision | boolean | unknown | ((request: CheckpointRequest) => unknown);

export interface ScriptedApprover {
  approve: (request: CheckpointRequest) => Promise<CheckpointDecision | boolean>;
  /** Every request the approver was given, in order. */
  requests: CheckpointRequest[];
}

/**
 * A scripted approver (D-4): the n-th checkpoint asked gets the n-th entry. Past the end of the
 * script every checkpoint is approved, so a test scripts only the decisions it is about; it
 * asserts on `requests` to pin which checkpoints were actually asked.
 */
export function decisions(...script: ScriptedDecision[]): ScriptedApprover {
  const requests: CheckpointRequest[] = [];
  const approve = async (request: CheckpointRequest) => {
    requests.push(request);
    const entry = requests.length <= script.length ? script[requests.length - 1] : { decision: 'APPROVE' };
    const value = typeof entry === 'function' ? (entry as (r: CheckpointRequest) => unknown)(request) : entry;
    return value as CheckpointDecision | boolean;
  };
  return { approve, requests };
}

/** The document `seedRun` writes beside each seeded state.json. */
export const SEEDED_DOCUMENT = 'USER_STORY.md';

/**
 * Write a valid run of the given class into `<cwd>/.factory/<id>/`: a state.json saved through the
 * real store, and one document (`SEEDED_DOCUMENT`). For the run-directory lifecycle tests (RD).
 * ACTIVE is a run killed mid-flight: IN_PROGRESS, nothing finished.
 */
export function seedRun(cwd: string, runClass: RunClass): FeatureState {
  let state = createFeatureState(`seed-${runClass.toLowerCase()}`, undefined, 'seeded run');
  const runDir = `.factory/${state.featureId}`;

  switch (runClass) {
    case 'ACTIVE':
      break;
    case 'PAUSED':
      state = recordPause(state, {
        checkpointId: 1,
        name: 'CHECKPOINT 1: Approve the story',
        stage: 2,
        artifactPaths: [`${runDir}/${SEEDED_DOCUMENT}`],
        sha256: 'a'.repeat(64)
      });
      break;
    case 'ESCALATED':
      state = completeFeature(
        recordEscalation(state, 3, 'harness', 'CRITICAL_ISSUE', 'seeded escalation'),
        'ESCALATED',
        'seeded escalation'
      );
      break;
    case 'SUCCESS':
    case 'MANUAL_STOP':
      state = completeFeature(state, runClass, `seeded ${runClass}`);
      break;
  }

  saveState(cwd, state);
  writeFileSync(join(cwd, runDir, SEEDED_DOCUMENT), `# Story of ${state.featureId}\n`);
  return state;
}

/** What `killAt` throws: the process "dies" at that agent call. */
export class SimulatedKill extends Error {
  constructor(agent: string, callNumber: number) {
    super(`simulated kill at ${agent} call ${callNumber}`);
    this.name = 'SimulatedKill';
  }
}

export interface KillSwitch {
  invoke: AgentInvoker;
  /** state.json as it was on disk when the kill happened: what a killed process leaves behind. */
  snapshot: () => FeatureState;
}

/** The state.json of the only live run in `cwd`, read through the real store. */
function onlyLiveRun(cwd: string): FeatureState {
  const factoryDir = join(cwd, '.factory');
  const runs = readdirSync(factoryDir).filter(
    name => name !== ARCHIVE_DIRNAME && existsSync(join(factoryDir, name, 'state.json'))
  );
  if (runs.length !== 1) throw new Error(`killAt: expected one live run in ${factoryDir}, found ${runs.length}.`);
  return loadState(cwd, runs[0])!;
}

/**
 * Simulate a killed process (AC-34, AC-36). At the `callNumber`-th call of `agent` the wrapper
 * captures state.json from disk — everything committed before the invocation, e.g. the attempt
 * counted for it — and throws SimulatedKill instead of invoking. The orchestrator then records an
 * escalation a real kill never would; `restoreSnapshot` puts the captured state back.
 */
export function killAt(invoke: AgentInvoker, agent: string, callNumber: number, cwd: string): KillSwitch {
  let calls = 0;
  let captured: FeatureState | undefined;

  return {
    invoke: async call => {
      if (call.agent === agent && ++calls === callNumber) {
        captured = onlyLiveRun(cwd);
        throw new SimulatedKill(agent, callNumber);
      }
      return invoke(call);
    },
    snapshot: () => {
      if (!captured) throw new Error(`killAt: ${agent} was never called ${callNumber} time(s).`);
      return structuredClone(captured);
    }
  };
}

/** Write a captured state back to disk through the real store, as the killed process left it. */
export function restoreSnapshot(cwd: string, state: FeatureState): FeatureState {
  saveState(cwd, state);
  return structuredClone(state);
}

/** The state.json of the only live run in project `cwd` (archived runs aside), or undefined when there is none or more than one. */
export function onDisk(cwd: string): FeatureState | undefined {
  const factory = join(cwd, '.factory');
  if (!existsSync(factory)) return undefined;
  const runs = readdirSync(factory).filter(name => name !== ARCHIVE_DIRNAME && existsSync(join(factory, name, 'state.json')));
  return runs.length === 1 ? loadState(cwd, runs[0]) : undefined;
}

/** A run's recorded verification evaluations, empty when there are none (or no state). */
export const evaluations = (state: FeatureState | undefined): ValidatorEvaluation[] => state?.validatorEvaluations ?? [];

/**
 * A logger that deletes one document right after the harness persists it into the run directory,
 * before any gate reads it: how a test makes a gate meet a missing document now that a read-only
 * agent cannot return one without its content (MINOR-8). Silent otherwise.
 */
export function removeOnPersist(cwd: string, agent: string, name: string): (message: string) => void {
  const persisted = new RegExp(`📄 ${agent.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} → (\\S*/${name.replace('.', '\\.')})$`);
  return message => {
    const match = persisted.exec(message);
    if (match) rmSync(resolve(cwd, match[1]));
  };
}
