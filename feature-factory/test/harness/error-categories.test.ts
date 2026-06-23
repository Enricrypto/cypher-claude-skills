/**
 * Error Categories Tests
 *
 * Tests for: error-categories.ts
 * - Error pattern matching
 * - Category classification
 * - Fix class assignment
 * - Code template generation
 */

import { describe, it, expect } from '@jest/globals';
import {
  analyzeError,
  getRemediationInstruction,
  getFixCodeTemplate
} from '../../harness/error-categories';

describe('Error Categories', () => {
  describe('analyzeError - Pattern Matching', () => {
    it('should categorize IMPORT_ERROR for missing module', () => {
      const error = 'Cannot find module "speakeasy"';
      const analysis = analyzeError(error);

      expect(analysis.category).toBe('IMPORT_ERROR');
      expect(analysis.fixClass).toBe('FIX_IMPORT');
      expect(analysis.confidence).toBeGreaterThan(0.8);
    });

    it('should categorize TYPE_ERROR for type mismatch', () => {
      const error = 'Type "string" is not assignable to type "number"';
      const analysis = analyzeError(error);

      expect(analysis.category).toBe('TYPE_ERROR');
      expect(analysis.fixClass).toBe('FIX_TYPES');
    });

    it('should categorize SYNTAX_ERROR for syntax issues', () => {
      const error = 'SyntaxError: Unexpected token }';
      const analysis = analyzeError(error);

      expect(analysis.category).toBe('SYNTAX_ERROR');
      expect(analysis.fixClass).toBe('FIX_SYNTAX');
    });

    it('should categorize ASSERTION_MISMATCH for test failures', () => {
      const error = 'expected 5 to equal 10';
      const analysis = analyzeError(error);

      expect(analysis.category).toBe('ASSERTION_MISMATCH');
      expect(analysis.fixClass).toBe('UPDATE_ASSERTION');
    });

    it('should categorize MISSING_IMPLEMENTATION for undefined references', () => {
      const error = 'Cannot read property "email" of undefined';
      const analysis = analyzeError(error);

      expect(analysis.category).toBe('MISSING_IMPLEMENTATION');
      expect(analysis.fixClass).toBe('IMPLEMENT');
    });

    it('should categorize DATA_COLLISION for duplicate keys', () => {
      const error = 'duplicate key violation on "email"';
      const analysis = analyzeError(error);

      expect(analysis.category).toBe('DATA_COLLISION');
      expect(analysis.fixClass).toBe('ADD_CLEANUP');
    });

    it('should categorize MIGRATION_ERROR for missing schema', () => {
      const error = 'column "totp_secret" does not exist';
      const analysis = analyzeError(error);

      expect(analysis.category).toBe('MIGRATION_ERROR');
      expect(analysis.fixClass).toBe('CREATE_MIGRATION');
    });

    it('should categorize API_CONTRACT for 404 errors', () => {
      const error = '404 Not Found: /api/users';
      const analysis = analyzeError(error);

      expect(analysis.category).toBe('API_CONTRACT');
      expect(analysis.fixClass).toBe('UPDATE_PAYLOAD');
    });

    it('should categorize API_CONTRACT for 401 errors', () => {
      const error = '401 Unauthorized';
      const analysis = analyzeError(error);

      expect(analysis.category).toBe('API_CONTRACT');
      expect(analysis.fixClass).toBe('UPDATE_PAYLOAD');
    });

    it('should categorize SELECTOR_MISMATCH for missing elements', () => {
      const error = 'No matching element for getByRole("button")';
      const analysis = analyzeError(error);

      expect(analysis.category).toBe('SELECTOR_MISMATCH');
      expect(analysis.fixClass).toBe('UPDATE_LOCATOR');
    });

    it('should categorize TIMING_ISSUE for timeouts', () => {
      const error = 'Timeout 5000ms waiting for element';
      const analysis = analyzeError(error);

      expect(analysis.category).toBe('TIMING_ISSUE');
      expect(analysis.fixClass).toBe('INCREASE_TIMEOUT');
    });

    it('should default to UNKNOWN for unmatched patterns', () => {
      const error = 'Some random error that does not match any pattern';
      const analysis = analyzeError(error);

      expect(analysis.category).toBe('UNKNOWN');
      expect(analysis.fixClass).toBe('MANUAL_REVIEW');
      expect(analysis.requiresManualReview).toBe(true);
    });
  });

  describe('getFixCodeTemplate', () => {
    it('should return FIX_IMPORT template', () => {
      const template = getFixCodeTemplate('FIX_IMPORT');
      expect(template).toContain('import');
      expect(template).toContain('file exists');
    });

    it('should return FIX_TYPES template', () => {
      const template = getFixCodeTemplate('FIX_TYPES');
      expect(template).toContain('interface');
      expect(template).toContain('type annotation');
    });

    it('should return IMPLEMENT template', () => {
      const template = getFixCodeTemplate('IMPLEMENT');
      expect(template).toContain('Implementation missing');
      expect(template).toContain('add body');
    });

    it('should return UPDATE_LOCATOR template', () => {
      const template = getFixCodeTemplate('UPDATE_LOCATOR');
      expect(template).toContain('getByRole');
      expect(template).toContain('getByTestId');
    });

    it('should return ADD_CLEANUP template', () => {
      const template = getFixCodeTemplate('ADD_CLEANUP');
      expect(template).toContain('afterEach');
      expect(template).toContain('cleanup');
    });

    it('should return MANUAL_REVIEW for unknown class', () => {
      const template = getFixCodeTemplate('UNKNOWN_CLASS' as any);
      expect(template).toContain('manual investigation');
    });
  });

  describe('getRemediationInstruction', () => {
    it('should return formatted remediation instruction', () => {
      const instruction = getRemediationInstruction('Cannot find module speakeasy');

      expect(instruction).toContain('Error Analysis');
      expect(instruction).toContain('IMPORT_ERROR');
      expect(instruction).toContain('FIX_IMPORT');
      expect(instruction).toContain('Confidence');
    });

    it('should include error message in instruction', () => {
      const instruction = getRemediationInstruction('Cannot find module speakeasy');

      expect(instruction).toContain('Cannot find module speakeasy');
    });

    it('should flag manual review when needed', () => {
      const instruction = getRemediationInstruction('Unknown random error');

      expect(instruction).toContain('Requires Manual Review');
    });

    it('should not flag manual review for fixable errors', () => {
      const instruction = getRemediationInstruction('Cannot find module test');

      expect(instruction).not.toContain('Requires Manual Review');
    });
  });

  describe('Confidence Scoring', () => {
    it('should have HIGH confidence for exact matches', () => {
      const analysis = analyzeError('Cannot find module "speakeasy"');
      expect(analysis.confidence).toBeCloseTo(0.9, 1);
    });

    it('should have 0 confidence for UNKNOWN patterns', () => {
      const analysis = analyzeError('completely unrelated error message');
      expect(analysis.confidence).toBe(0);
    });
  });

  describe('Edge Cases', () => {
    it('should match case-insensitive patterns', () => {
      const analysis1 = analyzeError('cannot find module X');
      const analysis2 = analyzeError('CANNOT FIND MODULE X');

      expect(analysis1.fixClass).toBe(analysis2.fixClass);
    });

    it('should match partial error messages', () => {
      const longError = 'Failed to compile\nSyntaxError: Unexpected token }\nat line 42';
      const analysis = analyzeError(longError);

      expect(analysis.category).toBe('SYNTAX_ERROR');
    });

    it('should prioritize more specific patterns', () => {
      // "Type" error should match TYPE_ERROR before generic "error"
      const analysis = analyzeError('Type mismatch: string vs number');

      expect(analysis.fixClass).toBe('FIX_TYPES');
    });
  });
});
