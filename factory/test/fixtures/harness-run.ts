/**
 * Harness-run fixtures (AC-2): a temp project, a scripted invoker, and a run-to-the-end helper.
 *
 * The invoker is the seam the orchestrator already had (`OrchestrationOptions.invoke`); the
 * gates are the seam added for AC-1. Together they let a test drive `runFeatureFactory` through
 * all five stages with no network and no child process.
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, isAbsolute, join, resolve } from 'path';

import { OrchestrationOptions, runFeatureFactory } from '../../feature/workflows/feature-factory-orchestrator';
import { AgentInvocation, AgentInvoker } from '../../runner/invoke-agent';
import { FeatureFactoryAgent } from '../../runner/agent-registry';
import { FeatureState } from '../../harness/state-tracker';
import {
  backend,
  consolidator,
  placeholder,
  researcher,
  spec,
  story,
  testVerifier,
  validator
} from './agent-outputs';
import { recordingGates } from './gates';

export interface TempProject {
  dir: string;
  cleanup: () => void;
}

/** A fresh, empty project directory under the OS temp dir. Call `cleanup` in afterEach. */
export function tempProject(prefix = 'ff-test-'): TempProject {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
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

/** A script under which every agent passes, so a run with passing gates reaches SUCCESS. */
export function passingScript(): InvokerScript {
  return {
    '01-researcher': researcher(),
    '02-story-writer': story(),
    '03-spec-writer': spec(),
    '04-backend-builder': backend(),
    '06-test-verifier': testVerifier(),
    '07-validator': validator(),
    '08-feature-consolidator': consolidator()
  };
}

/**
 * Run the orchestrator with test defaults: silent logger, an approver that approves every
 * checkpoint, and passing recorded gates. Anything in `overrides` wins.
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
    ...overrides
  });
}
