'use strict';

import { Document } from './qdrantNativeSearch';

export type DocType = 'description' | 'company' | 'offer' | 'unknown';

export interface DocumentMetadata {
  filename: string;
  mimetype: string;
  uploadedAt: string;
  docType?: DocType;
  [key: string]: string | undefined;
}

export interface IngestPipelineResult {
  ids: string[];
  chunkCount: number;
  docType: DocType;
  collectionName: string;
}

export interface IngestPipelineInput {
  buffer: Buffer;
  mimetype: string;
  metadata: DocumentMetadata;
  strategy?: string;
  model?: string;
}
