/**
 * Which failed invocations are worth re-invoking (PR R-1, R3 / AC-006, AC-007).
 *
 * A dropped connection stopped runs that had nothing wrong with them. One automatic retry of the
 * same invocation, after a 30-second wait, fixes that. Deciding WHICH failures earn the retry is
 * this module's whole job; `timedInvoke` in the orchestrator does the retrying.
 *
 * ITS OWN MODULE, DELIBERATELY. `factory/harness/error-categories.ts` classifies BUILD and TEST
 * failures and its header forbids absorbing another taxonomy: `analyzeError` is first-match-wins,
 * so pouring two tables together lets a generic pattern in one shadow a specific pattern in the
 * other. API/transport failures are a third taxonomy and live here (P7).
 *
 * AN ALLOW-LIST, NOT AN EXCLUSION LIST (R3-2). Only the signatures AC-006 names are transient.
 * Anything unrecognised is `unknown` and escalates exactly as it does today. The alternative —
 * retry unless proven fatal — would silently double the cost and the wall-clock of every real
 * failure, which is a worse bug than the one R3 fixes.
 *
 * NEVER-RETRY IS MATCHED FIRST, then transient, then the no-other-signal case, then `unknown`.
 * The order is load-bearing: a max-turns failure whose text happens to mention a dropped
 * connection would reproduce identically on a retry, so the fatal classification has to win. A
 * test pins the order. The one exception is R10's bare "exited with code 1", which is matched
 * LAST and only when nothing else did — see `EXITED_WITH_CODE_1` below.
 *
 * THREE CARRIERS, because the signature hides in a different place depending on how the failure
 * arrived:
 *   1. `Error.message` — how `invoke-agent.ts` reports the SDK's failure subtype and its own
 *      "returned no structured output";
 *   2. `AgentInvocationError.detail[]` — which holds the SDK's `failure.errors`;
 *   3. the `code` / `status` / `statusCode` property ON THE OBJECT — a raw transport error arrives
 *      as a plain `Error` whose code (`ECONNRESET`) or HTTP status (`529`) is a property, not
 *      text in the message.
 *
 * STATUS PATTERNS ARE ANCHORED and must never match a bare integer. A token count, a cost, a line
 * number, a duration or a test count would otherwise read as a 5xx and trigger a pointless retry;
 * a dedicated test holds that line.
 */

/**
 * How long to wait before the single retry (AC-006). A module constant, not a flag, an env var or
 * a state field: the bound is one and the wait is 30 seconds, and neither is configurable.
 * Injected into tests through `OrchestrationOptions.waitBeforeRetry` so no test ever sleeps
 * (R3-1; `barriers.ts` — "never a sleep").
 */
export const TRANSIENT_RETRY_WAIT_MS = 30_000;

/**
 * What to do with a failed invocation:
 *   - `transient`  — wait and re-invoke once (AC-006);
 *   - `never-retry` — would reproduce identically; escalate now (AC-007);
 *   - `unknown`    — unrecognised; escalate exactly as before R-1.
 * `signal` is the matched signature, recorded on the failed attempt's `agentInvocations` entry.
 */
export type InvocationErrorVerdict =
  | { kind: 'transient'; signal: string }
  | { kind: 'never-retry'; signal: string }
  | { kind: 'unknown' };

interface Signature {
  signal: string;
  pattern: RegExp;
}

/**
 * An HTTP status only where something nearby says it IS a status. Two shapes are accepted:
 *   - a status-ish key before the number: `HTTP 429`, `status 503`, `status code: 500`,
 *     `statusCode=502`, `"status":529`;
 *   - a known reason phrase after it: `429 Too Many Requests`, `503 Service Unavailable`.
 * A bare `500` on its own matches NEITHER, which is the point (R3-2).
 */
function statusPattern(digits: string): RegExp {
  const key = String.raw`(?:https?|status(?:[\s_-]*code)?|statuscode)`;
  const reason = String.raw`(?:too\s+many\s+requests|service\s+unavailable|bad\s+gateway|gateway\s+time-?out|internal\s+server\s+error|overloaded|server\s+error)`;
  return new RegExp(
    // "HTTP 429", "status code: 503" — at most a little punctuation in between, never a whole clause.
    String.raw`\b${key}\b\W{0,3}(?:${digits})\b` +
      '|' +
      // "429 Too Many Requests"
      String.raw`\b(?:${digits})\s+${reason}\b`,
    'i'
  );
}

/** Any 5xx that is not 529 (which has its own signal), as a status-anchored alternation. */
const OTHER_5XX = '5(?!29)\\d\\d';

/**
 * Matched FIRST (AC-007). Each of these would fail the same way on a retry, so retrying one only
 * doubles the cost of reaching the same escalation.
 */
const NEVER_RETRY: readonly Signature[] = [
  // The SDK's own terminal subtypes, as invoke-agent.ts embeds them in the message.
  { signal: 'ERROR_MAX_TURNS', pattern: /error_max_turns/i },
  { signal: 'ERROR_MAX_STRUCTURED_OUTPUT_RETRIES', pattern: /error_max_structured_output_retries/i },
  // The assistant-side output-token limit (sdk.d.ts:2822).
  { signal: 'MAX_OUTPUT_TOKENS', pattern: /max_output_tokens/i },
  // invoke-agent.ts:253-260 — the schema-shaped failure.
  { signal: 'NO_STRUCTURED_OUTPUT', pattern: /returned no structured output/i }
];

/**
 * SCOPE-2: R10's case, and the ONLY signature matched AFTER the transient table rather than
 * before it. The brief scopes this entry to R10's "exited with code 1 WITH NO MESSAGE" — a
 * subprocess that died without saying why. In `NEVER_RETRY` it would be matched FIRST, and
 * `/exited with code 1\b/` matches any carrier containing the phrase, so a crashed SDK subprocess
 * that ALSO reported "Connection closed", a 429/529/5xx or an `ECONNRESET` — a very plausible
 * pairing — would be classified fatal and never retried. That is precisely the first-match-wins
 * shadowing P7 and brief §4 warn about, pointed at R3's own purpose. Checked here, it classifies
 * `never-retry` only when the error carries no other signal, which is what the brief asked for.
 * Its operator-facing message belongs to PR R-3 and is not touched.
 */
const EXITED_WITH_CODE_1: Signature = { signal: 'EXITED_WITH_CODE_1', pattern: /exited with code 1\b/i };

/** Matched SECOND (AC-006): exactly the signatures the story lists, and nothing else. */
const TRANSIENT: readonly Signature[] = [
  { signal: 'CONNECTION_CLOSED', pattern: /connection closed/i },
  { signal: 'HTTP_429', pattern: new RegExp(`${statusPattern('429').source}|rate_limit_error`, 'i') },
  { signal: 'HTTP_529', pattern: new RegExp(`${statusPattern('529').source}|overloaded_error`, 'i') },
  { signal: 'HTTP_5XX', pattern: statusPattern(OTHER_5XX) },
  // Socket resets. Upper case and word-bounded: these are error codes, not prose.
  { signal: 'ECONNRESET', pattern: /\bECONNRESET\b/ },
  { signal: 'EPIPE', pattern: /\bEPIPE\b/ }
];

/**
 * Everything about `error` a signature may be matched against, as one string per carrier. The
 * carriers are kept separate rather than concatenated so a pattern can never match across the
 * join between two of them.
 */
function carriers(error: unknown): string[] {
  const texts: string[] = [];

  if (typeof error === 'string') texts.push(error);

  if (error instanceof Error) {
    texts.push(error.message);
  } else if (typeof error === 'object' && error !== null && typeof (error as { message?: unknown }).message === 'string') {
    texts.push((error as { message: string }).message);
  }

  if (typeof error === 'object' && error !== null) {
    const held = error as { detail?: unknown; code?: unknown; status?: unknown; statusCode?: unknown };

    // AgentInvocationError.detail[]: the SDK's failure.errors.
    if (Array.isArray(held.detail)) {
      for (const entry of held.detail) if (typeof entry === 'string') texts.push(entry);
    }

    // The code or status ON THE OBJECT. A numeric status is given a status-like context so the
    // same anchored patterns apply to it: `429` as a property is unambiguously a status.
    for (const value of [held.code, held.status, held.statusCode]) {
      if (typeof value === 'string') texts.push(value);
      else if (typeof value === 'number' && Number.isInteger(value)) texts.push(`status ${value}`);
    }
  }

  return texts.filter(text => text.length > 0);
}

/** The first signature in `table` that any carrier matches. */
function firstMatch(table: readonly Signature[], texts: readonly string[]): Signature | undefined {
  return table.find(signature => texts.some(text => signature.pattern.test(text)));
}

/**
 * Classify a thrown invocation (AC-006, AC-007). Never throws and never guesses: an error it does
 * not recognise is `unknown`, which the orchestrator treats exactly as it treated every failure
 * before R-1.
 */
export function classifyInvocationError(error: unknown): InvocationErrorVerdict {
  const texts = carriers(error);
  if (texts.length === 0) return { kind: 'unknown' };

  // Never-retry FIRST (R3-2): a fatal failure that happens to mention a transient one is fatal.
  const fatal = firstMatch(NEVER_RETRY, texts);
  if (fatal) return { kind: 'never-retry', signal: fatal.signal };

  const transient = firstMatch(TRANSIENT, texts);
  if (transient) return { kind: 'transient', signal: transient.signal };

  // LAST, and only when no other signal matched: a bare "exited with code 1" (see above).
  if (firstMatch([EXITED_WITH_CODE_1], texts)) return { kind: 'never-retry', signal: EXITED_WITH_CODE_1.signal };

  return { kind: 'unknown' };
}
