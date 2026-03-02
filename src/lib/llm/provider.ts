import type { ChatMessage, ChatOptions, LLMProvider, ProviderConfig } from './types';
import { getCatalogEntry } from './models';

/** Strip Grok inline citation markup tags from response text. */
function stripCitationTags(text: string): string {
  return text.replace(/<grok:render[\s\S]*?<\/grok:render>/g, '');
}

/** Extract a clean error message from OpenAI-compatible API error JSON. */
function parseApiError(status: number, body: string): string {
  try {
    const parsed = JSON.parse(body);
    const msg = parsed?.error?.message;
    if (typeof msg === 'string') return `LLM API error (${status}): ${msg.split('\n')[0].trim()}`;
  } catch { /* not JSON */ }
  return `LLM API error (${status}): ${body.slice(0, 200)}`;
}

/**
 * Base provider for OpenAI-compatible APIs.
 * Works for: OpenAI, xAI (Grok), DeepSeek, self-hosted (Ollama, LM Studio).
 */
export class OpenAICompatibleProvider implements LLMProvider {
  readonly id: string;
  readonly name: string;
  private config: ProviderConfig;
  private endpoint: string;
  private isOpenAI: boolean;
  private isReasoning: boolean;

  constructor(config: ProviderConfig, name: string, defaultEndpoint: string) {
    this.id = config.providerId;
    this.name = name;
    this.config = config;
    this.endpoint = config.endpoint || defaultEndpoint;
    this.isOpenAI = config.providerId === 'openai';
    // Reasoning models (o-series, gpt-5+) don't support temperature
    const entry = getCatalogEntry(config.providerId, config.model);
    this.isReasoning = entry?.reasoning === true
      || (this.isOpenAI && /^(o[134]|gpt-5)/i.test(config.model));
  }

  private tokenLimitParam(maxTokens: number): Record<string, number> {
    // OpenAI's newer models (o-series, gpt-4.1, etc.) require max_completion_tokens
    return this.isOpenAI
      ? { max_completion_tokens: maxTokens }
      : { max_tokens: maxTokens };
  }

  private formatMessage(m: ChatMessage): Record<string, unknown> {
    if (m.images?.length) {
      const parts: Array<Record<string, unknown>> = [{ type: 'text', text: m.content }];
      for (const img of m.images) {
        if ('url' in img) {
          parts.push({ type: 'image_url', image_url: { url: img.url } });
        } else {
          parts.push({
            type: 'image_url',
            image_url: { url: `data:${img.mimeType};base64,${img.base64}` },
          });
        }
      }
      return { role: m.role, content: parts };
    }
    return { role: m.role, content: m.content };
  }

  /**
   * Format a message for the Responses API (OpenAI).
   * Uses `input_text` / `input_image` part types instead of Chat Completions'
   * `text` / `image_url`.
   */
  private formatResponsesMessage(m: ChatMessage): Record<string, unknown> {
    if (m.images?.length) {
      const parts: Array<Record<string, unknown>> = [{ type: 'input_text', text: m.content }];
      for (const img of m.images) {
        if ('url' in img) {
          parts.push({ type: 'input_image', image_url: img.url });
        } else {
          parts.push({
            type: 'input_image',
            image_url: `data:${img.mimeType};base64,${img.base64}`,
          });
        }
      }
      return { role: m.role, content: parts };
    }
    return { role: m.role, content: m.content };
  }

  /**
   * Responses API — used for web search on OpenAI and xAI.
   * OpenAI: web_search_preview tool; xAI: web_search tool.
   * Chat Completions API only supports 'function'/'custom' tool types.
   */
  private async sendResponsesApi(messages: ChatMessage[], options?: ChatOptions): Promise<string> {
    const url = `${this.endpoint}/v1/responses`;
    // Separate system messages into `instructions`, rest into `input`
    const instructions = messages
      .filter(m => m.role === 'system')
      .map(m => m.content)
      .join('\n\n') || undefined;
    // OpenAI Responses API uses different content part types (input_text/input_image);
    // xAI Responses API doesn't support multi-part content at all — text only.
    const input = messages
      .filter(m => m.role !== 'system')
      .map(m => this.isOpenAI ? this.formatResponsesMessage(m) : ({ role: m.role, content: m.content }));

    const searchTool = this.isOpenAI ? 'web_search_preview' : 'web_search';
    const body: Record<string, unknown> = {
      model: this.config.model,
      input,
      tools: [{ type: searchTool }],
    };
    if (instructions) body.instructions = instructions;

    const timeoutController = new AbortController();
    const timer = setTimeout(() => timeoutController.abort(), 120_000);
    const signal = options?.signal
      ? AbortSignal.any([timeoutController.signal, options.signal])
      : timeoutController.signal;

    try {
      const bodyJson = JSON.stringify(body);
      options?.onRequestBody?.(bodyJson);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: bodyJson,
        signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(parseApiError(response.status, errorText));
      }

      const data = await response.json();
      options?.onResponseBody?.(JSON.stringify(data));

      // Extract text from Responses API output
      const output: Array<Record<string, unknown>> = data.output ?? [];
      for (const item of output) {
        if (item.type === 'message') {
          const content = item.content as Array<Record<string, unknown>> | undefined;
          const textPart = content?.find((c: Record<string, unknown>) => c.type === 'output_text');
          if (textPart?.text) return stripCitationTags(textPart.text as string);
        }
      }
      return stripCitationTags(data.output_text || '');
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        if (options?.signal?.aborted) throw new Error('Summarization cancelled');
        throw new Error('LLM request timed out after 120s');
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  async sendChat(messages: ChatMessage[], options?: ChatOptions): Promise<string> {
    // OpenAI & xAI web search requires the Responses API (not Chat Completions)
    if (options?.webSearch && (this.isOpenAI || this.id === 'xai')) {
      return this.sendResponsesApi(messages, options);
    }

    const url = `${this.endpoint}/v1/chat/completions`;
    const body: Record<string, unknown> = {
      model: this.config.model,
      messages: messages.map((m) => this.formatMessage(m)),
      ...this.tokenLimitParam(options?.maxTokens ?? 4096),
      stream: false,
    };
    // Reasoning models (o-series, gpt-5+) don't support temperature
    if (!this.isReasoning) body.temperature = options?.temperature ?? 0.3;
    if (options?.jsonSchema && this.isOpenAI) {
      body.response_format = {
        type: 'json_schema',
        json_schema: { name: options.jsonSchema.name, schema: options.jsonSchema.schema, strict: false },
      };
    } else if (options?.jsonSchema || options?.jsonMode) {
      body.response_format = { type: 'json_object' };
    }
    const timeoutController = new AbortController();
    const timer = setTimeout(() => timeoutController.abort(), 90_000);
    const signal = options?.signal
      ? AbortSignal.any([timeoutController.signal, options.signal])
      : timeoutController.signal;

    try {
      const bodyJson = JSON.stringify(body);
      options?.onRequestBody?.(bodyJson);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: bodyJson,
        signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(parseApiError(response.status, errorText));
      }

      const data = await response.json();
      options?.onResponseBody?.(JSON.stringify(data));
      return data.choices[0]?.message?.content || '';
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        if (options?.signal?.aborted) throw new Error('Summarization cancelled');
        throw new Error('LLM request timed out after 90s');
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  async *streamChat(messages: ChatMessage[], options?: ChatOptions): AsyncGenerator<string> {
    // OpenAI & xAI web search requires the Responses API (non-streaming)
    if (options?.webSearch && (this.isOpenAI || this.id === 'xai')) {
      const result = await this.sendResponsesApi(messages, options);
      yield result;
      return;
    }

    const url = `${this.endpoint}/v1/chat/completions`;
    const body: Record<string, unknown> = {
      model: this.config.model,
      messages: messages.map((m) => this.formatMessage(m)),
      ...this.tokenLimitParam(options?.maxTokens ?? 4096),
      stream: true,
    };
    if (!this.isReasoning) body.temperature = options?.temperature ?? 0.3;
    if (options?.jsonSchema && this.isOpenAI) {
      body.response_format = {
        type: 'json_schema',
        json_schema: { name: options.jsonSchema.name, schema: options.jsonSchema.schema, strict: false },
      };
    } else if (options?.jsonSchema || options?.jsonMode) {
      body.response_format = { type: 'json_object' };
    }
    const bodyJson = JSON.stringify(body);
    options?.onRequestBody?.(bodyJson);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: bodyJson,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(parseApiError(response.status, errorText));
    }

    let accumulated = '';
    try {
      for await (const chunk of parseSSEStream(response)) {
        accumulated += chunk;
        yield chunk;
      }
    } finally {
      if (accumulated) {
        options?.onResponseBody?.(JSON.stringify({ choices: [{ message: { content: accumulated } }] }));
      }
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      const result = await this.sendChat(
        [{ role: 'user', content: 'Reply with "ok"' }],
        { maxTokens: 10 },
      );
      return result.length > 0;
    } catch {
      return false;
    }
  }
}

export async function* parseSSEStream(response: Response): AsyncGenerator<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6);
        if (data === '[DONE]') return;

        try {
          const parsed = JSON.parse(data);
          const content = parsed.choices?.[0]?.delta?.content;
          if (content) yield content;
        } catch {
          // skip malformed JSON lines
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
