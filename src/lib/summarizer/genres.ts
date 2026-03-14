/**
 * Genre taxonomy and template registry for genre-specific summarization.
 *
 * Two orthogonal dimensions:
 * - Source type (extractor): platform-specific formatting (timestamps, links)
 * - Genre (classifier): what sections to include, emphasis, role expertise
 */

export type Genre =
  | 'narrative-fiction'
  | 'comedy'
  | 'documentary'
  | 'news'
  | 'opinion'
  | 'academic'
  | 'tutorial'
  | 'review'
  | 'conversation'
  | 'business'
  | 'discussion'
  | 'music'
  | 'legal'
  | 'lifestyle'
  | 'software'
  | 'generic';

export type DetailLevel = 'brief' | 'standard' | 'detailed';
export type SizeCategory = 'short' | 'medium' | 'long';

export interface FieldGuidelines {
  tldr: string;
  takeaways: string;
  takeawayFormat: string;
  summary: string;
  conclusion: string;
  quotes: string | null;
  prosCons: string | null;
  factCheck: 'standard' | 'detailed' | null;
  comments: string | null;
  extraSections: string | null;
  relatedTopics: string;
  tags: string;
}

/** Source-agnostic content hints passed to genre templates. */
export interface ContentHints {
  /** Content has video transcript / dialogue (duration present or transcript extracted). */
  isVideo: boolean;
}

export interface GenreTemplate {
  id: Genre;
  label: string;
  role: string;
  skipFactCheck?: boolean;
  skipQuotes?: boolean;
  /** Suppress mermaid process/architecture diagrams (genres where they're irrelevant). */
  skipMermaid?: boolean;
  /** Enable data chart visualization (for data-heavy genres). When unset, falls back to content-type check. */
  enableDataCharts?: boolean;
  getOverrides(detailLevel: DetailLevel, size: SizeCategory, hints?: ContentHints): Partial<FieldGuidelines>;
  additionalGuidelines?: (detailLevel: DetailLevel) => string[];
}

// ─── Genre Templates ──────────────────────────────────────────────────

const narrativeFiction: GenreTemplate = {
  id: 'narrative-fiction',
  label: 'Narrative Fiction',
  role: 'an expert film/TV critic, literature analyst, and content summarizer with deep knowledge of cinema, television, actors, directors, and entertainment industry',
  skipFactCheck: true,
  skipMermaid: true,
  getOverrides(detail) {
    if (detail === 'brief') return {
      tldr: 'Spoiler-free overview: genre, tone, premise. 2-3 sentences. Include year, creator, and lead cast/characters inline. Do NOT reveal plot twists or endings.',
      takeaways: '3-5 items. Each: "**Label** — value". This is structured METADATA about the work, NOT plot points or themes. Include: year/period, creator(s) (director/author/showrunner/playwright), genre/medium, content rating if known, key themes/tone. Use your general knowledge to fill in details not in the source. Do NOT include review scores (IMDb/RT) — they will be fetched via web search.',
      summary: 'Brief spoiler-free synopsis only — what the story is about without revealing key plot points. 2-3 sentences.',
      quotes: null,
      prosCons: null,
      conclusion: '1-2 sentences — overall impression, who would enjoy this.',
      extraSections: null,
      relatedTopics: 'Similar works — 2-3 recommendations with brief reason why they\'re similar.',
      tags: '3-5 short, lowercase tags. Include genre, mood, and content warnings.',
    };
    if (detail === 'standard') return {
      tldr: 'Spoiler-free overview: genre, tone, premise, year, creator(s), lead cast/characters. 2-3 sentences. Do NOT reveal plot twists or endings.',
      takeaways: '5-7 items. Each: "**Label** — value". This is structured METADATA about the work, NOT plot points or themes. Include: year/seasons, creator(s) (director/author/showrunner/playwright), main cast (actor as Character) or main characters, genre/subgenre, medium (film/series/novel/play), content rating (TV-MA/PG-13/R etc.) if known, key themes. Do NOT include review scores (IMDb/RT) — they will be fetched via web search. Use your general knowledge to fill in details not in the source.',
      summary: 'FULL PLOT SUMMARY with spoilers. Include all major plot points, twists, and resolution. Structure with ### subheadings for acts/major sequences. This section WILL be hidden behind a spoiler warning in the UI.',
      quotes: '3-5 memorable lines of dialogue or prose. When the summary language differs from the source language, append a translation in parentheses.',
      prosCons: null,
      conclusion: '2-3 sentences — critical assessment, thematic significance, who would enjoy this.',
      extraSections: `Include these sections IN THIS ORDER:
  - "[SPOILER] Condensed Script" — If the source contains dialogue, transcript, or play/screenplay text, rewrite it as a condensed play script: character names in **bold**, stage directions in *italics*, key dialogue preserved. Omit repetitive/filler content but preserve the dramatic flow. IMPORTANT: The condensed script MUST fit within the response alongside all other sections. For short content (under 5000 words), target ~40% of original. For long content (over 5000 words), produce a highlights version covering all major scenes in ~2000-3000 words max — do NOT attempt to condense the entire text at this detail level. If you had to omit significant scenes, add "(more)" at the end. If your version covers the full story arc, do NOT add "(more)". If the source is an article/review ABOUT the work rather than the work itself, skip this section.
  - "Cast & Characters" — List main characters as "**Performer/Author** as **Character** — brief role description". For film/TV, use actor names. For literature, list characters directly. Use your knowledge to enrich.
  - "Themes" — Major themes explored, with brief analysis.
  - "Similar Titles" — 4-5 similar works with brief explanations of why they're similar.`,
      relatedTopics: 'Similar works — 3-5 recommendations with brief reason why they\'re similar.',
      tags: '3-7 short, lowercase tags. Include genre, mood, and content warnings.',
    };
    // detailed
    return {
      tldr: 'Spoiler-free overview: genre, tone, premise, year, creator(s), lead cast/characters, awards/acclaim. 3-4 sentences. Do NOT reveal plot twists.',
      takeaways: '7-10 items. Each: "**Label** — value". This is structured METADATA about the work, NOT plot points or themes. Include: year/seasons, creator(s) (director/author/showrunner/playwright/writer), full main cast (actor as Character) or main characters, genre/subgenre, medium, content rating if known, awards/nominations, production/publication notes, key themes. Do NOT include review scores (IMDb/RT) — they will be fetched via web search. Use your general knowledge to fill in details not in the source.',
      summary: 'COMPREHENSIVE PLOT SUMMARY with full spoilers. Cover every significant scene, character arc, twist, and the resolution. Use ### subheadings for acts/major sequences. Include emotional beats and character motivations. This section WILL be hidden behind a spoiler warning.',
      quotes: '5-10 memorable or significant lines of dialogue or prose. When the summary language differs from the source language, append a translation in parentheses.',
      prosCons: 'Use as "Strengths & Weaknesses" — assess writing, acting/craft, direction/structure, pacing.',
      conclusion: '3-5 sentences — critical assessment, thematic depth, cultural significance, comparison to similar works.',
      extraSections: `Include these sections IN THIS ORDER:
  - "[SPOILER] Condensed Script" — If the source contains dialogue, transcript, or play/screenplay text, rewrite the FULL text as a condensed play script. Format: character names in **bold**, stage directions and scene descriptions in *italics*, key dialogue preserved verbatim where impactful. Compress mundane exchanges but keep ALL dramatically significant scenes. Target ~60% of original length. This should read as an enjoyable, aesthetically pleasant dramatic text. If the source is an article/review ABOUT the work rather than the work itself, skip this section.
  - "Cast & Characters" — Detailed list: "**Performer/Author** as **Character** — character description, arc, relationships". For film/TV, use actor names; for literature, list characters directly. Use your knowledge to enrich.
  - "Themes & Analysis" — In-depth thematic analysis: major themes, symbolism, cultural references, narrative techniques.
  - "Series/Work Context" — For TV: season arc, connections to other episodes, cliffhangers, character development across the season. For film: place in director's filmography, franchise context. For literature: place in author's body of work, literary movement, publication history.
  - "Reception" — Critical and audience reception, awards, notable reviews. Use your knowledge; note if information may be outdated.
  - "Similar Titles" — 5-7 recommendations with explanations.`,
      relatedTopics: 'Similar works — 5-6 recommendations with brief reason why they\'re similar.',
      tags: '5-10 short, lowercase tags. Include genre, mood, and content warnings.',
    };
  },
};

const comedy: GenreTemplate = {
  id: 'comedy',
  label: 'Comedy & Standup',
  role: 'an expert comedy critic, entertainment analyst, and content summarizer',
  skipFactCheck: true,
  skipMermaid: true,
  getOverrides(detail, _size) {
    if (detail === 'brief') return {
      tldr: 'Comedian, style, vibe. 1-2 sentences.',
      takeaways: '3-4 items: comedian, comedic style, main themes.',
      summary: 'Quick overview of material and comedic approach. 2-3 sentences.',
      quotes: null,
      prosCons: null,
      conclusion: '1-2 sentences — overall quality, who would enjoy this.',
      extraSections: null,
      tags: '3-5 short, lowercase tags. Include comedy style, mood.',
    };
    if (detail === 'standard') return {
      tldr: 'Comedian, style, themes, standout quality. 2-3 sentences.',
      takeaways: '5-7 items: comedian, style, themes, crowd work, callbacks, controversial bits.',
      summary: 'Bit-by-bit breakdown with thematic grouping. Use ### subheadings for major segments.',
      quotes: '3-5 best jokes/punchlines with setup context.',
      prosCons: null,
      conclusion: '2-3 sentences — comedic quality, writing strength, audience fit.',
      extraSections: `Include these sections:
  - "Notable Bits" — 3-5 standout comedy bits with brief description of each.
  - "Comedic Style" — Analysis of comedian's technique, delivery, and approach.
  - "Themes & Topics" — Major themes explored in the material.
  - "Similar Specials" — 3-4 similar comedy specials/comedians with reasons.`,
      tags: '3-7 short, lowercase tags. Include comedy style, mood, content warnings.',
    };
    return {
      tldr: 'Comedian, style, themes, career context. 3-4 sentences.',
      takeaways: '7-10 items: comedian, style, writing quality, structure, crowd work, callbacks, controversial bits, career context.',
      summary: 'Comprehensive comedic technique analysis. Full bit-by-bit breakdown with thematic and structural analysis. Use ### subheadings.',
      quotes: '5-10 best jokes/punchlines with full context and setup.',
      prosCons: 'Use as "Strengths & Weaknesses" — assess material quality, delivery, pacing, audience connection.',
      conclusion: '3-5 sentences — comprehensive assessment, place in comedian\'s body of work.',
      extraSections: `Include these sections:
  - "Notable Bits" — All major comedy bits with detailed description and analysis.
  - "Comedic Style Analysis" — Detailed breakdown of technique, delivery, timing, and approach.
  - "Themes & Topics" — In-depth analysis of themes explored.
  - "Writing & Structure" — Analysis of set structure, callbacks, and writing quality.
  - "Similar Specials" — 5-7 recommendations with explanations.`,
      tags: '5-10 short, lowercase tags. Include comedy style, mood, content warnings.',
    };
  },
};

const documentary: GenreTemplate = {
  id: 'documentary',
  label: 'Documentary',
  role: 'an expert documentary analyst, investigative journalist, and content summarizer',
  enableDataCharts: true,
  getOverrides(detail, _size) {
    if (detail === 'brief') return {
      tldr: 'Subject, thesis, filmmaker. 1-2 sentences.',
      takeaways: '3-4 items: subject, central argument, main conclusion.',
      summary: 'Quick thesis + conclusion overview. 3-5 sentences.',
      quotes: null,
      prosCons: null,
      conclusion: '1-2 sentences — significance, impact.',
      extraSections: null,
    };
    if (detail === 'standard') return {
      tldr: 'Subject, thesis, key findings, impact. 2-3 sentences.',
      takeaways: '5-7 items: subject, argument, evidence, interviewees, counterpoints.',
      summary: 'Structured argument flow with evidence. Use ### subheadings for major thesis points.',
      quotes: '3-5 key claims and testimonials with attribution.',
      prosCons: 'Use as "Strengths & Limitations" — assess evidence quality, balance, and methodology.',
      factCheck: 'standard',
      conclusion: '2-3 sentences — thesis validity, implications.',
      extraSections: `Include these sections:
  - "Thesis & Argument" — Core thesis and how it's supported.
  - "Key Subjects" — Main interviewees/subjects and their roles.
  - "Missing Perspectives" — Voices or viewpoints not represented.`,
    };
    return {
      tldr: 'Subject, thesis, methodology, key findings, reception. 3-4 sentences.',
      takeaways: '7-10 items: subject, argument, evidence, methodology, interviewees, counterpoints, gaps, implications.',
      summary: 'Comprehensive evidence chains and argument structure. Use ### subheadings.',
      quotes: '5-10 key claims and testimonials with attribution.',
      prosCons: 'Detailed methodology critique — evidence quality, balance, completeness.',
      factCheck: 'detailed',
      conclusion: '3-5 sentences — thesis assessment, broader implications.',
      extraSections: `Include these sections:
  - "Thesis & Argument" — Core thesis and complete argument structure.
  - "Key Subjects" — All main interviewees/subjects with detailed contributions.
  - "Evidence Analysis" — Assessment of evidence quality and sourcing.
  - "Missing Perspectives" — Comprehensive analysis of absent viewpoints.
  - "Impact & Reception" — Cultural impact and critical reception.`,
    };
  },
};

const news: GenreTemplate = {
  id: 'news',
  label: 'News & Journalism',
  role: 'an expert media analyst, fact-checker, and content summarizer',
  enableDataCharts: true,
  getOverrides(detail, _size) {
    if (detail === 'brief') return {
      tldr: 'What happened, who is involved, when. 1-2 sentences.',
      takeaways: '3-4 items: event, parties involved, outcome.',
      summary: '5W1H paragraph — who, what, when, where, why, how. 3-5 sentences.',
      quotes: null,
      prosCons: null,
      factCheck: 'standard',
      conclusion: '1-2 sentences — significance.',
      extraSections: null,
    };
    if (detail === 'standard') return {
      tldr: 'What happened, why it matters, immediate impact. 2-3 sentences.',
      takeaways: '5-7 items: event, parties, implications, reactions, timeline.',
      summary: 'Structured with ### subheadings: Timeline, Reaction, Impact.',
      quotes: '3-5 key statements from involved parties.',
      prosCons: null,
      factCheck: 'standard',
      conclusion: '2-3 sentences — broader implications.',
      extraSections: `Include these sections:
  - "Timeline" — Chronological sequence of events.
  - "Stakeholders & Reactions" — Key parties and their responses.`,
    };
    return {
      tldr: 'What happened, why it matters, historical context. 3-4 sentences.',
      takeaways: '7-10 items: event, parties, implications, reactions, timeline, precedent, related events.',
      summary: 'Comprehensive with background and context. Use ### subheadings.',
      quotes: '5-10 key statements with attribution.',
      prosCons: null,
      factCheck: 'detailed',
      conclusion: '3-5 sentences — historical significance, what to watch for next.',
      extraSections: `Include these sections:
  - "Timeline" — Detailed chronological sequence.
  - "Stakeholders & Reactions" — Comprehensive party analysis.
  - "Background & Context" — Historical context and precedent.
  - "Source Analysis" — Assessment of reporting quality and sourcing.`,
    };
  },
};

const opinion: GenreTemplate = {
  id: 'opinion',
  label: 'Opinion & Editorial',
  role: 'an expert rhetorical analyst and content summarizer',
  getOverrides(detail, _size) {
    if (detail === 'brief') return {
      tldr: 'Author\'s position, key claim. 1-2 sentences.',
      takeaways: '3-4 items: thesis, key arguments.',
      summary: 'Thesis + conclusion overview. 3-5 sentences.',
      quotes: null,
      prosCons: 'Arguments For & Against the author\'s position.',
      conclusion: '1-2 sentences.',
      extraSections: null,
    };
    if (detail === 'standard') return {
      tldr: 'Author\'s position, strongest argument. 2-3 sentences.',
      takeaways: '5-7 items: thesis, evidence, persuasion techniques.',
      summary: 'Argument structure with evidence. Use ### subheadings.',
      quotes: '3-5 strongest claims from the text.',
      prosCons: 'Detailed Arguments For & Against with evidence quality assessment.',
      factCheck: 'standard',
      conclusion: '2-3 sentences — argument strength, what\'s missing.',
      extraSections: `Include these sections:
  - "Argument Structure" — How the argument is built.
  - "Counterpoints" — Arguments the author addresses or ignores.`,
    };
    return {
      tldr: 'Author\'s position, strongest argument, rhetorical approach. 3-4 sentences.',
      takeaways: '7-10 items: thesis, evidence, persuasion techniques, counterpoints, blind spots.',
      summary: 'Full rhetorical analysis with argument mapping. Use ### subheadings.',
      quotes: '5-10 strongest claims with analytical notes.',
      prosCons: 'Comprehensive dialectic — arguments, evidence quality, logical gaps.',
      factCheck: 'detailed',
      conclusion: '3-5 sentences — comprehensive argument assessment.',
      extraSections: `Include these sections:
  - "Argument Structure" — Detailed argument mapping.
  - "Counterpoints" — Comprehensive analysis of opposing views.
  - "Rhetorical Techniques" — Persuasion methods used.`,
    };
  },
  additionalGuidelines(detail) {
    if (detail !== 'brief') return ['Actively check for logical fallacies and flag them in factCheck.'];
    return [];
  },
};

const academic: GenreTemplate = {
  id: 'academic',
  label: 'Academic & Scientific',
  role: 'an expert research analyst, domain expert, and content summarizer',
  enableDataCharts: true,
  getOverrides(detail, _size) {
    if (detail === 'brief') return {
      tldr: 'Key finding + significance. 1-2 sentences.',
      takeaways: '3-4 items: finding, method, significance.',
      summary: 'Finding + why it matters. 3-5 sentences.',
      quotes: null,
      prosCons: null,
      conclusion: '1-2 sentences — practical implications.',
      extraSections: null,
    };
    if (detail === 'standard') return {
      tldr: 'Finding, methodology, sample. 2-3 sentences.',
      takeaways: '5-7 items: finding, method, sample, limitations, applications.',
      summary: 'Background → method → results → discussion. Use ### subheadings.',
      quotes: '2-3 key claims with methodology notes.',
      prosCons: 'Use as "Strengths & Limitations" of the research.',
      factCheck: 'standard',
      conclusion: '2-3 sentences — validity and implications.',
      extraSections: `Include these sections:
  - "Methodology" — Research design and approach.
  - "Key Findings" — Main results with data.
  - "Limitations" — Acknowledged and unacknowledged limitations.`,
    };
    return {
      tldr: 'Finding, methodology, sample, limitations. 3-4 sentences.',
      takeaways: '7-10 items: finding, method, sample, limitations, applications, related work, methodology details.',
      summary: 'Comprehensive with technical depth. Use ### subheadings.',
      quotes: '3-5 key claims with methodology notes.',
      prosCons: 'Detailed methodology critique.',
      factCheck: 'detailed',
      conclusion: '3-5 sentences — validity, replication prospects, implications.',
      extraSections: `Include these sections:
  - "Methodology" — Detailed research design and approach.
  - "Key Findings" — Comprehensive results with data.
  - "Limitations" — Detailed assessment of limitations and potential biases.
  - "Practical Implications" — Real-world applications.
  - "Related Research" — Context within the field.`,
    };
  },
  additionalGuidelines(detail) {
    if (detail !== 'brief') return [
      'Check for conflicts of interest, funding sources, and replication status in factCheck.',
      'MERMAID DIAGRAMS: Academic content benefits from methodology flowcharts, experimental design diagrams, or causal relationship maps. Include when the research has a multi-step methodology or complex causal model.',
      'CRITICAL — MATH & FORMULAS: This is academic/scientific content. You MUST reproduce ALL mathematical expressions, equations, and formulas using LaTeX: `$...$` for inline (e.g. $E = mc^2$) and `$$...$$` for display equations. Never use plain text or Unicode for math — always LaTeX. Include the key equations from the paper in the summary and Key Findings sections.',
    ];
    return [];
  },
};

const tutorial: GenreTemplate = {
  id: 'tutorial',
  label: 'Tutorial & How-To',
  role: 'an expert technical educator and content summarizer',
  skipFactCheck: true,
  enableDataCharts: true,
  getOverrides(detail, _size) {
    if (detail === 'brief') return {
      tldr: 'What you\'ll learn/build. 1-2 sentences.',
      takeaways: '3-4 items: goal, key steps, tools needed.',
      summary: 'Goal + approach overview. 3-5 sentences.',
      quotes: null,
      prosCons: null,
      conclusion: '1-2 sentences — what you\'ll be able to do after.',
      extraSections: null,
    };
    if (detail === 'standard') return {
      tldr: 'What you\'ll learn, prerequisites, difficulty. 2-3 sentences.',
      takeaways: '5-7 items: goal, key steps, tools, tips, common mistakes.',
      summary: 'Step-by-step with ### subheadings per phase.',
      quotes: null,
      prosCons: 'Approach pros/cons — when to use this method vs alternatives.',
      conclusion: '2-3 sentences — next steps, further learning.',
      extraSections: `Include these sections:
  - "Prerequisites" — What you need before starting.
  - "Step-by-Step" — Key steps in order.
  - "Common Pitfalls" — Mistakes to avoid.`,
    };
    return {
      tldr: 'What you\'ll learn, prerequisites, difficulty, time estimate. 3-4 sentences.',
      takeaways: '7-10 items: goal, key steps, tools, tips, common mistakes, alternatives, edge cases.',
      summary: 'Detailed step-by-step with explanations. Use ### subheadings.',
      quotes: 'Key tips/warnings verbatim.',
      prosCons: 'Approach pros/cons + alternative approaches compared.',
      conclusion: '3-5 sentences — next steps, resources, further learning.',
      extraSections: `Include these sections:
  - "Prerequisites" — Detailed requirements.
  - "Step-by-Step" — Complete steps with explanations.
  - "Common Pitfalls" — Detailed mistakes to avoid.
  - "Resources" — Additional learning materials.
  - "Troubleshooting" — Solutions for common issues.`,
    };
  },
  additionalGuidelines(detail) {
    if (detail !== 'brief') return ['MERMAID DIAGRAMS: Tutorials benefit strongly from visual aids. Include a flowchart or sequence diagram for multi-step processes, decision trees for branching logic, or state diagrams for setup/configuration flows. Include when the tutorial has 3+ sequential steps or branching decisions.'];
    return [];
  },
};

const review: GenreTemplate = {
  id: 'review',
  label: 'Review & Critique',
  role: 'an expert product/media critic and content summarizer',
  enableDataCharts: true,
  getOverrides(detail, _size) {
    if (detail === 'brief') return {
      tldr: 'Verdict in one line. 1-2 sentences.',
      takeaways: '3-4 items: verdict, best aspect, worst aspect.',
      summary: 'Quick verdict paragraph. 3-5 sentences.',
      quotes: null,
      prosCons: 'Include — the core of any review.',
      conclusion: '1-2 sentences — buy/skip recommendation.',
      extraSections: null,
    };
    if (detail === 'standard') return {
      tldr: 'Verdict, best for / avoid if. 2-3 sentences.',
      takeaways: '5-7 items: verdict, best, worst, scores, value proposition.',
      summary: 'Structured by category. Use ### subheadings for aspects reviewed.',
      quotes: '2-3 key judgments from the reviewer.',
      prosCons: 'Detailed with specific examples.',
      factCheck: 'standard',
      conclusion: '2-3 sentences — verdict with context.',
      extraSections: `Include these sections:
  - "Verdict" — Final assessment and score/rating.
  - "Comparison" — 2-3 alternatives and how they compare.`,
    };
    return {
      tldr: 'Verdict, best for / avoid if, comparison context. 3-4 sentences.',
      takeaways: '7-10 items: verdict, best, worst, scores, value, edge cases, alternatives.',
      summary: 'Comprehensive analysis by category. Use ### subheadings.',
      quotes: '5-8 specific observations from the reviewer.',
      prosCons: 'Comprehensive, weighted by importance.',
      factCheck: 'detailed',
      conclusion: '3-5 sentences — nuanced verdict.',
      extraSections: `Include these sections:
  - "Verdict" — Detailed final assessment.
  - "Comparison" — Comprehensive alternatives comparison.
  - "Value Assessment" — Price/performance analysis.`,
    };
  },
  additionalGuidelines(detail) {
    if (detail !== 'brief') return ['In factCheck, flag any sponsored content disclosure or spec accuracy issues.'];
    return [];
  },
};

const conversation: GenreTemplate = {
  id: 'conversation',
  label: 'Conversation & Interview',
  role: 'an expert journalist, discussion analyst, and content summarizer',
  getOverrides(detail, _size) {
    if (detail === 'brief') return {
      tldr: 'Participants, main topic. 1-2 sentences.',
      takeaways: '3-4 items: topics covered, key insight.',
      summary: 'Topic overview. 3-5 sentences.',
      quotes: null,
      prosCons: null,
      conclusion: '1-2 sentences.',
      extraSections: null,
    };
    if (detail === 'standard') return {
      tldr: 'Participants, main topic, key revelation. 2-3 sentences.',
      takeaways: '5-7 items: topics, perspectives, disagreements.',
      summary: 'Topic-by-topic breakdown with ### subheadings.',
      quotes: '3-5 key exchanges with speaker attribution.',
      prosCons: null,
      conclusion: '2-3 sentences.',
      extraSections: `Include these sections:
  - "Key Topics" — Major topics discussed.
  - "Participant Perspectives" — Each participant's main positions.
  - "Notable Revelations" — Surprising or newsworthy statements.`,
    };
    return {
      tldr: 'Participants, main topic, key revelation, conversation context. 3-4 sentences.',
      takeaways: '7-10 items: topics, perspectives, disagreements, implications.',
      summary: 'Detailed argument flow with all perspectives. Use ### subheadings.',
      quotes: '5-10 key exchanges with full context.',
      prosCons: null,
      conclusion: '3-5 sentences.',
      extraSections: `Include these sections:
  - "Key Topics" — Comprehensive topic breakdown.
  - "Participant Perspectives" — Detailed position analysis.
  - "Notable Revelations" — All significant statements.
  - "Unresolved Questions" — Topics left open or unaddressed.`,
    };
  },
};

const business: GenreTemplate = {
  id: 'business',
  label: 'Business & Finance',
  role: 'an expert financial analyst and content summarizer',
  enableDataCharts: true,
  getOverrides(detail, _size) {
    if (detail === 'brief') return {
      tldr: 'Company/market headline, key metric. 1-2 sentences.',
      takeaways: '3-4 items: headline, key metric, outlook.',
      summary: 'Quick overview. 3-5 sentences.',
      quotes: null,
      prosCons: null,
      factCheck: 'standard',
      conclusion: '1-2 sentences — outlook.',
      extraSections: null,
    };
    if (detail === 'standard') return {
      tldr: 'Company/market headline, key metric, trend. 2-3 sentences.',
      takeaways: '5-7 items: headline, metrics, risks, competitive position.',
      summary: 'Performance → strategy → outlook. Use ### subheadings.',
      quotes: '2-3 key management statements.',
      prosCons: 'Use as "Bullish & Bearish" factors.',
      factCheck: 'standard',
      conclusion: '2-3 sentences — forward outlook.',
      extraSections: `Include these sections:
  - "Key Metrics" — Important financial data points.
  - "Competitive Position" — Market standing.
  - "Risks" — Identified risk factors.`,
    };
    return {
      tldr: 'Company/market headline, key metric, trend, competitive context. 3-4 sentences.',
      takeaways: '7-10 items: headline, metrics, risks, position, sector, regulatory.',
      summary: 'Comprehensive financial detail. Use ### subheadings.',
      quotes: '5-8 key statements from management and analysts.',
      prosCons: 'Detailed "Bullish & Bearish" with probability assessment.',
      factCheck: 'detailed',
      conclusion: '3-5 sentences — detailed forward outlook.',
      extraSections: `Include these sections:
  - "Key Metrics" — Comprehensive financial data.
  - "Competitive Position" — Detailed market analysis.
  - "Risks" — Comprehensive risk assessment.
  - "Outlook & Guidance" — Forward-looking projections.`,
    };
  },
  additionalGuidelines(detail) {
    if (detail !== 'brief') return [
      'Verify financial claims and metrics in factCheck. Flag conflicts of interest.',
      'MERMAID DIAGRAMS: Business content benefits from org/market structure diagrams, revenue flow charts, or competitive landscape maps. Include when the content describes market dynamics, organizational changes, or multi-step business processes.',
    ];
    return [];
  },
};

const discussion: GenreTemplate = {
  id: 'discussion',
  label: 'Discussion & Forum',
  role: 'an expert community analyst and content summarizer',
  getOverrides(detail, _size) {
    if (detail === 'brief') return {
      tldr: 'Topic, community stance. 1-2 sentences.',
      takeaways: '3-4 items: main points, sentiment.',
      summary: 'Consensus/disagreement overview. 3-5 sentences.',
      quotes: '3-4 most impactful comments.',
      prosCons: null,
      conclusion: '1-2 sentences.',
      extraSections: null,
    };
    if (detail === 'standard') return {
      tldr: 'Topic, consensus/split, engagement level. 2-3 sentences.',
      takeaways: '5-7 items: main points, arguments per side.',
      summary: 'Theme-by-theme with ### subheadings.',
      quotes: '5-7 most impactful comments.',
      prosCons: 'Arguments For & Against (if the discussion is a debate).',
      comments: 'Include notable exchanges and discussion threads.',
      conclusion: '2-3 sentences.',
      extraSections: `Include these sections:
  - "Community Sentiment" — Overall mood and engagement.
  - "Key Arguments" — Main positions with supporting points.`,
    };
    return {
      tldr: 'Topic, consensus/split, engagement, context. 3-4 sentences.',
      takeaways: '7-10 items: main points, all sides, minority views.',
      summary: 'Comprehensive all voices represented. Use ### subheadings.',
      quotes: '8-12 diverse perspectives.',
      prosCons: 'Detailed position mapping of all sides.',
      comments: 'Comprehensive coverage of notable exchanges.',
      conclusion: '3-5 sentences.',
      extraSections: `Include these sections:
  - "Community Sentiment" — Detailed mood and engagement analysis.
  - "Key Arguments" — Comprehensive position analysis.
  - "Notable Contributors" — Key voices in the discussion.
  - "Consensus Map" — Where agreement and disagreement lies.`,
    };
  },
};

const music: GenreTemplate = {
  id: 'music',
  label: 'Music & Performance',
  role: 'an expert music critic and content summarizer',
  skipFactCheck: true,
  skipMermaid: true,
  getOverrides(detail, _size) {
    if (detail === 'brief') return {
      tldr: 'Artist, track, genre, vibe. 1-2 sentences.',
      takeaways: '3-4 items: artist, genre, mood.',
      summary: 'What it sounds like. 2-3 sentences.',
      quotes: null,
      prosCons: null,
      conclusion: '1-2 sentences.',
      extraSections: null,
    };
    if (detail === 'standard') return {
      tldr: 'Artist, track, genre, production quality, standout element. 2-3 sentences.',
      takeaways: '5-7 items: artist, genre, production, lyrics, influences.',
      summary: 'Section-by-section breakdown. Use ### subheadings.',
      quotes: '2-3 lyric excerpts.',
      prosCons: null,
      conclusion: '2-3 sentences.',
      extraSections: `Include these sections:
  - "Musical Style" — Genre, influences, and sound.
  - "Lyrics & Themes" — Lyrical content analysis.
  - "Similar Artists" — 3-4 comparable artists.`,
    };
    return {
      tldr: 'Artist, track, genre, production, context in discography. 3-4 sentences.',
      takeaways: '7-10 items: artist, genre, production, lyrics, influences, technique, cultural context.',
      summary: 'Comprehensive musicological analysis. Use ### subheadings.',
      quotes: '5-8 key lyrics with analysis.',
      prosCons: 'Use as "Strengths & Weaknesses" of the work.',
      conclusion: '3-5 sentences.',
      extraSections: `Include these sections:
  - "Musical Style" — Detailed genre and sound analysis.
  - "Lyrics & Themes" — Comprehensive lyrical analysis.
  - "Production Analysis" — Technical production assessment.
  - "Cultural Impact" — Broader cultural context.
  - "Similar Artists" — 5-7 comparable artists with reasons.`,
    };
  },
};

const legal: GenreTemplate = {
  id: 'legal',
  label: 'Legal & Policy',
  role: 'an expert legal analyst and content summarizer',
  enableDataCharts: true,
  getOverrides(detail, _size) {
    if (detail === 'brief') return {
      tldr: 'What it does, who it affects. 1-2 sentences.',
      takeaways: '3-4 items: subject, key provision, impact.',
      summary: 'Plain-language overview. 3-5 sentences.',
      quotes: null,
      prosCons: null,
      conclusion: '1-2 sentences — practical impact.',
      extraSections: null,
    };
    if (detail === 'standard') return {
      tldr: 'What it does, key provisions, effective date. 2-3 sentences.',
      takeaways: '5-7 items: subject, provisions, exceptions, enforcement.',
      summary: 'Structured by provision/section in plain language. Use ### subheadings.',
      quotes: '2-3 key clauses verbatim.',
      prosCons: 'Supporters & Critics arguments.',
      factCheck: 'standard',
      conclusion: '2-3 sentences — practical implications.',
      extraSections: `Include these sections:
  - "Key Provisions" — Main provisions explained in plain language.
  - "Affected Parties" — Who is impacted and how.
  - "Timeline" — Implementation dates and milestones.`,
    };
    return {
      tldr: 'What it does, key provisions, effective date, precedent. 3-4 sentences.',
      takeaways: '7-10 items: subject, provisions, exceptions, enforcement, precedent, related law.',
      summary: 'Comprehensive with legal context. Use ### subheadings.',
      quotes: '5-8 key clauses with interpretation.',
      prosCons: 'Detailed with evidence from both sides.',
      factCheck: 'detailed',
      conclusion: '3-5 sentences — long-term implications.',
      extraSections: `Include these sections:
  - "Key Provisions" — Detailed provision analysis.
  - "Affected Parties" — Comprehensive impact assessment.
  - "Timeline" — Full implementation schedule.
  - "Precedent" — Related legal history.
  - "Enforcement" — How it will be enforced.
  - "Comparison" — How it differs from prior/similar legislation.`,
    };
  },
};

const lifestyle: GenreTemplate = {
  id: 'lifestyle',
  label: 'Lifestyle & Personal',
  role: 'an expert lifestyle journalist and content summarizer',
  skipFactCheck: true,
  skipMermaid: true,
  getOverrides(detail, _size) {
    if (detail === 'brief') return {
      tldr: 'What it\'s about, actionable takeaway. 1-2 sentences.',
      takeaways: '3-4 items: main advice, key points.',
      summary: 'Quick overview. 3-5 sentences.',
      quotes: null,
      prosCons: null,
      conclusion: '1-2 sentences.',
      extraSections: null,
    };
    if (detail === 'standard') return {
      tldr: 'What it\'s about, who it\'s for. 2-3 sentences.',
      takeaways: '5-7 items: practical tips, caveats.',
      summary: 'Structured practical guide. Use ### subheadings.',
      quotes: '2-3 key tips verbatim.',
      prosCons: 'Include if comparing options or approaches.',
      conclusion: '2-3 sentences.',
      extraSections: `Include these sections:
  - "Practical Tips" — Actionable advice.
  - "Resources" — Recommended tools, products, or references.`,
    };
    return {
      tldr: 'What it\'s about, who it\'s for, context. 3-4 sentences.',
      takeaways: '7-10 items: tips, caveats, alternatives, nuances.',
      summary: 'Comprehensive with context. Use ### subheadings.',
      quotes: '3-5 key tips with context.',
      prosCons: 'Include if comparing options.',
      conclusion: '3-5 sentences.',
      extraSections: `Include these sections:
  - "Practical Tips" — Comprehensive actionable advice.
  - "Resources" — Detailed recommendations.
  - "Background" — Context and history.
  - "Common Mistakes" — What to avoid.`,
    };
  },
  additionalGuidelines(detail) {
    if (detail === 'detailed') return ['If the content makes health or safety claims, include factCheck.'];
    return [];
  },
};

const software: GenreTemplate = {
  id: 'software',
  label: 'Software & Code',
  role: 'an expert software engineer and content summarizer',
  skipFactCheck: true,
  skipQuotes: true,
  // Software genre uses the existing GitHub override system in prompts.ts — no field overrides here
  getOverrides() { return {}; },
};

const generic: GenreTemplate = {
  id: 'generic',
  label: 'General Content',
  role: 'an expert content summarizer',
  // No overrides — uses the base detail × size matrix from prompts.ts
  getOverrides() { return {}; },
};

export const GENRE_TEMPLATES: Record<Genre, GenreTemplate> = {
  'narrative-fiction': narrativeFiction,
  'comedy': comedy,
  'documentary': documentary,
  'news': news,
  'opinion': opinion,
  'academic': academic,
  'tutorial': tutorial,
  'review': review,
  'conversation': conversation,
  'business': business,
  'discussion': discussion,
  'music': music,
  'legal': legal,
  'lifestyle': lifestyle,
  'software': software,
  'generic': generic,
};

export const GENRE_LIST: { id: Genre; label: string; description: string }[] = [
  { id: 'narrative-fiction', label: 'Narrative Fiction', description: 'Movies, TV dramas, novels, short stories' },
  { id: 'comedy', label: 'Comedy & Standup', description: 'Comedy specials, sitcoms, humor pieces, satire' },
  { id: 'documentary', label: 'Documentary', description: 'Documentaries, investigative pieces, true crime' },
  { id: 'news', label: 'News & Journalism', description: 'Breaking news, reporting, wire stories' },
  { id: 'opinion', label: 'Opinion & Editorial', description: 'Op-eds, video essays, columns, commentary' },
  { id: 'academic', label: 'Academic & Scientific', description: 'Papers, lectures, scientific explainers' },
  { id: 'tutorial', label: 'Tutorial & How-To', description: 'Guides, courses, coding tutorials, documentation' },
  { id: 'review', label: 'Review & Critique', description: 'Product/movie/book reviews, comparisons' },
  { id: 'conversation', label: 'Conversation & Interview', description: 'Podcasts, interviews, Q&A sessions, panels' },
  { id: 'business', label: 'Business & Finance', description: 'Earnings, market analysis, corporate announcements' },
  { id: 'discussion', label: 'Discussion & Forum', description: 'Reddit threads, social debates, forum discussions' },
  { id: 'music', label: 'Music & Performance', description: 'Music videos, album reviews, live performances' },
  { id: 'legal', label: 'Legal & Policy', description: 'Legislation, court rulings, policy papers' },
  { id: 'lifestyle', label: 'Lifestyle & Personal', description: 'Vlogs, recipes, travel, personal advice' },
  { id: 'software', label: 'Software & Code', description: 'GitHub pages, code repositories' },
  { id: 'generic', label: 'General Content', description: 'General or unclassifiable content' },
];
