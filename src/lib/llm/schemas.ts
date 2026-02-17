import type { JsonSchema } from './types';

/** Unified response schema for both summarization and chat refinement. */
export const RESPONSE_SCHEMA: JsonSchema = {
  name: 'response',
  schema: {
    type: 'object',
    required: [],
    properties: {
      text: {
        type: 'string',
        description: 'Conversational message. Empty string when only providing summary.',
      },
      summary: {
        type: 'object',
        description: 'Full summary (initial or rewrite). Null when only chatting.',
        required: ['tldr', 'keyTakeaways', 'summary', 'conclusion', 'relatedTopics', 'tags', 'sourceLanguage', 'summaryLanguage'],
        properties: {
          tldr: { type: 'string' },
          keyTakeaways: { type: 'array', items: { type: 'string' } },
          summary: { type: 'string' },
          conclusion: { type: 'string' },
          relatedTopics: { type: 'array', items: { type: 'string' } },
          tags: { type: 'array', items: { type: 'string' } },
          sourceLanguage: { type: 'string' },
          summaryLanguage: { type: 'string' },
          notableQuotes: { type: 'array', items: { type: 'string' } },
          prosAndCons: {
            type: 'object',
            properties: {
              pros: { type: 'array', items: { type: 'string' } },
              cons: { type: 'array', items: { type: 'string' } },
            },
            additionalProperties: false,
          },
          factCheck: { type: 'string' },
          commentsHighlights: { type: 'array', items: { type: 'string' } },
          extraSections: { type: 'object', description: 'Keys = plain-text titles, values = markdown content' },
          translatedTitle: { type: 'string' },
          inferredTitle: { type: 'string' },
          inferredAuthor: { type: 'string' },
          inferredPublishDate: { type: 'string' },
        },
        additionalProperties: false,
      },
      noContent: {
        type: 'boolean',
        description: 'true when page has no meaningful content',
      },
      updates: {
        type: 'object',
        description: 'Partial update: only changed fields. "__DELETE__" removes a field. extraSections deep-merged by key.',
      },
      requestedImages: {
        type: 'array',
        items: { type: 'string' },
        description: 'URLs of images the model needs fetched for analysis',
      },
    },
    additionalProperties: false,
  },
};

/** Provider IDs that support native JSON schema enforcement. */
export const SCHEMA_ENFORCED_PROVIDERS = new Set(['anthropic', 'openai', 'google']);
