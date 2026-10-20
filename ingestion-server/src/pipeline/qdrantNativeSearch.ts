'use strict';

import { QdrantClient } from '@qdrant/js-client-rest';
import config from '../config';
import { ensureCollection } from './vectorStoreFactory';
import { FastEmbedAdapter } from './fastembedAdapter';
import {
  getRetrievalProfile,
  getThresholdProfile,
  normalizeScore,
  toRawPrefilter,
} from './scoreConfig';

// ---------------------------------------------------------------------------
// Singleton-Client
// ---------------------------------------------------------------------------

let _client: QdrantClient | null = null;

const getClient = (): QdrantClient => {
  if (!_client) {
    _client = new QdrantClient({ url: config.qdrantUrl });
  }
  return _client;
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Document {
  pageContent: string;
  metadata: Record<string, any>;
}

export interface QdrantSearchOptions {
  /** Name der Qdrant-Collection (default: config.qdrantCollection) */
  indexName?: string;
  /** Anzahl Ergebnisse (default: 4) */
  limit?: number;
  /** Minimum-Score – Ergebnisse unterhalb werden verworfen (default: strategiespezifisch aus scoreConfig) */
  scoreThreshold?: number;
  /** Nativer Qdrant-Filter, z. B. { must: [{ key: 'metadata.filename', match: { value: 'x.pdf' } }] } */
  filter?: Record<string, any>;
  /**
   * HNSW-Suchtiefe pro Query.
   */
  hnswEf?: number;
  /**
   * Re-Scoring mit Original-Float-Vektoren nach quantisierter Vorauswahl.
   */
  rescore?: boolean;
  /**
   * Multiplikator für den Kandidaten-Pool vor dem Re-Scoring.
   */
  oversampling?: number;
  /**
   * Gewichtung Keyword vs. Vector Search.
   * Default: 0.5
   */
  alpha?: number;
  /**
   * Multi-Vector Query: Matrix von Vektoren (ColBERT style).
   * Wenn gesetzt, wird queryVector ignoriert.
   */
  queryVectors?: number[][];
}

// ---------------------------------------------------------------------------
// Main search function
// ---------------------------------------------------------------------------

/**
 * Sucht in der konfigurieren Qdrant-Collection mit nativen API-Parametern.
 * Unterstützt sowohl Standard-Vektorsuche als auch ColBERT Multi-Vektorsuche (MaxSim).
 */
export const qdrantNativeSearch = async (
  query: string,
  embeddings: FastEmbedAdapter,
  opts: QdrantSearchOptions = {}
): Promise<[Document, number][]> => {
  const {
    filter,
    hnswEf = 256,
    rescore = true,
    oversampling = 2.0,
    queryVectors,
  } = opts;

  // Strategy-specific score scale. The user-facing threshold is always on the
  // normalised 0..1 score (cosine / mean MaxSim / sigmoid logit).
  const profile = getThresholdProfile(embeddings.strategy);
  const threshold = opts.scoreThreshold ?? profile.default;

  let limit = opts.limit ?? 4;
  if (embeddings.strategy === 'colbert_rerank') {
    limit = 30; // Hardcoded requirement for this strategy
  }

  const client = getClient();

  // Resolve identifying query: either use provided matrix or embed the string.
  let activeQuery: any;
  let activeIndexName: string;

  if (queryVectors && queryVectors.length > 0) {
    activeQuery = queryVectors;
    activeIndexName = opts.indexName || "";
    if (!activeIndexName) throw new Error("Index name must be provided when searching with raw queryVectors.");
  } else {
    // Pass the selected model explicitly. Without it the FastEmbed server
    // falls back to the strategy default, which resolves to a DIFFERENT
    // collection (e.g. colbert_colbertv2 instead of colbert_jina_v2) and the
    // search silently returns no results.
    const embedResult = await embeddings.embedQuery(query, embeddings.model);
    activeQuery = embedResult.embedding;
    activeIndexName = embedResult.collectionName;
  }

  // Detect if query is a matrix (Multi-Vector) or a flat vector (Standard)
  const isMultiVectorQuery = Array.isArray(activeQuery[0]);
  const dim = isMultiVectorQuery ? activeQuery[0].length : activeQuery.length;

  // MaxSim grows with the query length, so both the pre-filter and the final
  // score are normalised by the number of query tokens.
  const queryTokenCount = isMultiVectorQuery ? activeQuery.length : 1;
  const prefilterThreshold = toRawPrefilter(
    profile,
    threshold,
    queryTokenCount,
  );

  // Ensure collection is in sync. Read-only: never delete/re-create existing
  // data because the caller picked a different strategy/model.
  try {
    await ensureCollection(activeIndexName, dim, isMultiVectorQuery, { allowRecreate: false });
  } catch (err: any) {
    console.warn(`[qdrantNativeSearch] ${err.message} Returning empty results.`);
    return [];
  }

  let response;
  try {
    // Hybrid / Keyword / Vector Search
    const vectorName = activeIndexName.split('_')[0] || 'vectors';
    console.log(`[qdrantNativeSearch] Executing query on '${activeIndexName}' | strategy: ${embeddings.strategy} | limit: ${limit} | threshold: ${threshold} (${profile.normalization}) | prefilter: ${prefilterThreshold}`);
    
    response = await client.query(activeIndexName, {
      query: activeQuery,
      using: vectorName,
      limit: limit,
      score_threshold: prefilterThreshold > 0 ? prefilterThreshold : undefined,
      params: {
        hnsw_ef: hnswEf,
        exact: false,
        quantization: { ignore: false, rescore, oversampling },
      },
      filter: filter ?? undefined,
      with_payload: true,
    });
  } catch (err: any) {
    if (err?.status === 404 || err?.message?.includes('Not Found')) {
      console.warn(`[qdrantNativeSearch] Collection '${activeIndexName}' not found. Returning empty results.`);
      return [];
    }
    throw err;
  }

  const rawPoints = response.points.map((point) => {
    const payload = (point.payload ?? {}) as Record<string, any>;
    const pageContent: string = payload['content'] ?? '';
    const metadata: Record<string, any> =
      typeof payload['metadata'] === 'object' && payload['metadata'] !== null
        ? payload['metadata']
        : Object.fromEntries(
          Object.entries(payload).filter(([k]) => k !== 'content')
        );

    return { 
      doc: { pageContent, metadata }, 
      score: point.score 
    };
  });

  // ---------------------------------------------------------------------------
  // Optional Second Pass: Cross-Encoder Reranking
  // ---------------------------------------------------------------------------
  if (embeddings.strategy === 'rerank' || embeddings.strategy === 'colbert_rerank') {
    const documentsToRerank = rawPoints.map(p => p.doc.pageContent);
    const shortQuery = query.length > 50 ? query.substring(0, 50) + '...' : query;
    console.log(`[qdrantNativeSearch] Re-ranking ${documentsToRerank.length} candidates for query: "${shortQuery}"`);
    
    try {
      // For colbert_rerank, we use the default reranker: Xenova/ms-marco-MiniLM-L-6-v2
      const rerankedResults = await embeddings.rerank(query, documentsToRerank);

      // Normalise the cross-encoder logit (sigmoid) and apply the user
      // threshold to the FINAL score, not to the retrieval score.
      return rerankedResults
        .map((r) => {
          const originalPoint = rawPoints[r.index];
          if (!originalPoint) return null;
          return {
            doc: originalPoint.doc,
            score: normalizeScore(r.score, profile, queryTokenCount),
          };
        })
        .filter((r): r is { doc: Document; score: number } => r !== null)
        .filter((r) => r.score >= threshold)
        .sort((a, b) => b.score - a.score)
        .map((r) => [r.doc, r.score] as [Document, number]);
    } catch (err: any) {
      console.error(`[qdrantNativeSearch] Reranking failed fallback to vector score:`, err.message);
      // Fall back to the retrieval scale (cosine / mean MaxSim) with its default
      // threshold, since the user threshold refers to the rerank scale.
      const fallbackProfile = getRetrievalProfile(embeddings.strategy);
      return rawPoints
        .map((p) => ({
          doc: p.doc,
          score: normalizeScore(p.score, fallbackProfile, queryTokenCount),
        }))
        .filter((p) => p.score >= fallbackProfile.default)
        .sort((a, b) => b.score - a.score)
        .map((p) => [p.doc, p.score] as [Document, number]);
    }
  }

  // Dense / ColBERT: normalise the retrieved score and apply the threshold to
  // the final score.
  return rawPoints
    .map((p) => ({
      doc: p.doc,
      score: normalizeScore(p.score, profile, queryTokenCount),
    }))
    .filter((p) => p.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .map((p) => [p.doc, p.score] as [Document, number]);
};

// ---------------------------------------------------------------------------
// Payload index setup
// ---------------------------------------------------------------------------

export const ensurePayloadIndexes = async (collectionName: string): Promise<void> => {
  if (!collectionName) return;
  const client = getClient();

  try {
    const collections = await client.getCollections();
    const exists = collections.collections.some(c => c.name === collectionName);

    if (!exists) return;

    await client.createPayloadIndex(collectionName, {
      field_name: 'content',
      field_schema: 'text',
      wait: true,
    });
  } catch (err: any) {
    if (!err.message?.includes('already indexed')) {
      console.warn(`[qdrant] Hinweis: Konnte Payload-Index in '${collectionName}' nicht sicherstellen:`, err.message);
    }
  }
};
