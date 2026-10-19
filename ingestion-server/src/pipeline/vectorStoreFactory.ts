import config from '../config';
import { FastEmbedAdapter } from './fastembedAdapter';
import { Document } from './qdrantNativeSearch';

/**
 * Multi-Vector Storage logic (ColBERT-style)
 * Stores one document as ONE point with a matrix of vectors.
 */
export const addMultiVectorDocumentToStore = async (
  documentId: string,
  chunks: Document[],
  embeddings: FastEmbedAdapter
): Promise<{ collectionName: string }> => {
  try {
    const result = await embeddings.embedDocuments(chunks.map(c => c.pageContent), embeddings.model);
    const vectorMatrix = result.embeddings;
    const collectionName = result.collectionName;
    const firstDoc = chunks[0];
    const metadata = {
      ...firstDoc.metadata,
      chunk_count: chunks.length,
      content: chunks.map(c => c.pageContent).join('\n\n')
    };

    const qdrantUrl = config.qdrantUrl;

    let finalVectorData: any;
    let dimensions = 0;
    let isMultiVector = false;

    if (Array.isArray(vectorMatrix[0]) && Array.isArray(vectorMatrix[0][0])) {
      // 3D Matrix (Late Interaction / ColBERT)
      finalVectorData = vectorMatrix.flat();
      dimensions = vectorMatrix[0][0].length;
      isMultiVector = true;
    } else if (Array.isArray(vectorMatrix[0])) {
      // 2D Matrix (Dense) with 1 chunk
      finalVectorData = vectorMatrix[0]; // Take the single vector
      dimensions = vectorMatrix[0].length;
      isMultiVector = false;
    } else {
      finalVectorData = vectorMatrix;
      dimensions = vectorMatrix.length;
      isMultiVector = false;
    }

    // Ensure collection exists with proper config
    const vectorName = collectionName.split('_')[0] || 'vectors';
    await ensureCollection(collectionName, dimensions, isMultiVector);

    // Upsert point via native REST API
    const payload = {
      points: [
        {
          id: documentId,
          vector: {
            [vectorName]: finalVectorData
          },
          payload: metadata
        }
      ]
    };

    console.log(`[vectorStoreFactory] Attempting upsert for doc ID: ${documentId}, Collection: ${collectionName}, Multi-Vector: ${isMultiVector}, Dim: ${dimensions}`);

    let lastError: string = '';
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const response = await fetch(`${qdrantUrl}/collections/${collectionName}/points?wait=true`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (response.ok) {
          console.log(`[vectorStoreFactory] Document '${(metadata as any).filename}' stored successfully (ID: ${documentId})`);
          return { collectionName };
        }

        lastError = await response.text();
        console.warn(`[vectorStoreFactory] Attempt ${attempt} failed: ${lastError}`);
        if (attempt < 3) await new Promise(r => setTimeout(r, 500 * attempt));
      } catch (e: any) {
        lastError = e.message;
        console.warn(`[vectorStoreFactory] Attempt ${attempt} network error: ${lastError}`);
        if (attempt < 3) await new Promise(r => setTimeout(r, 500 * attempt));
      }
    }

    throw new Error(`Qdrant Upsert failed after 3 attempts: ${lastError}`);
  } catch (err: any) {
    console.error(`[vectorStoreFactory] Ingestion failed: ${err.message}`);
    throw err;
  }
};

export interface EnsureCollectionOptions {
  /**
   * If false, the collection is only validated (read path): an out-of-sync
   * collection is never deleted/re-created and a missing collection is not created.
   */
  allowRecreate?: boolean;
}

/**
 * Ensures a collection is configured correctly.
 */
export const ensureCollection = async (collectionName: string, dimensions: number, isMultiVector: boolean, options: EnsureCollectionOptions = {}): Promise<void> => {
  const { allowRecreate = true } = options;
  const qdrantUrl = config.qdrantUrl;
  const vectorName = collectionName.split('_')[0] || 'vectors';

  const checkRes = await fetch(`${qdrantUrl}/collections/${collectionName}`);
  if (checkRes.ok) {
    const info = (await checkRes.json()) as any;
    const vectors = info.result?.config?.params?.vectors;

    const dynamicConfig = vectors?.[vectorName] || vectors;
    const multivectorConfig = dynamicConfig?.multivector_config;
    const existingSize = dynamicConfig?.size;

    const isCurrentlyMulti = !!multivectorConfig;
    if (isCurrentlyMulti === isMultiVector && existingSize === dimensions) {
      return; // Already configured correctly
    }

    // Read path: never destroy existing data because the caller used a
    // different strategy/model. Fail explicitly instead.
    if (!allowRecreate) {
      throw new Error(`Collection '${collectionName}' is out of sync (Size: ${existingSize} vs ${dimensions}, Multi: ${isCurrentlyMulti} vs ${isMultiVector}) and was not modified during read-only access. Re-ingest the documents with the matching strategy/model.`);
    }

    console.warn(`[vectorStoreFactory] Collection '${collectionName}' out of sync (Size: ${existingSize} vs ${dimensions}, Multi: ${isCurrentlyMulti} vs ${isMultiVector}). Re-creating...`);
    await fetch(`${qdrantUrl}/collections/${collectionName}`, { method: 'DELETE' });
    await new Promise(r => setTimeout(r, 400));
  } else if (!allowRecreate) {
    // Read path: leave a missing collection untouched; the search returns no results.
    return;
  }

  console.log(`[vectorStoreFactory] Creating Collection: ${collectionName} (Vector Name: ${vectorName}, Dim: ${dimensions}, Multi-Vector: ${isMultiVector})`);

  const vectorConfig = {
    size: dimensions,
    distance: 'Cosine',
    ...(isMultiVector ? { multivector_config: { comparator: 'max_sim' } } : {})
  };

  const createRes = await fetch(`${qdrantUrl}/collections/${collectionName}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      vectors: {
        [vectorName]: vectorConfig
      }
    })
  });

  if (!createRes.ok) {
    const err = await createRes.text();
    if (!err.includes('already exists')) {
      throw new Error(`Failed to create collection: ${err}`);
    }
  }
};

/**
 * Deletes the active VectorStore index/collection.
 */
export const clearVectorStore = async (
  _storeType: 'qdrant' | undefined,
  collectionToClear: string
): Promise<void> => {
  try {
    if (!collectionToClear) {
      throw new Error("clearVectorStore requires a collectionName explicitly.");
    }
    const response = await fetch(`${config.qdrantUrl}/collections/${collectionToClear}`, {
      method: 'DELETE',
    });
    if (response.ok || response.status === 404) {
      console.log(`[doc-ingestion-service] Qdrant Index '${collectionToClear}' gelöscht.`);
    } else {
      throw new Error(`Status: ${response.status}`);
    }
  } catch (e: any) {
    console.error(`[doc-ingestion-service] Qdrant Löschung fehlgeschlagen: ${e.message}`);
    throw new Error(`Qdrant Löschung fehlgeschlagen: ${e.message}`);
  }
};
