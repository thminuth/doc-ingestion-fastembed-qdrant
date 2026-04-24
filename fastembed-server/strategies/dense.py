"""
Dense Embedding Strategy
========================
Uses fastembed.TextEmbedding with proper .passage_embed() and .query_embed()
methods for asymmetric retrieval.

Supported models:
  - intfloat/multilingual-e5-large  (default, multilingual)
  - BAAI/bge-small-en-v1.5
  - BAAI/bge-m3
  - mxbai-embed-large

API prefix: /dense
"""

from typing import List, Union
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from fastembed import TextEmbedding

from config import resolve_model_name, get_collection_name, CACHE_DIR, DEFAULT_MODELS, PROVIDERS

router = APIRouter(prefix="/dense", tags=["Dense Embedding"])

# In-process model cache: model_name -> TextEmbedding instance
_model_cache: dict[str, TextEmbedding] = {}


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _get_model(model_name: str, providers: list[str]) -> TextEmbedding:
    if model_name not in _model_cache:
        print(f"Vector. [Dense] Loading model: {model_name}")
        _model_cache[model_name] = TextEmbedding(
            model_name=model_name,
            cache_dir=CACHE_DIR,
            providers=providers,
        )
        print(f"Vector. [Dense] Model ready: {model_name}")
    return _model_cache[model_name]


def _run_embed(texts: list[str], model_name: str, providers: list[str], mode: str) -> list[list[float]]:
    model = _get_model(model_name, providers)
    if mode == "passage":
        gen = model.passage_embed(texts)
    else:
        gen = model.query_embed(texts)
    return [vec.tolist() for vec in gen]


# ─── Request / Response Models ─────────────────────────────────────────────────

class DenseEmbedRequest(BaseModel):
    texts: Union[str, List[str]]
    model: str = DEFAULT_MODELS["dense"]

class DenseEmbedResponse(BaseModel):
    model: str
    collection: str | None
    type: str          # "passage" or "query"
    embeddings: List[List[float]]


# ─── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/embed/passage", response_model=DenseEmbedResponse, summary="Embed passages (documents) for storage")
async def embed_passage(request: DenseEmbedRequest):
    """
    Embed one or more text passages using .passage_embed().
    Use this when ingesting documents into Qdrant.
    The returned `collection` field contains the recommended Qdrant collection name.
    """
    providers = PROVIDERS
    try:
        model_name = resolve_model_name(request.model, "dense")
        texts = [request.texts] if isinstance(request.texts, str) else request.texts
        embeddings = _run_embed(texts, model_name, providers, mode="passage")
        return DenseEmbedResponse(
            model=model_name,
            collection=get_collection_name(model_name),
            type="passage",
            embeddings=embeddings,
        )
    except Exception as e:
        print(f"Vector. [Dense] Error in /embed/passage: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/embed/query", response_model=DenseEmbedResponse, summary="Embed a search query")
async def embed_query(request: DenseEmbedRequest):
    """
    Embed a query text using .query_embed().
    Use this when searching Qdrant (NOT for storing documents).
    """
    providers = PROVIDERS
    try:
        model_name = resolve_model_name(request.model, "dense")
        texts = [request.texts] if isinstance(request.texts, str) else request.texts
        embeddings = _run_embed(texts, model_name, providers, mode="query")
        return DenseEmbedResponse(
            model=model_name,
            collection=get_collection_name(model_name),
            type="query",
            embeddings=embeddings,
        )
    except Exception as e:
        print(f"Vector. [Dense] Error in /embed/query: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/health", summary="Dense strategy health check")
async def health():
    return {
        "strategy": "dense",
        "status": "ok",
        "default_model": DEFAULT_MODELS["dense"],
        "loaded_models": list(_model_cache.keys()),
    }


# ─── Preload ───────────────────────────────────────────────────────────────────

def preload(providers: list[str]):
    """Called by server.py on startup to warm up the default model."""
    try:
        _get_model(DEFAULT_MODELS["dense"], providers)
    except Exception as e:
        print(f"Vector. [Dense] Warning: preload failed: {e}")
