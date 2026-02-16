import type { JsonSchema } from './types';

/** Schema for the chat refinement response wrapper. */
export const CHAT_RESPONSE_SCHEMA: JsonSchema = {
  name: 'chat_response',
  schema: {
    type: 'object',
    required: ['text', 'updates'],
    properties: {
      text: {
        type: 'string',
        description: 'Conversational response. Markdown. Empty string if only updating.',
      },
      updates: {
        anyOf: [{ type: 'object' }, { type: 'null' }],
        description: 'Only changed summary fields. null = no changes. "__DELETE__" removes a field. extraSections is deep-merged by key.',
      },
    },
    additionalProperties: false,
  },
};

/** Provider IDs that support native JSON schema enforcement. */
export const SCHEMA_ENFORCED_PROVIDERS = new Set(['anthropic', 'openai', 'google']);
