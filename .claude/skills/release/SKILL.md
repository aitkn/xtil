---
name: release
description: Release a new version of the xTil Chrome extension. Runs the full pipeline — model catalog update, build, changelog, commit, tag, push, zip, Chrome Web Store upload, GitHub release, and version bump.
argument-hint: "[version-override]"
disable-model-invocation: true
allowed-tools: Bash(pnpm *), Bash(node *), Bash(git *), Bash(gh *), Bash(npx chrome-webstore-upload *), Read, Edit, Write, Grep, Glob
---

# xTil Release Procedure

Extension ID: `pikdhogjjbaakcpedmahckhmajdgdeon`

## Overview

This skill walks through the full release pipeline interactively.
Always confirm with the user before destructive/external actions (push, upload, publish).

`$ARGUMENTS` may contain a version override (e.g., `1.1.0`). If empty, use the version from `package.json`.

---

## Step 1: Determine release version

Read `package.json` to get the current version.

- If `$ARGUMENTS` contains a version string, use that instead and update `package.json` version field.
- Confirm the version with the user: "Releasing version X.Y.Z — correct?"

Store the version as `VERSION` for the remaining steps.

---

## Step 2: Update model catalog (raw)

```bash
node scripts/update-model-catalog.mjs
```

This writes to `src/lib/llm/model-catalog-raw.json` and computes a diff against the previous raw catalog.
If the script prints "No changes detected — curation not needed", skip Step 2b.
If it fails (e.g., missing API keys), ask the user whether to skip or abort.

---

## Step 2b: Curate model catalog (incremental)

Read `src/lib/llm/.model-catalog-diff.json`. If `hasChanges` is false, skip this step.

Otherwise launch a **subagent** (Agent tool, `subagent_type: "general-purpose"`) to curate the catalog incrementally. The subagent should follow the instructions in the `curate-models` skill (`.claude/skills/curate-models/SKILL.md`).

Pass this prompt to the subagent:
> Read `.claude/skills/curate-models/SKILL.md` for full instructions. The diff is at `src/lib/llm/.model-catalog-diff.json`. Apply incremental curation to `src/lib/llm/model-catalog.json`.

After the subagent finishes, show the user the final model count per provider and ask for approval before continuing.

---

## Step 3: Build & verify

```bash
pnpm wxt build
```

Verify the build succeeds. If it fails, show errors and STOP.

---

## Step 4: Write changelog

Read the current `CHANGELOG.md` and recent git log since the last tag:
```bash
git log $(git describe --tags --abbrev=0 2>/dev/null || echo "HEAD~20")..HEAD --oneline
```

Ask the user: **"What are the highlights for version VERSION?"**

Once the user provides the highlights (or approves your draft), prepend a new section to `CHANGELOG.md` following the existing format.

**Changelog guidelines:**
- Only include user-facing improvements and significant bug fixes.
- Write in plain, user-friendly language — no technical terms (e.g., "json3 format", "token usage", "parsing"). Describe what improved from the user's perspective.
- If specific models were added or replaced during curation, mention them (e.g., "Added GPT-5.4, replacing GPT-5.2").
- Keep entries concise.

```markdown
## VERSION

**One-line theme**

- Bullet point changes
```

Insert it right after the `---` separator line (line 5 of the file), before the previous version entry.

---

## Step 5: Commit all changes

Stage all modified/new files and commit:
```bash
git add -A
git commit -m "Release vVERSION

<changelog summary>"
```

Show the user the diff before committing. Use a HEREDOC for the commit message.

---

## Step 6: Tag

```bash
git tag vVERSION
```

---

## Step 7: Push

**Ask the user for confirmation before pushing.**

```bash
git push && git push --tags
```

---

## Step 8: Build zip for distribution

```bash
pnpm wxt zip
```

The zip will be at `.output/xtil-VERSION-chrome.zip`. Verify the file exists.

---

## Step 9: Upload to Chrome Web Store

**Ask the user for confirmation before uploading.**

Do NOT auto-publish — the user should review in the Chrome Web Store Developer Dashboard before publishing, because CWS has a review process and the user may want to add release notes there.

Source `.env` before running — credentials live there alongside API keys:
```bash
set -a && source .env && set +a
npx chrome-webstore-upload upload --source .output/xtil-VERSION-chrome.zip --extension-id pikdhogjjbaakcpedmahckhmajdgdeon
```

If CWS credentials (`CLIENT_ID`, `CLIENT_SECRET`, `REFRESH_TOKEN`) are missing from `.env`, show the setup instructions:
1. Follow https://github.com/fregante/chrome-webstore-upload-keys to create OAuth credentials
2. Add to `.env`:
   ```
   CLIENT_ID=your_client_id
   CLIENT_SECRET=your_client_secret
   REFRESH_TOKEN=your_refresh_token
   ```

---

## Step 10: Create GitHub release

```bash
gh release create vVERSION .output/xtil-VERSION-chrome.zip --title "xTil vVERSION" --notes "CHANGELOG_BODY"
```

Pass the changelog section for this version as the `--notes` value. Use a HEREDOC.

---

## Step 11: Bump to next development version

Increment the patch version (e.g., 1.0.2 → 1.0.3). Update the `version` field in `package.json`.

Commit:
```bash
git add package.json
git commit -m "Bump version to NEXT_VERSION"
git push
```

---

## Error handling

- If any step fails, STOP and report the error. Do not skip steps.
- If the user wants to skip a step (e.g., no CWS credentials yet), that's fine — skip it and continue.
- The user can always re-run the skill to retry failed steps, but warn them about duplicate tags/releases.

---

## Quick reference: file locations

| What | Where |
|------|-------|
| Version | `package.json` → `version` |
| Changelog | `CHANGELOG.md` |
| Model catalog | `src/lib/llm/model-catalog.json` |
| Raw catalog | `src/lib/llm/model-catalog-raw.json` |
| Catalog diff | `src/lib/llm/.model-catalog-diff.json` |
| Build output | `.output/chrome-mv3/` |
| Zip output | `.output/xtil-VERSION-chrome.zip` |
| CWS credentials | `.env` |
| Extension ID | `pikdhogjjbaakcpedmahckhmajdgdeon` |
