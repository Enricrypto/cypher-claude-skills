/**
 * Tri-state security checks (AC-67, AC-68).
 *
 * A Validator security check is true, false, or "not_applicable". The third value exists so a
 * feature with no auth surface is not forced to claim "auth implemented" (a lie) or "auth not
 * implemented" (a false block). It is only accepted when it is EARNED: the Validator gives a
 * reason, and the approved brief independently declared that surface absent.
 */

import { describe, it, expect } from '@jest/globals';

import { evaluateSecurityChecks } from '../../harness/security-checks';
import {
  SECURITY_CHECKS,
  SecurityCheckName,
  SecuritySurfaceDeclaration,
  ValidatorOutput
} from '../../harness/agent-output-schema';
import { ALL_SURFACES_PRESENT } from '../fixtures/agent-outputs';

type Security = ValidatorOutput['details']['security'];

const allTrue = (): Security => ({
  authImplemented: true,
  inputValidated: true,
  noHardcodedSecrets: true,
  sqlInjectionProtected: true,
  xssProtected: true
});

const noAuthSurface = (): SecuritySurfaceDeclaration => ({ ...ALL_SURFACES_PRESENT, auth: 'ABSENT' });

describe('evaluateSecurityChecks', () => {
  it('AC-67 false blocks, true passes, not_applicable with reason and declared-absent surface passes', () => {
    expect(evaluateSecurityChecks(allTrue(), ALL_SURFACES_PRESENT)).toEqual({ passed: true, blockers: [] });

    const withFalse = evaluateSecurityChecks({ ...allTrue(), inputValidated: false }, ALL_SURFACES_PRESENT);
    expect(withFalse.passed).toBe(false);
    expect(withFalse.blockers).toHaveLength(1);
    expect(withFalse.blockers[0]).toMatch(/inputValidated/);

    const earned = evaluateSecurityChecks(
      {
        ...allTrue(),
        authImplemented: 'not_applicable',
        notApplicableReasons: { authImplemented: 'The feature adds a CLI flag; there is no request boundary.' }
      },
      noAuthSurface()
    );
    expect(earned).toEqual({ passed: true, blockers: [] });
  });

  const naAuth = (reason: string | undefined): Security => ({
    ...allTrue(),
    authImplemented: 'not_applicable',
    ...(reason === undefined ? {} : { notApplicableReasons: { authImplemented: reason } })
  });

  it.each<[string, Security, SecuritySurfaceDeclaration | undefined, RegExp]>([
    ['reason missing', naAuth(undefined), noAuthSurface(), /no reason/],
    ['reason blank', naAuth('   '), noAuthSurface(), /no reason/],
    ['surface PRESENT', naAuth('No endpoints.'), ALL_SURFACES_PRESENT, /declares the auth surface PRESENT/],
    ['no securitySurface', naAuth('No endpoints.'), undefined, /declares the auth surface PRESENT/]
  ])('AC-68 not_applicable blocks when %s', (_label, security, surface, message) => {
    const evaluation = evaluateSecurityChecks(security, surface);

    expect(evaluation.passed).toBe(false);
    expect(evaluation.blockers).toHaveLength(1);
    expect(evaluation.blockers[0]).toMatch(/authImplemented/);
    expect(evaluation.blockers[0]).toMatch(message);
  });

  it('a missing or non-boolean check blocks (fail closed)', () => {
    const security = { ...allTrue(), xssProtected: undefined, sqlInjectionProtected: 'yes' } as unknown as Security;

    const evaluation = evaluateSecurityChecks(security, ALL_SURFACES_PRESENT);

    expect(evaluation.passed).toBe(false);
    expect(evaluation.blockers.map(b => b.split(':')[0]).sort()).toEqual(['sqlInjectionProtected', 'xssProtected']);
  });

  it('no security assessment at all blocks every check', () => {
    const evaluation = evaluateSecurityChecks(undefined, ALL_SURFACES_PRESENT);

    expect(evaluation.passed).toBe(false);
    expect(evaluation.blockers).toHaveLength(SECURITY_CHECKS.length);
  });

  it('every listed security issue blocks, even when every check is true', () => {
    const evaluation = evaluateSecurityChecks(
      { ...allTrue(), issues: ['Session token logged at src/auth.ts:12'] },
      ALL_SURFACES_PRESENT
    );

    expect(evaluation.passed).toBe(false);
    expect(evaluation.blockers).toEqual(['Security issue: Session token logged at src/auth.ts:12']);
  });

  it('maps every check to exactly one declared surface', () => {
    const checks: SecurityCheckName[] = [...SECURITY_CHECKS];
    for (const check of checks) {
      const security: Security = {
        ...allTrue(),
        [check]: 'not_applicable',
        notApplicableReasons: { [check]: 'Not part of this feature.' }
      };
      // Every surface present: a not_applicable claim for ANY check must block.
      expect(evaluateSecurityChecks(security, ALL_SURFACES_PRESENT).passed).toBe(false);
    }
  });
});
