/**
 * Invisible and direction-control characters in the run's documents (AC-107, D-12).
 *
 * An agent can return a document holding a right-to-left override or a zero-width character. The
 * harness stores it exactly as written (it never edits an agent's words) and reads it back after
 * every write: each affected document adds one IMPORTANT finding naming the document, the line and
 * the code point, so a human sees it before approving. The check reads what is on disk (C-3),
 * through every harness write path: the agents' own documents (persist, the pre-supplied spec, the
 * Consolidator) and the four documents the harness renders from agent output.
 *
 * At a checkpoint (AC-108 to AC-110, D-13) such a character is shown escaped under a warning banner,
 * and the approval binds to that escaped text; a run paused or approved before PR B-1 whose hash
 * was over the raw text is refused with a message naming the version change and --close.
 *
 * No test text here holds a raw set character: each is built from its code point.
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';

import { consolidateRun } from '../../feature/workflows/consolidate-run';
import { CHECKPOINTS } from '../../feature/workflows/feature-factory-orchestrator';
import { sha256Hex } from '../../harness/checkpoint-presentation';
import { directionCharacterPattern, DOCUMENT_CHECK_SOURCE, escapeCodePoint } from '../../harness/direction-characters';
import { documentFindings, writtenDocuments } from '../../harness/document-check';
import {
  renderApiContract,
  renderBackendSummary,
  renderFrontendSummary,
  renderTestReport
} from '../../harness/harness-documents';
import { RunRefusedError, shellArg } from '../../harness/run-lifecycle';
import { loadState, saveState, stateFilePath } from '../../harness/state-store';
import {
  createFeatureState,
  FeatureState,
  addImportantFindingsOnce,
  recordImportantFindings,
  recordImportantFindingsOnce
} from '../../harness/state-tracker';
import {
  backend,
  consolidator,
  featureSpec,
  frontend,
  spec,
  story
} from '../fixtures/agent-outputs';
import { fakeChangeTracker } from '../fixtures/changes';
import { decisions, passingScript, runToEnd, scriptedInvoker, tempProject, TempProject } from '../fixtures/harness-run';

const RUN_TIMEOUT_MS = 30_000;

const RLO = String.fromCodePoint(0x202e);
const ZWSP = String.fromCodePoint(0x200b);

let project: TempProject;

beforeEach(() => {
  project = tempProject('ff-direction-docs-');
});

afterEach(() => {
  project.cleanup();
});

/** A line that reads "The fee is 10 USD." but holds a right-to-left override. */
const planted = (text: string): string => `${text}\n\nThe fee is ${RLO}01 USD.`;

/** The finding the check must record for `name`, its one set character on `line`. */
const findingFor = (name: string, line: number): string =>
  `${name} contains invisible or direction-control characters (stored exactly as written): line ${line}: U+202E`;

/** The 1-based line holding the one planted character; fails if there is not exactly one. */
function plantedLine(text: string): number {
  const lines = text.split('\n');
  const holders = lines.map((line, index) => (line.includes(RLO) ? index + 1 : 0)).filter(Boolean);
  expect(holders).toHaveLength(1);
  expect(text.split(RLO)).toHaveLength(2);
  return holders[0];
}

const documentCheckFindings = (state: FeatureState) =>
  (state.importantFindings ?? []).filter(finding => finding.source === DOCUMENT_CHECK_SOURCE);

/** A brief that calls for UI, so the Frontend Builder runs and FRONTEND_SUMMARY.md is rendered. */
function uiScript(): Record<string, any> {
  return {
    ...passingScript(),
    '03-spec-writer': spec({ files: ['src/a.ts', 'src/components/TwoFactorForm.tsx'], ui: true }),
    '04-backend-builder': backend({ files: ['src/a.ts'] }),
    '05-frontend-builder': frontend({ files: ['src/components/TwoFactorForm.tsx'] })
  };
}

interface DocumentCase {
  name: string;
  /** Plant the character into the script, and return the bytes the document must hold on disk. */
  plant: (script: Record<string, any>) => () => string;
  /** The 08 pair is written by --consolidate, on the finished run. */
  viaConsolidate?: true;
}

/** An agent's own document: the artifact named `name` in the output of `agent`. */
function agentDocument(agent: string, name: string, viaConsolidate?: true): DocumentCase {
  return {
    name,
    ...(viaConsolidate ? { viaConsolidate } : {}),
    plant: script => {
      const artifact = script[agent].details.artifacts.find((a: { name: string }) => a.name === name);
      artifact.content = planted(artifact.content);
      const content: string = artifact.content;
      return () => content;
    }
  };
}

/** A harness-rendered document: `mutate` plants the character into the agent output it is rendered from. */
function renderedDocument(name: string, agent: string, mutate: (output: any) => void, render: (output: any) => string): DocumentCase {
  return {
    name,
    plant: script => {
      mutate(script[agent]);
      const output = structuredClone(script[agent]);
      return () => render(output);
    }
  };
}

const DOCUMENTS: DocumentCase[] = [
  agentDocument('01-researcher', 'RESEARCHER_REPORT.md'),
  agentDocument('02-story-writer', 'USER_STORY.md'),
  agentDocument('03-spec-writer', 'TECHNICAL_BRIEF.md'),
  agentDocument('03-spec-writer', 'FILE_LIST.md'),
  agentDocument('07-validator', 'VALIDATION_REPORT.md'),
  agentDocument('08-feature-consolidator', 'CONSOLIDATION_REPORT.md', true),
  agentDocument('08-feature-consolidator', 'PATTERNS.md', true),
  renderedDocument(
    'BACKEND_SUMMARY.md',
    '04-backend-builder',
    output => (output.details.summary = planted(output.details.summary)),
    renderBackendSummary
  ),
  renderedDocument(
    'API_CONTRACT.md',
    '04-backend-builder',
    output => (output.details.implementation.routes[0].description = `Enable 2FA for ${RLO}01 USD`),
    renderApiContract
  ),
  renderedDocument(
    'FRONTEND_SUMMARY.md',
    '05-frontend-builder',
    output => (output.details.summary = planted(output.details.summary)),
    renderFrontendSummary
  ),
  renderedDocument(
    'TEST_REPORT.md',
    '06-test-verifier',
    output => (output.details.summary = planted(output.details.summary)),
    renderTestReport
  )
];

describe('documentFindings', () => {
  it('AC-107 reads each written file back and returns one finding per affected document, none for a clean one', () => {
    const dir = project.dir;
    writeFileSync(join(dir, 'A.md'), `# A\n\nfine\nbad ${RLO} and ${ZWSP}\n`);
    writeFileSync(join(dir, 'B.md'), '# B\n\nclean\n');
    writeFileSync(join(dir, 'C.md'), `${ZWSP}# C\n`);

    expect(
      documentFindings([
        { name: 'A.md', path: join(dir, 'A.md') },
        { name: 'B.md', path: join(dir, 'B.md') },
        { name: 'C.md', path: join(dir, 'C.md') }
      ])
    ).toEqual([
      'A.md contains invisible or direction-control characters (stored exactly as written): line 4: U+202E, U+200B',
      'C.md contains invisible or direction-control characters (stored exactly as written): line 1: U+200B'
    ]);
    expect(documentFindings([])).toEqual([]);
  });

  it('AC-107 refuses a path that is not a regular file instead of reading it as clean', () => {
    const dir = project.dir;
    writeFileSync(join(dir, 'real.md'), `${RLO}\n`);
    symlinkSync(join(dir, 'real.md'), join(dir, 'LINK.md'));
    mkdirSync(join(dir, 'DIR.md'));

    expect(() => documentFindings([{ name: 'LINK.md', path: join(dir, 'LINK.md') }])).toThrow(/LINK\.md.*not a regular file/);
    expect(() => documentFindings([{ name: 'DIR.md', path: join(dir, 'DIR.md') }])).toThrow(/DIR\.md.*not a regular file/);
    expect(() => documentFindings([{ name: 'GONE.md', path: join(dir, 'GONE.md') }])).toThrow(/GONE\.md/);
  });

  it('AC-107 writtenDocuments names each written path by its file name and resolves it against the project', () => {
    expect(writtenDocuments('/p', ['.factory/r/USER_STORY.md', '/abs/.factory/r/TEST_REPORT.md'])).toEqual([
      { name: 'USER_STORY.md', path: resolve('/p', '.factory/r/USER_STORY.md') },
      { name: 'TEST_REPORT.md', path: '/abs/.factory/r/TEST_REPORT.md' }
    ]);
  });
});

describe('recordImportantFindingsOnce', () => {
  it('AC-107 skips a message already recorded with the same source, and a repeat within the list', () => {
    let state = createFeatureState('once');
    state = recordImportantFindings(state, 4, 'other-source', ['shared message']);
    state = recordImportantFindingsOnce(state, 2, DOCUMENT_CHECK_SOURCE, ['first', 'first', 'shared message']);
    state = recordImportantFindingsOnce(state, 3, DOCUMENT_CHECK_SOURCE, ['first', 'second']);

    expect((state.importantFindings ?? []).map(f => [f.stage, f.source, f.message])).toEqual([
      [4, 'other-source', 'shared message'],
      [2, DOCUMENT_CHECK_SOURCE, 'first'],
      [2, DOCUMENT_CHECK_SOURCE, 'shared message'],
      [3, DOCUMENT_CHECK_SOURCE, 'second']
    ]);
  });

  it('AC-107 changes nothing when every message is already recorded', () => {
    const state = recordImportantFindingsOnce(createFeatureState('once'), 2, DOCUMENT_CHECK_SOURCE, ['only']);
    const before = structuredClone(state.importantFindings);

    expect(recordImportantFindingsOnce(state, 4, DOCUMENT_CHECK_SOURCE, ['only']).importantFindings).toEqual(before);
    expect(recordImportantFindingsOnce(state, 4, DOCUMENT_CHECK_SOURCE, []).importantFindings).toEqual(before);
  });
});

describe('addImportantFindingsOnce', () => {
  it('AC-107 MINOR-3 records the findings once and reports exactly the messages it added, in order', () => {
    let state = recordImportantFindings(createFeatureState('once'), 4, 'other-source', ['shared message']);
    state = recordImportantFindingsOnce(state, 2, DOCUMENT_CHECK_SOURCE, ['known']);

    const { next, added } = addImportantFindingsOnce(state, 3, DOCUMENT_CHECK_SOURCE, ['known', 'new', 'new', 'shared message']);

    expect(added).toEqual(['new', 'shared message']);
    expect((next.importantFindings ?? []).map(f => [f.stage, f.source, f.message])).toEqual([
      [4, 'other-source', 'shared message'],
      [2, DOCUMENT_CHECK_SOURCE, 'known'],
      [3, DOCUMENT_CHECK_SOURCE, 'new'],
      [3, DOCUMENT_CHECK_SOURCE, 'shared message']
    ]);
  });

  it('AC-107 MINOR-3 reports nothing added, and changes nothing, when every message is already recorded', () => {
    const state = recordImportantFindingsOnce(createFeatureState('once'), 2, DOCUMENT_CHECK_SOURCE, ['only']);
    const before = structuredClone(state.importantFindings);

    const { next, added } = addImportantFindingsOnce(state, 4, DOCUMENT_CHECK_SOURCE, ['only']);
    expect(added).toEqual([]);
    expect(next.importantFindings).toEqual(before);
  });
});

describe('the document check on every harness write path', () => {
  it.each(DOCUMENTS.map(document => [document.name, document] as const))(
    'AC-107 %s containing U+202E is stored byte-identical and adds exactly one IMPORTANT finding naming the document, line and code point',
    async (name, document) => {
      const script = uiScript();
      const expected = document.plant(script);
      const invoker = scriptedInvoker(script, { cwd: project.dir });

      let state = await runToEnd({ cwd: project.dir, invoke: invoker.invoke });
      expect(state.completionStatus).toBe('SUCCESS');
      if (document.viaConsolidate) {
        const result = await consolidateRun({ cwd: project.dir, runId: state.featureId, invoke: invoker.invoke, logger: () => {} });
        expect(result.passed).toBe(true);
        state = result.state;
      }

      const onDisk = readFileSync(join(project.dir, '.factory', state.featureId, name), 'utf8');
      expect(onDisk).toBe(expected());

      const findings = documentCheckFindings(state);
      expect(findings.map(f => f.message)).toEqual([findingFor(name, plantedLine(onDisk))]);
      // What was returned is what is on disk: the record holds it too.
      expect(documentCheckFindings(loadState(project.dir, state.featureId)!)).toEqual(findings);
    },
    RUN_TIMEOUT_MS
  );

  it('AC-107 a clean document adds no finding', async () => {
    const invoker = scriptedInvoker(uiScript(), { cwd: project.dir });

    const state = await runToEnd({ cwd: project.dir, invoke: invoker.invoke });
    expect(state.completionStatus).toBe('SUCCESS');
    const consolidated = await consolidateRun({ cwd: project.dir, runId: state.featureId, invoke: invoker.invoke, logger: () => {} });

    expect(documentCheckFindings(state)).toEqual([]);
    expect(documentCheckFindings(consolidated.state)).toEqual([]);
  }, RUN_TIMEOUT_MS);

  it('AC-107 a resume that re-renders identical content adds no duplicate finding', async () => {
    const script = uiScript();
    script['04-backend-builder'].details.summary = planted(script['04-backend-builder'].details.summary);

    const paused = await runToEnd({
      cwd: project.dir,
      invoke: scriptedInvoker(script, { cwd: project.dir }).invoke,
      approveCheckpoint: decisions(true, true, { decision: 'PAUSE' }).approve
    });
    expect(paused.pendingCheckpoint?.checkpointId).toBe(3);
    const before = documentCheckFindings(paused);
    expect(before.map(f => f.message)).toEqual([expect.stringMatching(/^BACKEND_SUMMARY\.md contains/)]);

    // --approve of CP3 re-renders the harness documents from the same outputs.
    const resumed = await runToEnd({
      cwd: project.dir,
      invoke: scriptedInvoker(script, { cwd: project.dir }).invoke,
      resumeFromState: loadState(project.dir, paused.featureId)!,
      resume: { action: { kind: 'approve', checkpoint: 3 } }
    });

    expect(resumed.completionStatus).toBe('SUCCESS');
    expect(documentCheckFindings(resumed)).toEqual(before);
  }, RUN_TIMEOUT_MS);

  it('AC-107 a pre-supplied spec\'s documents are checked when the spec is accepted, at Stage 2', async () => {
    const supplied = featureSpec({ files: ['src/a.ts'] });
    const artifact = supplied.story.details.artifacts[0];
    artifact.content = planted(artifact.content as string);

    const state = await runToEnd({
      cwd: project.dir,
      invoke: scriptedInvoker(passingScript(), { cwd: project.dir }).invoke,
      approveCheckpoint: decisions({ decision: 'PAUSE' }).approve,
      preSuppliedSpec: supplied
    });

    const onDisk = readFileSync(join(project.dir, '.factory', state.featureId, 'USER_STORY.md'), 'utf8');
    expect(onDisk).toBe(artifact.content);
    expect(documentCheckFindings(state).map(f => [f.stage, f.message])).toEqual([
      [2, findingFor('USER_STORY.md', plantedLine(onDisk))]
    ]);
  }, RUN_TIMEOUT_MS);

  it('AC-107 a new version of a document with a different character adds a new finding and keeps the first', async () => {
    // CP1 is rejected; the resume re-runs the Story Writer, whose second version holds a different character.
    const script = uiScript();
    const versions = [`The fee is ${RLO}01 USD.`, `Zero${ZWSP}width.`];
    const base = story();
    script['02-story-writer'] = (_call: unknown, n: number) => {
      const output = structuredClone(base);
      output.details.artifacts[0].content = `${output.details.artifacts[0].content}\n\n${versions[Math.min(n, 2) - 1]}`;
      return output;
    };
    const invoker = scriptedInvoker(script, { cwd: project.dir });

    const rejected = await runToEnd({
      cwd: project.dir,
      invoke: invoker.invoke,
      approveCheckpoint: decisions({ decision: 'REJECT', notes: 'again' }).approve
    });
    expect(rejected.completionStatus).toBe('ESCALATED');

    const state = await runToEnd({
      cwd: project.dir,
      invoke: invoker.invoke,
      resumeFromState: loadState(project.dir, rejected.featureId)!,
      resume: { action: { kind: 'continue' } }
    });

    expect(invoker.agents().filter(agent => agent === '02-story-writer')).toHaveLength(2);
    expect(documentCheckFindings(state).map(f => f.message)).toEqual([
      expect.stringMatching(/^USER_STORY\.md contains .*U\+202E$/),
      expect.stringMatching(/^USER_STORY\.md contains .*U\+200B$/)
    ]);
  }, RUN_TIMEOUT_MS);
});

describe('the characters at a checkpoint (AC-108 to AC-110, D-13)', () => {
  /** The banner's first line for one occurrence (D-13). */
  const BANNER_ONE =
    'WARNING: this presentation contains 1 invisible or direction-control character(s). ' +
    'Each is shown below as \\u{XXXX}; the stored documents are unchanged.\n';
  const holdsSetCharacter = (text: string) => directionCharacterPattern().test(text);
  const runFile = (id: string, name: string) => readFileSync(join(project.dir, '.factory', id, name), 'utf8');
  const stateBytes = (id: string) => readFileSync(stateFilePath(project.dir, id), 'utf8');

  /** The refusal a run paused or approved before PR B-1 gets when its presentation now escapes a character (AC-110). */
  const versionChanged = (name: string, id: string) =>
    `${name}: the presentation changed in this version: invisible or direction-control characters are now shown ` +
    'escaped under a warning banner, so the hash recorded before this version no longer matches. ' +
    `Close the run: npm run factory -- --close ${id} --cwd ${shellArg(project.dir)}`;

  /** Plant U+202E into the artifact `name` of `agent` in `script`. */
  const plant = (script: Record<string, any>, agent: string, name: string) => {
    const artifact = script[agent].details.artifacts.find((a: { name: string }) => a.name === name);
    artifact.content = planted(artifact.content);
  };

  /** Resume `id` with `resume`, and return what was thrown. */
  async function refusalOf(id: string, resume: NonNullable<Parameters<typeof runToEnd>[0]['resume']>): Promise<unknown> {
    try {
      await runToEnd({
        cwd: project.dir,
        invoke: scriptedInvoker(passingScript(), { cwd: project.dir }).invoke,
        resumeFromState: loadState(project.dir, id)!,
        resume
      });
    } catch (error) {
      return error;
    }
    return undefined;
  }

  it.each<[number, string, string]>([
    [1, '02-story-writer', 'USER_STORY.md'],
    [2, '03-spec-writer', 'TECHNICAL_BRIEF.md'],
    [3, '07-validator', 'VALIDATION_REPORT.md']
  ])('AC-108 CHECKPOINT %i presents a document with U+202E escaped under the warning banner', async (id, agent, name) => {
    const script = passingScript();
    plant(script, agent, name);
    const approver = decisions();

    const state = await runToEnd({
      cwd: project.dir,
      invoke: scriptedInvoker(script, { cwd: project.dir }).invoke,
      approveCheckpoint: approver.approve
    });
    expect(state.completionStatus).toBe('SUCCESS');

    const request = approver.requests.find(r => r.id === id)!;
    const line = plantedLine(runFile(state.featureId, name));
    expect(request.text.startsWith(`${BANNER_ONE}- ${name}, line ${line}: U+202E\n\n---\n\n`)).toBe(true);
    expect(request.text).toContain(`The fee is ${escapeCodePoint(0x202e)}01 USD.`);
    expect(holdsSetCharacter(request.text)).toBe(false);
    expect(request.sha256).toBe(sha256Hex(request.text));
    // The approval binds to what was shown: the escaped text's hash.
    expect(state.checkpointApprovals.find(a => a.checkpointId === id)?.sha256).toBe(request.sha256);
    // Only the planted checkpoint carries a banner.
    for (const other of approver.requests.filter(r => r.id !== id)) expect(other.text.startsWith('WARNING:')).toBe(false);
  }, RUN_TIMEOUT_MS);

  it('AC-108 N-16 a CHECKPOINT 3 change holding U+202E is escaped and listed as the change, with no IMPORTANT finding', async () => {
    const approver = decisions();
    const changes = fakeChangeTracker({ text: `\`\`\`diff\n+const role = "user${RLO} admin";\n\`\`\`\n` });

    const state = await runToEnd({
      cwd: project.dir,
      invoke: scriptedInvoker(passingScript(), { cwd: project.dir }).invoke,
      approveCheckpoint: approver.approve,
      changes
    });

    const cp3 = approver.requests.find(r => r.id === 3)!;
    expect(cp3.text.startsWith(`${BANNER_ONE}- the change, line 2: U+202E\n\n---\n\n`)).toBe(true);
    expect(cp3.text.endsWith(`+const role = "user${escapeCodePoint(0x202e)} admin";\n\`\`\`\n`)).toBe(true);
    expect(holdsSetCharacter(cp3.text)).toBe(false);
    // Source files raise no finding: the banner is the warning (N-16).
    expect(state.importantFindings ?? []).toEqual([]);
  }, RUN_TIMEOUT_MS);

  it('AC-109 --approve of a paused checkpoint whose unchanged documents contain U+202E is not refused, and the I-7 re-check passes', async () => {
    const script = passingScript();
    plant(script, '02-story-writer', 'USER_STORY.md');
    plant(script, '03-spec-writer', 'TECHNICAL_BRIEF.md');
    plant(script, '07-validator', 'VALIDATION_REPORT.md');
    const changes = () => fakeChangeTracker({ text: `\`\`\`diff\n+const role = "user${RLO} admin";\n\`\`\`\n` });

    // CP1 and CP2 approved (each holding U+202E), paused at CP3.
    const pausing = decisions(true, true, { decision: 'PAUSE' });
    const paused = await runToEnd({
      cwd: project.dir,
      invoke: scriptedInvoker(script, { cwd: project.dir }).invoke,
      approveCheckpoint: pausing.approve,
      changes: changes()
    });
    expect(paused.pendingCheckpoint?.checkpointId).toBe(3);
    expect(pausing.requests.map(r => r.text.startsWith('WARNING:'))).toEqual([true, true, true]);

    // --approve 3 re-builds CP3 (AC-52) and re-checks the approved CP1 and CP2 (I-7): all unchanged.
    const resumed = await runToEnd({
      cwd: project.dir,
      invoke: scriptedInvoker(script, { cwd: project.dir }).invoke,
      resumeFromState: loadState(project.dir, paused.featureId)!,
      resume: { action: { kind: 'approve', checkpoint: 3 } },
      changes: changes()
    });

    expect(resumed.completionStatus).toBe('SUCCESS');
    expect(resumed.checkpointApprovals.find(a => a.checkpointId === 3)?.sha256).toBe(pausing.requests[2].sha256);
  }, RUN_TIMEOUT_MS);

  it.each<[string, (id: string) => Promise<void>]>([
    [
      'with no set character: the hash is unchanged and --approve works',
      async id => {
        // The pre-B-1 hash was taken over the raw text; with no character the text is the raw text.
        const paused = loadState(project.dir, id)!;
        expect(paused.pendingCheckpoint?.sha256).toBe(sha256Hex(runFile(id, 'USER_STORY.md')));

        const resumed = await runToEnd({
          cwd: project.dir,
          invoke: scriptedInvoker(passingScript(), { cwd: project.dir }).invoke,
          resumeFromState: paused,
          resume: { action: { kind: 'approve', checkpoint: 1 } }
        });
        expect(resumed.completionStatus).toBe('SUCCESS');
      }
    ],
    [
      'with one: --approve is refused ARTIFACT_CHANGED naming the version change and --close, state.json byte-identical',
      async id => {
        const recorded = loadState(project.dir, id)!;
        recorded.pendingCheckpoint!.sha256 = sha256Hex(runFile(id, 'USER_STORY.md')); // the hash before PR B-1
        saveState(project.dir, recorded);
        const before = stateBytes(id);

        const refusal = await refusalOf(id, { action: { kind: 'approve', checkpoint: 1 } });

        expect(refusal).toBeInstanceOf(RunRefusedError);
        expect(refusal).toMatchObject({ code: 'ARTIFACT_CHANGED', message: versionChanged(CHECKPOINTS.STORY.name, id) });
        expect(stateBytes(id)).toBe(before);
      }
    ],
    [
      'with one, and the document edited since: the refusal keeps the artifact-changed message',
      async id => {
        const recorded = loadState(project.dir, id)!;
        recorded.pendingCheckpoint!.sha256 = sha256Hex(runFile(id, 'USER_STORY.md'));
        saveState(project.dir, recorded);
        writeFileSync(join(project.dir, '.factory', id, 'USER_STORY.md'), `${runFile(id, 'USER_STORY.md')}\nEdited.\n`);
        const before = stateBytes(id);

        const refusal = await refusalOf(id, { action: { kind: 'approve', checkpoint: 1 } });

        expect(refusal).toMatchObject({ code: 'ARTIFACT_CHANGED' });
        expect((refusal as Error).message).toContain('artifact changed since it was presented (its hash differs)');
        expect((refusal as Error).message).not.toContain('in this version');
        expect(stateBytes(id)).toBe(before);
      }
    ]
  ])('AC-110 a run paused before B-1 %s', async (label, verify) => {
    const script = passingScript();
    if (!label.startsWith('with no')) plant(script, '02-story-writer', 'USER_STORY.md');
    const paused = await runToEnd({
      cwd: project.dir,
      invoke: scriptedInvoker(script, { cwd: project.dir }).invoke,
      approveCheckpoint: decisions({ decision: 'PAUSE' }).approve
    });
    expect(paused.pendingCheckpoint?.checkpointId).toBe(1);

    await verify(paused.featureId);
  }, RUN_TIMEOUT_MS);

  it('AC-110 a run paused before B-1 whose approved CHECKPOINT 1 holds one is refused APPROVED_ARTIFACT_CHANGED on resume, with the same message', async () => {
    const script = passingScript();
    plant(script, '02-story-writer', 'USER_STORY.md');
    const paused = await runToEnd({
      cwd: project.dir,
      invoke: scriptedInvoker(script, { cwd: project.dir }).invoke,
      approveCheckpoint: decisions(true, { decision: 'PAUSE' }).approve
    });
    const id = paused.featureId;
    expect(paused.pendingCheckpoint?.checkpointId).toBe(2);

    const recorded = loadState(project.dir, id)!;
    recorded.checkpointApprovals.find(a => a.checkpointId === 1)!.sha256 = sha256Hex(runFile(id, 'USER_STORY.md'));
    saveState(project.dir, recorded);
    const before = stateBytes(id);

    const refusal = await refusalOf(id, { action: { kind: 'approve', checkpoint: 2 } });

    expect(refusal).toBeInstanceOf(RunRefusedError);
    expect(refusal).toMatchObject({ code: 'APPROVED_ARTIFACT_CHANGED', message: versionChanged(CHECKPOINTS.STORY.name, id) });
    expect(stateBytes(id)).toBe(before);
  }, RUN_TIMEOUT_MS);
});
