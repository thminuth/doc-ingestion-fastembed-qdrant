"""
Cross-Encoder Reranking Strategy
==================================
Uses fastembed.rerank.cross_encoder.TextCrossEncoder with .rerank().

Unlike dense or late-interaction embedding, the cross-encoder does NOT produce
vector representations. It takes a (query, document) pair and returns a
relevance score directly. This is used as a second-pass reranker after
initial candidate retrieval from Qdrant.

Supported models:
  - Xenova/ms-marco-MiniLM-L-6-v2  (default, fast)

API prefix: /rerank
"""

from typing import List, Union
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from fastembed.rerank.cross_encoder import TextCrossEncoder
from fastembed import TextEmbedding

from config import resolve_model_name, get_collection_name, CACHE_DIR, DEFAULT_MODELS, PROVIDERS

router = APIRouter(prefix="/rerank", tags=["Cross-Encoder Reranking"])

# In-process cross-encoder cache
_model_cache: dict[str, TextCrossEncoder] = {}

# In-process embedding cache (for storage/retrieval part of reranking)
_embed_cache: dict[str, TextEmbedding] = {}


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _get_model(model_name: str) -> TextCrossEncoder:
    if model_name not in _model_cache:
        print(f"Vector. [Rerank] Loading model: {model_name}")
        _model_cache[model_name] = TextCrossEncoder(
            model_name=model_name,
            cache_dir=CACHE_DIR,
        )
        print(f"Vector. [Rerank] Model ready: {model_name}")
    return _model_cache[model_name]


def _get_embed_model(model_name: str, providers: list[str]) -> TextEmbedding:
    if model_name not in _embed_cache:
        print(f"Vector. [Rerank/Embed] Loading dense model for retrieval: {model_name}")
        _embed_cache[model_name] = TextEmbedding(
            model_name=model_name,
            cache_dir=CACHE_DIR,
            providers=providers,
        )
        print(f"Vector. [Rerank/Embed] Dense model ready: {model_name}")
    return _embed_cache[model_name]


# ─── Request / Response Models ─────────────────────────────────────────────────

class RerankRequest(BaseModel):
    query: str
    documents: List[str]
    model: str = DEFAULT_MODELS["rerank"]

class RerankResult(BaseModel):
    index: int       # original position in the input list
    document: str
    score: float

class RerankResponse(BaseModel):
    model: str
    query: str
    results: List[RerankResult]   # sorted by score descending

class RerankEmbedRequest(BaseModel):
    texts: Union[str, List[str]]
    model: str = DEFAULT_MODELS["rerank"]

class RerankEmbedResponse(BaseModel):
    model: str
    collection: str | None
    type: str          # "passage" or "query"
    embeddings: List[List[float]]


# ─── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/", response_model=RerankResponse, summary="Rerank documents for a query using cross-encoder")
async def rerank(request: RerankRequest):
    """
    Score each document against the query using a cross-encoder.
    Results are returned sorted by relevance score (highest first).
    """
    try:
        model_name = resolve_model_name(request.model, "rerank")
        model = _get_model(model_name)
        scores = list(model.rerank(request.query, request.documents))

        results = [
            RerankResult(index=i, document=doc, score=float(score))
            for i, (doc, score) in enumerate(zip(request.documents, scores))
        ]
        results.sort(key=lambda r: r.score, reverse=True)

        return RerankResponse(
            model=model_name,
            query=request.query,
            results=results,
        )
    except Exception as e:
        print(f"Vector. [Rerank] Error in /rerank: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/embed/passage", response_model=RerankEmbedResponse, summary="Embed passages for rerank storage (uses Dense model)")
async def embed_passage(request: RerankEmbedRequest):
    """
    Rerank strategy uses Dense embeddings for the storage phase.
    """
    try:
        # Use the default DENSE model for the vector representation
        embed_model_name = DEFAULT_MODELS["dense"]
        model = _get_embed_model(embed_model_name, PROVIDERS)
        
        texts = [request.texts] if isinstance(request.texts, str) else request.texts
        gen = model.passage_embed(texts)
        embeddings = [vec.tolist() for vec in gen]
        
        # Resolve collection name based on the Rerank model requested
        rerank_model_name = resolve_model_name(request.model, "rerank")
        collection = get_collection_name(rerank_model_name)
        
        return RerankEmbedResponse(
            model=embed_model_name,
            collection=collection,
            type="passage",
            embeddings=embeddings,
        )
    except Exception as e:
        print(f"Vector. [Rerank/Embed] Error in /embed/passage: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/embed/query", response_model=RerankEmbedResponse, summary="Embed query for rerank retrieval (uses Dense model)")
async def embed_query(request: RerankEmbedRequest):
    """
    Rerank strategy uses Dense embeddings for the retrieval phase.
    """
    try:
        embed_model_name = DEFAULT_MODELS["dense"]
        model = _get_embed_model(embed_model_name, PROVIDERS)
        
        texts = [request.texts] if isinstance(request.texts, str) else request.texts
        gen = model.query_embed(texts)
        embeddings = [vec.tolist() for vec in gen]
        
        rerank_model_name = resolve_model_name(request.model, "rerank")
        collection = get_collection_name(rerank_model_name)
        
        return RerankEmbedResponse(
            model=embed_model_name,
            collection=collection,
            type="query",
            embeddings=embeddings,
        )
    except Exception as e:
        print(f"Vector. [Rerank/Embed] Error in /embed/query: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/health", summary="Rerank strategy health check")
async def health():
    return {
        "strategy": "rerank",
        "status": "ok",
        "default_model": DEFAULT_MODELS["rerank"],
        "loaded_models": list(_model_cache.keys()),
        "loaded_embedders": list(_embed_cache.keys()),
    }


# ─── Preload ───────────────────────────────────────────────────────────────────

def preload():
    """Called by server.py on startup."""
    try:
        _get_model(DEFAULT_MODELS["rerank"])
    except Exception as e:
        print(f"Vector. [Rerank] Warning: preload failed: {e}")
