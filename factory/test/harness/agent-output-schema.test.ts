/**
 * Agent Output Schema Tests
 *
 * Tests for: agent-output-schema.ts
 * - Schema validation for each stage
 * - Required vs optional fields
 * - Invalid output rejection
 * - Error message generation
 */

import { describe, it, expect } from '@jest/globals';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  validateOutputSchema,
  getValidationErrorMessage,
  verifyArtifactMaterialization
} from '../../harness/agent-output-schema';
import { tempProject } from '../fixtures/harness-run';
import {
  backend,
  consolidator,
  echoedIssueKey,
  followup,
  researcher,
  skeptic,
  spec,
  story,
  testVerifier,
  validator
} from '../fixtures/agent-outputs';
import { AgentInvocation } from '../../runner/invoke-agent';

describe('Agent Output Schema', () => {
  describe('validateOutputSchema - Base Requirements', () => {
    it('should reject output with missing stage', () => {
      const output = {
        agent: '01-researcher',
        timestamp: '2026-06-23T10:15:00Z',
        status: 'PASS',
        details: { summary: 'Test', artifacts: [] }
      };

      const result = validateOutputSchema(1, '01-researcher', output);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('stage'))).toBe(true);
    });

    it('should reject output with wrong stage', () => {
      const output = {
        stage: 2,  // Expected 1
        agent: '01-researcher',
        timestamp: '2026-06-23T10:15:00Z',
        status: 'PASS',
        details: { summary: 'Test', artifacts: [] }
      };

      const result = validateOutputSchema(1, '01-researcher', output);

      expect(result.valid).toBe(false);
    });

    it('should reject output with missing agent', () => {
      const output = {
        stage: 1,
        timestamp: '2026-06-23T10:15:00Z',
        status: 'PASS',
        details: { summary: 'Test', artifacts: [] }
      };

      const result = validateOutputSchema(1, '01-researcher', output);

      expect(result.valid).toBe(false);
    });

    it('should reject output with missing timestamp', () => {
      const output = {
        stage: 1,
        agent: '01-researcher',
        status: 'PASS',
        details: { summary: 'Test', artifacts: [] }
      };

      const result = validateOutputSchema(1, '01-researcher', output);

      expect(result.valid).toBe(false);
    });

    it('should reject output with invalid status', () => {
      const output = {
        stage: 1,
        agent: '01-researcher',
        timestamp: '2026-06-23T10:15:00Z',
        status: 'INVALID_STATUS',
        details: { summary: 'Test', artifacts: [] }
      };

      const result = validateOutputSchema(1, '01-researcher', output);

      expect(result.valid).toBe(false);
    });

    it('should accept valid status values', () => {
      const statuses = ['PASS', 'FAIL', 'LOOP_BACK', 'ESCALATE'];

      statuses.forEach(status => {
        const output = {
          stage: 1,
          agent: '01-researcher',
          timestamp: '2026-06-23T10:15:00Z',
          status,
          details: { summary: 'Test', artifacts: [] }
        };

        const result = validateOutputSchema(1, '01-researcher', output);

        expect(result.errors.some(e => e.includes('status'))).toBe(false);
      });
    });

    it('should reject output without summary', () => {
      const output = {
        stage: 1,
        agent: '01-researcher',
        timestamp: '2026-06-23T10:15:00Z',
        status: 'PASS',
        details: { artifacts: [] }
      };

      const result = validateOutputSchema(1, '01-researcher', output);

      expect(result.valid).toBe(false);
    });

    it('should reject output without artifacts array', () => {
      const output = {
        stage: 1,
        agent: '01-researcher',
        timestamp: '2026-06-23T10:15:00Z',
        status: 'PASS',
        details: { summary: 'Test' }
      };

      const result = validateOutputSchema(1, '01-researcher', output);

      expect(result.valid).toBe(false);
    });

    it('AC-16 output with no details returns a schema failure naming details and does not throw', () => {
      const envelope = { stage: 3, agent: '04-backend-builder', timestamp: '2026-06-23T10:15:00Z', status: 'PASS' };
      const agents: Array<[number, string]> = [
        [1, '01-researcher'],
        [2, '02-story-writer'],
        [2, '03-spec-writer'],
        [3, '04-backend-builder'],
        [3, '05-frontend-builder'],
        [4, '06-test-verifier'],
        [4, '07-validator'],
        [5, '08-feature-consolidator']
      ];

      for (const [stage, agent] of agents) {
        // Missing details, and details that is not an object.
        for (const details of [undefined, null, 'not an object', 42]) {
          const output = { ...envelope, stage, agent, ...(details === undefined ? {} : { details }) };
          let result: { valid: boolean; errors: string[] } | undefined;

          expect(() => {
            result = validateOutputSchema(stage, agent, output);
          }).not.toThrow();
          expect(result!.valid).toBe(false);
          expect(result!.errors.some(e => e.includes('details'))).toBe(true);
        }
      }

      // Not an object at all.
      for (const output of [null, undefined, 'text', 7, true]) {
        let result: { valid: boolean; errors: string[] } | undefined;
        expect(() => {
          result = validateOutputSchema(3, '04-backend-builder', output);
        }).not.toThrow();
        expect(result!.valid).toBe(false);
        expect(result!.errors).toEqual(['output is not an object']);
      }
    });
  });

  describe('validateOutputSchema - Stage 1 Specific', () => {
    it('should accept valid Stage 1 Researcher output', () => {
      const output = {
        stage: 1,
        agent: '01-researcher',
        timestamp: '2026-06-23T10:15:00Z',
        status: 'PASS',
        details: {
          summary: 'Analyzed codebase',
          // MINOR-8: a read-only agent returns its required document, by name, with its content.
          artifacts: [{ name: 'RESEARCHER_REPORT.md', path: 'path/to/report.md', description: 'Audit report', content: '# Researcher Report' }],
          architecture: { layers: ['Controllers', 'Services', 'Models'] },
          // The rule is 3+ — the message always said so, but the check only tested non-empty.
          filesIdentified: [
            { path: 'src/auth.ts', role: 'service', reason: 'Auth logic' },
            { path: 'src/middleware/authGuard.ts', role: 'util', reason: 'Guards routes' },
            { path: 'src/routes/session.ts', role: 'controller', reason: 'Login entry point' }
          ],
          existingPatterns: [
            { name: 'AuthGuard', locations: ['src/middleware/'], confidence: 0.95 }
          ],
          risks: [{ type: 'TECHNICAL', severity: 'IMPORTANT', description: 'Risk' }]
        }
      };

      const result = validateOutputSchema(1, '01-researcher', output);

      expect(result.valid).toBe(true);
      expect(result.errors.length).toBe(0);
    });

    it('should reject Stage 1 without files identified', () => {
      const output = {
        stage: 1,
        agent: '01-researcher',
        timestamp: '2026-06-23T10:15:00Z',
        status: 'PASS',
        details: {
          summary: 'Test',
          artifacts: [],
          architecture: { layers: [] },
          filesIdentified: [],  // Empty!
          existingPatterns: [],
          risks: []
        }
      };

      const result = validateOutputSchema(1, '01-researcher', output);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('files'))).toBe(true);
    });

    it('should reject Stage 1 without patterns', () => {
      const output = {
        stage: 1,
        agent: '01-researcher',
        timestamp: '2026-06-23T10:15:00Z',
        status: 'PASS',
        details: {
          summary: 'Test',
          artifacts: [],
          architecture: { layers: [] },
          filesIdentified: [{ path: 'test.ts', role: 'service', reason: 'test' }],
          existingPatterns: [],  // Empty!
          risks: []
        }
      };

      const result = validateOutputSchema(1, '01-researcher', output);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('patterns'))).toBe(true);
    });
  });

  describe('validateOutputSchema - Stage 2 Specific', () => {
    it('should accept valid Stage 2 Story Writer output', () => {
      const output = {
        stage: 2,
        agent: '02-story-writer',
        timestamp: '2026-06-23T10:22:00Z',
        status: 'PASS',
        details: {
          summary: 'User story created',
          // MINOR-8: a read-only agent returns its required document, by name, with its content.
          artifacts: [{ name: 'USER_STORY.md', path: 'path/to/story.md', description: 'User story', content: '# User Story' }],
          userStory: {
            persona: 'user',
            goal: 'enable 2FA',
            benefit: 'security'
          },
          acceptanceCriteria: [
            { id: 'AC-1', given: 'logged in', when: 'enable 2FA', then: 'QR code shown', priority: 'MUST', testable: true },
            { id: 'AC-2', given: 'QR code shown', when: 'a valid TOTP code is submitted', then: '2FA is enabled', priority: 'MUST', testable: true },
            { id: 'AC-3', given: '2FA is enabled', when: 'an invalid TOTP code is submitted', then: 'login is rejected', priority: 'MUST', testable: true }
          ],
          edgeCases: [],
          assumptions: [],
          outOfScope: []
        }
      };

      const result = validateOutputSchema(2, '02-story-writer', output);

      expect(result.valid).toBe(true);
    });

    it('should reject Stage 2 with < 3 acceptance criteria', () => {
      const output = {
        stage: 2,
        agent: '02-story-writer',
        timestamp: '2026-06-23T10:22:00Z',
        status: 'PASS',
        details: {
          summary: 'User story',
          artifacts: [],
          userStory: { persona: 'user', goal: 'test', benefit: 'test' },
          acceptanceCriteria: [
            { id: 'AC-1', given: 'g', when: 'w', then: 't', priority: 'MUST', testable: true }
          ],  // Only 1 AC
          edgeCases: [],
          assumptions: [],
          outOfScope: []
        }
      };

      const result = validateOutputSchema(2, '02-story-writer', output);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('3+'))).toBe(true);
    });
  });

  describe('validateOutputSchema - Stage 3 Specific', () => {
    it('should accept valid Stage 3 Backend Builder output', () => {
      const output = {
        stage: 3,
        agent: '04-backend-builder',
        timestamp: '2026-06-23T10:48:00Z',
        status: 'PASS',
        details: {
          summary: 'Backend implemented',
          artifacts: [{ name: 'Summary', path: 'path/summary.md', description: 'Summary' }],
          filesModified: [{ path: 'src/auth.ts', type: 'MODIFY', description: 'Updated', linesAdded: 10, linesRemoved: 0 }],
          testing: {
            testsWritten: 26,
            testsPassed: 26,
            testsFailed: 0,
            coverage: 90
          },
          patterns: { reused: [], created: [] }
        }
      };

      const result = validateOutputSchema(3, '04-backend-builder', output);

      expect(result.valid).toBe(true);
    });

    it('should reject Stage 3 with test failures', () => {
      const output = {
        stage: 3,
        agent: '04-backend-builder',
        timestamp: '2026-06-23T10:48:00Z',
        status: 'PASS',
        details: {
          summary: 'Backend',
          artifacts: [],
          filesModified: [{ path: 'src/test.ts', type: 'MODIFY', description: 'test', linesAdded: 1, linesRemoved: 0 }],
          testing: {
            testsWritten: 26,
            testsPassed: 24,
            testsFailed: 2,  // Has failures!
            coverage: 90
          },
          patterns: { reused: [], created: [] }
        }
      };

      const result = validateOutputSchema(3, '04-backend-builder', output);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('failing'))).toBe(true);
    });
  });

  describe('getValidationErrorMessage', () => {
    it('should format error message with stage and agent', () => {
      const errors = ['Error 1', 'Error 2'];
      const message = getValidationErrorMessage(1, '01-researcher', errors);

      expect(message).toContain('Stage 1');
      expect(message).toContain('01-researcher');
      expect(message).toContain('Error 1');
      expect(message).toContain('Error 2');
    });

    it('should include action guidance', () => {
      const errors = ['Invalid field'];
      const message = getValidationErrorMessage(1, '01-researcher', errors);

      expect(message).toContain('Agent must re-run');
    });

    it('should reference schema file', () => {
      const errors = ['Invalid field'];
      const message = getValidationErrorMessage(1, '01-researcher', errors);

      expect(message).toContain('agent-output-schema.ts');
    });
  });

  describe('MINOR-8 read-only agents must return their documents with content', () => {
    type Case = [string, number, string, () => any, string];
    const cases: Case[] = [
      ['01-researcher', 1, '01-researcher', researcher, 'RESEARCHER_REPORT.md'],
      ['02-story-writer', 2, '02-story-writer', story, 'USER_STORY.md'],
      ['03-spec-writer (brief)', 2, '03-spec-writer', spec, 'TECHNICAL_BRIEF.md'],
      ['03-spec-writer (file list)', 2, '03-spec-writer', spec, 'FILE_LIST.md'],
      ['07-validator', 4, '07-validator', validator, 'VALIDATION_REPORT.md'],
      ['08-feature-consolidator', 5, '08-feature-consolidator', consolidator, 'PATTERNS.md']
    ];

    it.each(cases)("MINOR-8 a %s output missing a required document's content fails its schema", (_label, stage, agent, make, name) => {
      const complete = make();
      expect(validateOutputSchema(stage, agent, complete)).toEqual({ valid: true, errors: [] });

      const withoutContent = make();
      delete withoutContent.details.artifacts.find((a: { name: string }) => a.name === name).content;
      const blank = make();
      blank.details.artifacts.find((a: { name: string }) => a.name === name).content = '  \n ';
      const absent = make();
      absent.details.artifacts = absent.details.artifacts.filter((a: { name: string }) => a.name !== name);

      for (const output of [withoutContent, blank, absent]) {
        const result = validateOutputSchema(stage, agent, output);
        expect(result.valid).toBe(false);
        expect(result.errors).toContainEqual(expect.stringMatching(new RegExp(`${name.replace('.', '\\.')}.*content`)));
      }
    });

    it('MINOR-8 a document under another name does not stand in for the required one', () => {
      const output = validator();
      output.details.artifacts[0].name = 'VALIDATION.md';
      expect(validateOutputSchema(4, '07-validator', output).valid).toBe(false);
    });

    it('MINOR-8 builders and the Test Verifier write their own files and are not held to the document rule', () => {
      expect(validateOutputSchema(3, '04-backend-builder', backend()).valid).toBe(true);
      expect(validateOutputSchema(4, '06-test-verifier', testVerifier()).valid).toBe(true);
    });
  });

  describe('the follow-up (07b) and skeptic (07c) outputs (AC-127, D-6)', () => {
    const KEY = '0123456789ab';
    const call: AgentInvocation = {
      stage: 4,
      agent: '07c-validator-skeptic',
      prompt: `You are skeptic A.\nEcho issueKey \`${KEY}\`.\nMore rules.`
    };
    const skepticOutput = (options: Parameters<typeof skeptic>[0] = {}): any => skeptic(options)(call);

    it('AC-127 a follow-up with filesReviewed and an issues array passes its schema', () => {
      expect(validateOutputSchema(4, '07b-validator-followup', followup())).toEqual({ valid: true, errors: [] });
      const withIssue = followup({
        files: ['test/a.test.ts'],
        issues: [{ severity: 'IMPORTANT', message: 'weak assertion', suggestion: 'assert the value', canFix: true }]
      });
      expect(validateOutputSchema(4, '07b-validator-followup', withIssue)).toEqual({ valid: true, errors: [] });
    });

    it.each([
      ['filesReviewed is missing', (o: any) => delete o.details.filesReviewed, /filesReviewed/],
      ['filesReviewed is not an array', (o: any) => (o.details.filesReviewed = 'test/a.test.ts'), /filesReviewed/],
      ['issues is missing', (o: any) => delete o.details.issues, /issues/],
      ['VALIDATION_FOLLOWUP.md has no content', (o: any) => delete o.details.artifacts[0].content, /VALIDATION_FOLLOWUP\.md.*content/]
    ])('AC-127 a follow-up output whose %s fails its schema', (_label, mutate, message) => {
      const output: any = followup();
      mutate(output);
      const result = validateOutputSchema(4, '07b-validator-followup', output);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringMatching(message));
    });

    it('AC-127 a skeptic that echoes its key with UPHELD, or DISPROVED with evidence, passes its schema', () => {
      expect(validateOutputSchema(4, '07c-validator-skeptic', skepticOutput())).toEqual({ valid: true, errors: [] });
      expect(validateOutputSchema(4, '07c-validator-skeptic', skepticOutput({ verdict: 'DISPROVED' }))).toEqual({ valid: true, errors: [] });
    });

    it.each([
      ['a verdict outside DISPROVED / UPHELD', (o: any) => (o.details.verdict = 'MAYBE'), /verdict/],
      ['no verdict', (o: any) => delete o.details.verdict, /verdict/],
      ['a blank reason', (o: any) => (o.details.reason = ' \n '), /reason/],
      ['no reason', (o: any) => delete o.details.reason, /reason/],
      ['evidence that is not an array', (o: any) => (o.details.evidence = 'src/a.ts:1'), /evidence/],
      ['DISPROVED with no evidence entry', (o: any) => { o.details.verdict = 'DISPROVED'; o.details.evidence = []; }, /DISPROVED.*evidence/],
      ['a blank issueKey', (o: any) => (o.details.issueKey = '  '), /issueKey/],
      ['an issueKey that is not a string', (o: any) => (o.details.issueKey = 12), /issueKey/],
      ['SKEPTIC_REVIEW.md missing', (o: any) => (o.details.artifacts = []), /SKEPTIC_REVIEW\.md.*content/]
    ])('AC-127 a skeptic output with %s fails its schema', (_label, mutate, message) => {
      const output = skepticOutput();
      mutate(output);
      const result = validateOutputSchema(4, '07c-validator-skeptic', output);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringMatching(message));
    });

    it("AC-127 the skeptic fixture echoes the key from its prompt's \"Echo issueKey `<k>`\" line, and '' without one", () => {
      expect(skepticOutput().details.issueKey).toBe(KEY);
      expect(echoedIssueKey('no such line')).toBe('');
      const noKey = skeptic()({ ...call, prompt: 'You are skeptic B.' });
      expect(validateOutputSchema(4, '07c-validator-skeptic', noKey).valid).toBe(false);
      expect(skeptic({ issueKey: () => 'other' })(call).details.issueKey).toBe('other');
    });
  });

  describe('verifyArtifactMaterialization counts only regular files (MINOR-7)', () => {
    it('MINOR-7 a claimed path that is a directory is not materialised', async () => {
      const project = tempProject('ff-aos-');
      try {
        mkdirSync(join(project.dir, 'src', 'lib'), { recursive: true });
        writeFileSync(join(project.dir, 'src', 'a.ts'), 'export const a = 1;\n');
        const claims = [
          { name: 'lib', path: 'src/lib', description: 'Backend Builder: a directory' },
          { name: 'a.ts', path: 'src/a.ts', description: 'Backend Builder: a file' }
        ];

        const audit = await verifyArtifactMaterialization(3, 'builders', claims, project.dir);

        expect(audit.allMaterialized).toBe(false);
        expect(audit.missingArtifacts.map(a => a.path)).toEqual(['src/lib']);
        expect(audit.verifications.find(v => v.artifact.path === 'src/lib')?.error).toMatch(/not a regular file/);
      } finally {
        project.cleanup();
      }
    });
  });
});
