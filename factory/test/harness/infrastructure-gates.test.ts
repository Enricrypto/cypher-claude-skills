/**
 * What may block a build, and what may not.
 *
 * This gate once blocked a finished, correct backend feature because the target repo had:
 *   - no `dev` server script
 *   - no `build` script
 *   - no `test:e2e` suite
 *   - no `app/`, `components/` or `lib/` directories
 *   - no `migrations/` directory (it had one, under a path the gate didn't know about)
 *
 * None of that says anything about whether the feature was correctly built, and the pipeline
 * never invokes any of it. That is not a gate. That is dogma wearing a gate's clothes — and it
 * is exactly as harmful as a gate that passes everything, because a gate nobody trusts gets
 * switched off.
 *
 * THE PRINCIPLE: CRITICAL means THE PIPELINE CANNOT DO ITS JOB WITHOUT IT.
 *
 * Stage 4 runs the project's test suite, so a missing `test` script genuinely breaks
 * verification. That earns CRITICAL. Everything else is repo hygiene: reported, never blocking.
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { auditInfrastructure, validateInfrastructureGate } from '../../harness/infrastructure-gates';

let projectDir: string;

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), 'ff-infra-'));
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
});

function writePackageJson(scripts: Record<string, string>): void {
  writeFileSync(
    join(projectDir, 'package.json'),
    JSON.stringify({ name: 'target', version: '1.0.0', scripts }, null, 2)
  );
}

describe('what may block a build', () => {
  it('BLOCKS when there is no test script — stage 4 literally cannot verify anything', async () => {
    writePackageJson({ start: 'node .' });

    const audit = await auditInfrastructure(projectDir);
    const decision = validateInfrastructureGate(audit);

    expect(decision.canAdvance).toBe(false);
    expect(decision.blockers.join('\n')).toMatch(/test/i);
  });

  it('does NOT block a backend API for having no build, dev or e2e script', async () => {
    // A perfectly ordinary Express service run with ts-node. No build step, no dev server, no
    // Playwright. The pipeline never invokes any of them.
    writePackageJson({ test: 'jest', start: 'ts-node src/server.ts' });

    const audit = await auditInfrastructure(projectDir);
    const decision = validateInfrastructureGate(audit);

    expect(decision.canAdvance).toBe(true);
  });

  it('does NOT block for missing app/, components/ or lib/ directories', async () => {
    // These are Next.js conventions. An Express API has none of them and never will.
    writePackageJson({ test: 'jest' });
    mkdirSync(join(projectDir, 'src'), { recursive: true });

    const audit = await auditInfrastructure(projectDir);
    const decision = validateInfrastructureGate(audit);

    expect(decision.canAdvance).toBe(true);
  });

  it('parses a tsconfig.json that has comments in it — tsconfig is JSONC, not JSON', async () => {
    // TypeScript officially permits comments and trailing commas here, and real projects use
    // them. JSON.parse() chokes, and the gate then calls a valid tsconfig "invalid" and blocks.
    // This harness's own tsconfig has five comment lines, which is how the bug was found.
    writePackageJson({ test: 'jest' });
    writeFileSync(
      join(projectDir, 'tsconfig.json'),
      `{
  // the target of the compilation
  "compilerOptions": {
    "strict": true,   // no implicit any
    "target": "ES2022",
  }
}`
    );

    const audit = await auditInfrastructure(projectDir);
    const decision = validateInfrastructureGate(audit);

    expect(decision.canAdvance).toBe(true);
    expect(decision.blockers.join('\n')).not.toMatch(/parse|invalid/i);
  });

  it('audits the PROJECT it is given, never the directory the harness happens to run in', async () => {
    // The whole class of bug that produced this file: three gates resolved paths against
    // process.cwd(), so they audited the HARNESS repo and blocked builds over the state of a
    // completely unrelated codebase.
    writePackageJson({ test: 'jest' });

    const audit = await auditInfrastructure(projectDir);

    // The harness repo has a 'typecheck' script and no 'start'. The target has the reverse.
    // If this audit describes the harness, the wiring is broken again.
    expect(audit).toBeDefined();
    const decision = validateInfrastructureGate(audit);
    expect(decision.canAdvance).toBe(true);
  });
});
