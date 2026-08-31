# Code Review with Inline PR Comments

You are an expert code reviewer for this codebase. Review a pull request and post findings as inline comments on the PR.

`$ARGUMENTS` contains the PR number (e.g., `72` or `PR72`). Strip any "PR" prefix.

---

## Phase 0: Never Touch the Working Checkout

**Do not switch branches — ever.** Another session may be working in this checkout, and a review that runs `git checkout` / `git switch` / `gh pr checkout` / `git reset` / `git stash` pulls the branch out from under it.

Automated reviews already start you in a **throwaway detached worktree at the PR head**. The review wrapper creates it before you start and removes it after you exit, one per reviewer — so you never create or remove a worktree yourself, and `git worktree add`/`remove` is blocked along with the commands above. The guard (a `git` shim first on your `PATH`) lives outside this repo, so a PR cannot weaken the guard that reviews it.

**Two directories in that worktree are NOT this PR's.** Before you start, the wrapper deletes
`.claude/` and `.wolf/` at the PR head and copies the main checkout's versions in their place
(`_seed_trusted_config`). That is deliberate and not negotiable: agent configuration is executable
— `.claude/settings.json` registers the hooks that run during your own review — so a PR left to
supply its own would be able to weaken the guard reviewing it.

Two consequences, both of which have already cost review time:

- **`git status` is never clean in a fresh review worktree, and that is not a fault.** Expect
  modifications where the PR edits those paths, deletions where the PR ADDS a file the main
  checkout does not have, and untracked files wherever the main checkout is ahead or has
  uncommitted work of its own. sked_ai#2349 saw 22 such entries and both arms reported the
  checkout as suspect. Do not.
- **For a PR that touches `.claude/` or `.wolf/`, the file on disk is master's, not the one you
  are reviewing.** Read those paths with `git show HEAD:<path>` or from `gh pr diff` — never from
  disk. Everything outside those two directories is genuinely the PR's code.

A review needs no checkout at all: `gh pr diff` gives the diff, and `gh api -H "Accept: application/vnd.github.raw" repos/{owner}/{repo}/contents/<path>?ref=<head_sha>` gives any file at the PR head. Without that header the API returns JSON metadata with the file in a base64 `content` field, not the text (and it omits `content` entirely above 1 MB).

---

## Phase 1: Gather PR Context

1. Parse the PR number from `$ARGUMENTS`. If empty, run `gh pr list` and ask the user which PR to review.
2. Run in parallel:
   ```bash
   gh pr view <number>
   gh pr diff <number>
   gh pr view <number> --json headRefOid --jq '.headRefOid'
   ```
3. Read the key source files touched in the diff to understand the changes in context. Don't just rely on the diff — read surrounding code to catch issues the diff alone won't reveal. **Confirm the files on disk are actually at the PR head before trusting them:** `git rev-parse HEAD` must equal the `headRefOid` from step 2. If it matches (the normal case in a review worktree, see Phase 0), read the files directly. If it does not, you are in a shared checkout on some other ref — do not read files from disk; fetch them with `gh api` at `<head_sha>` instead. Either way, do not check anything out.

---

## Phase 2: Analyze the Changes

This is a WXT + Preact browser extension in TypeScript, BYOK (the user's own API keys), with no account and no backend. Review with that shape in mind:

- **Code correctness** — logic bugs, edge cases, off-by-one errors, silently swallowed rejections
- **Project conventions** — patterns already used in `src/`; `.impeccable.md` for the design/voice rules the website and UI copy must hold to
- **Type safety** — mismatched signatures, missing `| undefined`/`| null` in the types, `as` casts that paper over a real mismatch, `any` leaking out of a provider adapter in `src/lib/llm/`
- **Extension surface** — `wxt.config.ts` manifest permissions and host permissions (is a new one actually needed, and is it as narrow as it can be?), content-script injection into untrusted pages, message passing between content script / background / sidepanel (`src/lib/messaging/`), `chrome.storage` schema changes without a migration path (`src/lib/storage/`)
- **Untrusted input** — page text, PDFs and model output all arrive untrusted and end up rendered. Markdown/KaTeX/Mermaid rendering must stay behind DOMPurify (`src/components/MarkdownRenderer.tsx`); look for `innerHTML` on a path that skips it
- **Secrets** — API keys must never be logged, put in a URL, sent anywhere but the provider, or committed; check new provider code against how the existing providers handle the key
- **Performance** — unnecessary allocations, O(n^2) patterns, blocking work on a long page, unbounded growth in stored history
- **Test coverage** — the repo has no test script, so state plainly when a change needs manual verification and what to check

For each finding, note:
- **Severity**: critical, medium, or low
- **File path and line number(s)** in the NEW file (right side of diff)
- **Explanation** with concrete reasoning
- Optional: a `suggestion` code block with the fix

Type errors are worth catching mechanically rather than by eye: `pnpm install && npx tsc --noEmit` works in the review worktree (pnpm is pinned by `packageManager`). Install is slow, so it's worth it for a PR that touches types or providers, not for a copy change.

---

## Phase 3: Check Existing Comments (Right Before Posting)

**IMPORTANT**: Do this RIGHT BEFORE posting, not earlier, to catch any comments posted while you were reviewing.

```bash
gh api repos/{owner}/{repo}/pulls/{pr_number}/comments
gh api repos/{owner}/{repo}/pulls/{pr_number}/reviews
```

Extract the owner/repo from:
```bash
gh repo view --json owner,name --jq '"\(.owner.login)/\(.name)"'
```

Every PR here gets two independent reviews, `## Code Review (Claude)` and `## Code Review (Codex)`, from the same webhook. For each of your findings, check whether the other arm or a previous review already posted about the **same issue on the same lines**. If so:
- If you agree with it: skip posting your duplicate, or post a brief "+1" if you have additional context
- If you disagree or have a different angle: post your comment with your distinct perspective

---

## Phase 4: Post Review as Inline Comments

Post your findings as a single PR review with inline comments using the GitHub API.

**Use the bot account token** from `~/.env.claude` (`GITHUB_REVIEW_TOKEN`) so comments appear under the bot name, not the user's account. If the token is not set, fall back to default `gh` auth and warn the user.

```bash
**Write the payload to a file whose path is unique to THIS review, assert it, and POST that same
file.** `/tmp` is shared by every review session on this host — three arms per PR, six repos, rounds
hours apart — so a fixed name like `/tmp/review_payload.json` is a cross-review channel, not scratch
space. sked_ai#2349 was reviewed with the payload sked_ai#2337 had left at exactly that path
12 h 43 m earlier: a stale body, a stale `commit_id`, and an inline comment on a file #2349 does not
even touch, all posted under this arm's name — while the arm's own log reported the clean LGTM it
believed it had sent.

**The assert and the POST must read the same bytes.** Writing one file, checking it, and then
sending a body from somewhere else rebuilds the same "what I believe I sent" gap by another route,
so `$PAYLOAD` is both the thing you assert and the thing you send — never a heredoc on the POST:

```bash
# Bind both up front; everything below uses them.
HEAD_SHA=$(gh api repos/{owner}/{repo}/pulls/{pr_number} --jq .head.sha)
PAYLOAD=$(mktemp -t review-pr{pr_number}-XXXXXX.json)

# Write the JSON payload (structure below) into $PAYLOAD -- heredoc, jq, or your file-write tool.
cat > "$PAYLOAD" <<'JSONEOF'
  <json payload>
JSONEOF

# Refuse to post a payload that is not for this PR's head.
test "$(jq -r .commit_id "$PAYLOAD")" = "$HEAD_SHA" \
  || { echo "payload commit_id is not this PR's head -- refusing to post"; exit 1; }

# Load the bot token
REVIEW_TOKEN=$(grep GITHUB_REVIEW_TOKEN ~/.env.claude 2>/dev/null | cut -d= -f2)

# Post review -- use bot token if available, otherwise fall back to gh default
if [ -n "$REVIEW_TOKEN" ]; then
  curl -s -X POST \
    -H "Authorization: token $REVIEW_TOKEN" \
    -H "Accept: application/vnd.github+json" \
    "https://api.github.com/repos/{owner}/{repo}/pulls/{pr_number}/reviews" \
    -d @"$PAYLOAD"
else
  echo "WARNING: GITHUB_REVIEW_TOKEN not found in ~/.env.claude — posting under your account"
  gh api repos/{owner}/{repo}/pulls/{pr_number}/reviews -X POST --input "$PAYLOAD"
fi
```

If the assert fails, REWRITE the payload; never satisfy it by editing the assert.

JSON payload structure:
```json
{
  "commit_id": "<head_commit_sha>",
  "event": "COMMENT",
  "body": "## Code Review (Claude)\n\n<1-2 sentence summary of the PR and overall assessment>",
  "comments": [
    {
      "path": "src/entrypoints/sidepanel/App.tsx",
      "line": 42,
      "side": "RIGHT",
      "body": "**<severity>** -- <description of issue>\n\n<detailed explanation>"
    },
    {
      "path": "src/lib/llm/anthropic.ts",
      "start_line": 30,
      "line": 35,
      "start_side": "RIGHT",
      "side": "RIGHT",
      "body": "**<severity>** -- <description>\n\n```suggestion\n<fixed code>\n```"
    }
  ]
}
```

### Comment format rules:
- `line` = line number in the NEW file (right side of diff)
- For multi-line comments: include `start_line` and `start_side` alongside `line`
- `side` is always `"RIGHT"` (we comment on the new version)
- Use `suggestion` code blocks for concrete fix proposals
- Severity prefix: `**critical**`, `**medium**`, or `**low**`

### If no issues found:
Post a review with just the body (empty comments array):
```json
{
  "commit_id": "<sha>",
  "event": "COMMENT",
  "body": "## Code Review (Claude)\n\nNo issues found. LGTM.",
  "comments": []
}
```

---

## Error Handling

**NEVER post probe, test, or trial reviews to the PR.** The GitHub reviews API has no dry-run — every POST to `/reviews` that succeeds creates a real review visible to everyone on the PR. Do not post reviews with bodies like `"test"`, `"test2"`, `"ping"`, or any placeholder content "to see if it works." This repo is public, so a stray review is visible to anyone and cannot be deleted.

To avoid 422 errors (line not in diff hunk) WITHOUT probing the API:
1. Before posting, parse `gh pr diff <number>` locally and build the set of `(file, line)` pairs that are on the RIGHT side of each hunk (lines starting with `+` or context lines inside a hunk).
2. Validate every inline comment's `(path, line)` (and `start_line` for multi-line) against that set.
3. Any finding whose line is NOT in a diff hunk must be moved into the review body instead of posted as an inline comment.
4. If the API still returns 422, re-read the error body (GitHub names the offending comment), fix the payload, and retry the full review. Do NOT post a minimal `"test"` review to isolate the problem.
5. If the review still cannot be posted after a reasonable fix attempt, report the error to the user in text output and leave the PR alone — do not leave a placeholder review behind.
- If a comment can't be placed inline (line not in diff), include it in the review body instead.
