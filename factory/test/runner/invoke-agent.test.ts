/**
 * createSdkInvoker, against a fake Agent SDK (PR B-2, D-4).
 *
 * The SDK module is replaced with a fake `query` that records the options it was called with and
 * returns one successful result, so nothing here spawns Claude Code or spends a token. The first
 * assertion of every test checks the fake is the module the invoker loads: if the mock ever stopped
 * applying, the test fails before the real SDK could run.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';

import { createSdkInvoker } from '../../runner/invoke-agent';
import { REQUIRED_ARTIFACTS, REVIEW_DOCUMENTS } from '../../runner/agent-registry';

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
