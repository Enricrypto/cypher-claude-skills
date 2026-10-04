#!/usr/bin/env node
/**
 * Feature Factory CLI (A-2, D-11). Thin: it parses one mode, wires the library, and prints.
 *
 *   npm run factory -- --feature "add a health check endpoint" [--name <name>] [--cwd <dir>] [--model <m>] [--yes]
 *   npm run factory -- --resume <id> [--approve <cp> | --reject <cp> --notes "<why>" | --grant-attempts <n>] [--cwd <dir>]
 *   npm run factory -- --close <id> [--cwd <dir>]
 *   npm run factory -- --consolidate <id> [--cwd <dir>] [--model <m>]
 *
 * Exit codes (EXIT_CODES, D-6): 0 SUCCESS (also a done --close, and a --consolidate whose Stage 5
 * gate passed); 1 STOPPED (escalation, rejection, refusal, usage error, unexpected error, or a
 * --consolidate whose gate failed); 3 PAUSED (a checkpoint is waiting for --approve / --reject).
 * 2 is left unused: CLIs conventionally mean "usage error" by it (I-9). CI or a shell script can
 * trust the exit code rather than reading the log.
 *
 * Every decision about a run — whether it may start, resume, be approved, closed or consolidated —
 * belongs to the library (run-lifecycle, run-directory, the orchestrator, consolidate-run). This
 * file never re-implements one: a refusal is the library's RunRefusedError, printed, exit 1.
 */

import { resolve } from 'path';
import { createInterface } from 'readline';
import {
  CheckpointDecision,
  CheckpointRequest,
  OrchestrationGates,
  runFeatureFactory
} from '../feature/workflows/feature-factory-orchestrator';
import { consolidateRun } from '../feature/workflows/consolidate-run';
import { ChangeTracker } from '../harness/change-diff';
import { closeRun, findRun } from '../harness/run-directory';
import {
  classifyRun,
  isSafeRunId,
  nextStepHints,
  parseCheckpointId,
  resumeDescription,
  ResumeRequest,
  RunRefusedError
} from '../harness/run-lifecycle';
import { AgentInvoker, createSdkInvoker, SdkInvokerConfig } from './invoke-agent';
import { FeatureState, getRecommendedAction, getStateSummary } from '../harness/state-tracker';
import { stateFilePath } from '../harness/state-store';

/**
 * Every flag the CLI accepts (D-11, AC-79). Anything else is a usage error. SKILL.md's flag
 * documentation is drift-tested against this table.
 */
export const CLI_FLAGS = {
  feature: { takesValue: true, summary: 'Start a new run for this feature description (with --resume: must match the saved description).' },
  name: { takesValue: true, summary: 'Name of a new run (default: the first 60 characters of --feature).' },
  cwd: { takesValue: true, summary: 'The target project directory (default: the current directory).' },
  model: { takesValue: true, summary: 'The model the agents run on.' },
  yes: { takesValue: false, summary: 'Approve every checkpoint (CP1, CP2 and CP3) without asking.' },
  resume: { takesValue: true, summary: 'Continue the unfinished run with this id.' },
  approve: { takesValue: true, summary: 'With --resume: approve the pending checkpoint (1, 2, 3 or cp1, cp2, cp3).' },
  reject: { takesValue: true, summary: 'With --resume: reject the pending checkpoint; needs --notes.' },
  notes: { takesValue: true, summary: 'With --reject: why, for the agent that reworks it.' },
  'grant-attempts': { takesValue: true, summary: 'With --resume: give the builder that exhausted its attempts n more (1-3).' },
  close: { takesValue: true, summary: 'Close the unfinished run with this id (MANUAL_STOP); the next new run archives it.' },
  consolidate: { takesValue: true, summary: 'Run the Feature Consolidator on the SUCCESS run with this id (live or archived).' }
} as const satisfies Readonly<Record<string, { takesValue: boolean; summary: string }>>;

export type CliFlag = keyof typeof CLI_FLAGS;

/** D-6. 2 is deliberately unused (I-9). */
export const EXIT_CODES = { SUCCESS: 0, STOPPED: 1, PAUSED: 3 } as const;

/** What one invocation asks for: exactly one mode. */
export type CliCommand =
  | { kind: 'run'; feature: string; name: string; cwd: string; model?: string; yes: boolean }
  | { kind: 'resume'; id: string; cwd: string; model?: string; yes: boolean; feature?: string; request: ResumeRequest }
  | { kind: 'close'; id: string; cwd: string }
  | { kind: 'consolidate'; id: string; cwd: string; model?: string };

/** The command line itself is wrong. Thrown by parseArgs before anything runs; exit 1. */
export class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CliUsageError';
  }
}

const USAGE = [
  'Usage:',
  '  npm run factory -- --feature "<description>" [--name <name>] [--cwd <dir>] [--model <model>] [--yes]',
  '  npm run factory -- --resume <id> [--approve <cp> | --reject <cp> --notes "<why>" | --grant-attempts <n>] [--feature "<description>"] [--cwd <dir>] [--model <model>] [--yes]',
  '  npm run factory -- --close <id> [--cwd <dir>]',
  '  npm run factory -- --consolidate <id> [--cwd <dir>] [--model <model>]'
].join('\n');

/**
 * Everything the CLI touches outside itself, passed in — the same injection the orchestrator
 * uses for `invoke`. The real main wires realCliDependencies(); tests wire fakes, so a full CLI
 * run needs no process, no TTY and no network.
 */
export interface CliDependencies {
  createInvoker: (config: SdkInvokerConfig) => AgentInvoker;
  /** Asked only when isTTY() is true and --yes was not given. The real one is terminalApprover. */
  approver: (checkpoint: CheckpointRequest) => Promise<CheckpointDecision | boolean>;
  isTTY: () => boolean;
  exit: (code: number) => void;
  log: (message: string) => void;
  error: (message: string) => void;
  /** Passed through to runFeatureFactory. Production leaves it unset: the real gates run. */
  gates?: Partial<OrchestrationGates>;
  /** Passed through to runFeatureFactory. Production leaves it unset: the real read-only git tracker runs. */
  changes?: Partial<ChangeTracker>;
}

/** C0 controls except \t and \n, DEL, and C1 controls (which include the 8-bit CSI). */
const TERMINAL_CONTROL = /[\u0000-\u0008\u000a-\u001f\u007f-\u009f]/g;

/**
 * Text that is safe to write to a terminal (SEC, D-11). Agent output, documents and diffs reach
 * the screen, and an ESC sequence in them could clear the screen, rewrite what a human is about
 * to approve, or set the window title. Every C0 / C1 control character except `\n` and `\t` —
 * ESC included, which defuses every escape sequence — is shown as a visible `\xNN`; a CRLF line
 * ending is shown as a plain newline. Display only: approvals hash the raw text.
 */
export function printableForTerminal(text: string): string {
  return String(text)
    .replace(/\r\n/g, '\n')
    .replace(TERMINAL_CONTROL, char =>
      char === '\n' ? char : `\\x${char.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`
    );
}

/** D-6: 0 for SUCCESS, 3 for PAUSED, 1 for every other end — including anything unexpected. */
export function exitCodeFor(state: FeatureState): number {
  switch (classifyRun(state)) {
    case 'SUCCESS':
      return EXIT_CODES.SUCCESS;
    case 'PAUSED':
      return EXIT_CODES.PAUSED;
    default:
      return EXIT_CODES.STOPPED;
  }
}

function isFlag(name: string): name is CliFlag {
  return Object.prototype.hasOwnProperty.call(CLI_FLAGS, name);
}

/** Which flags each mode accepts, besides its own. */
const MODE_FLAGS: Readonly<Record<CliCommand['kind'], readonly CliFlag[]>> = {
  run: ['feature', 'name', 'cwd', 'model', 'yes'],
  resume: ['resume', 'feature', 'cwd', 'model', 'yes', 'approve', 'reject', 'notes', 'grant-attempts'],
  close: ['close', 'cwd'],
  consolidate: ['consolidate', 'cwd', 'model']
};

function runId(flag: CliFlag, value: string): string {
  if (!isSafeRunId(value)) {
    throw new CliUsageError(
      `--${flag} ${JSON.stringify(value)}: not a valid run id (a letter or digit, then letters, digits, ".", "_" or "-"; never "..").`
    );
  }
  return value;
}

function checkpointArg(flag: CliFlag, value: string) {
  const id = parseCheckpointId(value);
  if (id === undefined) throw new CliUsageError(`--${flag} takes a checkpoint: 1, 2, 3 (or cp1, cp2, cp3); got ${JSON.stringify(value)}.`);
  return id;
}

/**
 * Parse the command line (D-11). Throws CliUsageError for an unknown flag, a stray token, a
 * duplicate flag, a missing or blank value, more or less than one mode, or a flag the mode does not
 * take. Ranges that depend on the run (which checkpoint is pending, the 1-3 grant cap) are checked
 * by the library, not here.
 */
export function parseArgs(argv: string[]): CliCommand {
  const values = new Map<CliFlag, string>();

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      throw new CliUsageError(`Unexpected argument ${JSON.stringify(token)}: every argument is a --flag or its value.`);
    }
    const name = token.slice(2);
    if (!isFlag(name)) throw new CliUsageError(`Unknown flag ${JSON.stringify(token)}.`);
    if (values.has(name)) throw new CliUsageError(`--${name} is given more than once.`);

    if (!CLI_FLAGS[name].takesValue) {
      values.set(name, '');
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) throw new CliUsageError(`--${name} requires a value.`);
    if (value.trim() === '') throw new CliUsageError(`--${name} requires a non-blank value.`);
    values.set(name, value);
    i++;
  }

  const modes = (['resume', 'close', 'consolidate'] as const).filter(flag => values.has(flag));
  if (modes.length > 1) {
    throw new CliUsageError(`Use only one of --resume, --close and --consolidate; got ${modes.map(m => `--${m}`).join(' and ')}.`);
  }
  const kind: CliCommand['kind'] = modes.length === 0 ? 'run' : modes[0];
  if (kind === 'run' && !values.has('feature')) {
    throw new CliUsageError('Missing --feature. Usage: npm run factory -- --feature "<description>" (or --resume, --close, --consolidate <id>).');
  }

  for (const flag of values.keys()) {
    if (MODE_FLAGS[kind].includes(flag)) continue;
    if (flag === 'approve' || flag === 'reject' || flag === 'grant-attempts') throw new CliUsageError(`--${flag} requires --resume <id>.`);
    if (flag === 'notes') throw new CliUsageError('--notes is only allowed with --reject.');
    throw new CliUsageError(`--${flag} cannot be used with ${kind === 'run' ? '--feature' : `--${kind}`}.`);
  }

  const cwd = resolve(values.get('cwd') ?? process.cwd());
  const model = values.get('model');
  const optional = <K extends string, V>(key: K, value: V | undefined) => (value === undefined ? {} : ({ [key]: value } as Record<K, V>));

  switch (kind) {
    case 'run': {
      const feature = values.get('feature')!;
      return { kind, feature, name: values.get('name') ?? feature.slice(0, 60), cwd, ...optional('model', model), yes: values.has('yes') };
    }
    case 'close':
      return { kind, id: runId('close', values.get('close')!), cwd };
    case 'consolidate':
      return { kind, id: runId('consolidate', values.get('consolidate')!), cwd, ...optional('model', model) };
    case 'resume': {
      const actions = (['approve', 'reject', 'grant-attempts'] as const).filter(flag => values.has(flag));
      if (actions.length > 1) {
        throw new CliUsageError(`--approve, --reject and --grant-attempts are mutually exclusive; got ${actions.map(a => `--${a}`).join(' and ')}.`);
      }
      if (values.has('notes') && !values.has('reject')) throw new CliUsageError('--notes is only allowed with --reject.');

      let request: ResumeRequest;
      if (values.has('approve')) {
        request = { action: { kind: 'approve', checkpoint: checkpointArg('approve', values.get('approve')!) } };
      } else if (values.has('reject')) {
        const checkpoint = checkpointArg('reject', values.get('reject')!);
        const notes = values.get('notes');
        if (notes === undefined) throw new CliUsageError('--reject needs --notes "<why>", so the rework knows what to change.');
        request = { action: { kind: 'reject', checkpoint, notes } };
      } else if (values.has('grant-attempts')) {
        const raw = values.get('grant-attempts')!;
        if (!/^[0-9]+$/.test(raw)) throw new CliUsageError(`--grant-attempts takes a whole number; got ${JSON.stringify(raw)}.`);
        request = { action: { kind: 'continue' }, grantAttempts: Number(raw) };
      } else {
        request = { action: { kind: 'continue' } };
      }

      return {
        kind,
        id: runId('resume', values.get('resume')!),
        cwd,
        ...optional('feature', values.get('feature')),
        ...optional('model', model),
        yes: values.has('yes'),
        request
      };
    }
  }
}

/** What terminalApprover needs: somewhere to print, and a way to ask one question. */
export interface TerminalIO {
  log: (message: string) => void;
  ask: (question: string) => Promise<string>;
}

/**
 * The human at a checkpoint, on a terminal (D-11). Prints the full presented text — escaped, so it
 * cannot drive the terminal (SEC) — then asks `y` (approve), `n` (reject, then optional notes) or
 * `p` (pause). Anything that is not y / yes / p / pause rejects, as before. The request is never
 * modified: the approval binds to the hash of the raw text.
 */
export function terminalApprover(io: TerminalIO): (checkpoint: CheckpointRequest) => Promise<CheckpointDecision> {
  return async checkpoint => {
    io.log(`\n⏸️  ${printableForTerminal(checkpoint.name)}`);
    io.log(`\n${printableForTerminal(checkpoint.text)}\n`);

    const answer = (await io.ask('   Approve? [y = approve / n = reject / p = pause] ')).trim();
    if (/^y(es)?$/i.test(answer)) return { decision: 'APPROVE' };
    if (/^p(ause)?$/i.test(answer)) return { decision: 'PAUSE' };

    const notes = (await io.ask('   Notes for the rework (optional, Enter to skip): ')).trim();
    return { decision: 'REJECT', notes };
  };
}

/** One question on the real terminal. */
async function askLine(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await new Promise<string>(res => rl.question(question, res));
  } finally {
    rl.close();
  }
}

/** The real dependencies: the SDK invoker, a readline prompt, the real TTY, exit and console. */
export function realCliDependencies(): CliDependencies {
  return {
    createInvoker: createSdkInvoker,
    approver: terminalApprover({ log: message => console.log(message), ask: askLine }),
    isTTY: () => Boolean(process.stdin.isTTY),
    exit: code => process.exit(code),
    log: message => console.log(message),
    error: message => console.error(message)
  };
}

/** `--yes`: every checkpoint, CP3 included, approved without asking (I-15). */
const approveAll = async (): Promise<CheckpointDecision> => ({ decision: 'APPROVE', approvedBy: '--yes' });

/**
 * The human checkpoints (CHECKPOINTS in the orchestrator).
 *
 * On a TTY we ask, and the run blocks until you answer. Without a TTY (CI, a pipe) there is
 * nobody to ask, so the run PAUSES (AC-77): nothing is approved, and the run waits, resumable,
 * for `--resume <id> --approve <n>` or `--reject <n> --notes "<why>"` (exit 3).
 *
 * --yes is the only way to skip them, and it has to be typed. That is deliberate: a checkpoint
 * you can skip by forgetting to configure something is not a checkpoint.
 */
export function checkpointApprover(
  yes: boolean,
  deps: Pick<CliDependencies, 'approver' | 'isTTY' | 'error'>
): (checkpoint: CheckpointRequest) => Promise<CheckpointDecision | boolean> {
  if (yes) return approveAll;

  return async checkpoint => {
    if (!deps.isTTY()) {
      deps.error(
        `\n⏸️  ${checkpoint.name}\n` +
          `   No TTY, so there is nobody to ask: the run pauses here and approves nothing.\n` +
          `   Approve it with --resume <id> --approve ${checkpoint.id}, or reject it with ` +
          `--resume <id> --reject ${checkpoint.id} --notes "<why>" (the exact commands follow).`
      );
      return { decision: 'PAUSE' };
    }
    return deps.approver(checkpoint);
  };
}

/** The output of one invocation, every line made terminal-safe. */
interface Printer {
  log: (message: string) => void;
  error: (message: string) => void;
}

/** Print how a run ended, where its record is, and what can be done next. Returns the exit code. */
function report(state: FeatureState, cwd: string, out: Printer): number {
  out.log(getStateSummary(state));
  const code = exitCodeFor(state);
  const record = `  Run record: ${stateFilePath(cwd, state.featureId)}`;
  const hints = nextStepHints(state, cwd).map(hint => `  ${hint}`);

  if (code === EXIT_CODES.SUCCESS) {
    out.log(`\n✅ Feature complete: ${state.featureName}`);
    out.log(record);
    for (const hint of hints) out.log(hint);
    return code;
  }

  if (code === EXIT_CODES.PAUSED) {
    out.log(`\n⏸️  PAUSED at ${state.pendingCheckpoint?.name ?? 'a checkpoint'}: nothing past it runs until it is decided.`);
    out.log(record);
    for (const hint of hints) out.log(hint);
    return code;
  }

  out.error(`\n❌ BLOCKED: ${state.finalSummary ?? state.status}`);
  for (const escalation of state.escalations) {
    out.error(`\n  Stage ${escalation.stage} — ${escalation.reason} (${escalation.agent})`);
    out.error(`  ${escalation.context.message}`);
    for (const blocker of escalation.context.blockers ?? []) out.error(`    - ${blocker}`);
  }
  // The run left a full record. Say where, so the failure is inspectable rather than just
  // whatever survived in the terminal scrollback; and say what can be done, only if it can (AC-42).
  out.error(`\n${record}`);
  for (const hint of hints) out.error(hint);
  return code;
}

function sdkInvoker(cwd: string, model: string | undefined, deps: CliDependencies, out: Printer): AgentInvoker {
  return deps.createInvoker({
    cwd,
    model,
    log: message => out.log(message),
    onToolDenied: (agent, tool) => {
      // An agent reaching past its contract. Not fatal, but never silent.
      out.error(`  ⚠️  ${agent} attempted "${tool}", which its contract does not grant.`);
    }
  });
}

/**
 * The live run to resume (D-11). findRun refuses an unsafe id and an unreadable record; an
 * archived run is finished (only SUCCESS and MANUAL_STOP are archived), and a missing one is not
 * found — a hard error, never a quiet fresh start: the operator asked to continue specific work.
 */
function liveRunToResume(cwd: string, id: string): FeatureState {
  const found = findRun(cwd, id);
  if (!found) throw new RunRefusedError('RUN_NOT_FOUND', `No run ${id} in ${resolve(cwd, '.factory')}.`);
  if (found.location === 'archive') {
    throw new RunRefusedError(
      'RUN_FINISHED',
      `Run ${id} is archived and finished (${classifyRun(found.state)}) in ${found.runDir}; it cannot be resumed.`
    );
  }
  return found.state;
}

/** I-18: `--feature` with `--resume` must be the description the run was started with. */
function assertSameDescription(state: FeatureState, feature: string | undefined): void {
  if (feature === undefined || state.featureDescription === undefined || feature === state.featureDescription) return;
  throw new RunRefusedError(
    'DESCRIPTION_MISMATCH',
    `--feature ${JSON.stringify(feature)} does not match the description saved in run ${state.featureId} ` +
      `(${JSON.stringify(state.featureDescription)}). Omit --feature to resume it as it was started.`
  );
}

/** Parse, dispatch, report. Returns the exit code (D-6). */
async function execute(argv: string[], deps: CliDependencies, out: Printer): Promise<number> {
  const command = parseArgs(argv);
  const logger = (message: string) => out.log(`[FF] ${message}`);

  switch (command.kind) {
    case 'close': {
      const closed = closeRun(command.cwd, command.id);
      out.log(`Run ${closed.featureId} closed (${closed.completionStatus}); the next new run archives it.`);
      out.log(`  Run record: ${stateFilePath(command.cwd, closed.featureId)}`);
      return EXIT_CODES.SUCCESS;
    }

    case 'consolidate': {
      out.log(`Feature Factory — consolidate ${command.id}`);
      out.log(`  project: ${command.cwd}\n`);
      const result = await consolidateRun({
        cwd: command.cwd,
        runId: command.id,
        invoke: sdkInvoker(command.cwd, command.model, deps, out),
        logger
      });
      if (result.passed) {
        out.log(`\n✅ Consolidated ${command.id} (${result.location}): ${result.runDir}`);
        return EXIT_CODES.SUCCESS;
      }
      out.error(`\n❌ ${result.decision.reason}`);
      for (const blocker of result.decision.blockers) out.error(`    - ${blocker}`);
      out.error(`\n  Run directory: ${result.runDir}`);
      return EXIT_CODES.STOPPED;
    }

    case 'run':
    case 'resume': {
      const resumeFromState = command.kind === 'resume' ? liveRunToResume(command.cwd, command.id) : undefined;
      if (resumeFromState) assertSameDescription(resumeFromState, command.kind === 'resume' ? command.feature : undefined);

      // A run recorded without a description (pre-A-2) is refused without --feature (AC-37).
      const featureDescription =
        command.kind === 'run' ? command.feature : resumeDescription(resumeFromState!, command.feature);

      out.log(`Feature Factory`);
      out.log(`  feature: ${featureDescription}`);
      out.log(`  project: ${command.cwd}\n`);
      if (command.yes) out.log('  ⚠️  --yes: every checkpoint, CP3 included, will be approved automatically.\n');
      if (resumeFromState) {
        out.log(`  ▶️  Resuming ${resumeFromState.featureName} (${classifyRun(resumeFromState)}) at Stage ${resumeFromState.currentStage}`);
        out.log(`     ${getRecommendedAction(resumeFromState)}\n`);
      }

      const state = await runFeatureFactory({
        featureName: resumeFromState ? resumeFromState.featureName : (command as Extract<CliCommand, { kind: 'run' }>).name,
        featureDescription,
        cwd: command.cwd,
        resumeFromState,
        resume: command.kind === 'resume' ? command.request : undefined,
        invoke: sdkInvoker(command.cwd, command.model, deps, out),
        approveCheckpoint: checkpointApprover(command.yes, { ...deps, error: out.error }),
        gates: deps.gates,
        changes: deps.changes,
        logger
      });
      return report(state, command.cwd, out);
    }
  }
}

/**
 * The CLI entry point. Always calls `deps.exit(code)` exactly once, then returns the code.
 * A thrown error — a usage error, a RunRefusedError, a StatePersistenceError, anything — is
 * reported through `deps.error` and exits 1. Everything printed goes through printableForTerminal.
 */
export async function runCli(argv: string[], deps: CliDependencies): Promise<number> {
  const out: Printer = {
    log: message => deps.log(printableForTerminal(message)),
    error: message => deps.error(printableForTerminal(message))
  };

  let code: number;
  try {
    code = await execute(argv, deps, out);
  } catch (err) {
    out.error(`\n❌ ${err instanceof Error ? err.message : String(err)}`);
    if (err instanceof CliUsageError) out.error(`\n${USAGE}`);
    code = EXIT_CODES.STOPPED;
  }
  deps.exit(code);
  return code;
}

if (require.main === module) {
  void runCli(process.argv.slice(2), realCliDependencies());
}
