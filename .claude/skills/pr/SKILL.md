---
name: pr
description: Create a PR, wait for bot reviews, and respond to each comment autonomously. Handles the full workflow end-to-end — branch, commit, push, PR creation, bot review polling, and threaded replies — without asking the user to confirm routine steps.
argument-hint: "[base-branch]"
disable-model-invocation: true
allowed-tools: Bash(git *), Bash(gh *), Bash(pnpm wxt build), Read, Edit, Write, Grep, Glob, AskUserQuestion
---

# PR Workflow

## Overview

Drive the full pull request lifecycle end-to-end **without pausing for routine confirmation**:

1. **Create PR** — branch, commit, push, open PR
2. **Wait for bot reviews** — poll for Gemini / Greptile / Claude review bot comments
3. **Respond to reviews** — analyze each comment, fix or push back, reply in-thread
4. **Merge + post-merge cleanup** — opt-in (user says "merge"); the cleanup half runs automatically once a merge succeeds

`$ARGUMENTS` may contain a base branch name (e.g., `master`). Default: `master`.

---

## Core principle: autonomy by default

**Do not interrupt the user for routine decisions.** The user already invoked `/pr` — they want the PR created, reviewed, and handled. Pausing every step destroys the workflow.

### Decide autonomously (do NOT ask):
- **Branch name** — derive from the changes (e.g. `fix/signout-redirect-push-cleanup`, `feat/solver-progress-indicator`)
- **Commit message** — follow the repo's existing `type(scope): description` style (read `git log --oneline -20`)
- **Whether to split commits** — default to a single commit unless changes are clearly unrelated
- **Whether to push** — just push
- **PR title and body** — draft and create
- **Whether to agree/disagree with each bot comment** — analyze the code, decide, act
- **Whether to apply reviewer-suggested code** — apply if valid and in-scope

### Pause only for genuine problems (DO ask):
- Staged changes include files that look like secrets (`.env`, `credentials.json`, `*.pem`, unredacted tokens in source)
- `git push` is rejected (branch diverged, non-fast-forward) — ask before `git pull --rebase` or force-push
- `gh` is not authenticated — instruct the user to run `gh auth login`
- Build/test step fails during a fix for a review comment — report and stop
- A review comment demands a change that is clearly out-of-scope AND requires a judgement call the user should weigh (e.g. a large refactor a bot requested) — summarize and ask
- A destructive operation appears necessary (force-push, history rewrite, branch delete) — confirm first
- The user's changes look incomplete (e.g. a single `TODO` marker that wasn't meant to ship) — flag it

**Rule of thumb:** if the answer is predictable from context, don't ask. Announce what you're doing in one sentence and do it.

---

## Communication style

- One sentence per phase: "Creating branch `<name>` and committing." — not a block with proposed branch + commit message + "confirm?"
- Show the PR URL once it's created.
- Show a compact summary of each bot comment and your decision (agree/disagree + one-line reason).
- End with: PR URL, commits pushed, review replies posted.
- Avoid: "Proposed X. Confirm?", "Ready to push — confirm?", "Want me to proceed?"

---

## Phase 1: Create the PR

### Step 1: Inspect state (parallel)

```bash
git status
git diff --stat
git log --oneline -20
git branch --show-current
```

### Step 2: Branch

- If on `master` (or the base branch): derive a branch name from the changes and `git checkout -b <name>`.
- If already on a feature branch: use it.

Just do it — no confirmation.

### Step 3: Commit

- Stage the relevant changed files by name (not `git add -A`).
- Draft a message matching the repo style.
- Commit with HEREDOC:

```bash
git commit -m "$(cat <<'EOF'
<type>(<scope>): <short description>

<body paragraphs>

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Pause only if a staged file looks like secrets.

### Step 4: Push

```bash
git push -u origin <branch-name>
```

Just push. If rejected, ask before recovery.

### Step 5: Create PR

```bash
gh pr create --base <base-branch> --title "..." --body "$(cat <<'EOF'
## Summary
- bullets

## Test plan
- [ ] steps

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Capture the PR URL/number. Announce: "PR #<n> opened: <url>".

---

## Phase 2: Wait for bot reviews

Run the wait + fetch in the background so you don't block. Prefer a single background job that does `sleep 60 && gh api ... > /tmp/...`:

```bash
# In a single background command:
sleep 60
gh api repos/<owner>/<repo>/pulls/<pr>/comments > /tmp/pr<n>_comments.json
gh api repos/<owner>/<repo>/pulls/<pr>/reviews  > /tmp/pr<n>_reviews.json
```

When it completes, read both files. If no comments, wait another 60s (one more time). If still none after ~2 min, announce that no bot reviews arrived and end the flow.

---

## Phase 3: Respond to reviews

### Protocol (strict)

1. Reply **in the comment thread** (use `-F in_reply_to=<id>` on `/pulls/<pr>/comments`). Never `/pulls/comments/<id>/replies` (returns 404).
2. **Decide autonomously** for every comment — analyze the code, don't ask the user.
3. **Agree** → make the fix (bundle all agreed fixes into one commit), reply:
   ```
   Agree, fixed in <short-sha>. <one-line summary of change>. @<bot-name> review
   ```
4. **Disagree** → reply with a concrete reason:
   ```
   Disagree: <reason>. @<bot-name> review
   ```
5. **Every reply ends with exactly one bot tag that matches the comment author:**
   - `gemini-code-assist[bot]` → `@gemini-code-assist review`
   - `greptile-apps[bot]` → `@greptile-apps review`
   - Any other bot (unknown / self-hosted) → omit the tag rather than guess.
6. **Never tag two bots in one reply.**

### Step 7: Analyze comments (parallel if needed)

For each unique comment:
- Read the referenced file/lines to build context.
- Check if the suggestion is valid, in-scope, and low-risk.
- Decide Agree / Disagree / Partial (agree on one point, disagree on another — say so in the reply).

### Step 8: Apply fixes + commit + push

Bundle all agreed fixes into one commit:

```bash
git commit -m "$(cat <<'EOF'
<type>(<scope>): address review feedback

- <bullet per fix>

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git push
```

Capture the short SHA with `git rev-parse --short HEAD`.

### Step 9: Post replies (all in one batch)

Use a single shell block that captures `SHA=$(git rev-parse --short HEAD)` once, then posts every reply with `-F in_reply_to=<id>`. Don't post them one-at-a-time across turns.

---

## Phase 4: Merge + post-merge cleanup

### Merging is opt-in

**Do NOT auto-merge at the end of Phase 3.** Merge only when the user explicitly asks for it ("merge", "merge it", "/pr merge", etc.) after reviews are settled. Merging is destructive-on-history and worth a human ack.

When the user says merge:

1. **Sanity check first**:

   ```bash
   gh pr view <pr> --repo <owner>/<repo> --json mergeable,mergeStateStatus,statusCheckRollup
   ```

   If `mergeable != MERGEABLE` or there are unresolved bot threads from Phase 3, surface it and stop.

2. **Pick the merge method.** Default to `--merge` (merge commit) unless the repo strongly prefers squash — check `git log origin/master --oneline` for the pattern.

3. **Merge:**

   ```bash
   gh pr merge <pr> --repo <owner>/<repo> --merge --delete-branch
   ```

### Post-merge cleanup (runs automatically after a successful merge)

Once `gh pr merge` returns success, do this without asking:

```bash
# Switch back to master, fast-forward, delete the merged local branch.
git checkout master
git pull
git branch -d <feature-branch>
```

**End-state report:**

```
master @ <sha>
nothing to commit, working tree clean
```

### Gotchas

- **`gh pr view` arg form.** `gh pr view <number> --repo <owner>/<repo>`. The shorthand `gh pr view <owner>/<repo>#<number>` is interpreted as a branch name and fails with "no pull requests found for branch ...".
- **Local branch delete after `--delete-branch`.** `gh pr merge --delete-branch` only deletes the remote branch. The local branch still exists; clean it with `git branch -d <name>` after switching off it.

---

## Error handling

- `gh` not authenticated → tell user to run `gh auth login`.
- Push rejected → report and ask before `git pull --rebase`.
- Build/test failure while applying a fix → stop, report, let user decide.
- Comment ambiguous → reply with your best interpretation and note the uncertainty; don't pause the flow.

---

## Quick reference

| What | Command |
|------|---------|
| PR comments | `gh api repos/<owner>/<repo>/pulls/<pr>/comments` |
| PR reviews  | `gh api repos/<owner>/<repo>/pulls/<pr>/reviews` |
| Reply in-thread | `gh api repos/<owner>/<repo>/pulls/<pr>/comments -f body="..." -F in_reply_to=<id>` |
| Owner/repo  | `gh repo view --json owner,name` |
| Short SHA   | `git rev-parse --short HEAD` |
| PR mergeability | `gh pr view <pr> --repo <owner>/<repo> --json mergeable,mergeStateStatus` |
| Merge PR | `gh pr merge <pr> --repo <owner>/<repo> --merge --delete-branch` |
| Delete local branch | `git branch -d <name>` |
