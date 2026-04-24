"""
Late Interaction / ColBERT Strategy
=====================================
Uses fastembed.LateInteractionTextEmbedding with .passage_embed() and
.query_embed().

Unlike dense embedding, each text produces a MATRIX of token-level vectors
(shape: num_tokens × dim), enabling MaxSim scoring in Qdrant.

Supported models:
  - colbert-ir/colbertv2.0  (default)

API prefix: /colbert
"""

from typing import List, Union
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from fastembed import LateInteractionTextEmbedding

from config import resolve_model_name, get_collection_name, CACHE_DIR, DEFAULT_MODELS, PROVIDERS

router = APIRouter(prefix="/colbert", tags=["Late Interaction (ColBERT)"])

# In-process model cache
_model_cache: dict[str, LateInteractionTextEmbedding] = {}


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _get_model(model_name: str, providers: list[str]) -> LateInteractionTextEmbedding:
    if model_name not in _model_cache:
        print(f"Vector. [ColBERT] Loading model: {model_name}")
        _model_cache[model_name] = LateInteractionTextEmbedding(
            model_name=model_name,
            cache_dir=CACHE_DIR,
            providers=providers,
        )
        print(f"Vector. [ColBERT] Model ready: {model_name}")
    return _model_cache[model_name]


def _run_embed(texts: list[str], model_name: str, providers: list[str], mode: str) -> list[list[list[float]]]:
    """Returns a list of token-matrices (one per input text)."""
    model = _get_model(model_name, providers)
    if mode == "passage":
        gen = model.passage_embed(texts)
    else:
        gen = model.query_embed(texts)
    # Each item is a 2D numpy array: (num_tokens, dim)
    return [mat.tolist() for mat in gen]


# ─── Request / Response Models ─────────────────────────────────────────────────

class ColbertEmbedRequest(BaseModel):
    texts: Union[str, List[str]]
    model: str = DEFAULT_MODELS["late_interaction"]

class ColbertEmbedResponse(BaseModel):
    model: str
    collection: str | None
    type: str                           # "passage" or "query"
    # Each text → list of token vectors → list of float values
    embeddings: List[List[List[float]]]


# ─── Endpoints ─────────────────────────────────────────────────────────────────

@router.post(
    "/embed/passage",
    response_model=ColbertEmbedResponse,
    summary="Embed passages (documents) as multi-vector token matrices",
)
async def embed_passage(request: ColbertEmbedRequest):
    """
    Embed one or more passages using .passage_embed().
    Each text returns a 2D token-matrix — compatible with Qdrant multi-vector
    storage and MaxSim scoring.
    Use this when ingesting documents into Qdrant.
    """
    providers = PROVIDERS
    try:
        model_name = resolve_model_name(request.model, "late_interaction")
        texts = [request.texts] if isinstance(request.texts, str) else request.texts
        embeddings = _run_embed(texts, model_name, providers, mode="passage")
        return ColbertEmbedResponse(
            model=model_name,
            collection=get_collection_name(model_name),
            type="passage",
            embeddings=embeddings,
        )
    except Exception as e:
        print(f"Vector. [ColBERT] Error in /embed/passage: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post(
    "/embed/query",
    response_model=ColbertEmbedResponse,
    summary="Embed a query as multi-vector token matrix for MaxSim search",
)
async def embed_query(request: ColbertEmbedRequest):
    """
    Embed a query using .query_embed().
    Use this at search time to compute MaxSim scores against stored passage matrices.
    """
    providers = PROVIDERS
    try:
        model_name = resolve_model_name(request.model, "late_interaction")
        texts = [request.texts] if isinstance(request.texts, str) else request.texts
        embeddings = _run_embed(texts, model_name, providers, mode="query")
        return ColbertEmbedResponse(
            model=model_name,
            collection=get_collection_name(model_name),
            type="query",
            embeddings=embeddings,
        )
    except Exception as e:
        print(f"Vector. [ColBERT] Error in /embed/query: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/health", summary="Late Interaction strategy health check")
async def health():
    return {
        "strategy": "late_interaction",
        "status": "ok",
        "default_model": DEFAULT_MODELS["late_interaction"],
        "loaded_models": list(_model_cache.keys()),
    }


# ─── Preload ───────────────────────────────────────────────────────────────────

def preload(providers: list[str]):
    """Called by server.py on startup to warm up the default model."""
    try:
        _get_model(DEFAULT_MODELS["late_interaction"], providers)
        # Preload Jina ColBERT v2 as requested by USER
        _get_model("jinaai/jina-colbert-v2", providers)
    except Exception as e:
        print(f"Vector. [ColBERT] Warning: preload failed: {e}")
