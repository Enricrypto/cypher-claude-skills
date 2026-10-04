/**
 * Documents the HARNESS renders from an agent's structured output (D-7, I-5).
 *
 * TEST_REPORT.md is required by the Stage 4 gate, and no agent was ever asked to write it — so
 * the gate demanded a document nothing produced. It is now rendered here, from the very fields
 * the gate judges, so the document and the verdict cannot disagree.
 *
 * Every rendered document:
 *   - starts with harnessGeneratedLabel(agent), so no reader mistakes it for the agent's own words;
 *   - is written only into the run directory (.factory/<featureId>/);
 *   - is never a claimed file. It never enters filesModified or the materialization audit,
 *     because a gate that checked files the harness itself wrote would prove nothing.
 *
 * The builder summaries (BACKEND_SUMMARY.md, API_CONTRACT.md, FRONTEND_SUMMARY.md) are rendered
 * the same way, from the builders' structured output, so downstream agents (05..08) have a
 * document to read without the harness ever claiming a builder wrote it (AC-25).
 */

import { mkdirSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';

import { BackendBuilderOutput, FrontendBuilderOutput, TestVerifierOutput } from './agent-output-schema';

export const HARNESS_RENDERED_ARTIFACTS = [
  'BACKEND_SUMMARY.md',
  'API_CONTRACT.md',
  'FRONTEND_SUMMARY.md',
  'TEST_REPORT.md'
] as const;

export type HarnessRenderedArtifact = typeof HARNESS_RENDERED_ARTIFACTS[number];

/** The first line of every harness-rendered document. */
export function harnessGeneratedLabel(agent: string): string {
  return `> **Harness-generated** from ${agent}'s structured output. Not written by the agent; not a claimed file.`;
}

/** Escape a value for a single markdown table cell. */
function cell(value: unknown): string {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

type BuilderDetails = BackendBuilderOutput['details'] | FrontendBuilderOutput['details'];

/** A markdown table, or `empty` when there are no rows. */
function table(headers: string[], rows: unknown[][], empty: string): string[] {
  if (rows.length === 0) return [empty];
  return [
    `| ${headers.join(' | ')} |`,
    `|${headers.map(() => '---').join('|')}|`,
    ...rows.map(row => `| ${row.map(cell).join(' | ')} |`)
  ];
}

function list(items: readonly string[] | undefined, empty: string): string[] {
  return items && items.length > 0 ? items.map(item => `- ${item}`) : [empty];
}

/** The sections both builder summaries share: files, tests, patterns. */
function builderFiles(details: BuilderDetails): string[] {
  return [
    '## Files modified (as claimed by the builder)',
    '',
    ...table(
      ['Path', 'Type', 'Description', 'Lines +/-'],
      (details.filesModified ?? []).map(f => [f.path, f.type, f.description, `+${f.linesAdded ?? 0}/-${f.linesRemoved ?? 0}`]),
      'No files were reported.'
    )
  ];
}

function builderTestsAndPatterns(details: BuilderDetails): string[] {
  const t = details.testing;
  return [
    '',
    '## Tests (as reported by the builder)',
    '',
    t
      ? `Written: ${t.testsWritten} | Passed: ${t.testsPassed} | Failed: ${t.testsFailed}` +
        (t.coverage !== undefined ? ` | Coverage: ${t.coverage}%` : '')
      : 'Not reported.',
    '',
    '## Patterns',
    '',
    'Reused:',
    ...list(details.patterns?.reused, '- none reported'),
    '',
    'Created:',
    ...list(details.patterns?.created, '- none reported'),
    ...(details.patterns?.violations && details.patterns.violations.length > 0
      ? ['', 'Violations:', ...list(details.patterns.violations, '')]
      : [])
  ];
}

function header(agent: string, title: string, status: string, summary: string): string[] {
  return [harnessGeneratedLabel(agent), '', `# ${title}`, '', `Status reported by ${agent}: ${status}`, '', summary, ''];
}

/** BACKEND_SUMMARY.md: files, services, migrations, tests, patterns. */
export function renderBackendSummary(output: BackendBuilderOutput): string {
  const details = output.details;
  const implementation = details.implementation;
  const lines = [
    ...header(output.agent, 'Backend Summary', output.status, details.summary),
    ...builderFiles(details),
    '',
    '## Services',
    '',
    ...table(
      ['Service', 'Methods', 'Description'],
      (implementation?.services ?? []).map(s => [s.name, (s.methods ?? []).join(', '), s.description]),
      'No services were reported.'
    ),
    '',
    '## Migrations',
    '',
    ...table(
      ['Migration', 'Description'],
      (implementation?.migrations ?? []).map(m => [m.name, m.description]),
      'No migrations were reported.'
    ),
    ...builderTestsAndPatterns(details)
  ];
  return lines.join('\n') + '\n';
}

/** API_CONTRACT.md: the routes the Backend Builder reports, and the services behind them. */
export function renderApiContract(output: BackendBuilderOutput): string {
  const implementation = output.details.implementation;
  const lines = [
    harnessGeneratedLabel(output.agent),
    '',
    '# API Contract',
    '',
    'Routes as reported by the Backend Builder. Verify them against the code before relying on them.',
    '',
    '## Routes',
    '',
    ...table(
      ['Method', 'Path', 'Handler', 'Description'],
      (implementation?.routes ?? []).map(r => [r.method, r.path, r.handler, r.description]),
      'No routes were reported.'
    ),
    '',
    '## Services',
    '',
    ...table(
      ['Service', 'Methods', 'Description'],
      (implementation?.services ?? []).map(s => [s.name, (s.methods ?? []).join(', '), s.description]),
      'No services were reported.'
    )
  ];
  return lines.join('\n') + '\n';
}

/** FRONTEND_SUMMARY.md: files, components, pages, hooks, tests, patterns. */
export function renderFrontendSummary(output: FrontendBuilderOutput): string {
  const details = output.details;
  const implementation = details.implementation;
  const lines = [
    ...header(output.agent, 'Frontend Summary', output.status, details.summary),
    ...builderFiles(details),
    '',
    '## Components',
    '',
    ...table(
      ['Component', 'Description'],
      (implementation?.components ?? []).map(c => [c.name, c.description]),
      'No components were reported.'
    ),
    '',
    '## Pages',
    '',
    ...table(
      ['Route', 'Description', 'Components'],
      (implementation?.pages ?? []).map(p => [p.route, p.description, (p.components ?? []).join(', ')]),
      'No pages were reported.'
    ),
    '',
    '## Hooks',
    '',
    ...table(
      ['Hook', 'Description'],
      (implementation?.hooks ?? []).map(h => [h.name, h.description]),
      'No hooks were reported.'
    ),
    ...builderTestsAndPatterns(details)
  ];
  return lines.join('\n') + '\n';
}

/** TEST_REPORT.md: AC counts, per-AC results, execution counts, issues. */
export function renderTestReport(output: TestVerifierOutput): string {
  const acceptance = output.details.acceptanceTests;
  const execution = output.details.testExecution;
  const issues = output.details.issues ?? [];
  const results = acceptance?.results ?? [];

  const lines: string[] = [
    harnessGeneratedLabel(output.agent),
    '',
    '# Test Report',
    '',
    `Status reported by the Test Verifier: ${output.status}`,
    '',
    output.details.summary,
    '',
    '## Acceptance criteria',
    '',
    `Total: ${acceptance?.totalAC ?? 'not reported'} | Tested: ${acceptance?.tested ?? 'not reported'} | ` +
      `Not coverable: ${acceptance?.notCoverable ?? 'not reported'} | In progress: ${acceptance?.testing ?? 'not reported'}`,
    ''
  ];

  if (results.length > 0) {
    lines.push('| AC | Status | Description | Notes |', '|---|---|---|---|');
    for (const r of results) {
      lines.push(`| ${cell(r.acId)} | ${cell(r.status)} | ${cell(r.description)} | ${cell(r.notes)} |`);
    }
  } else {
    lines.push('No per-criterion results were reported.');
  }

  lines.push(
    '',
    '## Test execution (as reported by the Test Verifier)',
    '',
    `Total: ${execution?.totalTests ?? 'not reported'} | Passed: ${execution?.passed ?? 'not reported'} | ` +
      `Failed: ${execution?.failed ?? 'not reported'} | Skipped: ${execution?.skipped ?? 'not reported'}`
  );

  for (const failing of execution?.failingTests ?? []) {
    lines.push(`- FAILING: ${failing.name} — ${failing.error}`);
  }

  lines.push('', '## Issues', '');
  if (issues.length === 0) {
    lines.push('None.');
  } else {
    for (const issue of issues) {
      lines.push(`- [${issue.severity}] ${issue.acId}: ${issue.issue}${issue.suggestion ? ` — ${issue.suggestion}` : ''}`);
    }
  }

  return lines.join('\n') + '\n';
}

/**
 * Write a harness-rendered document into the run directory. Returns its absolute path.
 * Throws on any name outside HARNESS_RENDERED_ARTIFACTS: the harness renders those and nothing
 * else, and in particular never writes an agent's own document on its behalf.
 */
export function writeHarnessDocument(
  cwd: string,
  artifactDir: string,
  name: HarnessRenderedArtifact,
  content: string
): string {
  if (!(HARNESS_RENDERED_ARTIFACTS as readonly string[]).includes(name)) {
    throw new Error(
      `writeHarnessDocument: "${name}" is not a harness-rendered document ` +
        `(allowed: ${HARNESS_RENDERED_ARTIFACTS.join(', ')})`
    );
  }

  const absolutePath = resolve(cwd, artifactDir, name);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content, 'utf-8');
  return absolutePath;
}
