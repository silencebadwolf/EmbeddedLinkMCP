# Engineering Hygiene Docs And Index Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refresh the local GitNexus index and align project documentation with the current pushed `main` state.

**Architecture:** This is a documentation and generated-index hygiene pass, not a runtime behavior change. The work keeps edits scoped to status documentation and GitNexus-generated metadata, with verification proving the repository still builds and tests after the docs update.

**Tech Stack:** Git, GitNexus CLI, OpenSpec, pnpm, TypeScript, Vitest, Vite.

---

### Task 1: Refresh Code Intelligence

**Files:**
- Inspect: `.gitnexus/`
- Potentially Modify: `AGENTS.md`
- Potentially Modify: `CLAUDE.md`

- [ ] **Step 1: Confirm baseline Git state**

Run: `git status --short --branch`
Expected: `main` is based on `origin/main`, with any current worktree changes understood before proceeding.

- [ ] **Step 2: Refresh GitNexus index**

Run: `node .gitnexus/run.cjs analyze`
Expected: command exits 0 and refreshes the repository index for current `HEAD`.

- [ ] **Step 3: Verify index freshness**

Run: `node .gitnexus/run.cjs status`
Expected: indexed commit matches current `HEAD` or the command explicitly reports the index is current.

### Task 2: Update Project Status Documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/DEVELOPMENT_PLAN.md`

- [ ] **Step 1: Inspect stale facts**

Run: `rg -n "41|500|49|542|59|DEVELOPMENT_PLAN|PROJECT_REQUIREMENTS|MCP|工具|测试" README.md docs/DEVELOPMENT_PLAN.md`
Expected: stale counts and root-relative document links are visible before editing.

- [ ] **Step 2: Inspect current MCP tool surface**

Run: `rg -n "tool|tools|register|surface|expected" src/mcp tests/unit/mcp`
Expected: source or test fixtures identify the current MCP tool groupings and counts.

- [ ] **Step 3: Apply minimal documentation corrections**

Update `README.md` links from root-level plan paths to `docs/` paths, replace obsolete test counts with the current verified count, and adjust the MCP tool summary to match the current registered surface. Update `docs/DEVELOPMENT_PLAN.md` with a dated hygiene note recording the refreshed validation baseline.

### Task 3: Verify And Commit

**Files:**
- Inspect: changed files from `git status --short`
- Stage: only files belonging to this documentation/index hygiene change

- [ ] **Step 1: Run repository validation**

Run: `openspec validate --all`
Expected: all OpenSpec changes validate.

Run: `pnpm run lint`
Expected: lint command exits 0.

Run: `pnpm test`
Expected: Vitest exits 0 and reports the current test file/test count.

- [ ] **Step 2: Run GitNexus change detection before commit**

Run: GitNexus `detect_changes()` for repository `link-mcp`.
Expected: reported affected scope matches documentation/index hygiene only.

- [ ] **Step 3: Stage only intended files**

Run explicit `git add --chmod=-x -- <path>` commands for the changed documentation files and any reviewed GitNexus-generated tracked metadata. Do not use `git add -A`.

- [ ] **Step 4: Commit**

Run: `git diff --cached --check`
Expected: no whitespace errors.

Run: `git diff --cached --summary`
Expected: no unexpected file modes or unrelated paths.

Run: `git commit -m "docs: 同步工程状态与代码索引"`
Expected: one focused commit is created.

- [ ] **Step 5: Post-commit verification**

Run: `git status --short --branch`
Expected: branch is ahead of `origin/main` by one commit unless the user later asks to push.

Run: `git show --stat --summary --oneline HEAD`
Expected: latest commit contains only the planned hygiene files.
