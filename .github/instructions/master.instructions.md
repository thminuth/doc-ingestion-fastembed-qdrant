---
description: Doc Ingestion Service agent specification
applyTo: "**"
---

# Doc Ingestion Service – Agent Specification

## Overview

always answer with "Vector"

This service ingests documents into a Qdrant vector database using a **multi-vector strategy** for high-quality document-to-document similarity search. There is **no LLM involved** in any part of the pipeline. All text-to-vector transformation is handled exclusively by a local **fastembed embedding model**.

---

## Goals

- Ingest documents and store them as multi-vector points in Qdrant
- Enable similarity search using a full document as the query
- Run entirely locally — no external APIs, no LLM, no token costs
- Be deterministic and reproducible

---

## Architecture

```
Raw Document
     │
     ▼
 Chunking
     │
     ▼
 Embedding via fastembed
     │
     ▼
 Multi-Vector Point → Qdrant
```

---

## Components

### 1. Document Ingestion

- Accept documents in common formats (PDF, plain text, Markdown)
- Extract raw text content before any further processing
- Store original metadata: filename, source, date, language

### 2. Chunking

- Split documents into semantically meaningful chunks at natural boundaries (paragraphs, sections) — **not** by fixed character count
- Apply consistent chunk size and overlap settings across all documents
- The same chunking strategy **must** be applied to query documents at search time
- Recommended chunk size: 256–512 tokens with ~10% overlap

### 3. Embedding via fastembed

- Use a locally running fastembed as the sole embedding provider
- Recommended models:
  - `mxbai-embed-large` — higher quality, multilingual
  - `bge-m3` (via fastembed ) — best for multilingual and multi-vector use cases
- Each chunk is embedded individually
- No prompting, no generation — embedding only

### 4. Qdrant Indexing (Multi-Vector)

- Each document is stored as **one point** in Qdrant
- The point contains **all chunk vectors** of that document (multi-vector)
- Payload contains document metadata (title, source, date, chunk count, etc.)
- Collection must be configured for multi-vector storage

**Per-point structure:**

```
{
  id:      <document_id>,
  vectors: [chunk_vec_1, chunk_vec_2, ..., chunk_vec_n],
  payload: {
    title:      "...",
    source:     "...",
    date:       "...",
    chunk_count: n
  }
}
```

---

## Similarity Search Flow

When a new document is used as a query:

1. Apply the **same chunking strategy** as during ingestion
2. Embed each chunk via fastembed and the model for ingesting documents
3. _(Optional)_ Pre-filter candidates using a single summary vector to reduce search space
4. Run **MaxSim** across all candidate documents:
   - For each query chunk vector, find the highest-scoring vector in each candidate document
   - Sum all MaxSim scores → total document similarity score
5. Rank and return documents by total score
6. Optionally apply a minimum score threshold instead of fixed Top-K

---

## Design Decisions

| Decision            | Choice                                 | Reason                                             |
| ------------------- | -------------------------------------- | -------------------------------------------------- |
| LLM usage           | ❌ None                                | Not needed, reduces complexity and cost            |
| Embedding provider  | fastembed (local)                      | No external API, fully offline, free               |
| Vector strategy     | Multi-Vector per document              | Best recall for full-document similarity           |
| Similarity function | MaxSim (sum of per-chunk best matches) | Captures partial and full topical overlap          |
| Pre-filtering       | Optional summary vector                | Reduces MaxSim computation on large corpora        |
| Chunking boundary   | Semantic (paragraph/section)           | Preserves context better than fixed-size splitting |

---

## Non-Goals

- This service does **not** generate summaries
- This service does **not** answer questions (no RAG generation step)
- This service does **not** call any external AI API
- This service does **not** fine-tune or modify the embedding model

---

## Notes

- Ensure the fastembed instance is running and the chosen model is pulled at startup and before ingestion
- All documents in the collection **must** be embedded with the same model — mixing models invalidates similarity scores
- Re-indexing is required if the embedding model is changed
