# Output Schemas Reference

JSON schema definition for each agent's output.

---

## Base Schema

All agents produce output matching this base structure:

```typescript
{
  stage: 1|2|3|4|5,
  agent: "01-researcher"|"02-story-writer"|...,
  timestamp: "2026-06-23T10:15:00Z",
  status: "PASS"|"FAIL"|"LOOP_BACK"|"ESCALATE",
  details: {
    summary: string,
    artifacts: [
      { name: string, path: string, description: string }
    ],
    metrics?: { ... },
    errors?: [
      { type: string, message: string, severity: "CRITICAL"|"IMPORTANT"|"MINOR" }
    ]
  }
}
```

---

## Stage 1: Researcher Output

```json
{
  "stage": 1,
  "agent": "01-researcher",
  "timestamp": "2026-06-23T10:15:00Z",
  "status": "PASS",
  "details": {
    "summary": "Analyzed codebase for 2FA feature",
    "artifacts": [
      {
        "name": "RESEARCHER_REPORT.md",
        "path": "artifacts/stage-1-discover/RESEARCHER_REPORT.md",
        "description": "Full audit report"
      }
    ],
    "architecture": {
      "layers": ["Controllers", "Services", "Models"],
      "description": "3-layer architecture with Express, Services, and TypeORM"
    },
    "filesIdentified": [
      {
        "path": "src/models/User.ts",
        "role": "domain_model",
        "reason": "Add totp_secret property",
        "priority": "MUST_MODIFY"
      },
      {
        "path": "src/services/AuthService.ts",
        "role": "business_logic",
        "reason": "Implement TOTP logic",
        "priority": "MUST_MODIFY"
      }
    ],
    "existingPatterns": [
      {
        "name": "Auth Guard Middleware",
        "description": "Validates JWT tokens",
        "locations": ["src/middleware/auth.ts"],
        "confidence": 0.95,
        "recommendation": "REUSE"
      }
    ],
    "risks": [
      {
        "type": "TECHNICAL",
        "severity": "IMPORTANT",
        "description": "Session management on 2FA enable",
        "mitigation": "Test session handling thoroughly"
      }
    ],
    "timeEstimate": {
      "discover": 8,
      "plan": 12,
      "execute": 45,
      "verify": 20,
      "deliver": 10,
      "total": 95,
      "confidence": 0.75
    }
  }
}
```

---

## Stage 2: Story Writer Output

```json
{
  "stage": 2,
  "agent": "02-story-writer",
  "timestamp": "2026-06-23T10:22:00Z",
  "status": "PASS",
  "details": {
    "summary": "User story for 2FA feature",
    "artifacts": [
      {
        "name": "USER_STORY.md",
        "path": "artifacts/stage-2-plan/USER_STORY.md",
        "description": "Complete user story with AC"
      }
    ],
    "userStory": {
      "persona": "security-conscious user",
      "goal": "enable two-factor authentication",
      "benefit": "protect account from unauthorized access"
    },
    "acceptanceCriteria": [
      {
        "id": "AC-001",
        "given": "I'm logged into my account",
        "when": "I navigate to Security Settings",
        "then": "I see option to enable 2FA",
        "priority": "MUST",
        "testable": true
      }
    ],
    "edgeCases": [
      {
        "case": "User loses authenticator app",
        "inScope": false,
        "reason": "Recovery codes are future work"
      }
    ],
    "assumptions": ["User has valid email", "Backend supports TOTP"],
    "outOfScope": ["Recovery codes", "Hardware security keys"]
  }
}
```

---

## Stage 2: Spec Writer Output

```json
{
  "stage": 2,
  "agent": "03-spec-writer",
  "timestamp": "2026-06-23T10:27:00Z",
  "status": "PASS",
  "details": {
    "summary": "Technical specification for 2FA",
    "artifacts": [
      {
        "name": "TECHNICAL_BRIEF.md",
        "path": "artifacts/stage-2-plan/TECHNICAL_BRIEF.md"
      }
    ],
    "dataModel": {
      "tables": [
        {
          "name": "users",
          "columns": [
            {
              "name": "totp_secret",
              "type": "VARCHAR(32)",
              "required": false,
              "description": "Encrypted TOTP seed"
            },
            {
              "name": "totp_enabled",
              "type": "BOOLEAN",
              "required": false,
              "description": "Is 2FA enabled"
            }
          ],
          "constraints": ["UNIQUE(email)"]
        }
      ],
      "migrations": ["001_add_2fa_columns.sql"]
    },
    "apiContract": {
      "endpoints": [
        {
          "method": "POST",
          "path": "/api/auth/2fa/enable",
          "description": "Initiate 2FA setup",
          "auth": "JWT",
          "requestBody": null,
          "responseBody": {
            "qrCode": "string (base64 PNG)",
            "backupCodes": "string[]"
          },
          "statusCodes": [200, 401, 400]
        }
      ],
      "errorHandling": "Return 400 with error message if validation fails"
    },
    "uiComponents": [
      {
        "name": "TwoFactorSetup",
        "description": "Setup flow component",
        "props": [
          {
            "name": "user",
            "type": "User",
            "required": true
          },
          {
            "name": "onEnable",
            "type": "() => void",
            "required": true
          }
        ],
        "states": ["loading", "qr_displayed", "verifying", "complete"]
      }
    ],
    "fileList": [
      {
        "path": "src/models/User.ts",
        "type": "MODIFY",
        "reason": "Add totp_secret, totp_enabled",
        "complexity": "SIMPLE"
      }
    ],
    "testStrategy": {
      "unitTests": ["TOTPService generates valid QR", "Token validation works"],
      "integrationTests": ["Enable 2FA flow end-to-end"],
      "e2eTests": ["User can enable and use 2FA in browser"]
    }
  }
}
```

---

## Stage 3: Builder Output

```json
{
  "stage": 3,
  "agent": "04-backend-builder",
  "timestamp": "2026-06-23T10:48:00Z",
  "status": "PASS",
  "details": {
    "summary": "Backend implementation complete",
    "artifacts": [
      {
        "name": "BACKEND_BUILDER_SUMMARY.md",
        "path": "artifacts/stage-3-execute/BACKEND_SUMMARY.md"
      }
    ],
    "filesModified": [
      {
        "path": "src/models/User.ts",
        "type": "MODIFY",
        "description": "Added totp_secret, totp_enabled properties",
        "linesAdded": 5,
        "linesRemoved": 0
      },
      {
        "path": "src/services/TOTPService.ts",
        "type": "CREATE",
        "description": "TOTP generation and verification",
        "linesAdded": 45,
        "linesRemoved": 0
      }
    ],
    "implementation": {
      "services": [
        {
          "name": "TOTPService",
          "methods": ["generateSecret", "verifyToken", "generateBackupCodes"],
          "description": "Handles TOTP generation and validation"
        }
      ],
      "routes": [
        {
          "method": "POST",
          "path": "/api/auth/2fa/enable",
          "handler": "AuthController.enable2FA",
          "description": "Generate QR code"
        }
      ],
      "migrations": [
        {
          "name": "001_add_2fa_columns",
          "description": "Add totp_secret, totp_enabled to users"
        }
      ]
    },
    "testing": {
      "testsWritten": 26,
      "testsPassed": 26,
      "testsFailed": 0,
      "coverage": 92,
      "failingTests": []
    },
    "patterns": {
      "reused": ["AuthGuard", "Service pattern", "Database transactions"],
      "created": ["TOTP verification pattern"],
      "violations": []
    },
    "loopBack": null,
    "metrics": {
      "totalTime": 35,
      "linesOfCode": 180,
      "complexity": "MEDIUM"
    }
  }
}
```

---

## Stage 4: Validator Output

```json
{
  "stage": 4,
  "agent": "07-validator",
  "timestamp": "2026-06-23T11:05:00Z",
  "status": "PASS",
  "details": {
    "summary": "Implementation validated against story and spec",
    "artifacts": [
      {
        "name": "VALIDATION_REPORT.md",
        "path": "artifacts/stage-4-verify/VALIDATION_REPORT.md"
      }
    ],
    "storyCompliance": {
      "allFilesMentioned": true,
      "allACTested": true,
      "storyMatchesImplementation": true,
      "issues": []
    },
    "briefCompliance": {
      "apiImplementedCorrectly": true,
      "dataModelCorrect": true,
      "uiComponentsCorrect": true,
      "issues": []
    },
    "codeQuality": {
      "followsPatterns": true,
      "noMagicNumbers": true,
      "noDuplicateLogic": true,
      "properErrorHandling": true,
      "issues": []
    },
    "security": {
      "authImplemented": true,
      "inputValidated": true,
      "noHardcodedSecrets": true,
      "sqlInjectionProtected": true,
      "xssProtected": true,
      "issues": []
    },
    "issues": [],
    "regressions": {
      "count": 0,
      "tests": []
    }
  }
}
```

---

## Stage 5: Consolidator Output

```json
{
  "stage": 5,
  "agent": "08-feature-consolidator",
  "timestamp": "2026-06-24T10:00:00Z",
  "status": "PASS",
  "details": {
    "summary": "Patterns consolidated, knowledge stored",
    "artifacts": [
      {
        "name": "CONSOLIDATION_REPORT.md",
        "path": "artifacts/stage-5-deliver/CONSOLIDATION_REPORT.md"
      }
    ],
    "executionMetrics": {
      "featureName": "Add two-factor authentication",
      "startDate": "2026-06-23T10:15:00Z",
      "endDate": "2026-06-24T10:00:00Z",
      "totalTime": 1470,
      "timePerStage": {
        "discover": 8,
        "plan": 12,
        "execute": 45,
        "verify": 20,
        "deliver": 10
      },
      "loopCount": 2,
      "escalationCount": 0
    },
    "patterns": {
      "reusedPatterns": [
        {
          "name": "Auth Guard Middleware",
          "usedIn": ["Route protection"],
          "effectiveness": "HIGH"
        }
      ],
      "newPatterns": [
        {
          "name": "TOTP Integration",
          "description": "Generate, store, verify TOTP tokens",
          "applicability": "Any 2FA or MFA feature",
          "nextUse": "FIDO2 support"
        }
      ],
      "patternIssues": []
    },
    "learnings": {
      "whatWorked": [
        "Clear separation of concerns",
        "Test-driven implementation",
        "Reusing existing patterns"
      ],
      "whatDidntWork": [],
      "surprises": ["TOTP library integration simpler than expected"],
      "nextTime": ["Pre-generate seed before showing QR", "Test with real authenticator apps earlier"]
    },
    "estimates": {
      "stageEstimates": {
        "discover": 8,
        "plan": 12,
        "execute": 45,
        "verify": 20,
        "deliver": 10
      },
      "confidence": 0.85,
      "actualVsEstimated": {
        "discover": 1.0,
        "plan": 1.0,
        "execute": 1.0,
        "verify": 1.0,
        "deliver": 1.0
      },
      "adjustedEstimate": 95
    },
    "recommendations": {
      "forSimilarFeatures": ["Use TOTP template for auth features"],
      "architectureImprovements": [],
      "processImprovements": ["Test with real apps earlier"]
    }
  }
}
```

---

## Validation Rules

### All Outputs Must Have

- [ ] stage (1-5)
- [ ] agent (agent name)
- [ ] timestamp (ISO8601)
- [ ] status (PASS/FAIL/LOOP_BACK/ESCALATE)
- [ ] details.summary (brief description)
- [ ] details.artifacts (at least 1)

### Stage-Specific Requirements

- [ ] Stage 1: architecture, filesIdentified, patterns
- [ ] Stage 2: userStory, acceptanceCriteria, fileList
- [ ] Stage 3: filesModified, testing results
- [ ] Stage 4: validation results, issues
- [ ] Stage 5: executionMetrics, patterns extracted

---

## How Validation Works

```typescript
import { validateOutputSchema } from '../harness/agent-output-schema';

const output = agent.output;  // JSON from agent
const validation = validateOutputSchema(1, '01-researcher', output);

if (!validation.valid) {
  console.error('Schema invalid:', validation.errors);
  // Ask agent to fix output
}
```
