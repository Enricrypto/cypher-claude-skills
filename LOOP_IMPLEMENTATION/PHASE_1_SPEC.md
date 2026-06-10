# Phase 1: Loop Foundations — Detailed Specification

**Duration:** 2-3 weeks  
**Status:** Implementation Ready  
**Team Size:** 1-3 developers  
**Scope:** Worktrees, automations, verification gates, explicit loop stages

---

## Executive Summary

Phase 1 transforms the implicit Feature Factory (7-agent chain) into an explicit, automated loop with:

1. **Loop Trigger Engine** — CLI to start loops, manage state, enforce budgets
2. **Worktree Manager** — Automatic parallel agent execution without collisions
3. **Test Database Setup** — Local PostgreSQL with reset fixtures
4. **Verification Gates** — Per-stage quality checks that prevent bad code from advancing
5. **Enhanced Agent Prompts** — Agents aware of loop context, budget, prior runs
6. **Loop State Tracking** — MemoryKit integration for loop persistence

**Outcome:** `loop start "feature name"` runs full feature loop autonomously with E2E readiness built in.

---

## Part 1: Loop Trigger Engine

### What It Does

```
loop start "add auth feature"
  ↓
Creates worktrees for backend + frontend
  ↓
Runs DISCOVER (Researcher Agent)
  ↓
Tracks token budget
  ↓
Enforces verification gates
  ↓
Reports: "Feature ready for CHECKPOINT 1"
  ↓
Waits for your approval
  ↓
Continues autonomously to EXECUTE
  ↓
Reports final status
```

### CLI Commands

```bash
# Start a new feature loop
loop start "feature name"
  # Options:
  # --dry-run            (don't actually run, just show plan)
  # --budget 100000      (override default token budget)
  # --skip-checkpoint    (auto-approve at CHECKPOINT 1)
  # --parallel           (run builders in parallel)

# Check loop status
loop status

# Stop a running loop
loop stop

# List previous loops
loop list

# Re-run a previous loop
loop resume "feature-name-date"

# Reset a loop (delete branches, clean up)
loop reset "feature-name-date"
```

### Implementation Files

Create:
```
cypher-claude-skills/
├── cli/
│   ├── loop.js                 (main CLI entry point)
│   ├── commands/
│   │   ├── start.js           (loop start command)
│   │   ├── status.js          (loop status command)
│   │   ├── stop.js            (loop stop command)
│   │   ├── list.js            (loop list command)
│   │   ├── resume.js          (loop resume command)
│   │   └── reset.js           (loop reset command)
│   ├── utils/
│   │   ├── git-manager.js     (git operations)
│   │   ├── budget-tracker.js  (token budget enforcement)
│   │   ├── state-manager.js   (loop state in MemoryKit)
│   │   └── checkpoint.js      (approval gates)
│   └── config/
│       ├── budgets.json       (token budgets per stage)
│       ├── agents.json        (agent mappings)
│       └── timeouts.json      (stage timeouts)
```

### `loop.js` Structure

```javascript
#!/usr/bin/env node

const program = require('commander');
const path = require('path');

// Load sub-commands
program
  .command('start <feature-name>')
  .option('--dry-run', 'Show plan without executing')
  .option('--budget <tokens>', 'Override token budget')
  .option('--skip-checkpoint', 'Auto-approve at checkpoints')
  .action(require('./commands/start'));

program
  .command('status')
  .action(require('./commands/status'));

program
  .command('stop')
  .action(require('./commands/stop'));

program
  .command('list')
  .action(require('./commands/list'));

program
  .command('resume <feature-date>')
  .action(require('./commands/resume'));

program
  .command('reset <feature-date>')
  .action(require('./commands/reset'));

program.parse(process.argv);
```

### `commands/start.js` Logic

```javascript
const GitManager = require('../utils/git-manager');
const BudgetTracker = require('../utils/budget-tracker');
const StateManager = require('../utils/state-manager');
const { invokeAgent } = require('../utils/agent-invoker');

async function startLoop(featureName, options) {
  const loopId = `${featureName}-${Date.now()}`;
  
  try {
    // 1. Validate project state
    console.log('✓ Validating project state...');
    await GitManager.ensureCleanWorkingTree();
    await GitManager.ensureFreshMain();
    
    // 2. Create worktrees
    console.log('✓ Creating worktrees for parallel work...');
    const backendPath = await GitManager.createWorktree(loopId, 'backend');
    const frontendPath = await GitManager.createWorktree(loopId, 'frontend');
    
    // 3. Initialize loop state
    console.log('✓ Initializing loop state...');
    await StateManager.initializeLoop(loopId, {
      featureName,
      startTime: new Date(),
      budget: options.budget || 100000,
      stage: 'DISCOVER',
      checkpoints: []
    });
    
    // 4. DISCOVER Stage
    console.log('✓ Running DISCOVER stage (Researcher)...');
    const discoverResult = await invokeAgent('01-researcher', {
      prompt: `Research feature: ${featureName}`,
      loopContext: { loopId, stage: 'DISCOVER' }
    });
    
    // 5. Save discover results
    await StateManager.saveStageResult(loopId, 'DISCOVER', discoverResult);
    
    // 6. PLAN Stage
    console.log('✓ Running PLAN stage (Story Writer + Spec Writer)...');
    const planResult = await invokeAgent('02-story-writer', {
      prompt: `Write story for: ${featureName}`,
      loopContext: { loopId, stage: 'PLAN' },
      researcherReport: discoverResult
    });
    
    // 7. CHECKPOINT 1
    console.log('\n⏸  CHECKPOINT 1: Approve the story');
    console.log('Story summary:', planResult.summary);
    
    if (!options['skip-checkpoint']) {
      const approved = await askForApproval();
      if (!approved) {
        console.log('✗ Feature development cancelled');
        await cleanup(loopId);
        process.exit(1);
      }
    }
    
    // 8. EXECUTE Stage (parallel)
    console.log('✓ Running EXECUTE stage (Backend + Frontend in parallel)...');
    const [backendResult, frontendResult] = await Promise.all([
      invokeAgent('04-backend-builder', { 
        loopContext: { loopId, stage: 'EXECUTE', worktree: backendPath },
        specReport: planResult.spec
      }),
      invokeAgent('05-frontend-builder', { 
        loopContext: { loopId, stage: 'EXECUTE', worktree: frontendPath },
        specReport: planResult.spec
      })
    ]);
    
    // 9. VERIFY Stage
    console.log('✓ Running VERIFY stage (Test Verifier + Validator)...');
    const verifyResult = await invokeAgent('06-test-verifier', {
      loopContext: { loopId, stage: 'VERIFY' },
      backendCode: backendResult,
      frontendCode: frontendResult,
      storyAcceptanceCriteria: planResult.acceptanceCriteria
    });
    
    // 10. ITERATE if needed (up to 3 times)
    let attempts = 0;
    while (!verifyResult.allTestsPass && attempts < 3) {
      attempts++;
      console.log(`✓ ITERATE attempt ${attempts}/3...`);
      
      const fixResult = await invokeAgent(
        verifyResult.failedIn === 'backend' ? '04-backend-builder' : '05-frontend-builder',
        {
          loopContext: { loopId, stage: 'ITERATE', attempt: attempts },
          failureReport: verifyResult.failureReport
        }
      );
      
      // Re-verify
      const reVerifyResult = await invokeAgent('06-test-verifier', {
        loopContext: { loopId, stage: 'VERIFY' },
        backendCode: verifyResult.failedIn === 'backend' ? fixResult : backendResult,
        frontendCode: verifyResult.failedIn === 'frontend' ? fixResult : frontendResult
      });
      
      Object.assign(verifyResult, reVerifyResult);
    }
    
    if (!verifyResult.allTestsPass) {
      console.log('✗ Feature failed verification after 3 attempts');
      console.log('CHECKPOINT 3: Human review needed');
      // Exit, require manual fix
      process.exit(1);
    }
    
    // 11. DELIVER
    console.log('✓ Merging branches...');
    await GitManager.mergeWorktrees(loopId);
    
    // 12. CONSOLIDATE
    console.log('✓ Consolidating learnings...');
    await invokeAgent('08-feature-consolidator', {
      loopContext: { loopId },
      loopResults: {
        discover: discoverResult,
        plan: planResult,
        backend: backendResult,
        frontend: frontendResult,
        verify: verifyResult
      }
    });
    
    // 13. Complete
    console.log('\n✅ Feature loop complete!');
    console.log('Status: Ready for PR');
    console.log('Branch: feat/' + featureName);
    console.log('Next: git push origin feat/' + featureName);
    
    await StateManager.finalizeLoop(loopId, 'COMPLETE');
    
  } catch (error) {
    console.error('✗ Loop failed:', error.message);
    await StateManager.finalizeLoop(loopId, 'FAILED');
    process.exit(1);
  }
}

module.exports = startLoop;
```

---

## Part 2: Worktree Manager

### What It Does

Automatically creates isolated git worktrees for backend and frontend agents, preventing file collisions.

### Architecture

```
Original repo:
  main branch
    src/
    tests/
    ...

Worktree 1 (Backend):
  /workspace/feat-auth-backend
    feat/auth-01-backend branch
    Independent src/, tests/

Worktree 2 (Frontend):
  /workspace/feat-auth-frontend
    feat/auth-02-frontend branch
    Independent src/, tests/

Both pull from same repo, zero collisions
```

### Implementation

Create `cli/utils/git-manager.js`:

```javascript
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

class GitManager {
  static async ensureCleanWorkingTree() {
    const status = execSync('git status --porcelain').toString();
    if (status) {
      throw new Error('Working tree not clean. Commit or stash changes.');
    }
  }

  static async ensureFreshMain() {
    execSync('git checkout main');
    execSync('git pull origin main');
  }

  static async createWorktree(loopId, agent) {
    const branchName = `feat/${loopId}-${agent}`;
    const worktreePath = path.resolve(
      process.cwd(),
      `../workspace`,
      `${loopId}-${agent}`
    );

    // Create directory
    fs.mkdirSync(path.dirname(worktreePath), { recursive: true });

    // Create worktree with new branch
    execSync(
      `git worktree add --track -b ${branchName} ${worktreePath}`,
      { stdio: 'inherit' }
    );

    return {
      path: worktreePath,
      branch: branchName,
      agent
    };
  }

  static async mergeWorktrees(loopId) {
    // Both branches merged to main
    execSync(`git checkout main`);
    execSync(`git pull origin main`);
    execSync(`git merge feat/${loopId}-backend --no-edit`);
    execSync(`git merge feat/${loopId}-frontend --no-edit`);
    execSync(`git push origin main`);
  }

  static async cleanupWorktrees(loopId) {
    // Remove worktrees
    execSync(`git worktree prune`);
    
    // Delete remote branches
    try {
      execSync(`git push origin --delete feat/${loopId}-backend`);
      execSync(`git push origin --delete feat/${loopId}-frontend`);
    } catch (e) {
      // Branches may already be deleted
    }
  }
}

module.exports = GitManager;
```

### Naming Convention

```
Branch names follow pattern: feat/{loopId}-{agent}
  - feat/auth-1718044000000-backend
  - feat/auth-1718044000000-frontend

Worktree paths:
  - ../workspace/auth-1718044000000-backend/
  - ../workspace/auth-1718044000000-frontend/

Ensures:
  ✓ Unique per run (timestamp-based)
  ✓ Clear purpose (backend/frontend)
  ✓ Easy cleanup (find by loopId)
```

---

## Part 3: Test Database Setup

### Local PostgreSQL Configuration

Create `tests/setup.ts`:

```typescript
import { Pool } from 'pg';

const pool = new Pool({
  host: process.env.TEST_DB_HOST || 'localhost',
  port: parseInt(process.env.TEST_DB_PORT || '5432'),
  database: process.env.TEST_DB_NAME || 'test',
  user: process.env.TEST_DB_USER || 'postgres',
  password: process.env.TEST_DB_PASSWORD || 'postgres',
});

// Run before all tests
beforeAll(async () => {
  // Create schema from migrations
  const migrations = fs.readdirSync('./migrations').sort();
  for (const migration of migrations) {
    const sql = fs.readFileSync(`./migrations/${migration}`, 'utf8');
    await pool.query(sql);
  }
});

// Reset database before each test
beforeEach(async () => {
  // Truncate all tables
  const tables = ['users', 'listings', 'reviews', 'orders'];
  for (const table of tables) {
    await pool.query(`TRUNCATE ${table} RESTART IDENTITY CASCADE;`);
  }
});

// Close pool after all tests
afterAll(async () => {
  await pool.end();
});

export { pool };
```

Update `package.json`:

```json
{
  "scripts": {
    "test": "jest --setupFilesAfterEnv ./tests/setup.ts",
    "test:watch": "jest --watch --setupFilesAfterEnv ./tests/setup.ts",
    "test:coverage": "jest --coverage --setupFilesAfterEnv ./tests/setup.ts"
  },
  "jest": {
    "testEnvironment": "node",
    "setupFilesAfterEnv": ["./tests/setup.ts"],
    "testMatch": ["**/tests/**/*.test.ts"]
  }
}
```

### Test Fixtures

Create `tests/fixtures.ts`:

```typescript
import { pool } from './setup';

export async function seedTestData() {
  // Create test user
  const userResult = await pool.query(
    `INSERT INTO users (email, password, name) 
     VALUES ($1, $2, $3) 
     RETURNING *`,
    ['test@example.com', 'hashed_password', 'Test User']
  );
  const user = userResult.rows[0];

  // Create test listing
  const listingResult = await pool.query(
    `INSERT INTO listings (title, description, price, owner_id) 
     VALUES ($1, $2, $3, $4) 
     RETURNING *`,
    ['Test Listing', 'A test listing', 100, user.id]
  );
  const listing = listingResult.rows[0];

  return { user, listing };
}

// Usage in tests:
describe('API: POST /listings', () => {
  let testData;

  beforeEach(async () => {
    testData = await seedTestData();
  });

  it('creates listing', async () => {
    const response = await request(app)
      .post('/listings')
      .set('Authorization', `Bearer ${testData.user.id}`)
      .send({ title: 'New', description: 'New listing', price: 200 });

    expect(response.status).toBe(201);
  });
});
```

---

## Part 4: Verification Gates

### Stage-by-Stage Gates

Create `cli/utils/verification-gates.js`:

```javascript
const GATES = {
  DISCOVER: {
    name: 'DISCOVER Gate',
    checks: [
      'Researcher Report complete',
      'No critical unknowns flagged',
      'Prior patterns surfaced',
      'Risk assessment done'
    ],
    blocker: 'Must have clean Researcher Report'
  },

  PLAN: {
    name: 'PLAN Gate',
    checks: [
      'User Story approved at CHECKPOINT 1',
      'Acceptance criteria are testable',
      'Technical spec approved at CHECKPOINT 2',
      'API design documented',
      'Database schema designed'
    ],
    blocker: 'Cannot proceed without CHECKPOINT 1 approval'
  },

  EXECUTE: {
    name: 'EXECUTE Gate',
    checks: [
      'Backend code compiles',
      'Frontend code compiles',
      'Unit tests pass (backend)',
      'Unit tests pass (frontend)',
      'No hardcoded secrets',
      'No console.log in code'
    ],
    blocker: 'Code must compile and unit tests must pass'
  },

  VERIFY: {
    name: 'VERIFY Gate',
    checks: [
      'All acceptance tests pass',
      'Integration tests pass',
      'Coverage >= 70%',
      'Linter passes (eslint)',
      'Type checks pass (tsc)',
      'Security audit passed',
      'No hardcoded PII'
    ],
    blocker: 'All verification checks must pass before merge'
  },

  ITERATE: {
    name: 'ITERATE Gate',
    checks: [
      'Fix addresses root cause',
      'All affected tests pass',
      'No new test failures',
      'Attempt count < 3'
    ],
    blocker: 'After 3 attempts, escalate to human review'
  }
};

class VerificationGates {
  static async checkStage(stageName, context) {
    const gate = GATES[stageName];
    
    console.log(`\n⏸  ${gate.name}`);
    console.log('Checking requirements:');
    
    const results = [];
    for (const check of gate.checks) {
      const result = await this.performCheck(check, context);
      results.push({ check, passed: result });
      console.log(`  ${result ? '✓' : '✗'} ${check}`);
    }
    
    const allPassed = results.every(r => r.passed);
    
    if (!allPassed) {
      console.error(`\n✗ ${gate.blocker}`);
      return false;
    }
    
    console.log(`✓ ${stageName} gate passed\n`);
    return true;
  }

  static async performCheck(checkName, context) {
    // Implement actual checks based on context
    // Examples:
    // - "Backend code compiles" → try to build
    // - "Unit tests pass" → run npm test
    // - "No hardcoded secrets" → grep for API_KEY patterns
    // - "Linter passes" → run eslint
    
    switch (checkName) {
      case 'Backend code compiles':
        return await this.checkCompile('backend', context);
      case 'Frontend code compiles':
        return await this.checkCompile('frontend', context);
      case 'Unit tests pass (backend)':
        return await this.checkTests('backend', context);
      case 'Unit tests pass (frontend)':
        return await this.checkTests('frontend', context);
      case 'No hardcoded secrets':
        return await this.checkSecrets(context);
      case 'Linter passes (eslint)':
        return await this.checkLinter(context);
      case 'Type checks pass (tsc)':
        return await this.checkTypeScript(context);
      case 'All acceptance tests pass':
        return await this.checkAcceptanceTests(context);
      // ... more checks
      default:
        return true;
    }
  }

  static async checkCompile(layer, context) {
    try {
      execSync('npm run build', { cwd: context.worktreePath });
      return true;
    } catch {
      return false;
    }
  }

  static async checkTests(layer, context) {
    try {
      execSync('npm test', { cwd: context.worktreePath });
      return true;
    } catch {
      return false;
    }
  }

  static async checkSecrets(context) {
    try {
      execSync(`grep -r "API_KEY\\|SECRET\\|password" src/ --exclude-dir=node_modules`, 
        { cwd: context.worktreePath });
      return false; // Found hardcoded secrets
    } catch {
      return true; // No secrets found
    }
  }

  static async checkLinter(context) {
    try {
      execSync('eslint src/', { cwd: context.worktreePath });
      return true;
    } catch {
      return false;
    }
  }

  static async checkTypeScript(context) {
    try {
      execSync('tsc --noEmit', { cwd: context.worktreePath });
      return true;
    } catch {
      return false;
    }
  }

  static async checkAcceptanceTests(context) {
    try {
      execSync('npm run test:e2e', { cwd: context.worktreePath });
      return true;
    } catch {
      return false;
    }
  }
}

module.exports = VerificationGates;
```

---

## Part 5: Enhanced Agent Prompts

### Add Loop Context to Each Agent

Modify each agent file to include:

```
[At start of agent prompt]

## Loop Context

You are part of a loop-based feature development system.

**Current Loop:** {loopId}
**Stage:** {stage} (DISCOVER, PLAN, EXECUTE, VERIFY, ITERATE)
**Token Budget:** {tokenBudget} remaining
**Attempt:** {attemptNumber} (if iterating)
**Prior Results:** {priorStageResults}

**Your Job This Stage:**
- Execute {stage} stage of loop
- Respect token budget (warn at 80%, stop at 100%)
- Check verification gate before concluding
- Store results to MemoryKit for next stage
- Escalate if stuck (max 3 attempts)

[Rest of agent prompt follows]
```

Example for Researcher Agent:

```markdown
## Loop Context

**Loop:** feat-auth-{timestamp}
**Stage:** DISCOVER
**Token Budget:** 10,000 / 10,000 remaining
**Attempt:** 1

---

# Codebase Researcher

[Rest of researcher prompt]
```

### Checklist for Each Agent

Every agent should include:

```markdown
## Loop Gate Checklist (Before Concluding)

Before you report completion:
- [ ] Stage objectives complete
- [ ] Verification gate passed
- [ ] Results stored to MemoryKit
- [ ] Token budget respected
- [ ] No blocking issues

If any ✗, escalate or iterate.

## Escalation Rules

If you're stuck:
- Attempt 1-2: Try to fix, loop back to EXECUTE
- Attempt 3: Report "stuck after 3 attempts" → human review (CHECKPOINT 3)

If assumptions are wrong:
- Loop back to PLAN with corrected requirements
```

---

## Part 6: Implementation Checklist

### Week 1: CLI Foundation

- [ ] Create `cli/` folder structure
- [ ] Implement `loop.js` entry point
- [ ] Implement `commands/start.js` (main command)
- [ ] Implement `cli/utils/git-manager.js` (worktrees)
- [ ] Add `npm run loop start "test"` command
- [ ] Test on small feature (no production changes yet)

### Week 2: Verification & Automation

- [ ] Implement `cli/utils/budget-tracker.js`
- [ ] Implement `cli/utils/verification-gates.js`
- [ ] Implement `cli/utils/checkpoint.js` (approval prompts)
- [ ] Implement `cli/utils/state-manager.js` (MemoryKit integration)
- [ ] Add verification gates to each stage
- [ ] Test budget enforcement (warn/stop at limits)

### Week 3: Integration & Testing

- [ ] Update all 7 agent prompts with loop context
- [ ] Test full loop: `loop start "add payment"`
- [ ] Verify worktrees created/cleaned up
- [ ] Verify token budget tracked correctly
- [ ] Verify MemoryKit stores stage results
- [ ] Test recovery: `loop resume` after interruption
- [ ] Document: Create README for `loop` command

---

## Part 7: Success Criteria

Phase 1 is complete when:

- ✅ `loop start` command works
- ✅ Worktrees created automatically
- ✅ Backend + Frontend run in parallel
- ✅ Verification gates prevent bad code advancing
- ✅ Token budget enforced (warn at 80%, stop at 100%)
- ✅ Loop state persisted in MemoryKit
- ✅ Agents aware of loop context
- ✅ Full feature loop runs autonomously (DISCOVER → EXECUTE → VERIFY → ITERATE)
- ✅ 3 human checkpoints working (story, brief, PR)
- ✅ Test database resets between runs
- ✅ No file collisions between agents

---

## Part 8: Example: Running a Feature Loop

```bash
$ loop start "add payment processing"

✓ Validating project state...
✓ Creating worktrees for parallel work...
  Backend: /workspace/payment-1718044000000-backend
  Frontend: /workspace/payment-1718044000000-frontend

✓ Running DISCOVER stage (Researcher)...
  [Agent researches codebase]
  [Surfaces prior patterns from MemoryKit]
  [Flags risks]

✓ Running PLAN stage (Story Writer + Spec Writer)...
  [Creates acceptance criteria]
  [Designs technical approach]

⏸  CHECKPOINT 1: Approve the story
────────────────────────────────────
Story: User adds payment method
Criteria:
  - Form validates card number
  - Submits to Stripe API
  - Shows success message
  - Shows error if invalid

Accept? (y/n): y

✓ Running EXECUTE stage (Backend + Frontend in parallel)...
  [Backend: Implement payment endpoint]
  [Frontend: Build payment form]
  [Both run simultaneously in worktrees]

✓ Running VERIFY stage...
  ✓ Acceptance tests pass
  ✓ Coverage 85%
  ✓ Linter passes
  ✓ Type checks pass
  ✓ Security audit passed

✅ Feature complete!
Branch: feat/payment-1718044000000
Next: git push origin feat/payment-1718044000000

$ git push origin feat/payment-1718044000000
$ # Create PR on GitHub
```

---

## Part 9: Troubleshooting

### Worktree Issues

```bash
# Worktree got stuck?
git worktree prune  # Clean up orphaned worktrees

# List all worktrees
git worktree list

# Remove specific worktree
git worktree remove /path/to/worktree
```

### Token Budget Issues

```bash
# Check token usage
loop status
# Shows: "Token budget: 85,000 / 100,000"

# Override budget for one run
loop start "feature" --budget 150000

# Set permanent default
export LOOP_BUDGET=120000
```

### Agent Failures

```bash
# If agent fails, resume the loop
loop resume "feature-date"
# Picks up from where it left off

# Or reset and start over
loop reset "feature-date"
git branch -D feat/feature-date-backend feat/feature-date-frontend
loop start "feature"
```

---

## Handoff to Phase 2

After Phase 1 is complete and tested:

1. ✅ Loop trigger engine works
2. ✅ Worktrees prevent collisions
3. ✅ Verification gates enforce quality
4. ✅ Token budget respected
5. ✅ MemoryKit integration working

**Move to Phase 2:** Production Standards Library + GitHub Integration

Phase 2 adds:
- MCP connectors (GitHub auto-draft PRs, link issues)
- E2E readiness checklist enforcement
- Test database fixtures
- Performance monitoring

---

**End of Phase 1 Spec**

