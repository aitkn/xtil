import type { SummaryDocument } from '../summarizer/types';
import type { ExtractedContent } from '../extractors/types';

export interface ExportResult {
  url: string;
  databaseId?: string;
  databaseName?: string;
}

export interface ExportAdapter {
  id: string;
  name: string;
  testConnection(): Promise<boolean>;
  export(summary: SummaryDocument, content: ExtractedContent): Promise<ExportResult>;
}
