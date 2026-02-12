import type { ExtractedContent } from '../extractors/types';
import { MERMAID_ESSENTIAL_RULES } from '../mermaid-rules';

const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English', es: 'Spanish', fr: 'French', de: 'German',
  pt: 'Portuguese', ru: 'Russian', zh: 'Chinese', ja: 'Japanese', ko: 'Korean',
};

export function getSystemPrompt(detailLevel: 'brief' | 'standard' | 'detailed', language: string, languageExcept: string[] = [], imageAnalysisEnabled = false, wordCount = 1500, contentType?: string, githubPageType?: string): string {
  const targetLang = LANGUAGE_NAMES[language] || language;
  const exceptLangs = languageExcept
    .map((code) => LANGUAGE_NAMES[code] || code)
    .filter(Boolean);

  let langInstruction: string;
  if (language === 'auto') {
    langInstruction = 'Respond in the same language as the source content. Match the content language exactly.';
  } else if (exceptLangs.length > 0) {
    langInstruction = `LANGUAGE RULE: If the source content is written in ${exceptLangs.join(' or ')}, you MUST respond in that same language — do NOT translate it. For all other source languages, translate and respond in ${targetLang}.`;
  } else {
    langInstruction = `Respond in ${targetLang}.`;
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

  // Content-type-aware field exclusions
  const isGitHub = contentType === 'github';
  const skipQuotes = isGitHub;
  const skipFactCheck = isGitHub;

  // Apply GitHub-specific field guidelines — replace generic instructions with page-type-specific ones
  // (moves field overrides from user prompt into system prompt for clarity and token savings)
  let gProsCons = d.prosCons;
  let gComments = d.comments;
  let gExtraSections = d.extraSections;
  let gConclusion: string | null = null; // null = use default `d.conclusion`

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

  // factCheck rules — shared body for standard/detailed, null for brief, skipped for GitHub
  const factCheckPreamble = d.factCheck === 'detailed'
    ? 'Actively look for verifiable factual claims to analyze. Include when'
    : 'Include ONLY when';

  const factCheckGuideline = skipFactCheck
    ? ''
    : d.factCheck === null
      ? '- "factCheck": Set to null.'
      : `- "factCheck" — ${factCheckPreamble} the content makes specific, verifiable factual claims that matter to the reader's understanding (statistics, scientific claims, historical assertions, policy claims, attributed quotes). Set to null for: essays, opinion pieces, philosophical writing, personal narratives, advice/self-help, tutorials, reviews, humor, creative fiction, poetry, or any content where claims are primarily subjective, experiential, or use facts only as passing illustrations. The test: "Would getting a fact wrong here actually mislead the reader on something important?" If not, set to null. When included, use a structured markdown list format — one bullet per claim examined. Each bullet must follow this pattern: **"Claim quote or paraphrase"** — [icon] [verdict], then a brief explanation. Use only the icon emoji (✅ ⚠️ ❌ 🔍) followed by the verdict word in the summary language (e.g. ✅ Verified, ⚠️ Contested, ❌ False, 🔍 Unverifiable — translate these to match the summary language). Example:
  - **"Crime dropped 77% in Memphis"** — 🔍 Unverifiable; no public data supports this specific figure
  - **"Maduro indicted by SDNY in 2020"** — ✅ Verified; real indictment for narco-terrorism
  Focus on the most significant claims (5-8 max). Do NOT just echo mainstream consensus; focus on verifiable facts. Flag unsupported generalizations, cherry-picked data, or missing important context.
  CRITICAL — source attribution and verdict integrity: ALWAYS name the source and note their stake. The verdict MUST reflect source quality — do NOT mark ✅ Verified and then note the source is biased; that is contradictory. Rules:
  - ✅ Verified = ONLY for indisputable objective facts: mathematical truths, directly observable physical events, verbatim public records anyone can look up (e.g. "X was indicted" = court filing exists; "law was passed on date Y" = public record). This is the HIGHEST bar. If you have to cite WHO says it's true, it probably isn't ✅.
  - ⚠️ Contested/Partial = the DEFAULT for any claim involving politics, intelligence, military, geopolitics, or institutional narratives. Use this whenever sources have ANY stake. This includes: intelligence assessments (they are probabilistic analyses by agencies with geopolitical interests, not proof), indictment allegations (accusations, not verdicts — prosecutors have conviction incentives), government technical reports about adversaries, forensic attribution by firms hired by a party to the dispute, and any claim where "multiple sources" all trace back to the same original interested party. Always note who contests and why.
  - ❌ False = you have definitive contradicting knowledge (e.g. "17 agencies" when it was actually 3 + ODNI coordinator).
  - 🔍 Unverifiable = no information to confirm or deny, especially recent events beyond knowledge cutoff.
  SELF-CHECK: Before writing ✅, ask: "Could a reasonable, informed skeptic dispute this using publicly available information?" If yes, use ⚠️. Be skeptical of ALL official narratives regardless of which government or institution produces them. If later investigations, whistleblowers, or declassified documents challenged a narrative, mention that.
  CRITICAL — knowledge cutoff rule: Use ❌ False ONLY when you have definitive knowledge that contradicts the claim (e.g. wrong date for a historical event, misattributed quote, incorrect scientific fact). If a claim describes an event you have NO information about — especially anything recent — you MUST use 🔍 Unverifiable, NEVER ❌ False. "I have no record of this" does NOT mean it didn't happen. Absence of evidence is not evidence of absence. When in doubt, always default to 🔍 Unverifiable.`;

  // Quotes extra instructions (translation + timestamps) — only when quotes are included
  const quotesExtra = (skipQuotes || d.quotes === 'Set to null.') ? '' : ' When the summary language differs from the source language, append a translation in parentheses after each quote, e.g. "Original quote" (Translation). If you include a timestamp, always make it a clickable markdown link — never a bare number.';

  // Mermaid section — skip for GitHub non-code types; syntax rules appended when diagrams are allowed
  const mermaidGuideline = (isGitHub && githubPageType !== 'code')
    ? ''
    : detailLevel === 'brief'
    ? `- ${d.mermaid}`
    : `- ${d.mermaid}\n${MERMAID_ESSENTIAL_RULES}`;

  const today = new Date().toISOString().slice(0, 10);

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
  const schemaFields = schema.map(f => `  ${f}`).join(',\n');

  // Build guidelines
  const guidelines: string[] = [
    `- "tldr": ${d.tldr}. Each sentence standalone — never one compound run-on. Bold the most critical terms.`,
    `- "keyTakeaways": ${d.takeaways} items. Each: ${d.takeawayFormat}.`,
    `- "summary": ${d.summary}. Bold key terms, names, and statistics throughout.`,
  ];
  if (!skipQuotes) guidelines.push(`- "notableQuotes": ${d.quotes}${quotesExtra}`);
  guidelines.push(`- "conclusion": ${gConclusion || `${d.conclusion}.`}`);
  if (!skipProsCons) guidelines.push(`- "prosAndCons": ${gProsCons}`);
  if (factCheckGuideline) guidelines.push(factCheckGuideline);
  if (!skipComments) guidelines.push(`- "commentsHighlights": ${gComments}`);
  guidelines.push(`- "relatedTopics": ${d.relatedTopics} topics.`);
  if (!skipExtraSections) guidelines.push(`- "extraSections": ${gExtraSections}`);
  guidelines.push(
    `- "tags": ${d.tags} short, lowercase tags.`,
    `- "sourceLanguage" must be the ISO 639-1 code of the original content language (e.g. "en", "ru", "fr").`,
    `- "summaryLanguage" must be the ISO 639-1 code of the language you wrote the summary in (e.g. "en", "ru"). REMINDER: Re-read the language instruction at the top of this prompt — if it says to NOT translate certain source languages, you MUST obey. Write summaryLanguage to match the language you actually used.`,
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
  if (mermaidGuideline) guidelines.push(mermaidGuideline);
  if (!contentType || contentType === 'article' || contentType === 'generic') {
    const chartMax = detailLevel === 'brief' ? '1' : detailLevel === 'standard' ? '2-3' : '2-5';
    guidelines.push(`- DATA CHARTS: If the content contains significant numerical tables or datasets, identify the most important data and visualize it using mermaid charts (\`xychart-beta\` for trends/comparisons, \`pie\` for proportions). Create up to ${chartMax} chart(s). Place charts in the "summary" or "extraSections" near the relevant discussion. This applies even when process/architecture diagrams are otherwise omitted — data visualization is always valuable when the numbers warrant it.`);
  }
  guidelines.push(`- ${d.lengthRule} Each field should add unique value — do not restate the same points across fields.`);
  if (!isGitHub) {
    guidelines.push(`- IMPORTANT: The content may contain mature, explicit, or sensitive topics (medical, psychological, sexual health, etc.). You MUST still summarize it fully and accurately — never refuse to summarize. Keep the summary professional and clinical in tone — do not reproduce explicit language or graphic details. Focus on the key ideas, arguments, and conclusions.`);
  }
  guidelines.push(
    `- IMPORTANT: If the provided text contains no meaningful content — e.g. it is a UI dump, login page, error page, navigation menu, cookie consent, paywall, or app interface markup rather than an actual article or document — respond with ONLY this JSON instead: {"noContent": true, "reason": "Brief explanation of why there is no content to summarize"}. Do NOT attempt to summarize interface elements or boilerplate.`,
    `- IMPORTANT: If the user's additional instructions explicitly ask you NOT to summarize, or say they only want to ask questions / chat about the content, RESPECT their request. Respond with ONLY this JSON: {"noSummary": true, "message": "Your conversational response here"}. Do NOT produce a summary in this case. EXCEPTION: if the user also asks you to request a skill (e.g. "request mermaid:flowchart skill"), respond with {"skillsNeeded": [...]} instead — skill requests always take priority over noSummary.`,
  );

  const role = isGitHub ? 'an expert software engineer and content summarizer' : 'an expert content summarizer';

  return `You are ${role}. Today's date is ${today}. ${langInstruction}

Content: ~${wordCount.toLocaleString()} words → classified as "${size}" (thresholds: short <500, medium 500-3000, long 3000+). The ranges below are tuned for this size tier. If the content is near a threshold boundary, blend smoothly — do not produce drastically different output for 490 vs 510 words.

You MUST respond with valid JSON matching this exact structure (no markdown code fences, just raw JSON):
{
${schemaFields}
}

Guidelines:
${guidelines.join('\n')}`
  + (imageAnalysisEnabled ? `

Image Analysis Instructions:
- You have been provided with images from the page. Analyze them as part of the content.
- IMAGE EMBEDDING RULE: ${d.images}
- For each image, decide the best approach: embed as \`![description](url)\` in the summary (subject to the limit above), describe it in text, or discard if not informative.
- If you see image URLs listed in the text that you believe are critical to understanding the content but were NOT attached, you may return \`"requestedImages": ["url1", "url2"]\` (max 3 URLs) alongside the normal JSON response. The system will fetch them and re-run. Only request images that are clearly referenced in the text and essential for understanding.
- Do NOT request images if the attached images already cover the key visuals.` : '');
}

export function getSummarizationPrompt(content: ExtractedContent, detailLevel: 'brief' | 'standard' | 'detailed' = 'standard'): string {
  const isDiscussion = content.type === 'reddit' || content.type === 'twitter';
  const contentLabel = content.type === 'youtube' ? 'YouTube video'
    : content.type === 'reddit' ? 'Reddit discussion'
    : content.type === 'twitter' ? 'X thread'
    : content.type === 'github' ? getGitHubContentLabel(content)
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
    prompt += `\n---\n\n**User Comments:**\n\n`;
    for (const comment of content.comments.slice(0, 20)) {
      const author = comment.author ? `**${comment.author}**` : 'Anonymous';
      const likes = comment.likes ? ` (${comment.likes} likes)` : '';
      prompt += `- ${author}${likes}: ${comment.text}\n`;
    }
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
