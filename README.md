# TL;DR — AI Page Summarizer

Chrome extension that summarizes any web page or YouTube video using AI. Opens in Chrome's side panel for a seamless reading experience.

## Features

- **Structured summaries** — key takeaways, notable quotes, related topics, and tags
- **YouTube support** — summarizes transcripts and top comments
- **Google Docs support** — extracts and summarizes document content
- **Chat refinement** — ask follow-up questions about the content
- **Export to Notion** — save summaries to your Notion database with one click
- **Multiple AI providers** — OpenAI, Anthropic, Google Gemini, xAI, DeepSeek, or any self-hosted OpenAI-compatible endpoint (Ollama, vLLM, etc.)
- **Bring your own API key** — no subscription, no account, no backend server
- **Light, dark, and system themes**

## Install

### From Chrome Web Store
*Coming soon*

### From Source
```bash
git clone https://github.com/proshkin-aitkn/tldr.git
cd tldr
pnpm install
pnpm wxt build
```
Then load `.output/chrome-mv3/` as an unpacked extension in `chrome://extensions`.

## Usage

1. Navigate to any web page or YouTube video
2. Click the TL;DR icon in your toolbar to open the side panel
3. Press **Summarize** to generate a structured summary
4. Use the chat input to ask follow-up questions or refine the summary
5. Optionally export to Notion

## Configuration

Open the Settings drawer (gear icon) to:
- Select your AI provider and enter your API key
- Choose a model
- Set summary language and detail level
- Configure Notion export

## Privacy

TL;DR has no backend server, no analytics, and no data collection. Your API keys are stored locally on your device. Page content is sent directly to the AI provider you choose.

See the full [Privacy Policy](PRIVACY_POLICY.md).

## Tech Stack

- [WXT](https://wxt.dev) — Chrome extension framework
- [Preact](https://preactjs.com) — UI rendering
- [TypeScript](https://www.typescriptlang.org) — type safety
- [Readability](https://github.com/mozilla/readability) — article extraction
- Material Design 3 — design system

## License

[MIT](LICENSE)
