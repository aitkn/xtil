export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
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
}

export interface ProviderDefinition {
  id: string;
  name: string;
  defaultEndpoint: string;
  defaultContextWindow: number;
  apiKeyUrl?: string;
}
