import type { ExtractedContent, ExtractedComment } from '../extractors/types';
import { MERMAID_ESSENTIAL_RULES } from '../mermaid-rules';
import { GENRE_TEMPLATES, type Genre, type DetailLevel, type SizeCategory, type FieldGuidelines, type ContentHints } from './genres';

/** Max comments to include in the prompt, by detail level. */
export const COMMENT_LIMITS: Record<string, number> = { brief: 50, standard: 200, detailed: 1000 };

/**
 * Format comments for inclusion in a prompt.
 * Sorts by likes (most-liked first), caps to a detail-level-dependent limit,
 * and appends a note when some comments were omitted.
 */
export function formatCommentsBlock(
  comments: ExtractedComment[],
  detailLevel: 'brief' | 'standard' | 'detailed',
): string {
  const limit = COMMENT_LIMITS[detailLevel] ?? 50;
  // Sort: comments with likes first (desc), then the rest in original order
  const sorted = [...comments].sort((a, b) => (b.likes ?? -1) - (a.likes ?? -1));
  const selected = sorted.slice(0, limit);

  let block = '';
  for (const comment of selected) {
    const author = comment.author ? `**${comment.author}**` : 'Anonymous';
    const likes = comment.likes ? ` (${comment.likes} likes)` : '';
    block += `- ${author}${likes}: ${comment.text}\n`;
  }

  if (comments.length > limit) {
    block += `\n*(${comments.length - limit} more comments omitted — ${comments.length} total)*\n`;
  }

  return block;
}

const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English', es: 'Spanish', fr: 'French', de: 'German',
  pt: 'Portuguese', ru: 'Russian', zh: 'Chinese', ja: 'Japanese', ko: 'Korean',
};

export function getSystemPrompt(detailLevel: 'brief' | 'standard' | 'detailed', language: string, languageExcept: string[] = [], imageAnalysisEnabled = false, wordCount = 1500, contentType?: string, githubPageType?: string, genre?: Genre, isVideo = false): string {
  const targetLang = LANGUAGE_NAMES[language] || language;
  // Remove target language from exceptions — translating target→target is a no-op
  const exceptLangs = languageExcept
    .filter((code) => code !== language)
    .map((code) => LANGUAGE_NAMES[code] || code)
    .filter(Boolean);

  const sourceLangDetection = 'Source language = the language the MAJORITY of the body text is written in. A few foreign words, proper names, technical terms, or short quotes in another language do NOT change it — only the dominant language of the body text counts.';

  let langInstruction: string;
  if (language === 'auto') {
    langInstruction = `Respond in the same language as the source content. Match the content language exactly. ${sourceLangDetection}`;
  } else if (exceptLangs.length > 0) {
    // Build explicit mapping: "Source is Russian → write in Russian", "Source is anything else → write in English"
    const exceptRules = exceptLangs.map((lang) => `- Source is ${lang} → write ENTIRE summary in ${lang}`).join('\n');
    langInstruction = `LANGUAGE RULE (MANDATORY):
${sourceLangDetection}
Output language — based on the source language, pick EXACTLY ONE:
${exceptRules}
- Source is any other language → translate and write ENTIRE summary in ${targetLang}
Every field value must be in the chosen output language. No mixing languages within or across fields.`;
  } else {
    langInstruction = `Write the ENTIRE summary in ${targetLang}. ${sourceLangDetection}`;
  }

  const size: 'short' | 'medium' | 'long' = wordCount < 500 ? 'short' : wordCount < 3000 ? 'medium' : 'long';

  // All detail+size-dependent values in one place — every guideline references these.
  // Brief is flat (same output regardless of article size).
  // Standard and Detailed scale with content length.
  const d = detailLevel === 'brief' ? {
    tldr: '1-2 crisp sentences',
    takeaways: '3-4 short',
    takeawayFormat: '"**Label** — brief explanation"',
    summary: 'one short paragraph (3-5 sentences). No subheadings',
    conclusion: '1-2 sentences',
    quotes: 'Set to null.',
    prosCons: 'Set to null.',
    factCheck: null as null,
    comments: 'Set to null.',
    extraSections: 'Set to null.',
    relatedTopics: '2-3',
    tags: '3-5',
    mermaid: 'Do NOT include mermaid diagrams.',
    images: 'Do NOT embed images in the summary.',
    lengthRule: 'The summary must be much shorter than the source. Never pad or repeat.',
  } : detailLevel === 'standard' ? ({
    short: {
      tldr: '1-2 crisp sentences',
      takeaways: '3-5',
      takeawayFormat: '"**Bold label** — " then a concise explanation',
      summary: 'one focused paragraph. No subheadings',
      conclusion: '1-2 sentences',
      quotes: 'Include 1-2 actual direct quotes if notable. Use an empty array if none stand out.',
      prosCons: 'Include only if the content is primarily about a comparison. Set to null otherwise.',
      factCheck: 'standard' as const,
      comments: 'Include only if user comments are provided and add significant value. Set to null otherwise.',
      extraSections: 'Set to null — not needed for short content.',
      relatedTopics: '3-4',
      tags: '3-5',
      mermaid: 'Do NOT include mermaid diagrams for short content.',
      images: 'Embed at most 1 image, only if it is essential for understanding. Prefer describing in text.',
      lengthRule: 'The summary must be much shorter than the source. Never pad or repeat.',
    },
    medium: {
      tldr: '2-3 crisp sentences',
      takeaways: '5-7',
      takeawayFormat: '"**Bold label** — " then the explanation',
      summary: 'comprehensive but focused. Use ### subheadings to break into 2-4 sections when longer than one paragraph; keep paragraphs to 3-4 sentences',
      conclusion: '2-3 sentences',
      quotes: 'Include actual direct quotes from the text. Use an empty array if none found.',
      prosCons: 'Include only if the content discusses trade-offs, comparisons, or evaluations. Set to null if not applicable.',
      factCheck: 'standard' as const,
      comments: 'Include only if user comments/discussion is provided. Set to null if not applicable.',
      extraSections: 'Use for supplementary content that doesn\'t fit standard fields (cheat sheets, reference tables, etc.). Set to null if not applicable.',
      relatedTopics: '3-5',
      tags: '3-7',
      mermaid: 'Include a mermaid diagram ONLY when it is absolutely crucial for understanding the topic — e.g. the content is fundamentally about a process, architecture, or state machine that cannot be grasped without a visual. When in doubt, omit.',
      images: 'Embed at most 1 image, only if it is important for understanding. Include a 2nd only if absolutely essential. Prefer describing images in text over embedding.',
      lengthRule: 'The summary must be shorter than the original content. Never pad or repeat.',
    },
    long: {
      tldr: '2-3 crisp sentences',
      takeaways: '7-9',
      takeawayFormat: '"**Bold label** — " then the explanation',
      summary: 'comprehensive and structured. Use ### subheadings to break into 3-5 sections; keep paragraphs to 3-4 sentences',
      conclusion: '2-3 sentences',
      quotes: 'Include 3-5 actual direct quotes from the text. Use an empty array if none found.',
      prosCons: 'Include if the content discusses trade-offs, comparisons, or evaluations. Set to null if not applicable.',
      factCheck: 'standard' as const,
      comments: 'Include if user comments/discussion is provided. Set to null if not applicable.',
      extraSections: 'Consider 1-2 supplementary sections if the content has information that doesn\'t fit standard fields. Set to null if not applicable.',
      relatedTopics: '4-5',
      tags: '5-7',
      mermaid: 'Include a mermaid diagram ONLY when it is absolutely crucial for understanding the topic — e.g. the content is fundamentally about a process, architecture, or state machine that cannot be grasped without a visual. When in doubt, omit.',
      images: 'Embed up to 2 images if they are important for understanding. Prefer describing images in text over embedding.',
      lengthRule: 'The summary must be shorter than the original content. Never pad or repeat.',
    },
  })[size] : /* detailed */ ({
    short: {
      tldr: '2-3 sentences',
      takeaways: '5-7 detailed',
      takeawayFormat: '"**Bold label** — " then a thorough explanation',
      summary: 'thorough analysis. Use 2-3 ### subheadings; be detailed in each section',
      conclusion: '2-3 sentences with nuanced thoughts',
      quotes: 'Include 2-4 if available. Use an empty array only if truly none exist.',
      prosCons: 'Look for trade-offs and evaluative content. Only set to null if truly nothing evaluative exists.',
      factCheck: 'detailed' as const,
      comments: 'Include if user comments/discussion is provided. Set to null if not applicable.',
      extraSections: 'Include 1-2 extra sections if the content supports it (background context, key terms, etc.). Set to null if not enough material.',
      relatedTopics: '4-5',
      tags: '5-7',
      mermaid: 'Include a mermaid diagram when it significantly improves understanding of a process, system, or workflow. Do NOT add diagrams that merely restate what the text already says clearly.',
      images: 'Embed 1-2 images if they are important for understanding. Only include images that genuinely add value.',
      lengthRule: 'Be thorough — the summary may be comparable in length to the source for short, dense content.',
    },
    medium: {
      tldr: '3-4 sentences',
      takeaways: '8-12 detailed',
      takeawayFormat: '"**Bold label** — " then a thorough explanation',
      summary: 'long, in-depth analysis. Use 3-5 ### subheadings covering all major aspects; be thorough in each section',
      conclusion: '3-5 sentences with nuanced final thoughts',
      quotes: 'Include generously — aim for 5-8 if available. Use an empty array only if truly none exist.',
      prosCons: 'Actively look for trade-offs, comparisons, and evaluative content. Only set to null if truly nothing evaluative exists.',
      factCheck: 'detailed' as const,
      comments: 'Include if user comments/discussion is provided — be thorough, surface more highlights than usual. Set to null if not applicable.',
      extraSections: 'Actively create extra sections — timeline of events, glossary, key statistics table, methodology notes, background context, cast of characters, etc. Aim for 2-4 when the content supports it.',
      relatedTopics: '4-6',
      tags: '5-10',
      mermaid: 'Include a mermaid diagram when it significantly improves understanding of a process, system, workflow, or relationship with 3+ stages. Do NOT add diagrams that merely restate what the text already says clearly.',
      images: 'Embed 2-3 images that are important for understanding the content. Never exceed 5. Only include images that genuinely add value — decorative or redundant images should be omitted or described in text.',
      lengthRule: 'Prioritize completeness over brevity — the summary may approach the source length for dense content.',
    },
    long: {
      tldr: '3-4 sentences',
      takeaways: '10-15 detailed',
      takeawayFormat: '"**Bold label** — " then a thorough explanation',
      summary: 'extensive, in-depth analysis. Use 5-7 ### subheadings covering all major aspects and subtopics; be thorough in each section',
      conclusion: '4-6 sentences with nuanced final thoughts and broader implications',
      quotes: 'Include generously — aim for 6-10 if available. Use an empty array only if truly none exist.',
      prosCons: 'Actively look for trade-offs, comparisons, and evaluative content. Only set to null if truly nothing evaluative exists.',
      factCheck: 'detailed' as const,
      comments: 'Include if user comments/discussion is provided — be thorough, surface many highlights. Set to null if not applicable.',
      extraSections: 'Actively create 3-5 extra sections — timeline of events, glossary, key statistics table, methodology notes, background context, cast of characters, etc.',
      relatedTopics: '5-6',
      tags: '7-10',
      mermaid: 'Include a mermaid diagram when it significantly improves understanding of a process, system, workflow, or relationship with 3+ stages. Do NOT add diagrams that merely restate what the text already says clearly.',
      images: 'Embed 3-5 images that are important for understanding the content. Never exceed 5. Only include images that genuinely add value — decorative or redundant images should be omitted or described in text.',
      lengthRule: 'Prioritize completeness — the summary should capture all significant aspects of this long content.',
    },
  })[size];

  // Genre-aware field overrides
  // Genre template provides field-level overrides; source type (GitHub/Netflix) provides platform-specific formatting
  const isGitHub = contentType === 'github';
  const isNetflix = contentType === 'netflix';

  // Load genre template — skip for software (uses GitHub overrides) and generic (uses base)
  const genreTemplate = genre && genre !== 'software' && genre !== 'generic'
    ? GENRE_TEMPLATES[genre] : undefined;
  const contentHints: ContentHints = { isVideo };
  const genreFieldOverrides = genreTemplate?.getOverrides(detailLevel as DetailLevel, size as SizeCategory, contentHints);

  const skipQuotes = genreTemplate?.skipQuotes ?? isGitHub;
  const skipFactCheck = genreTemplate?.skipFactCheck ?? (isGitHub || isNetflix);

  // Initialize field guidelines from genre overrides or base `d`.
  // Genre returning null for a field → 'Set to null.' (triggers skip logic below).
  // Genre returning undefined (or absent key) → fall through to base `d` value.
  function genreOrDefault(override: string | null | undefined, base: string): string {
    if (override === undefined) return base;
    return override ?? 'Set to null.';
  }
  let gProsCons = genreOrDefault(genreFieldOverrides?.prosCons, d.prosCons);
  let gComments = genreOrDefault(genreFieldOverrides?.comments, d.comments);
  let gExtraSections = genreOrDefault(genreFieldOverrides?.extraSections, d.extraSections);
  let gConclusion: string | undefined = genreFieldOverrides?.conclusion;

  // Apply GitHub-specific field guidelines — replace generic instructions with page-type-specific ones
  // (GitHub always uses software genre which has no overrides, so these take precedence)
  if (isGitHub && githubPageType) {
    switch (githubPageType) {
      case 'pr':
        gProsCons = detailLevel === 'detailed'
          ? 'Use as "Strengths & Concerns" if the review warrants it. Set to null otherwise.'
          : 'Set to null.';
        gComments = detailLevel === 'brief'
          ? 'Set to null.'
          : 'Include notable review feedback and discussion points. Human comments carry significantly more weight than bot comments — always include them. Recent comments carry more weight than older ones.';
        gExtraSections = detailLevel === 'brief'
          ? 'Set to null.'
          : detailLevel === 'standard'
            ? 'FIRST section must be "Current Status" — state whether the PR is ready to merge, needs changes, or is blocked, and what action is needed next based on the latest comments. Then include "Changes Overview" summarizing what changed and why.'
            : 'FIRST section must be "Current Status" — state whether the PR is ready to merge, needs changes, or is blocked, and what action is needed next based on the latest comments. Then include "Changes Overview", "Review Status", "Key Review Feedback", and "Discussion Highlights".';
        break;
      case 'issue':
        gProsCons = 'Set to null.';
        gComments = detailLevel === 'brief'
          ? 'Set to null.'
          : 'Include notable discussion points and proposed solutions.';
        gExtraSections = detailLevel === 'brief'
          ? 'Set to null.'
          : detailLevel === 'standard'
            ? 'Include "Status & Labels" summarizing current state. If the issue describes a bug, include "Reproduction Steps".'
            : 'Include "Status & Labels", "Reproduction Steps" (if bug). Also include "Proposed Solutions" and "Discussion Highlights".';
        break;
      case 'code':
        gProsCons = detailLevel === 'detailed'
          ? 'Use as "Strengths & Concerns" to highlight code quality issues, if warranted. Set to null otherwise.'
          : 'Set to null.';
        gComments = 'Set to null.';
        gConclusion = 'Overall code quality assessment — note complexity, maintainability, error handling quality, and any structural concerns a senior developer would flag.';
        gExtraSections = detailLevel === 'brief'
          ? `Include "Key Components" — list non-trivial classes and global functions with [L42]({{FILE_1}}#L42) line links. Names only, no descriptions needed.`
          : detailLevel === 'standard'
            ? `Include these sections:
  - "Key Components" — for each non-trivial class or function, write 1-2 sentences in plain language explaining what it actually does — its purpose and behavior, not just its name. Include [L42]({{FILE_1}}#L42) line links. Focus on aggregated meaning: explain the role each component plays in the overall design rather than just listing names (an IDE can do that).
  - "Potential Issues" — ANALYZE THE ACTUAL CODE for problems a senior developer would catch on a fast scan: missing error handling, bare except clauses, resource leaks (files/connections not closed), potential None/null dereferences, obvious logic errors, hardcoded values that should be configurable, security concerns (SQL injection, hardcoded secrets, unsafe deserialization), performance anti-patterns (N+1 patterns, unnecessary loops). Link each issue to the specific line. Do NOT just list TODO/FIXME comments — actually read the code.
  - "TODOs" — items from TODO/FIXME/HACK/XXX comments with line links. Set to null if none found.`
            : `Include these sections:
  - "Key Components" — for each non-trivial class or function, write 3-4 sentences covering: its purpose, how it works internally, and its role in the overall architecture. For classes, list main non-trivial public methods with descriptions that go beyond repeating the method name — explain what actually happens, side effects, or notable behavior (e.g. not "saves data" for save(), but what it persists, how, and any non-obvious behavior). Include [L42]({{FILE_1}}#L42) line links. Aggregate knowledge: help the reader understand the code's architecture and design intent, not just its inventory.
  - "Potential Issues" — ANALYZE THE ACTUAL CODE for problems a senior developer would catch: missing error handling, bare except clauses, resource leaks (files/connections not closed), potential None/null dereferences, obvious logic errors, type safety concerns, hardcoded magic numbers/strings, security concerns (SQL injection, hardcoded secrets, unsafe deserialization, path traversal), performance anti-patterns (N+1 patterns, unnecessary allocations in loops, missing caching). Link each issue to the specific line. Do NOT just list TODO/FIXME comments — actually read the code.
  - "TODOs" — items from TODO/FIXME/HACK/XXX comments with line links. Set to null if none found.
  - "Dependencies" — key imported libraries/modules and their roles.`;
        break;
      case 'repo':
        gProsCons = 'Set to null.';
        gComments = 'Set to null.';
        gExtraSections = detailLevel === 'brief'
          ? 'Set to null.'
          : detailLevel === 'standard'
            ? 'Include "Key Features" listing main capabilities and "Tech Stack".'
            : 'Include "Key Features", "Tech Stack", and "Getting Started" with setup instructions from the README.';
        break;
      case 'commit':
        gProsCons = 'Set to null.';
        gComments = 'Set to null.';
        gExtraSections = detailLevel === 'brief'
          ? 'Set to null.'
          : 'Include "Changes Overview" describing what was changed and why. Use {{FILE_N}}#L123 references when discussing specific changes.';
        break;
      case 'release':
        gProsCons = 'Set to null.';
        gComments = 'Set to null.';
        gExtraSections = detailLevel === 'brief'
          ? 'Set to null.'
          : detailLevel === 'standard'
            ? 'Include "What\'s New" and "Breaking Changes" (if any).'
            : 'Include "What\'s New", "Breaking Changes" (if any), "Bug Fixes", and "Migration Notes" (if applicable).';
        break;
    }
  }

  // Skip fields from schema+guidelines when they're just "Set to null"
  const skipProsCons = gProsCons === 'Set to null.';
  const skipComments = gComments === 'Set to null.';
  const skipExtraSections = gExtraSections === 'Set to null.';

  const today = new Date().toISOString().slice(0, 10);

  // Genre can override the factCheck level (e.g. news forces 'standard' even at brief)
  const effectiveFactCheck = genreFieldOverrides?.factCheck !== undefined ? genreFieldOverrides.factCheck : d.factCheck;

  // factCheck rules — shared body for standard/detailed, null for brief, skipped for GitHub
  const factCheckPreamble = effectiveFactCheck === 'detailed'
    ? 'Actively look for verifiable factual claims to analyze. Include when'
    : 'Include ONLY when';

  const factCheckGuideline = skipFactCheck
    ? ''
    : effectiveFactCheck === null
      ? '- "factCheck": Set to null.'
      : `- "factCheck" — NEVER set to null for news, journalism, or reporting of any kind. For non-news content, ${factCheckPreamble.toLowerCase()} any of the conditions below apply.
  MANDATORY (never null):
  - NEWS / JOURNALISM: ALL news sources carry editorial bias — ownership, audience, advertisers, and geopolitical alignment shape what gets covered, how it's framed, and what's omitted. No outlet is neutral. State-affiliated media (RT, Xinhua, Al Jazeera, Voice of America, etc.), partisan outlets, and outlets with known ownership stakes MUST get a ⛔ bullet noting the affiliation/lean. Even "reputable" outlets selectively frame — check what's emphasized vs buried vs omitted.
  - POLITICAL / GEOPOLITICAL: government statements, policy claims, war/conflict reporting, election coverage, sanctions/diplomacy — competing narratives always exist.
  - FINANCIAL INCENTIVE: product reviews, sponsored content, affiliate pages, company announcements, press releases, fundraising appeals.
  - HEALTH / SCIENCE with stakes: medical claims, nutrition advice, drug efficacy, environmental data, pandemic coverage.
  - INDUSTRY-FUNDED or LOBBYING-ADJACENT: think-tank reports, industry whitepapers, "studies show" without naming the funder.
  - STATISTICS / DATA CLAIMS: specific numbers, percentages, rankings, "fastest growing", "most popular".
  INCLUDE when:
  - Content makes specific, verifiable factual claims that matter to the reader's understanding (historical assertions, attributed quotes, legal claims).
  - Source has an identifiable stake in the reader's conclusion (institutional PR, advocacy, marketing disguised as journalism).
  SET TO NULL ONLY for: essays, opinion pieces, philosophical writing, personal narratives, advice/self-help, tutorials, humor, creative fiction, poetry, or content where claims are purely subjective or experiential.
  The test: "Does someone benefit from the reader believing this uncritically?" If yes → MUST include. "Would getting this wrong actually mislead the reader?" If yes → MUST include. Both no → may set to null.
  GOAL: Maximize information value per bullet. Skip obvious/trivial truths everybody knows. Focus on what would SURPRISE, CORRECT, or PROTECT a careful reader. The output should change the reader's knowledge state — if a bullet wouldn't, cut it.
  Format: structured markdown list, one bullet per item. Pattern: [icon] [Verdict]: **"Claim quote or paraphrase"** — brief explanation. Icon and verdict word MUST come first so the reader sees the judgment immediately. Icons: ✅ ⚠️ ❌ 🔍 ⛔ — translate verdict words to match the summary language.
  HIGH-VALUE bullets (prioritize): ❌ claims widely believed but actually false (myth-busting); ⚠️ claims technically true but misleading (cherry-picked data, survivorship bias, misleading denominators, "up to X%" framing, correlation-as-causation); ⛔ important context the article omits that would materially change reader's conclusion; ✅ surprising truths most readers would doubt (confirms something counterintuitive); facts that WERE true but are now outdated.
  LOW-VALUE bullets (skip): obvious truths no informed reader would question; trivial details (exact dates, minor figures) unless the error is consequential; claims too recent to assess — do NOT pad with 🔍 bullets.
  TARGET: 3-6 bullets total. Quality over quantity. Every bullet must earn its place.
  EVIDENTIARY RIGOR — do not confuse repetition with verification. The #1 LLM bias: a claim repeated by many outlets FEELS verified but may trace to ONE interested source. Volume of repetition ≠ strength of evidence. Hierarchy:
  1. PRIMARY EVIDENCE (highest confidence): court filings, raw datasets, mathematical proofs, directly observable events, verbatim public records → may warrant ✅
  2. INDEPENDENT CONVERGENCE: multiple parties with DIFFERENT incentives reach the same conclusion → ✅ or strong ⚠️
  3. AMPLIFIED SINGLE-SOURCE: one interested party's claim repeated across outlets → ⚠️ at best, regardless of how many outlets repeat it. Name the original source and their stake.
  4. INSTITUTIONAL NARRATIVES: government statements, intelligence assessments, corporate claims, industry-funded studies → ⚠️ by default. Ask: "Who benefits from this being believed?"
  For any significant claim, consider: does a credible contrarian position exist? Not fringe conspiracy, but substantive disagreement from qualified sources with different incentives. If yes → ⚠️ regardless of mainstream consensus volume.
  Verdict rules:
  - ✅ Verified = indisputable. Mathematical truths, directly observable events, undisputed public records. HIGHEST bar. If you must cite WHO says it's true, it's not ✅. Self-check: "Could a reasonable, informed skeptic dispute this?" If yes → ⚠️.
  - ⚠️ Contested/Misleading = DEFAULT for anything in politics, geopolitics, corporate, or institutional space. Use when: (a) credible disagreement exists; (b) source has a stake; (c) technically true but framing implies more than evidence supports; (d) compound claim mixing verifiable and unverifiable parts.
  - ❌ False = you have definitive knowledge that DIRECTLY CONTRADICTS the claim. NEVER use because you're unaware — that's 🔍. Self-check: "Can I name the specific contradicting fact?" If not → 🔍.
  - 🔍 Unverifiable = entirely outside your training data. Use sparingly — only when you truly have ZERO relevant information. Self-check: "Do I actually have partial knowledge here?" If yes → ⚠️ Partial.
  - ⛔ Omitted = important fact/context the article does not mention that would materially affect reader's understanding. Only flag when: (a) you have actual knowledge of the missing information, AND (b) a reader without domain expertise would be misled by its absence. Do NOT flag common knowledge the article reasonably assumes readers have.
  LANGUAGE PRECISION flags — note when the article uses hedging that implies more than stated: "No evidence of X" (nobody looked?), "linked to" (correlation only), "up to N%" (the max, not average), "studies show" (which studies? funded by whom?), "officials say" (which officials? what's their stake?). Mention the gap between wording and what it implies.
  Knowledge cutoff (today is ${today}): "I have no record" → 🔍 or ⚠️ Partial, NEVER → ❌. Absence of information means your data predates it, NOT that it didn't happen.
  Examples:
  - ✅ Verified: **"Exposed 500M user records"** — confirmed by SEC filing and independent security audit
  - ⚠️ Misleading: **"Vaccine is 95% effective"** — figure is relative risk reduction — absolute risk reduction was ~0.7%, a distinction the article does not make
  - ❌ False: **"We only use 10% of our brains"** — neuroimaging shows most brain regions are active across 24h — persistent myth
  - 🔍 Unverifiable: **"Crime dropped 77% in Memphis"** — no public dataset supports this specific figure
  - ⛔ Omitted: **industry funding** — The cited study was funded by the manufacturer; no independent replication exists. Article presents findings as neutral science`;

  // Effective quotes guideline — genre may override or null it out
  const effectiveQuotes = genreFieldOverrides?.quotes !== undefined ? genreFieldOverrides.quotes : d.quotes;
  const hasQuotes = !skipQuotes && !!effectiveQuotes && effectiveQuotes !== 'Set to null.';

  // Quotes extra instructions (translation + timestamps) — only when quotes are included
  const quotesExtra = hasQuotes ? ' When the summary language differs from the source language, append a translation in parentheses after each quote, e.g. "Original quote" (Translation). If you include a timestamp, always make it a clickable markdown link — never a bare number.' : '';

  // Mermaid section — skip for GitHub non-code types and genres that don't benefit from process diagrams
  const skipMermaid = genreTemplate?.skipMermaid ?? false;
  const mermaidGuideline = ((isGitHub && githubPageType !== 'code') || skipMermaid)
    ? ''
    : detailLevel === 'brief'
    ? `- ${d.mermaid}`
    : `- ${d.mermaid}\n${MERMAID_ESSENTIAL_RULES}`;

  // Build JSON schema — omit fields that are always null for the content type
  const schema: string[] = [
    '"tldr": "High-level overview of the content."',
    '"keyTakeaways": ["Key point 1", "Key point 2", ...]',
    '"summary": "Main summary of the content."',
  ];
  if (!skipQuotes) schema.push('"notableQuotes": ["Direct quote 1", "Direct quote 2", ...]');
  schema.push('"conclusion": "Main conclusion or final thoughts."');
  if (!skipProsCons) schema.push('"prosAndCons": { "pros": ["Pro 1", ...], "cons": ["Con 1", ...] }');
  if (!skipFactCheck) schema.push('"factCheck": "Analysis of factual accuracy..."');
  if (!skipComments) schema.push('"commentsHighlights": ["Notable comment/discussion point 1", ...]');
  schema.push('"relatedTopics": ["Related topic 1", "Related topic 2", ...]');
  if (!skipExtraSections) schema.push('"extraSections": {"Section Title": "section content", ...} (keys are plain-text titles, no markdown)');
  schema.push('"tags": ["tag1", "tag2", ...]', '"sourceLanguage": "xx"', '"summaryLanguage": "xx"');
  if (!isGitHub) {
    schema.push('"translatedTitle": "Title in summary language or null"', '"inferredTitle": "Descriptive title or null"',
      '"inferredAuthor": "Author name or null"', '"inferredPublishDate": "YYYY-MM-DD or null"');
  }
  const schemaFields = schema.map(f => `    ${f}`).join(',\n');

  // Build guidelines — genre overrides replace base `d` values for core fields
  const gTldr = genreFieldOverrides?.tldr;
  const gTakeaways = genreFieldOverrides?.takeaways;
  const gTakeawayFormat = genreFieldOverrides?.takeawayFormat;
  const gSummary = genreFieldOverrides?.summary;
  const gRelatedTopics = genreFieldOverrides?.relatedTopics;
  const gTags = genreFieldOverrides?.tags;

  const guidelines: string[] = gTldr ? [
    `- "tldr": ${gTldr}`,
    `- "keyTakeaways": ${gTakeaways || `${d.takeaways} items. Each: ${gTakeawayFormat || d.takeawayFormat}.`}`,
    `- "summary": ${gSummary || d.summary}`,
  ] : [
    `- "tldr": ${d.tldr}. Each sentence standalone — never one compound run-on. Bold the most critical terms.`,
    `- "keyTakeaways": ${d.takeaways} items. Each: ${d.takeawayFormat}.`,
    `- "summary": ${d.summary}. Bold key terms, names, and statistics throughout.`,
  ];
  if (hasQuotes) guidelines.push(`- "notableQuotes": ${effectiveQuotes}${quotesExtra}`);
  guidelines.push(`- "conclusion": ${gConclusion || `${d.conclusion}.`}`);
  if (!skipProsCons) guidelines.push(`- "prosAndCons": ${gProsCons}`);
  if (factCheckGuideline) guidelines.push(factCheckGuideline);
  if (!skipComments) guidelines.push(`- "commentsHighlights": ${gComments}`);
  guidelines.push(`- "relatedTopics": ${gRelatedTopics || `${d.relatedTopics} topics.`}`);
  if (!skipExtraSections) guidelines.push(`- "extraSections": ${gExtraSections}`);
  guidelines.push(
    `- "tags": ${gTags || `${d.tags} short, lowercase tags.`}`,
    `- "sourceLanguage" must be the ISO 639-1 code of the language the MAJORITY of the original content is written in (e.g. "en", "ru", "fr"). A few foreign words, proper names, or technical terms do not change the source language — only the dominant language of the body text counts.`,
    `- "summaryLanguage" must be the ISO 639-1 code of the language you actually wrote the summary in. It must match the output language you chose in the LANGUAGE RULE (Step 2) at the top.`,
  );
  if (!isGitHub) {
    guidelines.push(
      `- "translatedTitle" — if sourceLanguage differs from summaryLanguage, provide the title translated to the summary language. Set to null if no translation was needed.`,
      `- "inferredTitle" — if the title metadata is marked as MISSING, create a concise, descriptive title (5-10 words) that captures the main topic. Set to null if a real title was already provided.`,
      `- "inferredAuthor" — if the author metadata is marked as MISSING, try to infer the author from the content text (byline, signature, mentions, etc.). Set to null if you cannot determine it.`,
      `- "inferredPublishDate" — if the publish date metadata is marked as MISSING, try to infer the date from the content text (date references, timestamps, etc.) in YYYY-MM-DD format. Set to null if you cannot determine it.`,
    );
  }
  guidelines.push(`- All text fields support full markdown formatting (bold, italic, links, lists, etc.). Use it wherever it improves clarity.`);
  guidelines.push(`- MATH FORMULAS: When the content contains mathematical expressions, equations, or formulas, reproduce them using LaTeX notation: \`$...$\` for inline math and \`$$...$$\` for display (block) equations. Always prefer LaTeX over Unicode approximations for anything beyond simple arithmetic.`);
  if (mermaidGuideline) guidelines.push(mermaidGuideline);
  // Data charts — enabled for data-heavy genres and generic content types
  const enableDataCharts = genreTemplate?.enableDataCharts
    ?? (!contentType || contentType === 'article' || contentType === 'pdf' || contentType === 'generic');
  if (enableDataCharts) {
    const chartMax = detailLevel === 'brief' ? '1' : detailLevel === 'standard' ? '2-3' : '2-5';
    guidelines.push(`- DATA CHARTS: If the content contains significant numerical tables or datasets, identify the most important data and visualize it using mermaid charts (\`xychart-beta\` for trends/comparisons, \`pie\` for proportions). Create up to ${chartMax} chart(s). Place charts in the "summary" or "extraSections" near the relevant discussion. This applies even when process/architecture diagrams are otherwise omitted — data visualization is always valuable when the numbers warrant it.`);
  }
  guidelines.push(`- ${d.lengthRule} Each field should add unique value — do not restate the same points across fields.`);
  if (!isGitHub) {
    guidelines.push(`- IMPORTANT: The content may contain mature, explicit, or sensitive topics (medical, psychological, sexual health, etc.). You MUST still summarize it fully and accurately — never refuse to summarize. Keep the summary professional and clinical in tone — do not reproduce explicit language or graphic details. Focus on the key ideas, arguments, and conclusions.`);
  }
  guidelines.push(
    `- IMPORTANT: If the provided text contains no meaningful content — e.g. it is a UI dump, login page, error page, navigation menu, cookie consent, paywall, or app interface markup rather than an actual article or document — respond with: {"text": "Brief explanation of why there is no content to summarize", "noContent": true}. Do NOT attempt to summarize interface elements or boilerplate.`,
    `- IMPORTANT: If the user's additional instructions explicitly ask you NOT to summarize, or say they only want to ask questions / chat about the content, RESPECT their request. Respond with: {"text": "Your conversational response here"}. Do NOT include "summary" in this case.`,
  );

  // Genre-specific additional guidelines (e.g. "check for logical fallacies")
  const additionalGuidelines = genreTemplate?.additionalGuidelines?.(detailLevel as DetailLevel) ?? [];
  for (const g of additionalGuidelines) {
    guidelines.push(`- ${g}`);
  }

  const role = genreTemplate?.role
    ?? (isGitHub ? 'an expert software engineer and content summarizer' : 'an expert content summarizer');

  // Build a short, punchy language reminder for the very end of the prompt (recency bias)
  let langReminder: string;
  if (language === 'auto') {
    langReminder = '\n\nREMINDER: Write the summary in the SAME language as the source content.';
  } else if (exceptLangs.length > 0) {
    const exceptBullets = exceptLangs.map((lang) => `${lang} source → ${lang} output`).join(', ');
    langReminder = `\n\nREMINDER — EXTREMELY IMPORTANT!!! — before you write: Identify the source language first. ${exceptBullets}. All other sources → ${targetLang} output. Do NOT default to ${targetLang} — check the source language. DO NOT MIX LANGUAGES. The ENTIRE text MUST use the SAME output language.`;
  } else {
    langReminder = `\n\nREMINDER: Write the ENTIRE summary in ${targetLang}.`;
  }

  return `You are ${role}. Today's date is ${today}. Your training data has a knowledge cutoff — many events, laws, announcements, personnel changes, and developments have occurred since then that you have NO information about. ${langInstruction}

Content: ~${wordCount.toLocaleString()} words → classified as "${size}" (thresholds: short <500, medium 500-3000, long 3000+). The ranges below are tuned for this size tier. If the content is near a threshold boundary, blend smoothly — do not produce drastically different output for 490 vs 510 words.

You MUST respond with valid JSON matching this exact structure (no markdown code fences, just raw JSON):
{
  "text": "",
  "summary": {
${schemaFields}
  }
}

Guidelines:
${guidelines.join('\n')}`
  + (imageAnalysisEnabled ? `

Image Analysis Instructions:
- You have been provided with images from the page. Analyze them as part of the content.
- ${d.images}
- Images marked [THUMBNAIL] in the attached list are already displayed as the page header image in the UI. You MUST analyze their content, but do NOT embed them with \`![](url)\` in the summary — they would appear twice.` + (detailLevel !== 'brief' ? `
- For each non-thumbnail image, decide the best approach: embed as \`![description](url)\` in the summary (subject to the limit above), describe it in text, or discard if not informative.
- If you see image URLs listed in the text that you believe are critical to understanding the content but were NOT attached, you may include \`"requestedImages": ["url1", "url2"]\` (max 3 URLs) at the top level of the response alongside "text" and "summary". The system will fetch them and re-run. Only request images that are clearly referenced in the text and essential for understanding.
- Do NOT request images if the attached images already cover the key visuals.` : '') : '')
  + langReminder;
}

export function getSummarizationPrompt(content: ExtractedContent, detailLevel: 'brief' | 'standard' | 'detailed' = 'standard'): string {
  const isDiscussion = ['reddit', 'twitter', 'linkedin'].includes(content.type);
  const contentLabel = content.type === 'youtube' ? 'YouTube video'
    : content.type === 'netflix' ? 'Netflix video (transcript from closed captions)'
    : content.type === 'reddit' ? 'Reddit discussion'
    : content.type === 'twitter' ? 'X thread'
    : content.type === 'linkedin' ? 'LinkedIn post'
    : content.type === 'github' ? getGitHubContentLabel(content)
    : content.type === 'pdf' ? 'PDF document'
    : 'article/page';

  let prompt = `Summarize the following ${contentLabel}.\n\n`;

  prompt += `**Title:** ${content.title || 'MISSING — infer a concise, descriptive title from the content'}\n`;
  prompt += `**URL:** ${content.url}\n`;
  prompt += `**Author:** ${content.author || 'MISSING — try to infer from content'}\n`;
  prompt += `**Published:** ${content.publishDate || 'MISSING — try to infer from content'}\n`;
  if (content.channelName) prompt += `**Channel:** ${content.channelName}\n`;
  if (content.duration) prompt += `**Duration:** ${content.duration}\n`;
  if (content.viewCount) prompt += `**Views:** ${content.viewCount}\n`;

  if (content.type === 'youtube') {
    prompt += `\n**IMPORTANT — Timestamp Links:** When referencing specific moments, include clickable timestamp links using this exact format: [MM:SS]({{VIDEO_URL}}&t=SECONDS) (e.g. [2:15]({{VIDEO_URL}}&t=135)). Use them in any section for key moments, notable quotes, and important transitions — but don't overdo it, only where they add genuine value.\n`;
  }
  if (content.type === 'netflix') {
    prompt += `\n**IMPORTANT — Netflix Content:** This is a transcript from Netflix closed captions. Use your general knowledge to enrich the summary with:
- Full cast information (actor names → character names)
- Director, showrunner, writers
- Release year, number of seasons/episodes
- Critical reception (IMDb, Rotten Tomatoes scores if you know them)
- Awards and nominations
- Cultural context and genre classification
The transcript is dialogue-only — infer scene descriptions, emotions, and context from the dialogue.
Sections with titles starting with "[SPOILER]" will be hidden behind a spoiler warning in the UI — include full spoilers freely in those sections. The "[SPOILER]" prefix will be stripped from the displayed title.
**Netflix Links:** In "Cast & Characters", make each actor name a Netflix search link: [Actor Name](https://www.netflix.com/search?q=Actor%20Name). In "Similar Titles", make each title a Netflix search link: [Title](https://www.netflix.com/search?q=Title). This lets users quickly find related content on Netflix. IMPORTANT: Never translate names or titles inside link URLs — always use the original (usually English/romanized) name in the URL query parameter, even when the summary is written in another language.
**Timestamp Links:** When referencing specific moments (notable dialogue, key scenes), include clickable timestamp links using this exact format: [MM:SS]({{VIDEO_URL}}&t=SECONDS) (e.g. [2:15]({{VIDEO_URL}}&t=135)). Clicking these will seek the Netflix player to that moment.\n`;
  }
  if (content.subreddit) prompt += `**Subreddit:** r/${content.subreddit}\n`;
  if (content.postScore !== undefined) prompt += `**Post Score:** ${content.postScore}\n`;
  if (content.commentCount !== undefined) prompt += `**Comments:** ${content.commentCount}\n`;
  prompt += `**Word count:** ${content.wordCount}\n\n`;
  if (content.description) prompt += `**Description:**\n${content.description}\n\n`;

  if (isDiscussion) {
    prompt += `**IMPORTANT — Discussion Mode:** This is a community discussion. The comments/replies ARE the primary content — not supplementary. Your summary should:
- Synthesize the key themes and arguments from the discussion into a coherent narrative.
- Identify points of consensus and disagreement among participants.
- Highlight the most insightful, upvoted, or impactful contributions.
- Note the overall community sentiment (supportive, critical, mixed, etc.).
- Use "commentsHighlights" for the most notable individual comments or exchanges.
- "notableQuotes" should be actual quotes from commenters, not just the original poster.\n\n`;
  }

  // GitHub-specific instructions
  if (content.type === 'github' && content.githubPageType) {
    if (content.content.includes('<!-- FILE_MAP:')) {
      prompt += getGitHubFileRefInstructions(content);
    }
    prompt += getGitHubContextInstructions(content.githubPageType, detailLevel, content.prState ?? content.issueState);
  }

  prompt += `---\n\n**Content:**\n\n${content.content}\n`;

  // For discussion types, comments are already embedded in the content
  if (!isDiscussion && content.comments && content.comments.length > 0) {
    prompt += `\n---\n\n**User Comments (${content.comments.length}):**\n\n`;
    prompt += formatCommentsBlock(content.comments, detailLevel);
  }

  return prompt;
}

export function getRollingContextPrompt(previousSummary: string): string {
  return `Here is a summary of the previous portion of the content. Use it as context for summarizing the next portion, then produce an updated combined summary.

**Previous summary context:**
${previousSummary}

---

Now continue summarizing the next portion below. Integrate it with the context above to produce a comprehensive summary.`;
}

export function getFinalChunkPrompt(): string {
  return `This is the FINAL portion of the content. Produce the complete, final structured JSON summary incorporating all previous context and this last section.`;
}

// ─── GitHub-specific prompt helpers ────────────────────────────────────

function getGitHubContentLabel(content: ExtractedContent): string {
  switch (content.githubPageType) {
    case 'pr': return 'GitHub Pull Request';
    case 'issue': return 'GitHub Issue';
    case 'code': return 'GitHub code file';
    case 'repo': return 'GitHub repository';
    case 'commit': return 'GitHub commit';
    case 'release': return 'GitHub release';
    default: return 'GitHub page';
  }
}

/** FILE_MAP reference instructions — appended to user prompt (content-dependent) */
function getGitHubFileRefInstructions(content: ExtractedContent): string {
  const fileMapMatch = content.content.match(/<!-- FILE_MAP: ({.*?}) -->/);
  if (!fileMapMatch) return '';
  try {
    const fileMap = JSON.parse(fileMapMatch[1]) as Record<string, string>;
    const fileLines = Object.entries(fileMap).map(([n, url]) => {
      const path = url.split('/blob/')[1]?.replace(/^[^/]+\//, '') || url;
      return `- {{FILE_${n}}} = ${path}`;
    });
    return `\n**FILE REFERENCES:** Use {{FILE_N}} aliases for line links.
Available files:
${fileLines.join('\n')}

When referencing specific lines, use: [L123]({{FILE_N}}#L123)
When referencing line ranges: [L123-L130]({{FILE_N}}#L123-L130)
Explain code in English, reference identifiers with \`backticks\`.\n\n`;
  } catch { return ''; }
}

/** GitHub contextual instructions — appended to user prompt (field overrides are in system prompt) */
function getGitHubContextInstructions(
  pageType: NonNullable<ExtractedContent['githubPageType']>,
  detailLevel: 'brief' | 'standard' | 'detailed',
  state?: string,
): string {
  const parts: string[] = [];

  // Status line format shared by PR and issue
  const statusFormat = 'Format: "**Status:** Label — brief explanation."';

  switch (pageType) {
    case 'pr':
      parts.push('- **COMMENT WEIGHTING:** Human comments are FAR more important than bot comments. The most recent human comment often determines the current state of the PR — surface it prominently. Repo owners/maintainers carry the most weight.');
      parts.push('- Comments tagged [BOT] are from automated tools — summarize their findings briefly, don\'t quote their boilerplate.'
        + (detailLevel === 'brief' ? ' Skip code diffs/blocks inside bot comments entirely, focus only on their prose conclusions.' : ''));
      parts.push('- Comments tagged [AUTHOR] are from the PR author — highlight their explanations and responses.');
      if (state === 'merged') {
        parts.push(`- **STATUS FOCUS:** The TL;DR must end with the status on a separate line (use \\n\\n). Use exactly: "**Status:** Merged". The conclusion should reflect what was accomplished.`);
      } else if (state === 'closed') {
        parts.push(`- **STATUS FOCUS:** The TL;DR must end with the status on a separate line (use \\n\\n). Use exactly: "**Status:** Closed — brief reason." The conclusion should explain why it was closed.`);
      } else {
        parts.push(`- **STATUS FOCUS:** The TL;DR must end with the current status on a separate line (use \\n\\n). Start with one of these exact labels: "Ready to merge" (all reviews pass, no unresolved concerns), "Needs attention" (has unresolved review comments or requested changes), "Blocked" (waiting on specific action/dependency), or "Open" (just opened, no reviews yet). ${statusFormat} Example: "**Status:** Needs attention — maintainer requested verification of recursive edge case." The conclusion must focus on where this PR stands NOW and what needs to happen next — not just a general assessment.`);
      }
      parts.push('- Use {{FILE_N}}#L123 references when discussing specific code changes.');
      break;
    case 'issue':
      parts.push('- **COMMENT WEIGHTING:** Human comments are more important than bot comments. Recent comments carry more weight — they reflect the current state of the issue.');
      parts.push('- Comments tagged [BOT] are from automated tools — summarize briefly.'
        + (detailLevel === 'brief' ? ' Skip code diffs/blocks inside bot comments entirely.' : ''));
      parts.push('- Comments tagged [AUTHOR] are from the issue author — highlight context they provide.');
      if (state === 'closed') {
        parts.push(`- **STATUS FOCUS:** The TL;DR must end with the status on a separate line (use \\n\\n). Use exactly: "**Status:** Closed — brief reason." The conclusion should reflect the resolution.`);
      } else {
        parts.push(`- **STATUS FOCUS:** The TL;DR must end with the current status on a separate line (use \\n\\n). Start with one of these exact labels: "Has fix" (PR or workaround available), "Confirmed" (reproduced/acknowledged), "Needs triage" (new, no response yet), or "Stale" (no activity). ${statusFormat}`);
      }
      break;
    case 'code':
      if (detailLevel === 'brief') {
        parts.push('- Format key components as: [L15]({{FILE_1}}#L15): `class ClassName`');
      } else {
        parts.push('- Format line-linked items as: [L42]({{FILE_1}}#L42): TODO — Description');
        parts.push('- Format key components as: [L15]({{FILE_1}}#L15): `class ClassName` — Plain language description of what it does');
      }
      break;
  }

  if (parts.length === 0) return '';
  return '\n**GitHub-specific instructions:**\n' + parts.join('\n') + '\n';
}
