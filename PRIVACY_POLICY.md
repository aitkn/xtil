# Privacy Policy for TL;DR Chrome Extension

**Last updated:** February 6, 2026

## Overview

TL;DR is a browser extension that summarizes web pages and YouTube videos using AI. This policy describes how the extension handles your data.

## Data We Handle

TL;DR has no backend server, no analytics, and no telemetry. We do not collect or store any user data on our servers.

However, the extension does handle the following data locally on your device:

### Website Content
When the side panel opens, the extension reads the current page's text content, title, and URL to display metadata (word count, content type). This data is held in memory only for the current session and is not stored persistently.

### Data Transmitted to Third Parties
When you explicitly click "Summarize", the extracted page content is sent directly from your browser to the AI provider you selected in Settings (e.g., OpenAI, Anthropic). These requests go directly to the provider's API — there is no intermediary server. Each provider's own privacy policy governs how they handle that data:

- [OpenAI Privacy Policy](https://openai.com/policies/privacy-policy)
- [Anthropic Privacy Policy](https://www.anthropic.com/privacy)
- [Google AI Privacy Policy](https://ai.google.dev/terms)
- [xAI Privacy Policy](https://x.ai/legal/privacy-policy)
- [DeepSeek Privacy Policy](https://www.deepseek.com/privacy)

If you use a self-hosted endpoint, data is sent only to the URL you configure.

### Notion Export
If you configure Notion integration and click "Export to Notion", the generated summary is sent directly to the Notion API using your API key. See [Notion's Privacy Policy](https://www.notion.so/Privacy-Policy).

### API Keys
You provide your own API keys for AI services and optionally for Notion. These keys are stored locally in Chrome's built-in storage (`chrome.storage.local`) on your device. They are never transmitted to anyone other than the respective API provider you configured.

### Local Storage
The extension stores the following locally on your device using `chrome.storage.local`:
- Your settings and preferences (theme, language, detail level)
- Provider configurations and API keys
- Cached model lists

No browsing history, cookies, or personal information is persisted.

## Permissions

| Permission | Purpose |
|---|---|
| `activeTab` | Read the current page's content and metadata when the side panel is open |
| `sidePanel` | Display the extension UI in Chrome's side panel |
| `storage` | Save your settings and API keys locally on your device |
| `scripting` | Inject the content extraction script into the active tab |
| Host permissions (`<all_urls>`) | Extract content from any web page for display and summarization |

## Data Use Certifications

- User data is **not sold** to third parties
- User data is **not used or transferred** for purposes unrelated to the extension's core functionality
- User data is **not used or transferred** to determine creditworthiness or for lending purposes

## Children's Privacy

This extension is not directed at children under 13.

## Changes to This Policy

Updates to this policy will be reflected in the extension's store listing. The "Last updated" date above will change accordingly.

## Contact

If you have questions about this privacy policy, please open an issue at [github.com/proshkin-aitkn/tldr/issues](https://github.com/proshkin-aitkn/tldr/issues).
