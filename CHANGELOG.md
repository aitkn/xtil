# Changelog

All notable user-facing changes to xTil are documented here.

---

## 1.2.3

**YouTube navigation fix**

- Fixed stale content appearing after clicking between YouTube videos — descriptions, transcripts, and summaries now correctly update when navigating within YouTube

## 1.2.0

**Smart genre detection**

- xTil now automatically detects what type of content you're reading — news, tutorial, fiction, academic paper, review, comedy special, and 12 more genres
- Each genre gets a tailored summary with relevant sections (e.g. tutorials get step-by-step breakdowns, news gets fact-checking, fiction gets cast & plot)
- Genre badge shown in the header so you know how xTil interpreted the content
- Movies, TV shows, and plays get a dedicated "Work Info" section with structured metadata and spoiler-protected plot summaries — works from any source, not just Netflix
- Scientific papers now reproduce equations in LaTeX notation
- Review scores (IMDb, Rotten Tomatoes, Metacritic) are fetched via web search instead of guessed, with color-coded badges
- Netflix metadata (thumbnail, maturity rating, season/episode info) extracted from the player and shown before summarizing
- Diagrams and data charts are now genre-aware — encouraged for tutorials and academic content, skipped for fiction and comedy
- Web searches cancel immediately when you navigate away — no more stale results appearing on the wrong page
- Grok recommended as default provider in the setup wizard
- Claude Opus/Sonnet 4.6 now support reasoning mode

## 1.1.12

**Netflix support**

- Extract subtitles from Netflix — works with any show or movie that has closed captions
- Movie/TV-specific summary with spoiler-free overview, show info, cast & characters, plot summary, and condensed script
- Spoiler protection — plot details hidden by default behind a collapsible spoiler tag
- Color-coded rating badges for content ratings (TV-MA, PG-13, R) and review scores (IMDb, Rotten Tomatoes, Metacritic)
- Clickable timestamps that seek the Netflix player to the exact moment
- Cast names and similar titles link to Netflix search
- Auto-enriched reception section with latest ratings via web search
- "Show full version" button to expand truncated condensed scripts
- Page reload no longer clears your existing summary

## 1.1.11

**Video transcript extraction beyond YouTube**

- Extract closed captions from Cloudflare Stream videos (used by many media and corporate sites)
- Extract captions from Vimeo videos (supports multi-language track selection)
- Extract subtitles from Dailymotion videos
- Extract captions from X/Twitter video posts with auto-generated CC
- Generic HTML5 video caption support — works on any site with standard subtitle tracks
- New "Transcript" indicator chip shows when video captions were captured on non-YouTube pages
- Smart language selection uses the same preferences across all video platforms
- Updated Claude Opus 4.6 and Sonnet 4.6 context windows to 1M tokens

## 1.1.10

**Web search for Anthropic & YouTube fixes**

- Anthropic models (Claude Haiku/Sonnet/Opus) now support web search for fact-checking and research
- Fixed web search chat responses sometimes breaking mid-stream when the model searches during a reply
- Fixed "By ..." author metadata showing a wrong channel name on YouTube videos

## 1.1.9

**YouTube transcript reliability & UX improvements**

- Fixed YouTube transcript extraction for videos where standard methods fail — the extension now automatically opens YouTube's transcript panel as a last resort
- Supports YouTube's new "In this video" transcript design (modern panel with chapters)
- Fixed video description auto-closing when the extension is open
- Stopped repeated transcript fetch attempts that spammed the console
- Refresh button now fully re-reads page content (including re-fetching transcripts)
- Made Continue buttons in setup wizard more visually distinct
- Improved mobile YouTube error message to clarify switching to YouTube desktop version

## 1.1.8

**Mobile YouTube experience**

- On mobile YouTube, video info now loads normally with a clear hint to switch to desktop version for transcripts

## 1.1.7

**Transcript fix & new model**

- Fixed YouTube transcripts sometimes being sent as raw data instead of clean text, improving summary quality and reducing token usage
- Added GPT-5.4 to the model catalog

## 1.1.6

**YouTube transcript reliability**

- Improved YouTube transcript loading on mobile YouTube and alternative browsers

## 1.1.5

**Mobile browser fix**

- Fixed YouTube transcripts not loading on mobile browsers (e.g., Yandex Browser)

## 1.1.4

**YouTube transcript fix**

- Fixed YouTube video transcripts not loading — captions now work reliably again for all videos

## 1.1.3

**Wizard bug fix**

- Fixed setup wizard skipping the fact-check step — it now has its own dedicated onboarding screen

## 1.1.2

**Clean model list & fact-check polish**

- Model dropdown now stays clean — only curated models show up, old and superseded models are automatically removed even if previously cached
- Fetch Models only adds genuinely new discoveries on top of the curated list
- Auto web-search fact check — opt-in setting to automatically verify claims after summarizing
- Improved fact check verdicts — icon + verdict word shown upfront for quick scanning
- Stronger fact check triggers — news, journalism, and bias-prone sources always get checked
- Source diversity in search — web search now cross-references independent sources, not just echoes
- Streaming stability — sections stay open and scroll position is preserved while content streams in
- Summary stays visible during diagram fixes instead of being hidden by a spinner
- Chat messages render markdown properly during streaming

## 1.1.0

**PDF support, math rendering & feed improvements**

- PDF text extraction — summarize academic papers, reports, and any PDF opened in Chrome
- PDF figure extraction — renders vector diagrams from PDF pages with smart cropping
- LaTeX math rendering — formulas display beautifully in the side panel via KaTeX
- Native Notion equation support — LaTeX formulas export as Notion's built-in equations
- Clipboard math — formulas paste into Gmail and Google Docs using Unicode math and HTML sup/sub
- Live metadata refresh as you scroll through feeds (no flicker, no re-clicking "See more")
- Stronger language rules to prevent mixed-language summaries
- Fixed Facebook/LinkedIn feed picking barely-visible posts
- Fixed math formulas appearing doubled/garbled when printing or saving as PDF
- Fixed empty thumbnails on pages with no content images
- User comments now produce consistent results whether entered before or after summarizing
- Updated model catalog with latest pricing

## 1.0.8

**Web search & error handling fixes**

- Fixed web search for Grok and OpenAI models
- Fixed Fact Check section not appearing with Gemini models
- Strip Grok citation tags from web search results
- Clean, readable API error messages instead of raw JSON

## 1.0.7

**Web search & Grok fix**

- Web search — enhance any section with live web results, fact-check claims against the web
- Fixed Grok web search
- Toolbar buttons spin while processing
- Fact Check turns green after successful web search

## 1.0.6

**Facebook feed support**

- Facebook feed extractor — summarize posts directly from the feed without clicking to open them, using smart "most visible post" detection

## 1.0.5

**LinkedIn support**

- LinkedIn post extractor — summarize posts from feed or direct URLs, with smart "most visible post" detection on feed pages

## 1.0.4

**Streaming responses & real-time preview**

- Real-time streaming — see summaries and chat responses as they're generated, with live preview
- Streaming progress indicator for multi-chunk summarization
- Chat can now add and remove custom sections reliably
- Fixed YouTube transcript not loading on first visit

## 1.0.3

**Gmail support, pricing in model selector & UX improvements**

- Gmail extractor — summarize emails and threaded conversations, auto-detects when you switch emails
- Model prices shown inline in the dropdown with aligned monospace formatting
- Catalog auto-updates model metadata (names, prices) on version change, not just new models
- Deduplicate preview-dated model variants (e.g., Gemini 2.5 Pro)
- Thumbnail height capped at 320px across all layouts including multi-image collages
- Side panel opens automatically on fresh install
- Show context window setting for all providers
- Dynamic version display in Settings
- GitHub PR title, number, and state displayed correctly
- Clear chat input when switching tabs
- Notion onboarding fix — auto-select first database
- Updated model catalog (181 models across 5 providers)
- Website: comparison table, benefit-driven copy, API key guidance, scroll animations

## 1.0.2

**Smarter chat & better language handling**

- Smart YouTube transcript language selection — picks the best available transcript based on your language preferences
- Chat can now fully replace the entire summary — ask for a complete rewrite and get one
- Schema enforcement (structured output) now applies to summarization too, not just chat — improves response quality across all providers
- Summaries now reliably follow the page's language instead of defaulting to English
- Works on mobile browsers like Kiwi and Yandex that support extensions but lack the side panel API — xTil opens as a tab instead
- Fixed image analysis getting stuck after a transient API failure
- Fixed duplicate thumbnail images appearing in summaries
- Fixed YouTube transcript fetch failing on slow-loading captions

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
