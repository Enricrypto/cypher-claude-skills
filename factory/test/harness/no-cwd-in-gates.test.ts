/**
 * The harness must NEVER call process.cwd().
 *
 * Three separate gates have now been caught auditing the HARNESS's own repo instead of the
 * project the agents were building in:
 *
 *   verifyArtifactMaterialization  — approved a hallucinated file because a file of that name
 *                                    existed in OUR repo; rejected four real files because they
 *                                    did not.
 *   auditInfrastructure            — blocked a good backend build for a "missing dev script"
 *                                    and an "invalid tsconfig.json", both describing OUR repo.
 *   auditExecution                 — same root cause, found while fixing the other two.
 *
 * The bug is invisible in tests, because the tests run WITH the harness repo as the project, so
 * process.cwd() is accidentally correct. It only appears when the factory is pointed at a real
 * project somewhere else — i.e. every real use.
 *
 * The project directory is always available: it is threaded through as `cwd`. There is no
 * legitimate reason for a gate to ask the operating system where it happens to be running.
 * This test makes the mistake unrepeatable.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync, readdirSync } from 'fs';
import { join, resolve } from 'path';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [full] : [];
  });
}

describe('no gate may ask the OS where it is running', () => {
  const root = resolve(__dirname, '../..');

  const gateCode = [
    ...sourceFiles(join(root, 'harness')),
    ...sourceFiles(join(root, 'feature', 'workflows'))
  ];

  it.each(gateCode.map(f => [f.replace(root + '/', ''), f]))(
    '%s does not call process.cwd()',
    (_label, file) => {
      const source = readFileSync(file, 'utf-8');

      // Strip comments — the fixed files DESCRIBE the bug in their docblocks.
      const code = source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');

      expect(code).not.toContain('process.cwd()');
    }
  );
});
