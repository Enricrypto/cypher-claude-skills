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

/**
 * JSON Schema for the output envelope, handed to the SDK so the shape is guaranteed and the
 * SDK retries the model itself on a malformed response. This is why the orchestrator never
 * has to parse JSON out of prose.
 *
 * `details` is deliberately open: each agent adds its own stage-specific fields there, and
 * enforcing THOSE is the harness's job. This schema guarantees well-formed JSON;
 * validateOutputSchema decides whether it is acceptable work.
 */
export function envelopeSchema(stage: number, agent: string): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      stage: { type: 'integer', const: stage },
      agent: { type: 'string', const: agent },
      timestamp: { type: 'string' },
      status: { type: 'string', enum: ['PASS', 'FAIL', 'LOOP_BACK', 'ESCALATE'] },
      details: {
        type: 'object',
        properties: {
          summary: { type: 'string' },
          artifacts: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                path: { type: 'string' },
                description: { type: 'string' }
              },
              required: ['name', 'path', 'description']
            }
          }
        },
        required: ['summary', 'artifacts'],
        additionalProperties: true
      }
    },
    required: ['stage', 'agent', 'timestamp', 'status', 'details'],
    additionalProperties: true
  };
}

/** Appended to the agent's contract. States the honesty rule the materialization gate enforces. */
const OUTPUT_CONTRACT = `
---

# Output contract (enforced)

Return your result as structured JSON matching the required schema. Beyond the envelope,
\`details\` must carry the stage-specific fields your role's contract describes above.

\`details.artifacts\` must list every file you actually created or modified, with a real path.
Do not list a file you did not write. A later gate checks each path against the filesystem,
and a claimed-but-absent file fails the build as a hallucination — an honest short list always
beats an optimistic long one.

If you cannot complete the task, still return the envelope with status "FAIL" or "ESCALATE"
and explain why in \`summary\`.
`;

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
    const systemPrompt = loadAgentContract(agent) + OUTPUT_CONTRACT;
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
        outputFormat: { type: 'json_schema', schema: envelopeSchema(stage, agent) },

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
