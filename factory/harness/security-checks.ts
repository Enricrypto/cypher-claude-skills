/**
 * Tri-state security evaluation (AC-67, AC-68).
 *
 * The Validator reports five security checks. Each was a boolean, which forced a false choice on
 * a feature with no such surface (a CLI flag has no auth boundary): claim "auth implemented",
 * which is a lie, or "auth not implemented", which blocks a correct feature. So a check may now
 * be "not_applicable" — but only when that is EARNED by two independent sources:
 *
 *   1. the Validator gives a non-blank reason for it, and
 *   2. the approved brief declared the matching surface ABSENT before any code was written.
 *
 * Neither alone is enough. A reason with no declaration is the Validator grading its own
 * exemption; a declaration with no reason means nobody looked. Everything else fails closed:
 * a missing value, a value that is not true/false/"not_applicable", or a missing assessment.
 */

import {
  SECURITY_CHECKS,
  SECURITY_CHECK_SURFACE,
  SecuritySurfaceDeclaration,
  ValidatorOutput
} from './agent-output-schema';

export interface SecurityEvaluation {
  passed: boolean;
  /** One entry per blocking check or listed issue, each starting with the check name. */
  blockers: string[];
}

export function evaluateSecurityChecks(
  security: ValidatorOutput['details']['security'] | undefined,
  surface: SecuritySurfaceDeclaration | undefined
): SecurityEvaluation {
  const blockers: string[] = [];

  for (const check of SECURITY_CHECKS) {
    const value: unknown = security?.[check];

    if (value === true) continue;

    if (value === false) {
      blockers.push(`${check}: false — the Validator found this protection missing`);
      continue;
    }

    if (value === 'not_applicable') {
      const surfaceName = SECURITY_CHECK_SURFACE[check];
      const reason = security?.notApplicableReasons?.[check];
      const hasReason = typeof reason === 'string' && reason.trim().length > 0;
      const declaredAbsent = surface?.[surfaceName] === 'ABSENT';

      if (!hasReason) {
        blockers.push(`${check}: not_applicable with no reason — the Validator must say why`);
      } else if (!declaredAbsent) {
        blockers.push(
          `${check}: not_applicable, but the brief declares the ${surfaceName} surface PRESENT` +
            (surface ? '' : ' (no securitySurface was declared, so every surface counts as present)')
        );
      }
      continue;
    }

    blockers.push(
      `${check}: ${value === undefined ? 'not reported' : `invalid value ${JSON.stringify(value)}`} — ` +
        `expected true, false or "not_applicable"`
    );
  }

  for (const issue of security?.issues ?? []) {
    blockers.push(`Security issue: ${issue}`);
  }

  return { passed: blockers.length === 0, blockers };
}
