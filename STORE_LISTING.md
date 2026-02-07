# Chrome Web Store Listing — TL;DR

Use this document when filling out the Chrome Web Store submission form.

---

## Extension Name
TL;DR

## Short Description (132 chars max)
Summarize any web page or YouTube video with AI. Supports OpenAI, Claude, Gemini, Grok, DeepSeek, and self-hosted models.

## Detailed Description (for store listing)

TL;DR gives you instant AI-powered summaries of any web page or YouTube video — right in Chrome's side panel.

**How it works:**
1. Open any page or YouTube video
2. Click the TL;DR icon to open the side panel
3. Hit Summarize — get a structured summary in seconds

**Features:**
- Structured summaries with key takeaways, notable quotes, and related topics
- YouTube support: summarizes transcripts and top comments
- Google Docs support: extracts and summarizes document content
- Chat refinement: ask follow-up questions about the content
- Export to Notion with one click
- Light, dark, and system themes
- Configurable summary language and detail level

**Bring your own API key — no subscription, no account.**
Works with OpenAI (GPT-4o), Anthropic (Claude), Google Gemini, xAI (Grok), DeepSeek, or any self-hosted OpenAI-compatible endpoint (Ollama, vLLM, etc.)

**Privacy-first:** No data collection, no analytics, no backend server. Your API keys stay on your device. Content is sent directly to the AI provider you choose.

---

## Category
Productivity

## Language
English

---

## Single Purpose Description (required by Chrome Web Store)
Summarize web page and YouTube video content using AI.

---

## Permissions Justification (required for each permission)

### activeTab
Used to read the text content of the page the user is currently viewing when they click "Summarize". The extension only accesses the active tab's content upon explicit user action.

### sidePanel
The extension's user interface is displayed in Chrome's side panel. This permission is required to register and open the side panel.

### storage
Used to persist user settings (theme preference, summary language, detail level) and API key configurations locally on the user's device using chrome.storage.local.

### scripting
Used to inject the content extraction script into the active tab when the user requests a summary. The script extracts the page's text content for summarization.

### Host permissions (<all_urls>)
Required to extract text content from any web page the user chooses to summarize. The extension supports summarizing content from any website, so broad host permissions are necessary. Content is only accessed when the user explicitly initiates a summary.

---

## Screenshots Needed (you'll need to take these yourself)

1. **Main summary view** — showing a completed summary with key takeaways, on an article page (1280x800 or 640x400)
2. **YouTube summary** — showing a YouTube video being summarized with transcript and comment indicators
3. **Chat refinement** — showing a follow-up question and response in the chat area
4. **Settings panel** — showing the settings drawer with provider configuration
5. **Dark mode** — showing the extension in dark theme

Tips for good screenshots:
- Use a clean browser window with no other extensions visible
- Pick visually interesting content (a popular article or YouTube video)
- Show the side panel alongside the actual page content
- Capture at 1280x800 for best quality

---

## Store Icon
Already included: `public/icons/icon-128.png`
(Chrome Web Store also accepts a 128x128 PNG for the store tile)
