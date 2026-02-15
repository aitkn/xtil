# xTil — Extract Content, Distill Knowledge

Chrome extension that summarizes any web page or YouTube video using AI, lets you refine the summary via chat, and saves everything to Notion or Markdown. Opens in Chrome's side panel for a seamless reading experience.

## How It Works

1. **Summarize** — Get a structured summary with key takeaways, notable quotes, and tags
2. **Refine** — Chat with the AI to adjust the summary, ask follow-up questions, or request diagrams
3. **Save & Share** — Export to Notion or Markdown with all metadata, tags, and source links preserved

## Features

- **Works everywhere** — articles, YouTube (transcripts + comments), Reddit threads, X/Twitter threads, Facebook posts, Google Docs, SPAs, any web page
- **Image analysis** — vision-capable models automatically analyze charts, infographics, and screenshots on the page
- **Visual diagrams** — AI generates Mermaid flowcharts, sequence diagrams, and timelines inline with light/dark theme support
- **Multiple AI providers** — OpenAI, Anthropic, Google Gemini, xAI, DeepSeek, or any self-hosted OpenAI-compatible endpoint (Ollama, vLLM, etc.)
- **Bring your own API key** — no subscription, no account, no backend server
- **Auto-translation** — summarize in your preferred language with exception lists
- **Markdown & Notion export** — save summaries locally or to your Notion knowledge base
- **Per-tab state** — switch tabs without losing your summary or chat history
- **Light, dark, and system themes**

## Install

### From Chrome Web Store
[Install xTil](https://chromewebstore.google.com/detail/xtil/pikdhogjjbaakcpedmahckhmajdgdeon)

### From Source
```bash
git clone https://github.com/aitkn/xtil.git
cd xtil
pnpm install
pnpm wxt build
```
Then load `.output/chrome-mv3/` as an unpacked extension in `chrome://extensions`.

## Usage

1. Navigate to any web page or YouTube video
2. Click the xTil icon in your toolbar to open the side panel
3. Press **Summarize** to generate a structured summary
4. Use the chat input to ask follow-up questions, request diagrams, or refine the summary
5. Export to Notion or download as Markdown

## Configuration

Open the Settings drawer (gear icon) to:
- Select your AI provider and enter your API key
- Choose a model (vision support auto-detected)
- Set summary language, translation exceptions, and detail level
- Configure Notion export (see below)

## Notion Integration Setup

1. Go to [notion.so/my-integrations](https://www.notion.so/my-integrations) and click **New integration**
2. Name it (e.g. "xTil") and click **Submit**
3. Copy the **Internal Integration Secret** (starts with `ntn_`)
4. Paste it into xTil Settings > Notion API Key
5. Click **Test Connection** to verify

On your first export, xTil will automatically create an "xTil Summaries" database in your Notion workspace. Subsequent exports will add pages to the same database.

Each exported page includes the summary, key takeaways, notable quotes, tags, source URL, and content metadata.

## Privacy

xTil has no backend server, no analytics, and no data collection. Your API keys are stored locally on your device. Page content is sent directly to the AI provider you choose.

See the full [Privacy Policy](PRIVACY_POLICY.md).

## Tech Stack

- [WXT](https://wxt.dev) — Chrome extension framework
- [Preact](https://preactjs.com) — UI rendering
- [TypeScript](https://www.typescriptlang.org) — type safety
- [Readability](https://github.com/mozilla/readability) — article extraction
- [Mermaid](https://mermaid.js.org) — diagram rendering
- Material Design 3 — design system

## License

[MIT](LICENSE)
