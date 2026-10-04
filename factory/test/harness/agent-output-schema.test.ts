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
import {
  validateOutputSchema,
  getValidationErrorMessage
} from '../../harness/agent-output-schema';

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
          artifacts: [{ name: 'Report', path: 'path/to/report.md', description: 'Audit report' }],
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
          artifacts: [{ name: 'Story', path: 'path/to/story.md', description: 'User story' }],
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
});
