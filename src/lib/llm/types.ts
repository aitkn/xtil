export type VisionSupport = 'unknown' | 'none' | 'base64' | 'url';
// 'url' means model accepts both URLs AND base64 (url is a superset)

export interface ModelCapabilities {
  vision: VisionSupport;
  probedAt: number; // timestamp for cache invalidation
}

export type ImageContent =
  | { base64: string; mimeType: string }
  | { url: string };

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  images?: ImageContent[];
  /** Hint for providers with explicit cache control (Anthropic). */
  cacheBreakpoint?: boolean;
}

export interface JsonSchema {
  name: string;
  schema: Record<string, unknown>;
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  /** When true, ask the provider to enforce valid JSON output. */
  jsonMode?: boolean;
  /** When set, enforce a specific JSON schema on the response (provider-specific mechanism). */
  jsonSchema?: JsonSchema;
  /** External abort signal to cancel the request (e.g. user navigated away). */
  signal?: AbortSignal;
}

export interface LLMProvider {
  id: string;
  name: string;
  sendChat(messages: ChatMessage[], options?: ChatOptions): Promise<string>;
  streamChat(messages: ChatMessage[], options?: ChatOptions): AsyncGenerator<string>;
  testConnection(): Promise<boolean>;
}

export interface ProviderConfig {
  providerId: string;
  apiKey: string;
  model: string;
  endpoint?: string;
  contextWindow: number;
}

export interface ModelInfo {
  id: string;
  name: string;
  contextWindow: number;
  maxOutput?: number;
  inputPrice?: number;    // per 1M tokens USD
  outputPrice?: number;   // per 1M tokens USD
  vision?: boolean;
  /** false for image/video-only models that can't do text chat */
  textGeneration?: boolean;
}

export interface ProviderDefinition {
  id: string;
  name: string;
  defaultEndpoint: string;
  defaultContextWindow: number;
  apiKeyUrl?: string;
  /** @deprecated Use per-model vision probe via modelCapabilities instead */
  supportsVision?: boolean;
  description?: string;
}
