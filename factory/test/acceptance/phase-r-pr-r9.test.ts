/**
 * ACCEPTANCE TESTS — Phase R, PR R-9 (R9, the Ponytail rules).
 *
 * One test per acceptance criterion of the approved user story
 * (`.factory/<run>/USER_STORY.md`, AC-001 … AC-010), each named after the criterion it proves.
 * Numbering restarts at AC-001 for this PR, as PR R-1's file did; the global Phase A/B sequence
 * is not continued.
 *
 * These are deliberately OUTSIDE-IN. Where the criterion is about behaviour they drive whole runs
 * through `runFeatureFactory` (via the `runToEnd` fixture) and the real Stage 2 gate, rather than
 * the module the builder happened to edit. Where the criterion is about a rule an agent must
 * follow — the Ponytail ladder, the never-cut list, the depth table — the contract documents
 * themselves ARE the deliverable, because they are the agents' system prompts; so those tests
 * read the shipped markdown. Assertions compare against imported constants (`EFFORT_LABELS`,
 * `DEFAULT_EFFORT_LABEL`) wherever a label is involved, so the documents and the code cannot drift.
 *
 * No network and no real agent: the invoker is scripted and every gate is the real one.
 */

import { describe, it, expect, afterEach, beforeEach } from '@jest/globals';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { join, relative, resolve } from 'path';

import {
  BriefItem,
  DEFAULT_EFFORT_LABEL,
  EFFORT_LABELS,
  resolveEffortLabel
} from '../../harness/agent-output-schema';
import { buildStageContext } from '../../harness/stage-context';
import { canAdvanceStage, STAGE2_SPEC_CONTRACT } from '../../harness/stage-gates';
import { presentBrief } from '../../harness/checkpoint-presentation';
import { renderBackendSummary, renderFrontendSummary } from '../../harness/harness-documents';
import { agentOutputSchema } from '../../runner/output-schemas';
import { AGENT_COST } from '../../runner/agent-registry';
import { acceptFeatureSpec } from '../../contracts/feature-spec';
import { backend, featureSpec, frontend, spec } from '../fixtures/agent-outputs';
import {
  decisions,
  passingScript,
  runToEnd,
  scriptedInvoker,
  tempProject,
  TempProject
} from '../fixtures/harness-run';

/** A whole scripted run is a few seconds. */
const RUN_TIMEOUT_MS = 60_000;

/** The repository root, from `factory/test/acceptance/`. */
const ROOT = resolve(__dirname, '..', '..', '..');

let project: TempProject;

beforeEach(() => {
  project = tempProject('ff-accept-r9-');
});

afterEach(() => {
  project.cleanup();
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────────────────────────────────

const read = (repoRelative: string): string => readFileSync(join(ROOT, repoRelative), 'utf-8');

/** One agent contract, raw: every word of the markdown counts, prose and fences alike. */
const agentContract = (name: string): string => read(`factory/feature/agents/${name}`);

const BUILDER_CONTRACTS = ['04-backend-builder.md', '05-frontend-builder.md'] as const;

/** The one credit line, identical in every document that carries Ponytail-derived wording. */
const PONYTAIL_CREDIT = 'Adapted from [Ponytail](https://github.com/DietrichGebert/ponytail) by Dietrich Gebert (MIT).';
const PONYTAIL_URL = 'https://github.com/DietrichGebert/ponytail';

/** Exactly the documents that carry Ponytail's wording, and therefore its credit (AC-009). */
const CREDITED_DOCUMENTS = [
  'factory/feature/agents/04-backend-builder.md',
  'factory/feature/agents/05-frontend-builder.md',
  'factory/feature/agents/06-test-verifier.md',
  'factory/feature/agents/07-validator.md',
  'factory/feature/SKILL.md'
] as const;

/** The four things no label and no documented shortcut ever excuses cutting. */
const NEVER_CUT = [
  'validation at a trust boundary',
  'error handling that prevents data loss',
  'security',
  'accessibility'
] as const;

/** The in-code comment form a bounded, deliberate shortcut carries. */
const SHORTCUT_FORM = 'shortcut: <the limit>, <when to upgrade>';

/** The six ordered rungs of the smallest-complete-change ladder, by their distinctive phrase. */
const LADDER_STEPS = [
  'Does it need to exist?',
  'Already in this codebase',
  'Standard library or a platform feature?',
  'An installed dependency?',
  'Can it be one line a reader understands at a glance?',
  'the minimum code that works'
] as const;

/**
 * The ten program-only-rule patterns `repo-hygiene.test.ts`'s D-B2-4 forbids in the shared
 * contracts, re-applied here so this PR proves the constraint rather than merely inheriting it.
 */
const PROGRAM_ONLY: ReadonlyArray<readonly [string, RegExp]> = [
  ['the harness snapshot', /harness snapshots/i],
  ['the execution gate', /Gate 2/i],
  ['the review copy', /review copy/i],
  ['the read-only copy', /read-only copy/i],
  ['the test-path rule', /test paths? only/i],
  ['the test-path section', /Where you may write/i],
  ['the review-copy section', /Where you review/i],
  ['no test report', /no test report/i],
  ['the no-commit rule', /never commit/i],
  ['the harness run directory', /\.factory\/`?(?!_archive)/]
];

/** The `## Before Declaring Done` item 3 that AC-91 compares byte for byte. */
const PINNED_ITEM_3 =
  '3. Tests: run the tests related to the files you changed (for example `jest --findRelatedTests <files>` or `vitest related <files> --run`), and anything else your session asks for. All must pass.';

/** One brief item per label, so a test covers all three rather than only the default one. */
const ONE_ITEM_PER_LABEL: BriefItem[] = EFFORT_LABELS.map((label, index) => ({
  item: `unit of work ${String(index + 1)}`,
  label,
  reason: `it is a ${label}, and that is the depth it needs`
}));

const occurrences = (text: string, needle: string): number => text.split(needle).length - 1;

/**
 * The same text with every run of whitespace folded to one space. These documents are hard-wrapped
 * at ~100 columns, so a sentence a reader sees as one phrase is a literal with a newline in the
 * middle of it; `doc-drift.test.ts` reads SKILL.md this way for exactly this reason. Asserting on
 * the collapsed text pins the wording without pinning where the author happened to wrap.
 */
const collapsed = (text: string): string => text.replace(/\s+/g, ' ');

/** Directories no repository-wide scan descends into, matching the house convention. */
const NOT_SCANNED = new Set(
  ['node_modules', '.git', 'dist', 'coverage', '.factory', join('docs', 'factory-runs')].map(dir => join(ROOT, dir))
);

function repoFiles(dir: string = ROOT): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return NOT_SCANNED.has(full) ? [] : repoFiles(full);
    return entry.isFile() ? [full] : [];
  });
}

const textOf = (file: string): string => {
  try {
    return readFileSync(file, 'utf-8');
  } catch {
    return '';
  }
};

// ═════════════════════════════════════════════════════════════════════════════════════════════
// AC-001 — every brief item carries one label from a fixed enum, required by the output schema
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('AC-001 the Spec Writer labels every brief item, validated by its output schema', () => {
  it('AC-001 briefItems is required, non-empty, and each item carries exactly one label from EFFORT_LABELS', () => {
    const schema: any = agentOutputSchema('03-spec-writer');
    const details = schema.properties.details;
    const briefItems = details.properties.briefItems;

    // Required by the SDK schema is what "validated by its output schema" means: the SDK retries
    // the model until every item conforms. minItems 1 stops an empty declaration counting.
    expect(details.required).toContain('briefItems');
    expect({ type: briefItems.type, minItems: briefItems.minItems }).toEqual({ type: 'array', minItems: 1 });
    expect(briefItems.items.required).toEqual(['item', 'label', 'reason']);

    // Exactly one label, from exactly the three — asserted against the imported constant, so no
    // fourth label is reachable through either the schema or the type.
    expect(briefItems.items.properties.label.enum).toEqual([...EFFORT_LABELS]);
    expect([...EFFORT_LABELS]).toEqual(['tidy-up', 'behaviour change', 'new feature']);

    // And a labelled brief really does satisfy the schema's shape, item for item.
    const declared = spec({ briefItems: ONE_ITEM_PER_LABEL }).details.briefItems!;
    expect(declared.map(item => item.label)).toEqual([...EFFORT_LABELS]);
    expect(declared.every(item => typeof item.item === 'string' && typeof item.reason === 'string')).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// AC-002 — the label is mirrored in the brief's prose, which is how CHECKPOINT 2 shows it
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('AC-002 the labels appear in TECHNICAL_BRIEF.md and so at CHECKPOINT 2, with no new presentation code', () => {
  it(
    'AC-002 a run mirrors every declared label into the persisted brief, and CHECKPOINT 2 presents exactly that text',
    async () => {
      const approver = decisions();
      const state = await runToEnd({
        cwd: project.dir,
        invoke: scriptedInvoker(
          { ...passingScript(), '03-spec-writer': spec({ briefItems: ONE_ITEM_PER_LABEL }) },
          { cwd: project.dir }
        ).invoke,
        approveCheckpoint: approver.approve
      });

      expect(state.completionStatus).toBe('SUCCESS');

      // (a) Every declared label is readable in the document the harness persisted — which is the
      // only route by which the Test Verifier and the Validator, who never see structured output,
      // can see a label at all.
      const runDir = join(project.dir, '.factory', state.featureId);
      const brief = readFileSync(join(runDir, 'TECHNICAL_BRIEF.md'), 'utf-8');
      expect(EFFORT_LABELS.filter(label => !brief.includes(label))).toEqual([]);

      // (b) CHECKPOINT 2 was asked, and the labels are in what the human was shown.
      const cp2 = approver.requests.find(request => request.id === 2);
      expect(cp2).toBeDefined();
      expect(EFFORT_LABELS.filter(label => !cp2!.text.includes(label))).toEqual([]);

      // (c) ...because the brief is in it, not because anything new renders labels: the presented
      // text is byte for byte what the unchanged `presentBrief` builds from the same two files.
      expect(cp2!.text).toBe(presentBrief(runDir).text);
    },
    RUN_TIMEOUT_MS
  );

  it('AC-002 how CHECKPOINT 2 is assembled did not change: no presentation code knows about labels', () => {
    const presentation = read('factory/harness/checkpoint-presentation.ts');
    const orchestrator = read('factory/feature/workflows/feature-factory-orchestrator.ts');

    // Rendering labels from the Spec Writer's structured output would change the presented bytes of
    // every run, so a run paused at CP2 under an older version would be refused ARTIFACT_CHANGED on
    // --approve. Neither module knows the vocabulary exists.
    for (const token of ['briefItems', 'EFFORT_LABELS', 'resolveEffortLabel']) {
      expect({ token, inPresentation: presentation.includes(token) }).toEqual({ token, inPresentation: false });
      expect({ token, inOrchestrator: orchestrator.includes(token) }).toEqual({ token, inOrchestrator: false });
    }
    // The presentation module reads documents only: it never reaches into an agent's output at all.
    // (The orchestrator has always held `outputs.spec`; what matters is that CP2 is not built from it.)
    expect(presentation).not.toContain('outputs.spec');
    expect(presentation).not.toContain('SpecWriterOutput');
    // CP2 is still built from the run directory alone — one parameter, no new threaded input.
    expect(presentBrief.length).toBe(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// AC-003 — a missing or ambiguous label fails closed, and is at most an IMPORTANT finding
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('AC-003 an unlabelled or ambiguous item fails closed to full depth and never blocks the run', () => {
  it('AC-003 anything unusable resolves to the deepest label, never the cheapest one', () => {
    const unusable: unknown[] = [undefined, null, '', 'tidyup', 'TIDY-UP', 'Tidy-Up', 'newfeature', 42, {}, []];

    expect(unusable.map(label => resolveEffortLabel(label))).toEqual(unusable.map(() => DEFAULT_EFFORT_LABEL));
    // A missing label must not buy a free pass: it buys the most expensive treatment there is.
    expect(DEFAULT_EFFORT_LABEL).toBe('new feature');
    expect(DEFAULT_EFFORT_LABEL).toBe(EFFORT_LABELS[EFFORT_LABELS.length - 1]);
    expect(DEFAULT_EFFORT_LABEL).not.toBe(EFFORT_LABELS[0]);
    // Every real label still round-trips unchanged.
    expect(EFFORT_LABELS.map(label => resolveEffortLabel(label))).toEqual([...EFFORT_LABELS]);
  });

  it('AC-003 the Stage 2 brief gate raises an IMPORTANT finding and no blocker when nothing is labelled', async () => {
    const unlabelled = spec();
    delete unlabelled.details.briefItems;
    for (const artifact of unlabelled.details.artifacts) {
      writeFileSync(join(project.dir, artifact.name), artifact.content!);
    }

    const context = buildStageContext({ stage: 2, cwd: project.dir, outputs: { spec: unlabelled } });
    const decision = await canAdvanceStage(2, STAGE2_SPEC_CONTRACT, context);

    // At most IMPORTANT, never CRITICAL: the enforcement stays a human at CHECKPOINT 2.
    expect(decision.canAdvance).toBe(true);
    expect(decision.blockers).toEqual([]);
    expect(decision.importantFindings.filter(finding => finding.includes('Effort Labels Declared'))).toHaveLength(1);
    expect(decision.importantFindings.join('\n')).toContain(DEFAULT_EFFORT_LABEL);

    // And the severity is a property of the contract, not of this one context.
    const criteria = STAGE2_SPEC_CONTRACT.acceptance.criteria;
    expect(criteria.filter(criterion => criterion.severity === 'CRITICAL').map(criterion => criterion.name)).toEqual([
      'Technical Brief Complete'
    ]);
    expect(criteria.find(criterion => criterion.name === 'Effort Labels Declared')!.severity).toBe('IMPORTANT');
    // Nothing was added to the required documents either — that would block (AC-21).
    expect(STAGE2_SPEC_CONTRACT.artifacts.required).toEqual(['TECHNICAL_BRIEF.md', 'FILE_LIST.md']);
  });

  it(
    'AC-003 a whole run whose spec predates the field still reaches CHECKPOINT 2 and SUCCESS, with the finding recorded',
    async () => {
      const unlabelled = spec();
      delete unlabelled.details.briefItems;

      const approver = decisions();
      const state = await runToEnd({
        cwd: project.dir,
        invoke: scriptedInvoker({ ...passingScript(), '03-spec-writer': unlabelled }, { cwd: project.dir }).invoke,
        approveCheckpoint: approver.approve
      });

      expect(state.completionStatus).toBe('SUCCESS');
      expect(state.escalations ?? []).toEqual([]);
      expect(approver.requests.map(request => request.id)).toContain(2);
      expect(
        (state.importantFindings ?? []).filter(finding => finding.message.includes('Effort Labels Declared'))
      ).toHaveLength(1);
    },
    RUN_TIMEOUT_MS
  );

  it('AC-003 a pre-supplied spec written before this field is still accepted, with no blocker', async () => {
    const supplied = featureSpec();
    delete supplied.spec.details.briefItems;

    const acceptance = await acceptFeatureSpec(supplied, project.dir);

    expect({ accepted: acceptance.accepted, blockers: acceptance.blockers }).toEqual({ accepted: true, blockers: [] });
    expect(existsSync(join(project.dir, 'TECHNICAL_BRIEF.md'))).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// AC-004 — the ladder is in both builder contracts, and trips none of the repo's own pins
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('AC-004 both builder contracts carry the smallest-complete-change ladder in its six ordered steps', () => {
  it('AC-004 the six steps are present in order, in their own section, and no pinned or forbidden text moved', () => {
    for (const name of BUILDER_CONTRACTS) {
      const text = agentContract(name);

      // Its own section, placed before the pinned block rather than inside it.
      expect({ name, hasSection: text.includes('\n## Smallest Complete Change\n') }).toEqual({ name, hasSection: true });

      const positions = LADDER_STEPS.map(step => text.indexOf(step));
      expect({ name, missing: LADDER_STEPS.filter((_, index) => positions[index] < 0) }).toEqual({ name, missing: [] });
      expect({
        name,
        ascending: positions.every((position, index) => index === 0 || position > positions[index - 1])
      }).toEqual({ name, ascending: true });
      // "Be lazy about the solution, never about the change" is what stops step 1 becoming an alibi.
      expect(text).toContain('Be lazy about the solution, never about the change');

      // AC-91's captured block is byte-identical: the new section sits before the heading, so the
      // non-greedy regex still captures the same bytes and still finds a later `\n## `.
      const beforeDone = /## Before Declaring Done\n([\s\S]*?)\n## /.exec(text);
      expect({ name, captured: beforeDone !== null }).toEqual({ name, captured: true });
      expect(beforeDone![1]).toContain(PINNED_ITEM_3);
      expect(beforeDone![1]).not.toMatch(/Gate 2/);
      expect(beforeDone![1]).not.toMatch(/test suite — all must pass/);
    }

    // The ten D-B2-4 patterns, re-applied to all four shared contracts this PR edited.
    const offenders = [...BUILDER_CONTRACTS, '06-test-verifier.md', '07-validator.md'].flatMap(name => {
      const text = agentContract(name);
      return PROGRAM_ONLY.filter(([, pattern]) => pattern.test(text)).map(([label]) => `${name}: ${label}`);
    });
    expect(offenders).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// AC-005 — the never-cut list, and that cutting one of them is CRITICAL whatever the label
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('AC-005 four things are never cut, whatever the label, and a cut to one of them is Critical', () => {
  it('AC-005 both builder contracts state the list as never skippable, and 07 makes a cut Critical regardless of label', () => {
    for (const name of BUILDER_CONTRACTS) {
      const text = agentContract(name);
      expect({ name, missing: NEVER_CUT.filter(item => !text.includes(item)) }).toEqual({ name, missing: [] });
      expect(text).toContain('Never cut these, whatever label the brief item carries');
      // The label sets how much is expected; it never decides whether these four are done.
      expect(text).toContain('It never decides whether the four above are done — they always');
    }

    const validatorContract = agentContract('07-validator.md');
    expect({ missing: NEVER_CUT.filter(item => !validatorContract.includes(item)) }).toEqual({ missing: [] });
    expect(validatorContract).toContain("**Critical**, whatever the item's label says");

    // And the Severity Levels bullet says it too, so the rule is not only in the new section. The
    // bullet is hard-wrapped, so it is read collapsed.
    const severity = /## Severity Levels\n([\s\S]*?)\n## /.exec(validatorContract);
    expect(severity).not.toBeNull();
    const bullet = collapsed(severity![1]);
    expect(bullet).toContain('is Critical whatever label the brief item carries');
    expect({ missing: NEVER_CUT.filter(item => !bullet.includes(item)) }).toEqual({ missing: [] });
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// AC-006 — the optional `shortcut:` comment, and that the Validator accepts it
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('AC-006 a bounded shortcut is documented in the code and accepted as intentional', () => {
  it('AC-006 both builder contracts define the comment form, and 07 accepts a shortcut carrying it', () => {
    for (const name of BUILDER_CONTRACTS) {
      expect({ name, defines: agentContract(name).includes(SHORTCUT_FORM) }).toEqual({ name, defines: true });
    }

    const validatorContract = agentContract('07-validator.md');
    expect(validatorContract).toContain(SHORTCUT_FORM);
    expect(validatorContract).toContain('intentional, bounded choice');
    expect(validatorContract).toContain('accept it, and do not report it as an omission');
    // An undocumented shortcut, or one whose stated limit is untrue, is still a finding — the
    // comment is a way to be explicit, not a way to be excused.
    expect(validatorContract).toContain('A shortcut with no');
    expect(validatorContract).toMatch(/stated limit does not match what the code actually does, is a finding/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// AC-007 — the summary ends with what was skipped and the risk, through the existing field
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('AC-007 a builder summary ends with what was skipped or not checked, and the risk', () => {
  it('AC-007 both builder contracts require it as the closing element of the summary', () => {
    for (const name of BUILDER_CONTRACTS) {
      expect(agentContract(name)).toContain(
        'Your summary ends with what you skipped or did not check, and the risk that follows from it.'
      );
    }
  });

  it('AC-007 the closing text reaches the rendered summary verbatim, multi-line and all: no new plumbing', () => {
    const closing = [
      'Implemented the resolver.',
      '',
      'SKIPPED OR NOT CHECKED: the retry path, because no caller reaches it yet.',
      'Risk: a silent failure there would go unnoticed until a caller appears.'
    ].join('\n');

    const backendOutput = backend();
    backendOutput.details.summary = closing;
    expect(renderBackendSummary(backendOutput)).toContain(closing);

    const frontendOutput = frontend();
    frontendOutput.details.summary = closing;
    expect(renderFrontendSummary(frontendOutput)).toContain(closing);

    // It rides the existing `details.summary`: the renderer gained no field and no new carrier.
    // (`skipped` does appear there — it is the test-execution count, which predates this PR.)
    const documents = read('factory/harness/harness-documents.ts');
    for (const token of ['briefItems', 'EFFORT_LABELS', 'skippedOrNotChecked', 'whatWasSkipped', 'riskOfSkipping']) {
      expect({ token, present: documents.includes(token) }).toEqual({ token, present: false });
    }
    // The summary is placed by the one shared header helper, verbatim and not through a cell, which
    // is why a multi-line closing survives at all.
    expect(documents).toContain('summary: string');
    expect(documents).toContain('details.summary');
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// AC-008 — the Test Verifier and the Validator follow the label
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('AC-008 06 and 07 follow a fixed depth rule per label, plus one small test for new non-trivial logic', () => {
  it('AC-008 both contracts state each label’s depth, the one-small-test rule, and the tidy-up guard', () => {
    for (const name of ['06-test-verifier.md', '07-validator.md']) {
      const text = agentContract(name);

      // All three labels are named, against the imported constant so the prose cannot drift.
      expect({ name, missing: EFFORT_LABELS.filter(label => !text.includes(label)) }).toEqual({ name, missing: [] });
      // tidy-up: the tests that already exist stay green, and no new test is asked for.
      expect({ name, green: /tests that already exist/i.test(text) }).toEqual({ name, green: true });
      expect({ name, noNew: /no new test/i.test(text) }).toEqual({ name, noNew: true });
      // behaviour change: exactly one focused test per changed behaviour.
      expect({ name, focused: /one focused test per changed behaviour/i.test(text) }).toEqual({ name, focused: true });
      // new feature: full depth.
      expect({ name, full: /full depth/i.test(text) }).toEqual({ name, full: true });
      // Independent of the label: new non-trivial logic gets at least one small test.
      for (const trigger of ['non-trivial logic', 'a branch', 'a loop', 'a parser', 'money or security']) {
        expect({ name, trigger, present: text.includes(trigger) }).toEqual({ name, trigger, present: true });
      }
      // An item with no usable label is the deepest treatment, here too.
      expect({ name, failsClosed: text.includes(DEFAULT_EFFORT_LABEL) }).toEqual({ name, failsClosed: true });
    }

    // 06's half of the tidy-up guard: no deletion, and no exemption from the AC accounting.
    const verifier = agentContract('06-test-verifier.md');
    expect(verifier).toContain('"No new tests" is not "fewer tests"');
    expect(verifier).toContain('never justifies deleting, skipping or');
    expect(verifier).toContain('weakening a test that already exists');
    expect(verifier).toContain('Nor does it exempt the item from the acceptance-criteria');
    expect(verifier).toMatch(/explicitly reported as [^\n]*Not coverable/);
    // A genuinely trivial change needs no test — the rule cuts both ways.
    expect(verifier).toContain('A genuinely trivial change gets none.');

    // 07's half: the absence of a new test under a tidy-up is not a finding, but thinning is; and
    // it states the trivial case as its contrapositive (no test at all for non-trivial logic).
    const validatorContract = agentContract('07-validator.md');
    expect(validatorContract).toMatch(/absence of\s+a new test is not a finding/);
    expect(validatorContract).toContain('Deleting, skipping or weakening an existing test **is** a finding');
    expect(validatorContract).toMatch(/with no test at all is a finding/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// AC-009 — Ponytail is credited, by absolute URL, exactly where its wording is used
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('AC-009 every document carrying Ponytail-derived wording credits it once, by absolute URL', () => {
  it('AC-009 the credit line appears exactly once in each of the five documents, and in no other file', () => {
    for (const path of CREDITED_DOCUMENTS) {
      expect({ path, credits: occurrences(read(path), PONYTAIL_CREDIT) }).toEqual({ path, credits: 1 });
    }

    // Nowhere else, so there is one wording to keep in step rather than several that can drift.
    const credited = new Set<string>(CREDITED_DOCUMENTS.map(path => join(ROOT, path)));
    const scanned = repoFiles();
    // The scan must actually be looking at something, or "no strays" would prove nothing.
    expect(scanned.length).toBeGreaterThan(50);
    expect(scanned.filter(file => credited.has(file))).toHaveLength(CREDITED_DOCUMENTS.length);

    const strays = scanned
      .filter(file => !credited.has(file) && file !== __filename)
      .filter(file => textOf(file).includes(PONYTAIL_CREDIT))
      .map(file => relative(ROOT, file));
    expect(strays).toEqual([]);

    // The Spec Writer's contract carries the labels, which are this project's own vocabulary, and
    // none of Ponytail's wording — so it carries no credit.
    expect(agentContract('03-spec-writer.md')).not.toContain(PONYTAIL_CREDIT);
  });

  it('AC-009 the credit is the absolute upstream URL: nothing links a Ponytail path this repository does not hold', () => {
    // Nothing is vendored for this PR, so a relative link would be a broken one.
    expect(existsSync(join(ROOT, 'skills', 'ponytail'))).toBe(false);

    for (const path of CREDITED_DOCUMENTS) {
      expect({ path, absolute: read(path).includes(`](${PONYTAIL_URL})`) }).toEqual({ path, absolute: true });
    }

    const markdown = repoFiles().filter(file => file.endsWith('.md'));
    expect(markdown.length).toBeGreaterThan(10);

    const danglingLinks = markdown
      .filter(file => /\]\(\s*[^)\s]*skills\/ponytail\//.test(textOf(file)))
      .map(file => relative(ROOT, file));
    expect(danglingLinks).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// AC-010 — SKILL.md, the pinned claims and the run records move in this same change
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('AC-010 the documents of record move with the code, and nothing out of scope moved', () => {
  it('AC-010 SKILL.md names this PR and the new rules, doc-drift pins them, and R-1’s version assertions are retired', () => {
    const skill = read('factory/feature/SKILL.md');
    const intro = skill.split('\n---')[0];

    // The version line names this PR, and the retired one is gone from the intro.
    expect(intro).toContain('(Phase R, PR R-9)');
    expect(intro).not.toContain('PR R-1');

    // SKILL.md describes the three labels and the Ponytail rules, not just the version bump. Read
    // collapsed, because the document is hard-wrapped and claims span its line breaks.
    const skillText = collapsed(skill);
    expect(skill).toContain('## Proportionate effort');
    expect(EFFORT_LABELS.filter(label => !skillText.includes(label))).toEqual([]);
    for (const claim of ['briefItems', 'Effort Labels Declared', SHORTCUT_FORM, PONYTAIL_URL]) {
      expect({ claim, stated: skillText.includes(claim) }).toEqual({ claim, stated: true });
    }

    // doc-drift's pins moved in the same change, so prose and code cannot disagree.
    const docDrift = read('factory/test/contracts/doc-drift.test.ts');
    expect(docDrift).toContain("'Phase R, PR R-9'");
    expect(docDrift).toContain('/\\(Phase R, PR R-9\\)/');
    expect(docDrift).not.toContain("'Phase R, PR R-1'");
    for (const literal of [...EFFORT_LABELS, 'briefItems', 'shortcut:', 'Effort Labels Declared', PONYTAIL_URL]) {
      expect({ literal, pinned: docDrift.includes(`'${literal}'`) }).toEqual({ literal, pinned: true });
    }

    // R-1's acceptance file no longer asserts the version line it used to own: retired in this
    // same change rather than left failing. Each PR asserts its own line exactly once.
    const r1 = read('factory/test/acceptance/phase-r-pr-r1.test.ts');
    expect(r1).not.toContain("'(Phase R, PR R-1)'");
    expect(r1).not.toContain("'Phase R, PR R-1'");
  });

  it('AC-010 the ROADMAP and the measurements table moved too, and no out-of-scope file did', () => {
    const roadmap = read('docs/ROADMAP.md');
    // R-9 is done with a summary of what shipped, and R-2 is next.
    expect(roadmap).toMatch(/- \*\*R-9 \(done[^)]*\):\*\*/);
    expect(roadmap).toContain('- **R-2 (next):**');
    expect(roadmap).not.toContain('- **R-9 (next):**');
    expect(EFFORT_LABELS.filter(label => !roadmap.includes(label))).toEqual([]);

    // R_MEASUREMENTS has the After-R9 row prepared, and says who fills it — not silently skipped.
    const measurements = read('docs/factory-runs/phase-r/R_MEASUREMENTS.md');
    const afterR9 = measurements.slice(measurements.indexOf('## After R9'));
    expect(measurements).toContain('## After R9');
    expect(afterR9).toContain('the first');
    expect(afterR9).toMatch(/post-R9 run fills this row/);
    expect(afterR9).toMatch(/\n\|[^\n]*to be filled[^\n]*\|/);

    // Nothing belonging only to R4, R5, R6, R7, R10 or "model per job" moved. AGENT_COST is the
    // named one: this pins its value, and the PR that implements backlog item 12 retargets it.
    expect(AGENT_COST).toEqual({
      '01-researcher': { model: 'claude-opus-5', effort: 'high', maxTurns: 80 },
      '02-story-writer': { model: 'claude-sonnet-5', effort: 'medium', maxTurns: 30 },
      '03-spec-writer': { model: 'claude-opus-5', effort: 'high', maxTurns: 60 },
      '04-backend-builder': { model: 'claude-opus-5', effort: 'high', maxTurns: 80 },
      '05-frontend-builder': { model: 'claude-opus-5', effort: 'high', maxTurns: 80 },
      '06-test-verifier': { model: 'claude-opus-5', effort: 'high', maxTurns: 80 },
      '07-validator': { model: 'claude-opus-5', effort: 'high', maxTurns: 50 },
      '07b-validator-followup': { model: 'claude-opus-5', effort: 'high', maxTurns: 40 },
      '07c-validator-skeptic': { model: 'claude-opus-5', effort: 'high', maxTurns: 30 },
      '08-feature-consolidator': { model: 'claude-haiku-4-5-20251001', effort: 'low', maxTurns: 15 }
    });

    // And the rules live in the contracts, never in the program's prompts, so a by-hand run gets
    // them too — which is also why no prompt file needed to change.
    const prompts = read('factory/harness/agent-prompts.ts');
    for (const token of ['briefItems', 'EFFORT_LABELS', 'Smallest Complete Change', 'shortcut:']) {
      expect({ token, inPrompts: prompts.includes(token) }).toEqual({ token, inPrompts: false });
    }
  });
});
