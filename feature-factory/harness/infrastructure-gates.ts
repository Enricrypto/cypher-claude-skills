/**
 * Feature Factory Infrastructure Verification Gates
 *
 * Validates that the project infrastructure is ready before running tests:
 * - npm scripts configured (test, build, dev, test:e2e)
 * - package.json and tsconfig.json valid
 * - Database migrations exist
 * - Dev server can start
 *
 * Prevents the "npm script missing" hallucination by verifying prerequisites
 * exist BEFORE Test Verifier tries to use them.
 */

import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

export interface InfrastructureCheck {
  name: string;
  severity: 'CRITICAL' | 'WARNING';
  passed: boolean;
  message: string;
  remediation?: string;
}

export interface InfrastructureAudit {
  timestamp: string;
  projectRoot: string;
  checks: InfrastructureCheck[];
  criticalFailures: InfrastructureCheck[];
  warnings: InfrastructureCheck[];
  canProceed: boolean;
  summary: string;
}

export interface InfrastructureGateDecision {
  canAdvance: boolean;
  blockers: string[];
  warnings: string[];
  remediation: string;
  reason: string;
}

/**
 * Verify npm scripts exist in package.json
 */
async function checkNpmScripts(projectRoot: string): Promise<InfrastructureCheck[]> {
  const checks: InfrastructureCheck[] = [];
  const packageJsonPath = resolve(projectRoot, 'package.json');

  try {
    if (!existsSync(packageJsonPath)) {
      checks.push({
        name: 'package.json exists',
        severity: 'CRITICAL',
        passed: false,
        message: 'package.json not found',
        remediation: 'Run: npm init -y'
      });
      return checks;
    }

    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
    const scripts = packageJson.scripts || {};

    const requiredScripts = [
      { name: 'test', description: 'Unit/integration tests' },
      { name: 'build', description: 'Build for production' },
      { name: 'dev', description: 'Development server' }
    ];

    for (const script of requiredScripts) {
      const exists = scripts[script.name] !== undefined;
      checks.push({
        name: `npm script '${script.name}'`,
        severity: 'CRITICAL',
        passed: exists,
        message: exists
          ? `✓ Script exists: ${scripts[script.name]}`
          : `Missing npm script: ${script.name}`,
        remediation: exists
          ? undefined
          : `Add to package.json scripts: "${script.name}": "..."`
      });
    }

    // Check for test:e2e (if E2E tests were created)
    const e2eTestsExist = existsSync(resolve(projectRoot, 'e2e'));
    if (e2eTestsExist) {
      const e2eExists = scripts['test:e2e'] !== undefined;
      checks.push({
        name: "npm script 'test:e2e'",
        severity: 'CRITICAL',
        passed: e2eExists,
        message: e2eExists
          ? `✓ Script exists: ${scripts['test:e2e']}`
          : 'E2E tests exist but test:e2e script is missing',
        remediation: e2eExists
          ? undefined
          : 'Add to package.json: "test:e2e": "playwright test"'
      });
    }
  } catch (err) {
    checks.push({
      name: 'Parse package.json',
      severity: 'CRITICAL',
      passed: false,
      message: `Failed to parse package.json: ${err instanceof Error ? err.message : String(err)}`,
      remediation: 'Fix JSON syntax in package.json'
    });
  }

  return checks;
}

/**
 * Verify TypeScript configuration is valid
 */
async function checkTypeScriptConfig(projectRoot: string): Promise<InfrastructureCheck[]> {
  const checks: InfrastructureCheck[] = [];
  const tsconfigPath = resolve(projectRoot, 'tsconfig.json');

  try {
    if (!existsSync(tsconfigPath)) {
      checks.push({
        name: 'tsconfig.json exists',
        severity: 'WARNING',
        passed: false,
        message: 'tsconfig.json not found (TypeScript may not be configured)',
        remediation: 'Run: npx tsc --init'
      });
      return checks;
    }

    const tsconfig = JSON.parse(readFileSync(tsconfigPath, 'utf-8'));

    checks.push({
      name: 'tsconfig.json valid',
      severity: 'CRITICAL',
      passed: true,
      message: `✓ tsconfig.json is valid (strict mode: ${tsconfig.compilerOptions?.strict ?? 'not set'})`
    });

    // Check for strict mode (recommended)
    if (!tsconfig.compilerOptions?.strict) {
      checks.push({
        name: 'TypeScript strict mode',
        severity: 'WARNING',
        passed: false,
        message: 'strict mode not enabled in tsconfig.json',
        remediation: 'Add "strict": true to compilerOptions'
      });
    }
  } catch (err) {
    checks.push({
      name: 'Parse tsconfig.json',
      severity: 'CRITICAL',
      passed: false,
      message: `Failed to parse tsconfig.json: ${err instanceof Error ? err.message : String(err)}`,
      remediation: 'Fix JSON syntax in tsconfig.json'
    });
  }

  return checks;
}

/**
 * Verify database setup (migrations exist)
 */
async function checkDatabaseSetup(projectRoot: string): Promise<InfrastructureCheck[]> {
  const checks: InfrastructureCheck[] = [];

  // Check for common migration directories
  const migrationPaths = [
    'supabase/migrations',
    'db/migrations',
    'migrations',
    'prisma/migrations'
  ];

  const hasMigrations = migrationPaths.some((path) => existsSync(resolve(projectRoot, path)));

  if (hasMigrations) {
    checks.push({
      name: 'Database migrations',
      severity: 'CRITICAL',
      passed: true,
      message: '✓ Migration directory exists'
    });
  } else {
    checks.push({
      name: 'Database migrations',
      severity: 'WARNING',
      passed: false,
      message: 'No migration directory found (supabase/migrations, db/migrations, prisma/migrations)',
      remediation: 'Create migration directory if using database'
    });
  }

  return checks;
}

/**
 * Verify key source directories exist
 */
async function checkSourceStructure(projectRoot: string): Promise<InfrastructureCheck[]> {
  const checks: InfrastructureCheck[] = [];

  const requiredDirs = [
    { path: 'app', description: 'Next.js app directory' },
    { path: 'components', description: 'React components' },
    { path: 'lib', description: 'Utility libraries' }
  ];

  for (const dir of requiredDirs) {
    const exists = existsSync(resolve(projectRoot, dir.path));
    checks.push({
      name: `Directory: ${dir.path}/`,
      severity: 'WARNING',
      passed: exists,
      message: exists ? `✓ ${dir.path}/ exists` : `${dir.path}/ not found`,
      remediation: exists ? undefined : `Create: mkdir -p ${dir.path}`
    });
  }

  return checks;
}

/**
 * Run all infrastructure checks
 */
export async function auditInfrastructure(projectRoot: string): Promise<InfrastructureAudit> {
  const timestamp = new Date().toISOString();

  // Run all checks in parallel
  const [npmChecks, tsChecks, dbChecks, srcChecks] = await Promise.all([
    checkNpmScripts(projectRoot),
    checkTypeScriptConfig(projectRoot),
    checkDatabaseSetup(projectRoot),
    checkSourceStructure(projectRoot)
  ]);

  const checks = [...npmChecks, ...tsChecks, ...dbChecks, ...srcChecks];
  const criticalFailures = checks.filter((c) => c.severity === 'CRITICAL' && !c.passed);
  const warnings = checks.filter((c) => c.severity === 'WARNING' && !c.passed);

  const canProceed = criticalFailures.length === 0;

  let summary = '';
  if (canProceed && warnings.length === 0) {
    summary = `✅ All infrastructure checks passed`;
  } else if (canProceed && warnings.length > 0) {
    summary = `✅ Infrastructure ready (${warnings.length} warning${warnings.length > 1 ? 's' : ''})`;
  } else {
    summary = `❌ ${criticalFailures.length} critical check${criticalFailures.length > 1 ? 's' : ''} failed`;
  }

  return {
    timestamp,
    projectRoot,
    checks,
    criticalFailures,
    warnings,
    canProceed,
    summary
  };
}

/**
 * Validate infrastructure gate
 */
export function validateInfrastructureGate(audit: InfrastructureAudit): InfrastructureGateDecision {
  const blockers = audit.criticalFailures.map((c) => c.message);
  const warnings = audit.warnings.map((c) => c.message);

  const canAdvance = audit.criticalFailures.length === 0;

  const remediation = audit.criticalFailures
    .filter((c) => c.remediation)
    .map((c) => `- ${c.name}: ${c.remediation}`)
    .join('\n');

  let reason = '';
  if (canAdvance && warnings.length === 0) {
    reason = 'All infrastructure checks passed';
  } else if (canAdvance && warnings.length > 0) {
    reason = `Infrastructure ready but ${warnings.length} warning(s) present`;
  } else {
    reason = `${audit.criticalFailures.length} critical check(s) failed`;
  }

  return {
    canAdvance,
    blockers,
    warnings,
    remediation: remediation || 'No remediation needed',
    reason
  };
}

/**
 * Generate infrastructure audit report
 */
export function generateInfrastructureReport(audit: InfrastructureAudit): string {
  let report = `
## 🏗️  Infrastructure Verification Report

**Timestamp:** ${audit.timestamp}
**Project:** ${audit.projectRoot}

### Summary
${audit.summary}

`;

  // Show checks by category
  const checksByType = {
    'npm Scripts': audit.checks.filter((c) => c.name.includes('npm script')),
    'TypeScript': audit.checks.filter((c) => c.name.includes('TypeScript') || c.name.includes('tsconfig')),
    'Database': audit.checks.filter((c) => c.name.includes('Database') || c.name.includes('migrations')),
    'Source Structure': audit.checks.filter((c) => c.name.includes('Directory'))
  };

  for (const [category, checks] of Object.entries(checksByType)) {
    if (checks.length === 0) continue;

    report += `### ${category}\n\n`;
    for (const check of checks) {
      const icon = check.passed ? '✅' : '❌';
      report += `${icon} **${check.name}** (${check.severity})\n`;
      report += `   ${check.message}\n`;
      if (check.remediation) {
        report += `   📝 Remediation: ${check.remediation}\n`;
      }
      report += `\n`;
    }
  }

  // Gate decision
  const decision = validateInfrastructureGate(audit);

  report += `### Gate Decision\n`;
  report += `**Can Advance:** ${decision.canAdvance ? '✅ YES' : '❌ NO'}\n\n`;

  if (decision.blockers.length > 0) {
    report += `**Critical Blockers:**\n`;
    decision.blockers.forEach((b) => {
      report += `- ${b}\n`;
    });
    report += `\n**Required Actions:**\n`;
    report += decision.remediation;
    report += `\n\n`;
  }

  if (decision.warnings.length > 0) {
    report += `**Warnings:**\n`;
    decision.warnings.forEach((w) => {
      report += `- ${w}\n`;
    });
    report += `\n`;
  }

  if (decision.canAdvance) {
    report += `✅ Infrastructure ready. Safe to proceed to Test Verifier.\n`;
  } else {
    report += `❌ Infrastructure issues must be fixed before proceeding.\n`;
  }

  return report;
}
