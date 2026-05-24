---
name: debug-extension
description: Reload the Chrome extension and open the sidepanel with debug prompts visible. Use when the user wants to test extension changes in the browser, read LLM prompts, or inspect summarization output.
argument-hint: "[build] [summarize]"
disable-model-invocation: true
allowed-tools: Bash(pnpm wxt build), Bash(google-chrome *), Bash(sleep *)
context: fork
---

# Debug Extension Procedure

Extension ID: `pikdhogjjbaakcpedmahckhmajdgdeon`

## Arguments

- `$ARGUMENTS` contains "build" → run `pnpm wxt build` first
- `$ARGUMENTS` contains "summarize" → trigger a new summarization after reload
- No arguments → reload extension, open sidepanel, enable debug

## Procedure (FALLOW EXACLY)

### 1. Build (only if "build" in arguments)

Skip if "build" is NOT in `$ARGUMENTS`.
```bash
pnpm wxt build
```

### 2. Open extensions page, click Update, and close it

Open `new_page` with URL:
```
chrome://extensions/?id=pikdhogjjbaakcpedmahckhmajdgdeon
```

If it fails (Chrome closed), launch Chrome and retry:
```bash
google-chrome --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-demo-profile --force-device-scale-factor=1.5 &
sleep 3
```

Take a snapshot, then click the **"Update"** button (description="Update extensions now").
Use `includeSnapshot=true` on the click to confirm "Extensions updated" alert appeared.

Now close this tab with `close_page`.

### 3. Open the sidepanel tab

Open → `new_page` with URL:
```
chrome-extension://pikdhogjjbaakcpedmahckhmajdgdeon/sidepanel.html
```
Remember extension page ID


### 4. Enable debug

Take ONE snapshot to get UIDs.
Click **"TL;DR"** (description="Too Long; Didin't Read").
Enter secretpassword:  presses "de" as a hidden password
This is a toggle. Nothing visibly changes until a summary exists. That is fine.

If "summarize" is in `$ARGUMENTS`:
- Click **"Summarize"** (description="Summarize page content")
- Wait: `wait_for text="Summary JSON" timeout=120000`
- Do NOT wait for "Summary" — that matches UI elements instantly.

### 5. Read debug sections

Take a snapshot. If any collapsed debug buttons exist (▶ System Prompt, etc.),
click ALL of them in one parallel call. Then take ONE final snapshot.

All prompt text is in StaticText nodes. Report findings to the user.
