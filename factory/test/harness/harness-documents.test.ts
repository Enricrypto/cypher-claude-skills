/**
 * Harness-rendered documents (D-7, I-5).
 *
 * TEST_REPORT.md is rendered by the harness from the Test Verifier's structured output. The
 * agent does not write it, so it can never disagree with the counts the Stage 4 gate judges.
 */

import { describe, it, expect, afterEach } from '@jest/globals';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

import {
  HARNESS_RENDERED_ARTIFACTS,
  HarnessRenderedArtifact,
  harnessGeneratedLabel,
  renderApiContract,
  renderBackendSummary,
  renderFrontendSummary,
  renderTestReport,
  writeHarnessDocument
} from '../../harness/harness-documents';
import { backend, frontend, testVerifier } from '../fixtures/agent-outputs';
import { tempProject, TempProject } from '../fixtures/harness-run';

let project: TempProject | undefined;

afterEach(() => {
  project?.cleanup();
  project = undefined;
});

describe('harness-documents', () => {
  it('lists exactly the documents the harness renders', () => {
    expect([...HARNESS_RENDERED_ARTIFACTS]).toEqual([
      'BACKEND_SUMMARY.md',
      'API_CONTRACT.md',
      'FRONTEND_SUMMARY.md',
      'TEST_REPORT.md'
    ]);
  });

  it('labels a document as harness-generated, naming the agent whose output it came from', () => {
    expect(harnessGeneratedLabel('06-test-verifier')).toBe(
      "> **Harness-generated** from 06-test-verifier's structured output. Not written by the agent; not a claimed file."
    );
  });

  it('renders TEST_REPORT.md from the structured output: label first, AC counts, per-AC results, execution counts, issues', () => {
    const output = testVerifier({ totalAC: 4, tested: 2, notCoverable: 1, criticalIssue: true });

    const report = renderTestReport(output);
    const lines = report.split('\n');

    expect(lines[0]).toBe(harnessGeneratedLabel('06-test-verifier'));
    expect(report).toContain('# Test Report');
    expect(report).toMatch(/Total: 4 \| Tested: 2 \| Not coverable: 1 \| In progress: 1/);
    expect(report).toContain('| AC-1 | TESTED |');
    expect(report).toContain('| AC-3 | NOT_COVERABLE |');
    expect(report).toContain('| AC-4 | TESTING |');
    expect(report).toMatch(/Total: 10 \| Passed: 10 \| Failed: 0 \| Skipped: 0/);
    expect(report).toContain('[CRITICAL] AC-1: AC-1 is not actually exercised');
  });

  it('renders "None" rather than an empty section when there are no issues', () => {
    expect(renderTestReport(testVerifier())).toMatch(/## Issues\n\nNone\./);
  });

  it('writes into the run directory only, and returns the absolute path', () => {
    project = tempProject('ff-docs-');
    const artifactDir = '.factory/run-1';

    const path = writeHarnessDocument(project.dir, artifactDir, 'TEST_REPORT.md', '# Test Report');

    expect(path).toBe(join(project.dir, artifactDir, 'TEST_REPORT.md'));
    expect(readFileSync(path, 'utf-8')).toBe('# Test Report');
    expect(existsSync(join(project.dir, 'TEST_REPORT.md'))).toBe(false);
  });

  it('refuses a name outside the harness-rendered list', () => {
    project = tempProject('ff-docs-');

    expect(() =>
      writeHarnessDocument(project!.dir, '.factory/run-1', 'VALIDATION_REPORT.md' as HarnessRenderedArtifact, 'x')
    ).toThrow(/VALIDATION_REPORT\.md/);
    expect(existsSync(join(project.dir, '.factory/run-1/VALIDATION_REPORT.md'))).toBe(false);
  });

  it('renders BACKEND_SUMMARY.md from the Backend Builder\'s output: label first, files, services, tests, patterns', () => {
    const output = backend({ files: ['src/a.ts', 'src/b|c.ts'] });
    output.details.implementation.migrations = [{ name: '001_totp', description: 'Add totp_secret' }];

    const doc = renderBackendSummary(output);

    expect(doc.split('\n')[0]).toBe(harnessGeneratedLabel('04-backend-builder'));
    expect(doc).toContain('# Backend Summary');
    expect(doc).toContain('| src/a.ts | CREATE |');
    expect(doc).toContain('src/b\\|c.ts'); // pipes escaped inside a table cell
    expect(doc).toContain('TotpService');
    expect(doc).toContain('001_totp');
    expect(doc).toMatch(/Written: 4 \| Passed: 4 \| Failed: 0/);
    expect(doc).toContain('BaseService');
  });

  it('renders API_CONTRACT.md as a routes table, and says so when there are no routes', () => {
    const output = backend();

    const doc = renderApiContract(output);

    expect(doc.split('\n')[0]).toBe(harnessGeneratedLabel('04-backend-builder'));
    expect(doc).toContain('# API Contract');
    expect(doc).toContain('| POST | /2fa | enable | Enable 2FA |');
    expect(doc).toContain('TotpService');

    output.details.implementation.routes = [];
    expect(renderApiContract(output)).toMatch(/No routes were reported/);
  });

  it('renders FRONTEND_SUMMARY.md from the Frontend Builder\'s output: label first, files, components, tests', () => {
    const doc = renderFrontendSummary(frontend());

    expect(doc.split('\n')[0]).toBe(harnessGeneratedLabel('05-frontend-builder'));
    expect(doc).toContain('# Frontend Summary');
    expect(doc).toContain('| src/components/TwoFactorForm.tsx | CREATE |');
    expect(doc).toContain('TwoFactorForm');
    expect(doc).toMatch(/Written: 4 \| Passed: 4 \| Failed: 0/);
  });

  it('the builder renderers tolerate missing optional sections rather than throwing', () => {
    const output = backend();
    (output.details as any).implementation = undefined;
    (output.details as any).patterns = undefined;

    expect(() => renderBackendSummary(output)).not.toThrow();
    expect(renderApiContract(output)).toMatch(/No routes were reported/);
  });
});
