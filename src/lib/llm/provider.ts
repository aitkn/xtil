import type { ChatMessage, ChatOptions, LLMProvider, ProviderConfig } from './types';

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

  constructor(config: ProviderConfig, name: string, defaultEndpoint: string) {
    this.id = config.providerId;
    this.name = name;
    this.config = config;
    this.endpoint = config.endpoint || defaultEndpoint;
    this.isOpenAI = config.providerId === 'openai';
  }

  private tokenLimitParam(maxTokens: number): Record<string, number> {
    // OpenAI's newer models (o-series, gpt-4.1, etc.) require max_completion_tokens
    return this.isOpenAI
      ? { max_completion_tokens: maxTokens }
      : { max_tokens: maxTokens };
  }

  async sendChat(messages: ChatMessage[], options?: ChatOptions): Promise<string> {
    const url = `${this.endpoint}/v1/chat/completions`;
    const body = {
      model: this.config.model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      temperature: options?.temperature ?? 0.3,
      ...this.tokenLimitParam(options?.maxTokens ?? 4096),
      stream: false,
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`LLM API error (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    return data.choices[0]?.message?.content || '';
  }

  async *streamChat(messages: ChatMessage[], options?: ChatOptions): AsyncGenerator<string> {
    const url = `${this.endpoint}/v1/chat/completions`;
    const body = {
      model: this.config.model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      temperature: options?.temperature ?? 0.3,
      ...this.tokenLimitParam(options?.maxTokens ?? 4096),
      stream: true,
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`LLM API error (${response.status}): ${errorText}`);
    }

    yield* parseSSEStream(response);
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
