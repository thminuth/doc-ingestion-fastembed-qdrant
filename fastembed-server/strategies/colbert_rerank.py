"""
ColBERT Rerank Strategy (Embedding Side)
=========================================
Uses fastembed.LateInteractionTextEmbedding (ColBERT) for the initial 
vector representations. The actual reranking logic is handled by the 
Gateway, which calls this strategy for embeddings and then the /rerank 
strategy for refinement.

Supported models:
  - jinaai/jina-colbert-v2  (default)

API prefix: /colbert_rerank
"""

from typing import List, Union
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from fastembed import LateInteractionTextEmbedding

from config import resolve_model_name, get_collection_name, CACHE_DIR, DEFAULT_MODELS, PROVIDERS

router = APIRouter(prefix="/colbert_rerank", tags=["ColBERT + Rerank Strategy"])

# In-process model cache
_model_cache: dict[str, LateInteractionTextEmbedding] = {}


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _get_model(model_name: str, providers: list[str]) -> LateInteractionTextEmbedding:
    if model_name not in _model_cache:
        print(f"Vector. [ColBERT-Rerank] Loading model: {model_name}")
        _model_cache[model_name] = LateInteractionTextEmbedding(
            model_name=model_name,
            cache_dir=CACHE_DIR,
            providers=providers,
        )
        print(f"Vector. [ColBERT-Rerank] Model ready: {model_name}")
    return _model_cache[model_name]


def _run_embed(texts: list[str], model_name: str, providers: list[str], mode: str) -> list[list[list[float]]]:
    """Returns a list of token-matrices (one per input text)."""
    model = _get_model(model_name, providers)
    if mode == "passage":
        gen = model.passage_embed(texts)
    else:
        gen = model.query_embed(texts)
    return [mat.tolist() for mat in gen]


# ─── Request / Response Models ─────────────────────────────────────────────────

class ColbertRerankEmbedRequest(BaseModel):
    texts: Union[str, List[str]]
    model: str = "jinaai/jina-colbert-v2"

class ColbertRerankEmbedResponse(BaseModel):
    model: str
    collection: str | None
    type: str                           # "passage" or "query"
    embeddings: List[List[List[float]]]


# ─── Endpoints ─────────────────────────────────────────────────────────────────

@router.post(
    "/embed/passage",
    response_model=ColbertRerankEmbedResponse,
    summary="Embed passages (documents) as multi-vector token matrices for hybrid strategy",
)
async def embed_passage(request: ColbertRerankEmbedRequest):
    providers = PROVIDERS
    try:
        # Vector. Hardcoded model for this strategy
        model_name = "jinaai/jina-colbert-v2"
        texts = [request.texts] if isinstance(request.texts, str) else request.texts
        embeddings = _run_embed(texts, model_name, providers, mode="passage")
        return ColbertRerankEmbedResponse(
            model=model_name,
            collection=get_collection_name(model_name, strategy="colbert_rerank"),
            type="passage",
            embeddings=embeddings,
        )
    except Exception as e:
        print(f"Vector. [ColBERT-Rerank] Error in /embed/passage: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post(
    "/embed/query",
    response_model=ColbertRerankEmbedResponse,
    summary="Embed a query as multi-vector token matrix for hybrid strategy",
)
async def embed_query(request: ColbertRerankEmbedRequest):
    providers = PROVIDERS
    try:
        # Vector. Hardcoded model for this strategy
        model_name = "jinaai/jina-colbert-v2"
        texts = [request.texts] if isinstance(request.texts, str) else request.texts
        embeddings = _run_embed(texts, model_name, providers, mode="query")
        return ColbertRerankEmbedResponse(
            model=model_name,
            collection=get_collection_name(model_name, strategy="colbert_rerank"),
            type="query",
            embeddings=embeddings,
        )
    except Exception as e:
        print(f"Vector. [ColBERT-Rerank] Error in /embed/query: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/health", summary="ColBERT + Rerank strategy health check")
async def health():
    return {
        "strategy": "colbert_rerank",
        "status": "ok",
        "default_model": DEFAULT_MODELS["colbert_rerank"],
        "loaded_models": list(_model_cache.keys()),
    }


# ─── Preload ───────────────────────────────────────────────────────────────────

def preload(providers: list[str]):
    """Called by server.py on startup."""
    try:
        _get_model(DEFAULT_MODELS["colbert_rerank"], providers)
    except Exception as e:
        print(f"Vector. [ColBERT-Rerank] Warning: preload failed: {e}")
