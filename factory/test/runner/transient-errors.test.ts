/**
 * R3 / AC-006, AC-007: classifying a failed invocation.
 *
 * An ALLOW-LIST, not an exclusion list (R3-2). Only the signatures AC-006 names are retried;
 * everything else escalates exactly as it does today, because a retry-by-default would silently
 * double the cost of every real failure.
 *
 * NEVER-RETRY IS MATCHED FIRST. The order is the thing that keeps the allow-list honest over
 * time: a max-turns failure whose text happens to mention a dropped connection must not be
 * retried, because it would reproduce identically.
 */

import { describe, it, expect } from '@jest/globals';

import { AgentInvocationError } from '../../runner/invoke-agent';
import { classifyInvocationError, TRANSIENT_RETRY_WAIT_MS } from '../../runner/transient-errors';

/** The three carriers an error can hide its signature in. */
const asMessage = (text: string) => new Error(text);
/** How invoke-agent.ts really wraps an SDK failure: the subtype in the message, `failure.errors` in `detail`. */
const asDetail = (text: string) => new AgentInvocationError('Agent 04-backend-builder failed (error_during_execution).', '04-backend-builder', 3, [text]);
/** A raw transport error: a plain Error with the code on the OBJECT, not in the message. */
const asCode = (code: string | number) => Object.assign(new Error('socket hang up'), { code });

describe('TRANSIENT_RETRY_WAIT_MS', () => {
  it('AC-006 the wait is 30 seconds', () => {
    expect(TRANSIENT_RETRY_WAIT_MS).toBe(30_000);
  });
});

describe('classifyInvocationError: transient signatures (AC-006)', () => {
  const transient: Array<[string, string]> = [
    ['Connection closed', 'CONNECTION_CLOSED'],
    ['Connection closed by the remote host', 'CONNECTION_CLOSED'],
    ['HTTP 429', 'HTTP_429'],
    ['429 Too Many Requests', 'HTTP_429'],
    ['status code 429', 'HTTP_429'],
    ['HTTP 529', 'HTTP_529'],
    ['529 Overloaded', 'HTTP_529'],
    ['HTTP 500', 'HTTP_5XX'],
    ['500 Internal Server Error', 'HTTP_5XX'],
    ['status code 502', 'HTTP_5XX'],
    ['503 Service Unavailable', 'HTTP_5XX'],
    ['ECONNRESET', 'ECONNRESET'],
    ['EPIPE', 'EPIPE']
  ];

  it.each(transient)('AC-006 %s classifies transient from Error.message', (text, signal) => {
    expect(classifyInvocationError(asMessage(text))).toEqual({ kind: 'transient', signal });
  });

  it.each(transient)('AC-006 %s classifies transient from AgentInvocationError.detail[]', (text, signal) => {
    expect(classifyInvocationError(asDetail(text))).toEqual({ kind: 'transient', signal });
  });

  it.each([
    ['ECONNRESET', 'ECONNRESET'],
    ['EPIPE', 'EPIPE'],
    [429, 'HTTP_429'],
    [529, 'HTTP_529'],
    [503, 'HTTP_5XX']
  ] as Array<[string | number, string]>)('AC-006 a code of %s on the error object classifies transient', (code, signal) => {
    expect(classifyInvocationError(asCode(code))).toEqual({ kind: 'transient', signal });
  });

  it('AC-006 the SDK\'s named API error types are transient', () => {
    expect(classifyInvocationError(asMessage('{"type":"error","error":{"type":"overloaded_error"}}'))).toEqual({ kind: 'transient', signal: 'HTTP_529' });
    expect(classifyInvocationError(asMessage('{"type":"error","error":{"type":"rate_limit_error"}}'))).toEqual({ kind: 'transient', signal: 'HTTP_429' });
  });
});

describe('classifyInvocationError: never-retry signatures (AC-007)', () => {
  it('AC-007 a max-turns failure is never retried', () => {
    const real = new AgentInvocationError('Agent 04-backend-builder failed (error_max_turns).', '04-backend-builder', 3, []);
    expect(classifyInvocationError(real)).toEqual({ kind: 'never-retry', signal: 'ERROR_MAX_TURNS' });
  });

  it('AC-007 a structured-output-retries failure is never retried', () => {
    const real = new AgentInvocationError('Agent 07-validator failed (error_max_structured_output_retries).', '07-validator', 4, []);
    expect(classifyInvocationError(real)).toEqual({ kind: 'never-retry', signal: 'ERROR_MAX_STRUCTURED_OUTPUT_RETRIES' });
  });

  it('AC-007 an output-token-limit failure is never retried', () => {
    const real = new AgentInvocationError('Agent 04-backend-builder failed (error_during_execution).', '04-backend-builder', 3, [
      'Claude\'s response exceeded the max_output_tokens limit'
    ]);
    expect(classifyInvocationError(real)).toEqual({ kind: 'never-retry', signal: 'MAX_OUTPUT_TOKENS' });
  });

  it('AC-007 a schema failure ("returned no structured output") is never retried', () => {
    // Exactly how invoke-agent.ts:253-260 builds it.
    const real = new AgentInvocationError('Agent 03-spec-writer returned no structured output.', '03-spec-writer', 2, ['']);
    expect(classifyInvocationError(real)).toEqual({ kind: 'never-retry', signal: 'NO_STRUCTURED_OUTPUT' });
  });

  it("SCOPE-2 R10's \"exited with code 1\" WITH NO OTHER SIGNAL is NOT transient here (its message belongs to PR R-3)", () => {
    const verdict = classifyInvocationError(asMessage('Claude Code process exited with code 1'));
    expect(verdict.kind).not.toBe('transient');
    expect(verdict).toEqual({ kind: 'never-retry', signal: 'EXITED_WITH_CODE_1' });
  });

  it.each([
    ['Connection closed', 'CONNECTION_CLOSED'],
    ['HTTP 429', 'HTTP_429'],
    ['HTTP 529', 'HTTP_529'],
    ['503 Service Unavailable', 'HTTP_5XX'],
    ['ECONNRESET', 'ECONNRESET'],
    ['EPIPE', 'EPIPE']
  ])(
    'AC-006 SCOPE-2 "exited with code 1" that ALSO carries %s classifies TRANSIENT: the bare-exit entry must never shadow a real transient signal',
    (text, signal) => {
      // A crashed SDK subprocess is a very plausible carrier of BOTH — the dropped connection is
      // WHY it died. The brief scopes the never-retry entry to "exited with code 1 with no
      // message", so this must be retried; matching the bare phrase first would suppress exactly
      // the retries R3 exists to make.
      expect(classifyInvocationError(asMessage(`Claude Code process exited with code 1: ${text}`))).toEqual({ kind: 'transient', signal });
      // And from the OTHER carrier: the phrase in the message, the transient signal in `detail[]`.
      const split = new AgentInvocationError('Claude Code process exited with code 1', '04-backend-builder', 3, [text]);
      expect(classifyInvocationError(split)).toEqual({ kind: 'transient', signal });
    }
  );

  it('AC-007 SCOPE-2 "exited with code 1" alongside a NEVER-RETRY signal still classifies never-retry, by that signal', () => {
    // The bare-exit entry is matched after the transient table, not after the never-retry one:
    // max-turns still wins, and the signal recorded is the specific one.
    const both = new AgentInvocationError('Claude Code process exited with code 1', '04-backend-builder', 3, [
      'Agent 04-backend-builder failed (error_max_turns).'
    ]);
    expect(classifyInvocationError(both)).toEqual({ kind: 'never-retry', signal: 'ERROR_MAX_TURNS' });
  });

  it('AC-007 R3-2 an error matching BOTH tables resolves never-retry: the order is what makes the allow-list safe', () => {
    // A max-turns failure that also mentions a dropped connection. Retrying it would burn a
    // second full invocation on a failure that reproduces identically.
    const both = new AgentInvocationError('Agent 04-backend-builder failed (error_max_turns).', '04-backend-builder', 3, [
      'Connection closed'
    ]);
    expect(classifyInvocationError(both)).toEqual({ kind: 'never-retry', signal: 'ERROR_MAX_TURNS' });
  });
});

describe('classifyInvocationError: unknown (AC-007)', () => {
  it('AC-007 an unrecognised failure is unknown, so it escalates exactly as it does today', () => {
    expect(classifyInvocationError(asMessage('Agent 04-backend-builder failed (error_during_execution).'))).toEqual({ kind: 'unknown' });
  });

  it.each([
    ['a token count', 'the agent used 500 tokens and 429 cache reads'],
    ['a cost', 'total cost $529.00'],
    ['a line number', 'TypeError at src/a.ts line 500, column 429'],
    ['a duration', 'the invocation took 529ms (500 of them queued)'],
    ['a test count', '500 passing, 429 pending'],
    ['a byte count', 'wrote 503 bytes']
  ])('R3-2 a bare number that is %s classifies unknown, never a 5xx', (_what, text) => {
    expect(classifyInvocationError(asMessage(text))).toEqual({ kind: 'unknown' });
  });

  it('AC-007 a non-Error value is unknown and never throws', () => {
    expect(classifyInvocationError(undefined)).toEqual({ kind: 'unknown' });
    expect(classifyInvocationError(null)).toEqual({ kind: 'unknown' });
    expect(classifyInvocationError('Connection closed')).toEqual({ kind: 'transient', signal: 'CONNECTION_CLOSED' });
    expect(classifyInvocationError({ nothing: true })).toEqual({ kind: 'unknown' });
  });
});
