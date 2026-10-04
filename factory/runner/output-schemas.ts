/**
 * Per-agent JSON Schemas handed to the Agent SDK's `outputFormat`.
 *
 * Why these exist, and why an envelope-only schema was not enough:
 *
 * The first live run of the Researcher produced excellent analysis — four files mapped, the
 * "thin routes, logic in services" pattern identified, real risks flagged — and put ALL of it
 * in `details.summary` as prose. `filesIdentified` came back `[]`. The gate then failed the
 * stage for "0 files identified", on evidence the agent had genuinely gathered.
 *
 * The cause was that the schema only required `summary` and `artifacts` and left `details`
 * open, so there was no pressure to populate the fields the gates actually read. An agent will
 * fill the shape you give it. Give it the right shape.
 *
 * Each schema below marks the gate-relevant fields REQUIRED, and the SDK retries the model
 * internally until the output conforms — so a well-formed-but-empty output is no longer
 * something the harness has to catch after the fact.
 */

import { isReadOnly, FeatureFactoryAgent, AGENT_STAGE, REQUIRED_ARTIFACTS } from './agent-registry';

type Schema = Record<string, unknown>;

const str = (description: string): Schema => ({ type: 'string', description });
const int = (description: string): Schema => ({ type: 'integer', description });
const bool = (description: string): Schema => ({ type: 'boolean', description });

const arrayOf = (items: Schema, description: string, minItems?: number): Schema => ({
  type: 'array',
  description,
  items,
  ...(minItems !== undefined ? { minItems } : {})
});

const object = (properties: Record<string, Schema>, required: string[]): Schema => ({
  type: 'object',
  properties,
  required,
  additionalProperties: true
});

/**
 * The artifact block. `content` is required for read-only agents — they cannot write files, so
 * the harness persists what they return here. Builders write their own files and must NOT have
 * them written for them, or the materialization gate would be checking the harness's work
 * instead of the builder's.
 */
function artifactSchema(agent: FeatureFactoryAgent, readOnly: boolean): Schema {
  const requiredNames = REQUIRED_ARTIFACTS[agent];

  const properties: Record<string, Schema> = {
    // Constrained to the exact keys the gates look up. A document by any other name is
    // invisible to the gate and the stage fails, so the model is not allowed to invent one.
    name:
      requiredNames.length > 0
        ? {
            type: 'string',
            enum: requiredNames,
            description: `MUST be exactly one of: ${requiredNames.join(', ')}. A gate looks the document up by this exact name.`
          }
        : str('Filename of the document you produced'),
    path: str('Path relative to the project root'),
    description: str('What this artifact is')
  };
  const required = ['name', 'path', 'description'];

  if (readOnly) {
    properties.content = str(
      'The full text of the document. You cannot write files, so the harness writes this for you. ' +
        'Omitting it means the document will not exist on disk and the gate will block the stage.'
    );
    required.push('content');
  }

  return object(properties, required);
}

const DETAILS_BY_AGENT: Record<FeatureFactoryAgent, { properties: Record<string, Schema>; required: string[] }> = {
  '01-researcher': {
    properties: {
      architecture: object(
        { layers: arrayOf(str('Layer name'), 'Architectural layers found'), description: str('How the code is organised') },
        ['layers', 'description']
      ),
      filesIdentified: arrayOf(
        object(
          {
            path: str('Path relative to project root'),
            role: { type: 'string', enum: ['controller', 'service', 'component', 'hook', 'util', 'config', 'other'] },
            reason: str('Why this file is relevant to the feature'),
            priority: { type: 'string', enum: ['MUST_MODIFY', 'LIKELY', 'OPTIONAL'] }
          },
          ['path', 'role', 'reason', 'priority']
        ),
        'Every file relevant to this feature. At least 3 — if the codebase genuinely has fewer, say so in summary and set status to ESCALATE.',
        3
      ),
      existingPatterns: arrayOf(
        object(
          {
            name: str('Pattern name'),
            description: str('What the pattern is'),
            locations: arrayOf(str('File path'), 'Where it appears'),
            confidence: { type: 'number', description: '0-1' },
            recommendation: { type: 'string', enum: ['REUSE', 'ADAPT', 'AVOID'] }
          },
          ['name', 'description', 'locations', 'confidence', 'recommendation']
        ),
        'Patterns already in the codebase. At least one.',
        1
      ),
      risks: arrayOf(
        object(
          {
            type: { type: 'string', enum: ['TECHNICAL', 'SCOPE', 'CONSTRAINT', 'UNKNOWN'] },
            severity: { type: 'string', enum: ['CRITICAL', 'IMPORTANT', 'NICE_TO_HAVE'] },
            description: str('The risk'),
            mitigation: str('How to handle it')
          },
          ['type', 'severity', 'description']
        ),
        'Risks and unknowns. An empty list reads as incomplete analysis.'
      ),
      timeEstimate: object(
        {
          discover: int('minutes'), plan: int('minutes'), execute: int('minutes'),
          verify: int('minutes'), deliver: int('minutes'), total: int('minutes'),
          confidence: { type: 'number', description: '0-1' }
        },
        ['discover', 'plan', 'execute', 'verify', 'deliver', 'total', 'confidence']
      )
    },
    required: ['architecture', 'filesIdentified', 'existingPatterns', 'risks', 'timeEstimate']
  },

  '02-story-writer': {
    properties: {
      userStory: object(
        { persona: str('As a...'), goal: str('I want...'), benefit: str('so that...') },
        ['persona', 'goal', 'benefit']
      ),
      acceptanceCriteria: arrayOf(
        object(
          {
            id: str('AC-001, AC-002, ...'),
            given: str('Given...'),
            when: str('When...'),
            then: str('Then...'),
            priority: { type: 'string', enum: ['MUST', 'SHOULD', 'COULD'] },
            testable: bool('Can this be verified by an automated test?')
          },
          ['id', 'given', 'when', 'then', 'priority', 'testable']
        ),
        'At least 3 criteria, each in Given/When/Then form. The USER_STORY.md you return as an artifact MUST spell these out in Given/When/Then prose — a gate reads that file and blocks the stage if it cannot find them.',
        3
      ),
      edgeCases: arrayOf(
        object({ case: str('The edge case'), inScope: bool('In scope?'), reason: str('Why') }, ['case', 'inScope', 'reason']),
        'Edge cases, in or out of scope'
      ),
      assumptions: arrayOf(str('Assumption'), 'Assumptions made'),
      outOfScope: arrayOf(str('Excluded'), 'Explicitly out of scope')
    },
    required: ['userStory', 'acceptanceCriteria', 'edgeCases', 'assumptions', 'outOfScope']
  },

  '03-spec-writer': {
    properties: {
      dataModel: object({ tables: arrayOf(object({ name: str('Table'), description: str('Purpose') }, ['name', 'description']), 'Tables'), migrations: arrayOf(str('Migration'), 'Migrations') }, ['tables']),
      apiContract: object(
        {
          endpoints: arrayOf(
            object(
              {
                method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'] },
                path: str('Route path'),
                description: str('What it does'),
                auth: { type: 'string', enum: ['NONE', 'JWT', 'API_KEY'] },
                statusCodes: arrayOf(int('HTTP status'), 'All status codes, including errors')
              },
              ['method', 'path', 'description', 'auth', 'statusCodes']
            ),
            'Endpoints'
          ),
          errorHandling: str('Error response shape')
        },
        ['endpoints', 'errorHandling']
      ),
      uiComponents: arrayOf(object({ name: str('Component'), description: str('Purpose') }, ['name', 'description']), 'UI components'),
      fileList: arrayOf(
        object(
          {
            path: str('Path'),
            type: { type: 'string', enum: ['CREATE', 'MODIFY', 'DELETE'] },
            reason: str('Why'),
            complexity: { type: 'string', enum: ['SIMPLE', 'MODERATE', 'COMPLEX'] }
          },
          ['path', 'type', 'reason', 'complexity']
        ),
        'Every file the builders will touch. Nothing may surprise them.',
        1
      ),
      testStrategy: object(
        { unitTests: arrayOf(str('Test'), 'Unit'), integrationTests: arrayOf(str('Test'), 'Integration'), e2eTests: arrayOf(str('Test'), 'E2E') },
        ['unitTests', 'integrationTests', 'e2eTests']
      )
    },
    required: ['dataModel', 'apiContract', 'uiComponents', 'fileList', 'testStrategy']
  },

  '04-backend-builder': builderDetails(),
  '05-frontend-builder': builderDetails(),

  '06-test-verifier': {
    properties: {
      acceptanceTests: object(
        {
          totalAC: int('Total acceptance criteria in the story'),
          tested: int('How many are covered by a passing test'),
          notCoverable: int('How many cannot be tested automatically'),
          testing: int('How many are still in progress')
        },
        ['totalAC', 'tested', 'notCoverable', 'testing']
      ),
      testExecution: object(
        { totalTests: int('Total'), passed: int('Passed'), failed: int('Failed'), skipped: int('Skipped') },
        ['totalTests', 'passed', 'failed', 'skipped']
      ),
      issues: arrayOf(
        object(
          {
            acId: str('Which AC'),
            severity: { type: 'string', enum: ['CRITICAL', 'IMPORTANT', 'MINOR'] },
            issue: str('The problem'),
            suggestion: str('Which builder owns the fix')
          },
          ['acId', 'severity', 'issue', 'suggestion']
        ),
        'Failures, by acceptance criterion'
      )
    },
    required: ['acceptanceTests', 'testExecution', 'issues']
  },

  '07-validator': {
    properties: {
      storyCompliance: object(
        { allFilesMentioned: bool(''), allACTested: bool(''), storyMatchesImplementation: bool('') },
        ['allFilesMentioned', 'allACTested', 'storyMatchesImplementation']
      ),
      briefCompliance: object(
        { apiImplementedCorrectly: bool(''), dataModelCorrect: bool(''), uiComponentsCorrect: bool('') },
        ['apiImplementedCorrectly', 'dataModelCorrect', 'uiComponentsCorrect']
      ),
      codeQuality: object(
        { followsPatterns: bool(''), noMagicNumbers: bool(''), noDuplicateLogic: bool(''), properErrorHandling: bool('') },
        ['followsPatterns', 'noMagicNumbers', 'noDuplicateLogic', 'properErrorHandling']
      ),
      security: object(
        {
          authImplemented: bool('Auth checks present where needed'),
          inputValidated: bool('All input validated'),
          noHardcodedSecrets: bool('No secrets in code or logs'),
          sqlInjectionProtected: bool(''),
          xssProtected: bool('')
        },
        ['authImplemented', 'inputValidated', 'noHardcodedSecrets', 'sqlInjectionProtected', 'xssProtected']
      ),
      issues: arrayOf(
        object(
          {
            severity: { type: 'string', enum: ['CRITICAL', 'IMPORTANT', 'MINOR'] },
            message: str('The problem'),
            suggestion: str('The fix'),
            canFix: bool('Can a builder fix this automatically?'),
            file: str('File'),
            line: int('Line')
          },
          ['severity', 'message', 'suggestion', 'canFix']
        ),
        'Every issue found. An empty array is a valid finding — it means the code is clean. A false security boolean above IS an issue and blocks the stage.'
      )
    },
    required: ['storyCompliance', 'briefCompliance', 'codeQuality', 'security', 'issues']
  },

  '08-feature-consolidator': {
    properties: {
      executionMetrics: object(
        { featureName: str(''), totalTime: int('minutes'), loopCount: int(''), escalationCount: int('') },
        ['featureName', 'totalTime', 'loopCount', 'escalationCount']
      ),
      patterns: object(
        {
          reusedPatterns: arrayOf(object({ name: str(''), description: str('') }, ['name', 'description']), 'Reused'),
          newPatterns: arrayOf(object({ name: str(''), description: str('') }, ['name', 'description']), 'Created'),
          patternIssues: arrayOf(object({ name: str(''), description: str('') }, ['name', 'description']), 'Problematic')
        },
        ['reusedPatterns', 'newPatterns', 'patternIssues']
      ),
      learnings: object({ whatWorked: arrayOf(str(''), ''), whatFailed: arrayOf(str(''), '') }, ['whatWorked', 'whatFailed'])
    },
    required: ['executionMetrics', 'patterns', 'learnings']
  }
};

function builderDetails(): { properties: Record<string, Schema>; required: string[] } {
  return {
    properties: {
      filesModified: arrayOf(
        object(
          {
            path: str('Path relative to project root. You MUST have actually written this file — a gate checks each path against the filesystem and fails the build if it is missing.'),
            type: { type: 'string', enum: ['CREATE', 'MODIFY', 'DELETE'] },
            description: str('What changed'),
            linesAdded: int(''),
            linesRemoved: int('')
          },
          ['path', 'type', 'description', 'linesAdded', 'linesRemoved']
        ),
        'Every file you actually created or modified.',
        1
      ),
      implementation: object(
        {
          services: arrayOf(object({ name: str(''), path: str('') }, ['name', 'path']), 'Services'),
          routes: arrayOf(object({ method: str(''), path: str('') }, ['method', 'path']), 'Routes'),
          migrations: arrayOf(object({ name: str(''), path: str('') }, ['name', 'path']), 'Migrations')
        },
        ['services', 'routes', 'migrations']
      ),
      testing: object(
        {
          testsWritten: int('How many tests you wrote'),
          testsPassed: int('How many pass. Report what the test runner actually printed.'),
          testsFailed: int('How many fail. Do not report 0 unless you ran the suite and saw 0.'),
          failingTests: arrayOf(object({ name: str(''), error: str('') }, ['name', 'error']), 'Each failure with its error')
        },
        ['testsWritten', 'testsPassed', 'testsFailed']
      ),
      patterns: object(
        { reused: arrayOf(str(''), 'Patterns reused'), created: arrayOf(str(''), 'Patterns introduced'), violations: arrayOf(str(''), 'Violations') },
        ['reused', 'created']
      )
    },
    required: ['filesModified', 'implementation', 'testing', 'patterns']
  };
}

/** The full output schema for one agent: envelope + its stage-specific fields. */
export function agentOutputSchema(agent: FeatureFactoryAgent): Schema {
  const stage = AGENT_STAGE[agent];
  const spec = DETAILS_BY_AGENT[agent];
  const readOnly = isReadOnly(agent);
  const requiredArtifacts = REQUIRED_ARTIFACTS[agent];

  return {
    type: 'object',
    properties: {
      stage: { type: 'integer', const: stage },
      agent: { type: 'string', const: agent },
      timestamp: str('ISO8601'),
      status: {
        type: 'string',
        enum: ['PASS', 'FAIL', 'LOOP_BACK', 'ESCALATE'],
        description:
          'ESCALATE if the task cannot proceed and needs a human. FAIL if you could not complete it. ' +
          'PASS only if you did the work. The harness acts on this.'
      },
      details: {
        type: 'object',
        properties: {
          summary: str('One paragraph. Do not put findings ONLY here — the structured fields below are what the gates read.'),
          artifacts: arrayOf(
            artifactSchema(agent, readOnly),
            requiredArtifacts.length > 0
              ? `You MUST return exactly these documents, by these exact names: ${requiredArtifacts.join(', ')}. A gate looks each one up by name and blocks the stage if it is absent.`
              : 'Documents and files you produced',
            requiredArtifacts.length || undefined
          ),
          ...spec.properties
        },
        required: ['summary', 'artifacts', ...spec.required],
        additionalProperties: true
      }
    },
    required: ['stage', 'agent', 'timestamp', 'status', 'details'],
    additionalProperties: true
  };
}
