# Privacy Policy for TL;DR Chrome Extension

**Last updated:** February 6, 2026

## Overview

TL;DR is a browser extension that summarizes web pages and YouTube videos using AI. This policy describes how the extension handles your data.

## Data Collection

**TL;DR does not collect, transmit, or store any personal data on external servers.** The extension has no backend server, analytics, or telemetry.

## Data Handling

### Content Extraction
When you click "Summarize", the extension reads the text content of the current browser tab. This content is processed entirely within your browser and is not stored persistently.

### API Keys
You provide your own API keys for AI services (OpenAI, Anthropic, Google Gemini, xAI, DeepSeek, or a self-hosted endpoint) and optionally for Notion. These keys are stored locally in Chrome's built-in storage (`chrome.storage.local`) on your device. They are never transmitted to anyone other than the respective API provider you configured.

### Third-Party API Calls
When you generate a summary, the extracted page content is sent directly from your browser to the AI provider you selected in Settings (e.g., OpenAI, Anthropic). These requests go directly to the provider's API — there is no intermediary server. Each provider's own privacy policy governs how they handle that data:

- [OpenAI Privacy Policy](https://openai.com/policies/privacy-policy)
- [Anthropic Privacy Policy](https://www.anthropic.com/privacy)
- [Google AI Privacy Policy](https://ai.google.dev/terms)
- [xAI Privacy Policy](https://x.ai/legal/privacy-policy)
- [DeepSeek Privacy Policy](https://www.deepseek.com/privacy)

If you use a self-hosted endpoint, data is sent only to the URL you configure.

### Notion Export
If you configure Notion integration, summaries are sent directly to the Notion API using your API key. See [Notion's Privacy Policy](https://www.notion.so/Privacy-Policy).

### Local Storage
The extension stores the following locally on your device using `chrome.storage.local`:
- Your settings and preferences (theme, language, detail level)
- Provider configurations and API keys
- Cached model lists

No browsing history, cookies, or personal information is stored.

## Permissions

| Permission | Purpose |
|---|---|
| `activeTab` | Read content from the tab you're viewing when you click Summarize |
| `sidePanel` | Display the extension UI in Chrome's side panel |
| `storage` | Save your settings and API keys locally on your device |
| `scripting` | Inject the content extraction script into the active tab |
| Host permissions (`<all_urls>`) | Extract content from any web page you choose to summarize |

## Data Sharing

TL;DR does not share your data with any third party. The only external communication is the API calls you explicitly initiate to your chosen AI provider.

## Children's Privacy

This extension is not directed at children under 13.

## Changes to This Policy

Updates to this policy will be reflected in the extension's store listing. The "Last updated" date above will change accordingly.

## Contact

If you have questions about this privacy policy, please open an issue at the extension's support page.
