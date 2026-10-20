import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

export interface UploadResult {
  message: string;
  filename: string;
  chunkCount: number;
  ids: string[];
}

export interface QueryResult {
  query: string;
  results: {
    text: string;
    score: number;
    metadata: Record<string, any>;
  }[];
}

export interface ThresholdProfile {
  strategy: string;
  label: string;
  description: string;
  min: number;
  max: number;
  step: number;
  default: number;
  normalization: string;
  prefilterThreshold: number;
}

export interface ModelsResult {
  embedders: any;
  llms: string[];
  thresholds: Record<string, ThresholdProfile>;
  collections?: Record<string, number>;
}

export interface QueryOptions {
  query: string;
  threshold?: number;
  limit?: number;
  vectorStore?: string;
  strategy?: string;
  embeddingProvider?: string;
  model?: string;
}

export interface CompareOptions {
  file: File;
  threshold?: number;
  limit?: number;
  vectorStore: string;
  strategy: string;
  embeddingProvider?: string;
  model?: string;
}

@Injectable({
  providedIn: 'root'
})
export class IngestService {
  private readonly apiUrl = 'http://localhost:3100/api/ingest';
  private readonly queryUrl = 'http://localhost:3100/api/ingest/query';

  constructor(private http: HttpClient) { }

  uploadDocument(file: File, vectorStore?: string, strategy?: string, embeddingProvider?: string, model?: string): Observable<UploadResult> {
    const formData = new FormData();
    formData.append('document', file);
    if (vectorStore) formData.append('vectorStore', vectorStore);
    if (strategy) formData.append('strategy', strategy);
    if (embeddingProvider) formData.append('embeddingProvider', embeddingProvider);
    if (model) formData.append('model', model);

    return this.http.post<UploadResult>(this.apiUrl, formData);
  }

  queryDocuments(opts: QueryOptions): Observable<QueryResult> {
    const { query, threshold = 0.5, limit = 10, vectorStore, strategy, embeddingProvider } = opts;
    
    console.log(`[IngestService] queryDocuments - Query: ${query}, Limit: ${limit}, Strategy: ${strategy}`);
    
    let params = new HttpParams()
      .set('q', query)
      .set('limit', limit.toString())
      .set('threshold', threshold.toString());

    if (vectorStore) params = params.set('vectorStore', vectorStore);
    if (strategy) params = params.set('strategy', strategy);
    if (embeddingProvider) params = params.set('embeddingProvider', embeddingProvider);
    if (opts.model) params = params.set('model', opts.model);

    return this.http.get<QueryResult>(this.queryUrl, { params });
  }

  clearDatabase(vectorStore?: string, strategy?: string): Observable<{ message: string }> {
    let params = new HttpParams();
    if (vectorStore) params = params.set('vectorStore', vectorStore);
    if (strategy) params = params.set('strategy', strategy);
    return this.http.delete<{ message: string }>(this.apiUrl, { params });
  }

  getModels(): Observable<ModelsResult> {
    return this.http.get<ModelsResult>('http://localhost:3100/api/ingest/models');
  }

  logModelSelection(strategy: string, embeddingProvider?: string): Observable<void> {
    return this.http.post<void>('http://localhost:3100/api/ingest/log-selection', { strategy, embeddingProvider });
  }

  compareDocument(opts: CompareOptions): Observable<{ store: string; collection?: string; results: any[]; exactMatch?: boolean }> {
    const { file, threshold = 0.4, limit = 10, vectorStore, strategy, embeddingProvider } = opts;
    
    const formData = new FormData();
    formData.append('document', file);
    formData.append('vectorStore', vectorStore);
    formData.append('strategy', strategy);
    formData.append('threshold', threshold.toString());
    formData.append('limit', limit.toString());
    if (embeddingProvider) formData.append('embeddingProvider', embeddingProvider);
    if (opts.model) formData.append('model', opts.model);

    return this.http.post<{ store: string; collection?: string; results: any[]; exactMatch?: boolean }>('http://localhost:3100/api/ingest/compare', formData);
  }
}
