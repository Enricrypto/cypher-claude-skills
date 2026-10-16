/**
 * createSdkInvoker, against a fake Agent SDK (PR B-2, D-4).
 *
 * The SDK module is replaced with a fake `query` that records the options it was called with and
 * returns one successful result, so nothing here spawns Claude Code or spends a token. The first
 * assertion of every test checks the fake is the module the invoker loads: if the mock ever stopped
 * applying, the test fails before the real SDK could run.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';

import { createSdkInvoker, MAX_OUTPUT_TOKENS_VALUE, MAX_OUTPUT_TOKENS_VAR } from '../../runner/invoke-agent';
import { AGENT_COST, REQUIRED_ARTIFACTS, REVIEW_DOCUMENTS } from '../../runner/agent-registry';

type QueryCall = { prompt: string; options: Record<string, unknown> };

const mockQueryCalls: QueryCall[] = [];

function mockQuery(call: QueryCall): AsyncIterable<unknown> {
  mockQueryCalls.push(call);
  return (async function* () {
    yield {
      type: 'result',
      subtype: 'success',
      permission_denials: [],
      structured_output: { status: 'PASS' },
      result: '',
      num_turns: 1,
      total_cost_usd: 0
    };
  })();
}

jest.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: mockQuery }));

async function assertFakeSdk(): Promise<void> {
  const sdk = await import('@anthropic-ai/claude-agent-sdk');
  expect(sdk.query).toBe(mockQuery);
}

beforeEach(() => {
  mockQueryCalls.length = 0;
});

describe('createSdkInvoker per-call working directory (D-4)', () => {
  it('AC-117 AC-118 AC-132 createSdkInvoker runs the agent in call.cwd when the call gives one', async () => {
    await assertFakeSdk();
    const invoke = createSdkInvoker({ cwd: '/project' });

    await invoke({ stage: 4, agent: '07-validator', prompt: 'review', cwd: '/tmp/factory-review-copy' });

    expect(mockQueryCalls).toHaveLength(1);
    expect(mockQueryCalls[0].options.cwd).toBe('/tmp/factory-review-copy');
  });

  it('AC-118 AC-132 createSdkInvoker runs the agent in config.cwd when the call gives none', async () => {
    await assertFakeSdk();
    const invoke = createSdkInvoker({ cwd: '/project' });

    await invoke({ stage: 4, agent: '06-test-verifier', prompt: 'test' });

    expect(mockQueryCalls).toHaveLength(1);
    expect(mockQueryCalls[0].options.cwd).toBe('/project');
  });
});

describe('outputContract for the review documents (PR B-2, step-1 OPEN)', () => {
  async function systemPromptOf(agent: string): Promise<string> {
    await assertFakeSdk();
    await createSdkInvoker({ cwd: '/project' })({ stage: 4, agent, prompt: 'p' });
    return mockQueryCalls[mockQueryCalls.length - 1].options.systemPrompt as string;
  }

  it.each(['07b-validator-followup', '07c-validator-skeptic'] as const)(
    'AC-127 the %s output contract names its document exactly and does not claim a gate looks it up',
    async agent => {
      const systemPrompt = await systemPromptOf(agent);
      const [name] = REQUIRED_ARTIFACTS[agent];

      expect(REVIEW_DOCUMENTS).toContain(name);
      expect(systemPrompt).toContain(`You MUST return exactly these documents, named EXACTLY as written: ${name}.`);
      expect(systemPrompt).not.toContain('A gate looks each one up by that exact name');
      expect(systemPrompt).toContain('No gate reads it');
    }
  );

  it.each(['01-researcher', '07-validator', '08-feature-consolidator'] as const)(
    'the %s output contract still says a gate looks each document up by its exact name',
    async agent => {
      const systemPrompt = await systemPromptOf(agent);

      expect(systemPrompt).toContain('A gate looks each one up by that exact name');
      expect(systemPrompt).not.toContain('No gate reads it');
    }
  );
});

/**
 * R2 / AC-004, AC-005: the reply ceiling.
 *
 * `options.env` REPLACES the subprocess environment entirely (sdk.d.ts:1395-1413) — it does not
 * merge. Passing only the new variable would strip PATH, HOME and the SDK's subscription
 * credentials and break EVERY agent invocation: the exact opposite of a reliability fix. The
 * spread-comes-first guard below is the single highest-consequence assertion in this PR (R2-1).
 */
describe('createSdkInvoker output-token ceiling (R2)', () => {
  /** The options of the one recorded query call. */
  async function optionsOf(): Promise<Record<string, unknown>> {
    const invoke = createSdkInvoker({ cwd: '/project' });
    await invoke({ stage: 3, agent: '04-backend-builder', prompt: 'build' });
    expect(mockQueryCalls).toHaveLength(1);
    return mockQueryCalls[0].options;
  }

  it('AC-004 every invocation carries CLAUDE_CODE_MAX_OUTPUT_TOKENS=64000', async () => {
    await assertFakeSdk();

    const env = (await optionsOf()).env as Record<string, string>;

    expect(env[MAX_OUTPUT_TOKENS_VAR]).toBe(MAX_OUTPUT_TOKENS_VALUE);
    expect(MAX_OUTPUT_TOKENS_VAR).toBe('CLAUDE_CODE_MAX_OUTPUT_TOKENS');
    expect(MAX_OUTPUT_TOKENS_VALUE).toBe('64000');
  });

  it('AC-004 R2-1 the inherited environment SURVIVES: an inherited sentinel and PATH are both still there', async () => {
    await assertFakeSdk();
    process.env.FF_R2_SENTINEL = 'inherited-value';
    try {
      const env = (await optionsOf()).env as Record<string, string>;

      // If the spread were missing (or came last), these would be gone and every agent would
      // lose its credentials, its PATH and its HOME.
      expect(env.FF_R2_SENTINEL).toBe('inherited-value');
      expect(env.PATH).toBe(process.env.PATH);
      expect(env[MAX_OUTPUT_TOKENS_VAR]).toBe(MAX_OUTPUT_TOKENS_VALUE);
    } finally {
      delete process.env.FF_R2_SENTINEL;
    }
  });

  it("AC-004 the factory's 64000 wins over a value already set in the operator's shell", async () => {
    await assertFakeSdk();
    const saved = process.env[MAX_OUTPUT_TOKENS_VAR];
    process.env[MAX_OUTPUT_TOKENS_VAR] = '8000';
    try {
      const env = (await optionsOf()).env as Record<string, string>;

      // The spread comes FIRST, so the factory's value overwrites the inherited one, never the
      // other way round (the story's own assumption).
      expect(env[MAX_OUTPUT_TOKENS_VAR]).toBe('64000');
    } finally {
      if (saved === undefined) delete process.env[MAX_OUTPUT_TOKENS_VAR];
      else process.env[MAX_OUTPUT_TOKENS_VAR] = saved;
    }
  });

  it('AC-005 the option key set is exactly what it was plus `env`, every other option is byte-identical, and the result is unchanged', async () => {
    await assertFakeSdk();
    const invoke = createSdkInvoker({ cwd: '/project' });

    const result = await invoke({ stage: 3, agent: '04-backend-builder', prompt: 'build' });

    // A reply that already fitted under the old default behaves exactly as before.
    expect(result).toEqual({ status: 'PASS' });

    const options = mockQueryCalls[0].options;
    expect(Object.keys(options).sort()).toEqual(
      [
        'allowedTools',
        'cwd',
        'disallowedTools',
        'effort',
        'env',
        'maxTurns',
        'model',
        'outputFormat',
        'permissionMode',
        'settingSources',
        'systemPrompt'
      ]
    );
    // Every option that existed before R2 is untouched: the ceiling only adds `env`.
    expect(options.cwd).toBe('/project');
    expect(options.permissionMode).toBe('dontAsk');
    expect(options.settingSources).toEqual([]);
    expect(options.maxTurns).toBe(AGENT_COST['04-backend-builder'].maxTurns);
    expect(options.model).toBe(AGENT_COST['04-backend-builder'].model);
    expect(options.effort).toBe(AGENT_COST['04-backend-builder'].effort);
  });
});
