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

- **A fresh review worktree is usually dirty, and under those two paths that is expected, not a
  fault.** Under `.claude/` and `.wolf/`, expect modifications where the PR edits those paths,
  deletions wherever the PR head has a file the main checkout's WORKING TREE does not — not
  only files the PR adds, but any file the main checkout is behind on or has deleted locally —
  and untracked files wherever
  the main checkout is ahead or holds uncommitted work of its own; it is clean only when the two
  copies happen to match. sked_ai#2349 saw 22 such entries and both arms reported the checkout as
  suspect. **Anything dirty OUTSIDE those two directories is not explained by this and still
  deserves your scrutiny.**
- **For a PR that touches `.claude/` or `.wolf/`, the file on disk is master's, not the one you
  are reviewing.** Read those paths with `git show <headRefOid>:<path>` or from `gh pr diff` —
  never from disk, **even when `git rev-parse HEAD` equals `headRefOid`**, and key the lookup on
  `headRefOid` rather than `HEAD` so it still works from a checkout that is not the PR. Any
  later step telling you to read files directly once HEAD matches does not apply to these two
  directories. Everything outside them is genuinely the PR's code.

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
3. Read the key source files touched in the diff to understand the changes in context. Don't just rely on the diff — read surrounding code to catch issues the diff alone won't reveal. **Confirm the files on disk are actually at the PR head before trusting them:** `git rev-parse HEAD` must equal the `headRefOid` from step 2. If it matches (the normal case in a review worktree, see Phase 0), read the files directly — **except under `.claude/` and `.wolf/`, which the wrapper has replaced with the main checkout's copies (Phase 0); read those with `git show <headRefOid>:<path>` however HEAD compares.** If it does not, you are in a shared checkout on some other ref — do not read files from disk; fetch them with `gh api` at `<head_sha>` instead. Either way, do not check anything out.

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
# Run this as ONE shell invocation: shell variables do not survive between tool
# calls, so a $PAYLOAD assigned in an earlier call reads back EMPTY in a later one.
#
# HEAD_SHA is the headRefOid you PINNED IN PHASE 1 -- the commit your findings were
# actually computed against. Paste that value; do NOT re-read the live head here.
# Re-reading breaks the guard in both directions when a push lands mid-review:
# the payload and the live head would both be the NEW sha, so the assert passes and
# a review of code you never examined is accepted -- or it fails, and "rewrite"
# becomes stamping the new sha onto findings derived from the old diff.
HEAD_SHA=<the headRefOid from Phase 1>
[ -n "$HEAD_SHA" ] || { echo "no analyzed head sha -- refusing to post"; exit 1; }
PAYLOAD=$(mktemp -t review-pr{pr_number}-XXXXXX.json)
echo "payload: $PAYLOAD"   # printed so a file-write tool can be given the literal path

# Write the JSON payload (structure below) into $PAYLOAD -- heredoc here, or your
# file-write tool using the path just printed.
cat > "$PAYLOAD" <<'JSONEOF'
  <json payload>
JSONEOF

# Refuse to post a payload that is not the one you just wrote for this review.
# The -s test is not belt-and-braces: with both sides empty -- which is exactly what
# a run split across two tool calls produces -- `test "" = ""` PASSES.
[ -s "$PAYLOAD" ] || { echo "payload file is empty or unset -- refusing to post"; exit 1; }
test "$(jq -r .commit_id "$PAYLOAD")" = "$HEAD_SHA" \
  || { echo "payload commit_id is not the analyzed head -- refusing to post"; exit 1; }

# Then check the PR has not moved under you since Phase 1. This is a re-review
# trigger, NOT something to fix by editing the payload.
LIVE=$(gh api repos/{owner}/{repo}/pulls/{pr_number} --jq .head.sha)
[ "$LIVE" = "$HEAD_SHA" ] \
  || { echo "head moved $HEAD_SHA -> $LIVE mid-review; re-read the diff at $LIVE and rebuild"; exit 1; }

# Load the bot token
REVIEW_TOKEN=$(grep GITHUB_REVIEW_TOKEN ~/.env.claude 2>/dev/null | cut -d= -f2)

# Post review -- use bot token if available, otherwise fall back to gh default
if [ -n "$REVIEW_TOKEN" ]; then
  curl -s -X POST \
    -H "Authorization: token $REVIEW_TOKEN" \
    -H "Accept: application/vnd.github+json" \
    "https://api.github.com/repos/{owner}/{repo}/pulls/{pr_number}/reviews" \
    --data-binary @"$PAYLOAD"   # NOT -d: `-d @file` strips newlines, so it would not
                                # send the bytes the assert above just checked
else
  echo "WARNING: GITHUB_REVIEW_TOKEN not found in ~/.env.claude — posting under your account"
  gh api repos/{owner}/{repo}/pulls/{pr_number}/reviews -X POST --input "$PAYLOAD"
fi
```

If the assert fails, **rebuild the payload — never re-stamp `commit_id`, and never edit the
assert.** Re-stamping is the cheapest repair and it is precisely the incident: setting
`.commit_id` to the current head would have made #2349's stale payload pass and posted #2337's
body and inline comment under #2349's head. Work out which case you are in first:

- **The payload is not yours** (a leftover from another PR or round) — discard it and write your
  own findings into a fresh `$PAYLOAD`.
- **The head moved under you mid-review** — the diff you reviewed is stale. Re-read it at the new
  head, re-validate every inline `line` number against it, and rebuild the payload from that. Your
  findings may still hold; their line numbers usually do not.

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
