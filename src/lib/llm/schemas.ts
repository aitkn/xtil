import type { JsonSchema } from './types';

/** Schema for the chat refinement response wrapper. */
export const CHAT_RESPONSE_SCHEMA: JsonSchema = {
  name: 'chat_response',
  schema: {
    type: 'object',
    required: ['text'],
    properties: {
      text: {
        type: 'string',
        description: 'Conversational response. Markdown. Empty string if only updating.',
      },
      updates: {
        type: 'object',
        description: 'Partial update: only changed summary fields. "__DELETE__" removes a field. extraSections is deep-merged by key.',
      },
      summary: {
        type: 'object',
        description: 'Full summary replacement (all fields). Use when regenerating the entire summary.',
      },
    },
    oneOf: [
      { required: ['updates'] },
      { required: ['summary'] },
      {},
    ],
    additionalProperties: false,
  },
};

/** Provider IDs that support native JSON schema enforcement. */
export const SCHEMA_ENFORCED_PROVIDERS = new Set(['anthropic', 'openai', 'google']);
