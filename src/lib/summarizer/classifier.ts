/**
 * Genre pre-classifier for content summarization.
 *
 * Classifies content into a genre via LLM (non-streaming, cheap ~$0.01/call)
 * or direct-maps content types that don't need classification (e.g. GitHub → software).
 */

import type { LLMProvider } from '../llm/types';
import type { ExtractedContent } from '../extractors/types';
import { GENRE_LIST, type Genre } from './genres';

export interface ClassificationResult {
  genre: Genre;
  subGenre?: string;
  confidence: number;
}

const VALID_GENRES = new Set<string>(GENRE_LIST.map(g => g.id));

/** Direct-map content types that don't need classification. Returns null if classifier needed. */
export function directMapGenre(contentType: string, githubPageType?: string): ClassificationResult | null {
  if (contentType === 'github') {
    return { genre: 'software', subGenre: githubPageType, confidence: 1.0 };
  }
  return null;
}

/** Build the classifier prompt — all in user message for maximum compatibility. */
function buildClassifierUserMessage(content: ExtractedContent, userInstructions?: string): string {
  const genreLines = GENRE_LIST
    .filter(g => g.id !== 'software' && g.id !== 'generic')
    .map(g => `${g.id}: ${g.description}`)
    .join('\n');

  // Keep excerpt small — genre is identifiable from title + first ~500 words.
  // Large excerpts can exhaust small context windows (Gemini), leaving no room for output.
  const excerpt = content.content.split(/\s+/).slice(0, 500).join(' ');
  let meta = `Title: ${content.title || '(untitled)'}\nURL: ${content.url}\nType: ${content.type}`;
  if (content.channelName) meta += `\nChannel: ${content.channelName}`;
  if (content.subreddit) meta += `\nSubreddit: r/${content.subreddit}`;

  return `Classify this content into one genre. Respond with ONLY the JSON, nothing else.

Genres:
${genreLines}
generic: Doesn't fit any above

${meta}${userInstructions ? `\nUser instructions: ${userInstructions}` : ''}

Content:
${excerpt}

Respond with ONLY: {"genre":"<id>","confidence":<0-1>}`;
}

/** Try to extract a genre ID from free text when JSON parsing fails. */
function extractGenreFromText(text: string): Genre | null {
  // Try to find a quoted genre ID
  for (const id of VALID_GENRES) {
    // Match "genre-id" or 'genre-id' or genre field in partial JSON
    if (text.includes(`"${id}"`) || text.includes(`'${id}'`)) {
      return id as Genre;
    }
  }
  // Try unquoted exact match (word boundary)
  for (const id of VALID_GENRES) {
    if (new RegExp(`\\b${id.replace(/-/g, '[-\\s]?')}\\b`, 'i').test(text)) {
      return id as Genre;
    }
  }
  return null;
}

/** Classify content genre via LLM. Returns 'generic' on failure or low confidence. */
export async function classifyGenre(
  provider: LLMProvider,
  content: ExtractedContent,
  userInstructions?: string,
  signal?: AbortSignal,
): Promise<ClassificationResult> {
  const fallback: ClassificationResult = { genre: 'generic', confidence: 0 };

  try {
    const userMsg = buildClassifierUserMessage(content, userInstructions);

    const response = await provider.sendChat(
      [
        { role: 'system', content: 'Respond with ONLY a JSON object. No explanation, no markdown, no code fences.' },
        { role: 'user', content: userMsg },
      ],
      { maxTokens: 300, jsonMode: true, signal },
    );

    const raw = response.trim();
    console.log('[xTil classifier] raw response:', raw.substring(0, 300));

    if (!raw) {
      console.warn('[xTil classifier] empty response from LLM');
      return fallback;
    }

    // Try JSON parse — with progressive fallbacks
    let genre: Genre = 'generic';
    let subGenre: string | undefined;
    let confidence = 0.5;

    // 1. Try to extract and parse JSON object
    const braceStart = raw.indexOf('{');
    const braceEnd = raw.lastIndexOf('}');
    if (braceStart >= 0 && braceEnd > braceStart) {
      try {
        const parsed = JSON.parse(raw.slice(braceStart, braceEnd + 1)) as {
          genre?: string; subGenre?: string; confidence?: number;
        };
        if (parsed.genre && VALID_GENRES.has(parsed.genre)) genre = parsed.genre as Genre;
        if (typeof parsed.subGenre === 'string') subGenre = parsed.subGenre;
        if (typeof parsed.confidence === 'number') confidence = Math.max(0, Math.min(1, parsed.confidence));
      } catch {
        // JSON in braces was malformed — fall through to text extraction
      }
    }

    // 2. Fallback: extract genre ID from free text (handles truncated/chatty responses)
    if (genre === 'generic') {
      const extracted = extractGenreFromText(raw);
      if (extracted) {
        genre = extracted;
        confidence = 0.6; // Lower confidence for text-extracted genre
        console.log('[xTil classifier] extracted genre from text:', genre);
      }
    }

    if (confidence < 0.3) return fallback;

    return { genre, subGenre, confidence };
  } catch (err) {
    // Any error → graceful fallback to generic
    console.warn('[xTil classifier] failed:', err instanceof Error ? err.message : String(err));
    return fallback;
  }
}
