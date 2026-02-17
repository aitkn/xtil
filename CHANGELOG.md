# Changelog

All notable user-facing changes to xTil are documented here.

---

## 1.0.2

**Smarter chat & better language handling**

- Smart YouTube transcript language selection — picks the best available transcript based on your language preferences
- Chat can now fully replace the entire summary — ask for a complete rewrite and get one
- Improved response quality with per-provider JSON schema enforcement (OpenAI, Anthropic, Google)
- Summaries now reliably follow the page's language instead of defaulting to English
- Fixed image analysis getting stuck after a transient API failure
- Fixed duplicate thumbnail images appearing in summaries

## 1.0.1

**Rebrand, model catalog & comment extraction**

- Rebranded from TL;DR to xTil with a new icon design
- Model catalog with smart provider-based filtering and API discovery
- Extract comments from Disqus, Giscus, and Utterances embedded in iframes
- Graceful handling of restricted pages (chrome://, edge://, etc.)
- Launched [xtil.ai](https://xtil.ai) website
- Fixed Notion database creation nesting inside summary pages
- Fixed GitHub line links, PR status badges, and commit message extraction
- Fixed setup wizard closing prematurely when API key is entered
- Fixed chat JSON parsing for Anthropic
- Improved dark mode Mermaid diagram theming

## 1.0.0

**Initial public release**

- AI-powered multi-section summaries of any web page or YouTube video
- Image and code analysis with automatic vision detection
- Interactive chat refinement with structured responses
- Auto-generated Mermaid diagrams with light/dark theme support
- Export to Notion, Markdown, and HTML
- Quote translation when page language differs from your preference
- YouTube timestamp link support
- GitHub analysis: PRs, issues, and commit pages
- Table extraction with data chart generation
- Bring-your-own-key: OpenAI, Anthropic, Google, and self-hosted providers
- Dynamic model discovery from provider APIs
- Session persistence across browser restarts
- Settings auto-save
- Privacy-first: all processing happens client-side, no data sent to external servers
