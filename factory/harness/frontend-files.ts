/**
 * What counts as a frontend file (D-9, AC-69).
 *
 * The ONLY copy of this heuristic. It decides two things that must never disagree:
 *   - whether the approved brief calls for the Frontend Builder at all (specRequiresFrontend);
 *   - which builder gets a Validator issue on a file both builders touched (validator-routing).
 * A repo-hygiene test fails if these patterns appear in any other source file.
 */

import { SpecWriterOutput } from './agent-output-schema';

/** A UI component file by extension. */
const FRONTEND_EXTENSION = /\.(tsx|jsx|vue|svelte)$/;

/** A path with a conventional UI directory segment. `application/` is not `app/`. */
const FRONTEND_SEGMENT = /(^|\/)(components|pages|app|views|screens)\//;

export function isFrontendPath(path: string): boolean {
  return FRONTEND_EXTENSION.test(path) || FRONTEND_SEGMENT.test(path);
}

/**
 * Does the approved brief call for UI work?
 *
 * A backend-only feature is a completely ordinary thing, and the Frontend Builder's schema
 * requires filesModified to be non-empty — so invoking it with nothing to build guarantees three
 * loop-backs and a bogus escalation. The spec is the authority: UI components listed, or a
 * frontend file in the file list. No spec means no evidence of UI work.
 */
export function specRequiresFrontend(spec: SpecWriterOutput | undefined): boolean {
  if (!spec) return false;
  const hasUiComponents = (spec.details?.uiComponents ?? []).length > 0;
  const hasFrontendFiles = (spec.details?.fileList ?? []).some(f => isFrontendPath(f.path));
  return hasUiComponents || hasFrontendFiles;
}
