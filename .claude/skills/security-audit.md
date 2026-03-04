---
name: security-audit
description: >
  Comprehensive security audit skill covering the full threat surface of modern applications.
  Activate whenever the user mentions: security audit, vulnerability scan, security review,
  pen test prep, CVE check, secrets detection, dependency audit, threat modeling, OWASP check,
  smart contract audit, API security, AI agent security, or asks "is this secure?", "check for
  vulnerabilities", "audit my code", "what are the security risks". Also activate proactively
  when working on financial platforms, DeFi protocols, prediction markets, trading systems,
  APIs that handle money, or any system deploying AI agents — these are high-value targets
  that require a security pass even when the user hasn't asked for one.
---

# Security Audit Skill

A comprehensive, multi-layer security auditing framework grounded in the 2026 threat landscape.
Covers web/API security, infrastructure, AI agents, blockchain/smart contracts, and the
malware-free Living Off the Land (LOTL) attack patterns that dominate modern breaches.

## Threat Context (2026)

Before auditing, internalize the current threat reality:

- **82% of attacks are malware-free** — credential theft + legitimate tools, not exploits
- **29% of CVEs are exploited before disclosure** — patch windows are measured in hours
- **AI-generated phishing achieves 54% click-through** vs 12% for human-crafted
- **LOTL binary abuse up 51% YoY** — PowerShell, PsExec, RDP are the weapons now
- **Smart contract losses: $905M in 2025** from chained vulnerability exploits
- **48% of security professionals** rank agentic AI as the #1 attack vector for 2026

Classic detection-based thinking (find the malware, block the signature) is insufficient.
This audit focuses on **preventing malicious actions from succeeding even when the attacker
is already inside using legitimate tools and credentials.**

---

## Audit Execution Protocol

### Phase 0 — Scope Assessment

Before starting, determine:

1. What type of system is this? (web app, API, smart contract, AI agent, infrastructure)
2. What handles money or sensitive data?
3. What are the trust boundaries? (who can call what)
4. What's the blast radius if credential X is compromised?

Load the relevant reference files based on scope:

- Web/API systems → `references/owasp-web.md`
- Smart contracts / DeFi → `references/owasp-smartcontract.md`
- AI agents / LLM systems → `references/owasp-agentic.md`
- Infrastructure / AWS → `references/infrastructure.md`
- All systems → `references/lotl-credentials.md` (always relevant)

---

### Phase 1 — Secrets & Credential Exposure

**This is always first. Credential theft drives 82% of attacks.**

Scan for:

- [ ] Hardcoded API keys, private keys, JWT secrets in source code
- [ ] Secrets in environment files committed to git (`.env`, `.env.local`)
- [ ] Private keys or mnemonics in config files or comments
- [ ] Credentials in log output or error messages
- [ ] Database connection strings with passwords inline
- [ ] AWS access keys / IAM credentials outside Secrets Manager
- [ ] RPC endpoint API keys exposed in frontend bundles
- [ ] Secrets in Docker images or CI/CD configs

**Severity**: Any confirmed secret = CRITICAL. Stop and flag immediately.

Pattern check:

```
grep -rE "(PRIVATE_KEY|SECRET|PASSWORD|API_KEY|MNEMONIC)\s*=\s*['\"][^'\"]{8,}" --include="*.ts" --include="*.js" --include="*.env"
```

---

### Phase 2 — Authentication & Authorization

**Broken auth is OWASP #1 and the entry point for LOTL attacks.**

Check:

- [ ] JWT validation: algorithm enforcement (reject `alg: none`), expiry checked, signature verified server-side
- [ ] Wallet signature verification: replay protection, nonce uniqueness, domain binding (EIP-712)
- [ ] API key rotation policy exists and is enforced
- [ ] Rate limiting on auth endpoints (brute force protection)
- [ ] Session invalidation on logout / key revocation
- [ ] Privilege escalation paths — can a standard user reach admin endpoints?
- [ ] HMAC-SHA256 signatures on trading/financial endpoints (not just JWT)
- [ ] Timestamp validation on signed requests (replay window ≤ 30 seconds)

For multi-tier systems (AI agents + users + admins):

- [ ] Each tier has its own credentials, not shared
- [ ] Agent API keys have minimum required permissions (least privilege)
- [ ] Agent actions are attributable — full audit trail per API key

---

### Phase 3 — Injection Vulnerabilities

**OWASP Top 10 #5. SQL injection, command injection, prompt injection.**

- [ ] All database queries use parameterized statements / prepared queries
- [ ] No string concatenation in SQL queries
- [ ] Input validation before reaching ORM or query builder
- [ ] NoSQL injection patterns (MongoDB `$where`, JSON injection)
- [ ] Command injection in shell exec calls
- [ ] Path traversal in file operations
- [ ] **Prompt injection** — if system processes user-supplied text and passes it to an LLM or agent, can an attacker inject instructions?
- [ ] Server-Side Request Forgery (SSRF) — can user-controlled URLs be fetched server-side?

---

### Phase 4 — Supply Chain & Dependencies

**OWASP #3 in 2025. Overtook Injection due to ecosystem-wide compromise risk.**

- [ ] Run `npm audit` / `cargo audit` / `pip audit` — flag CRITICAL and HIGH findings
- [ ] Check for dependency confusion attacks (internal package names on public registries)
- [ ] Verify package integrity with lockfiles committed to git
- [ ] Scan for malicious skill/plugin files if using Claude Code or agent frameworks (prompt injection in markdown)
- [ ] CI/CD pipeline integrity — are build scripts fetching from untrusted sources?
- [ ] Docker base images — official images only, pinned by digest not tag
- [ ] Third-party SDK/API integrations — what data do they receive?

For AI agent systems specifically:

- [ ] MCP server sources are verified and audited
- [ ] Skills/plugins only from trusted, reviewed sources
- [ ] No skill instructs Claude to read `~/.ssh`, env vars, or exfiltrate data

---

### Phase 5 — API Security & Rate Limiting

**Especially critical for trading platforms and financial APIs.**

- [ ] WAF in place (Cloudflare or AWS WAF) with OWASP managed rule groups enabled
- [ ] DDoS protection (Cloudflare or AWS Shield Standard minimum)
- [ ] Rate limiting per API key, not just per IP
- [ ] Separate rate limit tiers: anonymous < authenticated < verified market maker
- [ ] Throttle (queue) rather than hard reject — prevents agent loop crashes
- [ ] WebSocket connections authenticated before data streams begin
- [ ] CORS policy is restrictive — not `*`
- [ ] HTTP security headers: `Strict-Transport-Security`, `X-Content-Type-Options`, `X-Frame-Options`
- [ ] API versioning — old deprecated endpoints disabled, not just undocumented
- [ ] Error responses don't leak stack traces, internal paths, or system info

---

### Phase 6 — Data Protection & Privacy

**OWASP #4 Cryptographic Failures.**

- [ ] All data in transit uses TLS 1.2+ (TLS 1.3 preferred)
- [ ] Sensitive data encrypted at rest (RDS encryption, S3 SSE, KMS)
- [ ] PII / wallet addresses hashed or encrypted in logs
- [ ] No sensitive financial data in URL parameters (use POST body)
- [ ] Portfolio values and positions never cached — always fetched from source of truth
- [ ] Redis cache keys don't store user-specific financial state without TTL
- [ ] Backup encryption verified
- [ ] GDPR/compliance: data retention policies enforced, deletion requests handled

---

### Phase 7 — Infrastructure & Cloud Posture

**Covers LOTL attack surface — what can an attacker do once inside?**

Read `references/infrastructure.md` for detailed AWS-specific checks.

Key checks:

- [ ] IAM least privilege — each service role has minimum permissions only
- [ ] No wildcard IAM policies (`"Action": "*"`)
- [ ] EC2/ECS instances in private subnets — no direct internet access
- [ ] Secrets in AWS Secrets Manager, not SSM Parameter Store plaintext
- [ ] CloudTrail enabled — all API calls logged
- [ ] S3 buckets not publicly accessible unless intentional (run S3 Block Public Access)
- [ ] Security Groups: no `0.0.0.0/0` on port 22 (SSH) or 5432 (Postgres)
- [ ] VPC flow logs enabled
- [ ] GuardDuty enabled for anomaly detection
- [ ] RDS not publicly accessible — private subnet only

---

### Phase 8 — Smart Contract / Blockchain

**Only if project includes on-chain components. Load `references/owasp-smartcontract.md`.**

OWASP Smart Contract Top 10 (2026):

1. Access Control Vulnerabilities
2. Business Logic Flaws
3. Price Oracle Manipulation
4. Flash Loan-Assisted Attacks
5. Lack of Input Validation
6. Unchecked External Calls
7. Arithmetic Errors
8. Reentrancy Attacks
9. Integer Overflow/Underflow
10. Proxy & Upgradeability Vulnerabilities _(new in 2026)_

Key checks:

- [ ] Access control on all privileged functions (`onlyOwner`, role checks)
- [ ] Oracle price feeds use TWAP, not spot price
- [ ] Flash loan attack surface analyzed for each state-changing function
- [ ] Reentrancy guards on all external calls that modify state
- [ ] Safe math / Solidity 0.8+ overflow protection
- [ ] Upgrade proxy governance — timelock + multisig required
- [ ] Settlement functions validated against off-chain order state

---

### Phase 9 — AI Agent Security

**Only if project deploys AI agents. Load `references/owasp-agentic.md`.**

OWASP Top 10 for Agentic Applications (2026):

1. Agent Goal Hijacking (prompt injection via documents/data)
2. Tool Misuse
3. Rogue Agents
4. Cascading Failures
5. Data Leakage
6. Insufficient Sandboxing
7. Excessive Agency
8. Trust Boundary Violations
9. Data Poisoning
10. Identity Spoofing

Key checks:

- [ ] Agents operate on principle of least agency — minimum tool access for the task
- [ ] All natural language inputs treated as untrusted (prompt injection surface)
- [ ] Agent actions are reversible where possible — no irreversible operations without human confirmation
- [ ] Kill switch implemented — can halt all agent activity immediately
- [ ] Agent identity is cryptographically verified (HMAC-signed API keys, not IP-based)
- [ ] Agent audit trail: every action logged with agent ID, timestamp, inputs, outputs
- [ ] Multi-agent trust: agents don't blindly trust instructions from other agents
- [ ] Position limits and daily loss caps enforced server-side, not just in agent code

---

## Confidence Classification

Use this system for every finding. Do not report LOW unless explicitly asked.

| Level       | Criteria                                                   | Action                               |
| ----------- | ---------------------------------------------------------- | ------------------------------------ |
| 🔴 CRITICAL | Confirmed vulnerability + direct path to exploit           | Report immediately, block deployment |
| 🟠 HIGH     | Vulnerable pattern confirmed, exploit path likely          | Fix before deployment                |
| 🟡 MEDIUM   | Pattern found, input source unclear or partially mitigated | Fix in next sprint                   |
| 🟢 LOW      | Theoretical / best practice gap                            | Informational only                   |

**Never report a finding as HIGH without confirmed evidence.** False positives erode trust
in the audit process. When uncertain, label MEDIUM with reasoning.

---

## Report Format

Structure every audit report as:

```
## Security Audit Report
**System**: [name]
**Date**: [date]
**Scope**: [what was audited]
**Auditor**: Claude (security-audit skill)

### Executive Summary
[2-3 sentences: overall posture, critical count, most urgent action]

### Findings

#### [VULN-001] [Title]
**Severity**: 🔴 CRITICAL
**Location**: `path/to/file.ts:42`
**Evidence**: [exact code or config showing the issue]
**Impact**: [what an attacker can do]
**Fix**: [specific remediation with code example]

[repeat for each finding]

### What Was Checked
[checklist of phases completed]

### Accepted Risks
[anything intentionally not fixed, with justification]
```

---

## Reference Files

Load these when relevant to the audit scope:

| File                                | When to Load                                 |
| ----------------------------------- | -------------------------------------------- |
| `references/owasp-web.md`           | Web apps, REST APIs, frontend                |
| `references/owasp-smartcontract.md` | Solidity, Anchor, any on-chain code          |
| `references/owasp-agentic.md`       | AI agents, LLM pipelines, autonomous systems |
| `references/infrastructure.md`      | AWS, cloud architecture, DevOps              |
| `references/lotl-credentials.md`    | Always — credential theft and LOTL patterns  |
