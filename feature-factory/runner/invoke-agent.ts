/**
 * Feature Factory Agent Dispatch
 *
 * Replaces the mock invokeAgent() that returned a hardcoded status:'PASS'. This really runs
 * the agent, via the Claude Agent SDK, whose bundled binary is Claude Code — so it
 * authenticates as the signed-in user (subscription) rather than a metered API key.
 *
 * Scope boundary, deliberately drawn:
 *   This module RUNS agents and ENFORCES their tool grants. It does not judge their work.
 *   Semantic validation (does the story have 3+ Given/When/Then criteria?) belongs to the
 *   harness — the orchestrator calls validateOutputSchema and records a structured escalation.
 *   If the invoker also rejected bad output, there would be two arbiters and the harness's
 *   escalation path would be silently bypassed. There is one arbiter, and it is the gate.
 */

import { agentOutputSchema } from './output-schemas';
import {
  AGENT_TOOLS,
  AGENT_STAGE,
  FeatureFactoryAgent,
  deniedToolsFor,
  isReadOnly,
  loadAgentContract
} from './agent-registry';

/**
 * The port the orchestrator depends on. Its shape matches the call sites the orchestrator
 * already had, so production gets the SDK adapter below and tests get a scripted fake —
 * which is what lets the gates be verified in CI without a login or a single token.
 */
export interface AgentInvocation {
  stage: number;
  agent: string;
  prompt: string;
  maxAttempts?: number;
}

export type AgentInvoker = (call: AgentInvocation) => Promise<any>;

export interface SdkInvokerConfig {
  /** The target project the agents operate on. NOT this repo. */
  cwd: string;
  model?: string;
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  maxTurns?: number;
  /** Called with each denied tool attempt — an agent reaching beyond its contract. */
  onToolDenied?: (agent: string, toolName: string) => void;
  log?: (message: string) => void;
}

/**
 * The Agent SDK ships ESM only ("type": "module", sdk.mjs — there is no CommonJS build). This
 * project is CommonJS, so a static import would compile to require() and fail at runtime with
 * ERR_REQUIRE_ESM. Under `module: node16` TypeScript preserves this dynamic import as a real
 * ESM import instead of downleveling it, which is what makes the interop work. Loaded lazily
 * and cached, so importing this module for its types (as the tests do) never spawns the SDK.
 */
type AgentSdk = typeof import('@anthropic-ai/claude-agent-sdk', { with: { 'resolution-mode': 'import' } });

let sdkPromise: Promise<AgentSdk> | undefined;

function loadSdk(): Promise<AgentSdk> {
  sdkPromise ??= import('@anthropic-ai/claude-agent-sdk');
  return sdkPromise;
}

export class AgentInvocationError extends Error {
  constructor(
    message: string,
    readonly agent: string,
    readonly stage: number,
    readonly detail: string[] = []
  ) {
    super(message);
    this.name = 'AgentInvocationError';
  }
}

const DEFAULTS = {
  model: 'claude-opus-4-8',
  effort: 'high' as const,
  maxTurns: 40
};

/** Appended to the agent's contract, tailored to whether the agent can write files. */
function outputContract(agent: FeatureFactoryAgent): string {
  const common = `
---

# Output contract (enforced)

Return your result as structured JSON matching the required schema. Put your findings in the
STRUCTURED FIELDS, not only in \`summary\` — the gates read the fields, and analysis that exists
only as prose is invisible to them and will fail the stage.

Set \`status\` honestly. If the task cannot proceed and needs a human, return "ESCALATE" and
explain why in \`summary\`; the harness stops the run and shows your reasoning. "PASS" means you
did the work.
`;

  if (isReadOnly(agent)) {
    return (
      common +
      `
You have NO Write tool — you cannot create files, by design. For each document you produce,
return its full text in \`artifacts[].content\` and the harness will write it to disk for you.
An artifact without content will not exist on disk, and the gate that reads it will block the
stage.
`
    );
  }

  return (
    common +
    `
You DO have Write and Edit. Every path in \`filesModified\` must be a file you actually wrote —
a gate checks each one against the filesystem and fails the build as a hallucination if it is
missing. Report test counts as the runner actually printed them; do not report 0 failures
unless you ran the suite and saw 0.
`
  );
}

/**
 * Build the production invoker. Agents run against `cwd` with exactly the tools their contract
 * grants and nothing loaded from the machine's Claude settings.
 */
export function createSdkInvoker(config: SdkInvokerConfig): AgentInvoker {
  const log = config.log ?? (() => {});

  return async function sdkInvoker(call: AgentInvocation): Promise<any> {
    const agent = call.agent as FeatureFactoryAgent;

    if (!(agent in AGENT_TOOLS)) {
      throw new AgentInvocationError(
        `Unknown agent "${call.agent}" — no tool grant is defined for it, so it cannot be run.`,
        call.agent,
        call.stage
      );
    }

    const stage = AGENT_STAGE[agent];
    const systemPrompt = loadAgentContract(agent) + outputContract(agent);
    const { query } = await loadSdk();

    let structuredOutput: unknown;
    let resultText = '';
    let failure: { subtype: string; errors: string[] } | null = null;

    for await (const message of query({
      prompt: call.prompt,
      options: {
        cwd: config.cwd,
        model: config.model ?? DEFAULTS.model,
        effort: config.effort ?? DEFAULTS.effort,
        maxTurns: config.maxTurns ?? DEFAULTS.maxTurns,
        systemPrompt,

        // The envelope is schema-forced; the SDK retries the model on a malformed response.
        outputFormat: { type: 'json_schema', schema: agentOutputSchema(agent) },

        // Exactly the tools this agent's contract grants; the mutating ones it lacks are
        // explicitly denied. 'dontAsk' never prompts and denies anything not pre-approved —
        // the only permission mode that is safe unattended.
        allowedTools: AGENT_TOOLS[agent],
        disallowedTools: deniedToolsFor(agent),
        permissionMode: 'dontAsk',

        // Load no CLAUDE.md, no user skills, no project settings. The agent's contract is its
        // only instruction source. Otherwise the same agent behaves differently depending on
        // whose machine it runs on, forfeiting the determinism the gates exist to provide.
        settingSources: []
      }
    })) {
      if (message.type !== 'result') continue;

      for (const denial of message.permission_denials) {
        log(`  ⚠️  ${agent} attempted denied tool: ${denial.tool_name}`);
        config.onToolDenied?.(agent, denial.tool_name);
      }

      if (message.subtype === 'success') {
        structuredOutput = message.structured_output;
        resultText = message.result;
        log(
          `  ${agent}: ${message.num_turns} turns, $${message.total_cost_usd.toFixed(4)}` +
            (isReadOnly(agent) ? ' (read-only)' : '')
        );
      } else {
        failure = { subtype: message.subtype, errors: message.errors };
      }
    }

    if (failure) {
      throw new AgentInvocationError(
        `Agent ${agent} failed (${failure.subtype}).`,
        agent,
        stage,
        failure.errors
      );
    }

    if (structuredOutput === undefined) {
      throw new AgentInvocationError(
        `Agent ${agent} returned no structured output.`,
        agent,
        stage,
        [resultText.slice(0, 500)]
      );
    }

    // Returned unjudged. The orchestrator validates it and owns the escalation.
    return structuredOutput;
  };
}
