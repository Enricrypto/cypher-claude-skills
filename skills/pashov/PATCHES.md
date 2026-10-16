# Pashov Audit Group skills — vendored copy

- **Source:** https://github.com/pashov/skills (MIT, see `LICENSE`)
- **Pinned commit:** `92b0ea6786e6c210bc9a839e4813d50876c1c550` (2026-10-05)
- **Versions:** solidity-auditor 4.1 · x-ray 2 · fizz 1
- **Vendored:** 2026-10-16. `.github/`, `static/` (demo GIFs), the repo README/CLAUDE.md were not copied.
- **Installed as:** symlinks `~/.claude/skills/software/pashov-{solidity-auditor,x-ray,fizz}` → this folder.
  They sit under `software/` on purpose: Claude Code does not auto-discover them, so their broad
  triggers ("audit", "summarize this protocol") never fire in non-Solidity projects. Activate with
  `Read` on `<dir>/SKILL.md`, like every other skill here.

**Paths:** patches 2 and 4 name the skills by their symlink path (`~/.claude/skills/software/pashov-*`),
never by where this repo is checked out, so a move or a merge only needs the symlinks repointed.
Expand `~` to the home directory when a tool needs an absolute path.

## Review summary (2026-10-16)

All 15 scripts and every prompt file were scanned for network calls, process spawning, deletes,
home-dir/secret/env access, servers and prompt-injection phrasing; every hit was read in full.
No exfiltration, no secret access, no injection. x-ray's git analyzer runs only
`git -C <repo> log/diff/blame/rev-parse`. fizz writes only under `test/fizz/`, `fizz_data/`, the
fuzzer configs at the project root and a `[profile.fuzz]` in `foundry.toml`. solidity-auditor's
agents are told they are read-only inside the audited repo, unconditionally.

Known and accepted: `fizz/references/setup-playbook.md` tells the harness to hard-code a known
**test** private key in `Base.sol` for signer roles. Test-only; secret scanners may flag it.

## Local patches — re-apply after every update

1. **`fizz/scripts/select_functions.js` — picker server bound to loopback.**
   Upstream: `server.listen(0)` (all interfaces) + `Access-Control-Allow-Origin: *`, so while the
   guided-mode picker was open any LAN host or any web page could `POST /save` and overwrite
   `entry-point-selection.json`. Patched: `server.listen(0, '127.0.0.1')`, CORS headers removed
   (the page is same-origin). Automatic mode never starts the server.
2. **`fizz/SKILL.md` — x-ray Acquisition Protocol, Attempt 2.**
   Upstream: `git clone` into `/tmp` and `cp -r` into top-level `~/.claude/skills/x-ray`
   (auto-discovered, outside version control). Patched: read the vendored x-ray through its
   symlink, `~/.claude/skills/software/pashov-x-ray/SKILL.md`, and run it inline. Nothing is cloned
   or installed.
3. **Version checks removed.** `solidity-auditor/SKILL.md` Turn 1 (d, e and the compare
   paragraph) and `x-ray/SKILL.md` Step 1 item 0 did a `curl` to raw.githubusercontent.com on
   every run. Removed: this copy is pinned and updated deliberately.
4. **`solidity-auditor/SKILL.md` Turn 1 b — explicit `{resolved_path}`.**
   Upstream located `references/` with a Glob for `**/references/hacking-agents/shared-rules.md`
   from the project root. Glob skips symlinks and never reaches this folder from a project, so it
   is replaced by the symlink path `~/.claude/skills/software/pashov-solidity-auditor/references`.

5. **`x-ray/scripts/enumerate.sh` — portable grep (macOS).**
   Upstream used `grep -P` (PCRE) on 15 lines; BSD grep on macOS has no `-P`, so every nSLOC,
   NatSpec and test-category count silently came out 0 (the report would claim no tests).
   The patterns only used `\s` / `\S`, so: `-P` → `-E`, `\s` → `[[:space:]]`,
   `\S` → `[^[:space:]]`. Same semantics on BSD and GNU grep. Found on the first Mostro run.
   Worth sending upstream.

## Updating

1. Clone upstream to a scratch dir; `git log` the range since the pinned commit.
2. Re-run the review scan above on the diff (scripts and prompt files).
3. Copy the three folders over this one, re-apply patches 1–4, update the pinned commit here.
