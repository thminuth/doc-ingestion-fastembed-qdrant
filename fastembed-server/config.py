"""
Central configuration for the FastEmbed Server.
All model names, collection names, and defaults are defined here.
"""

import os
import sys

# ─── Cache ────────────────────────────────────────────────────────────────────

CACHE_DIR = os.path.join(os.path.dirname(__file__), "local_models_v2")
os.makedirs(CACHE_DIR, exist_ok=True)

# ─── Server ───────────────────────────────────────────────────────────────────

SERVER_HOST = "0.0.0.0"
SERVER_PORT = 8001

# ─── Default Models per Strategy ──────────────────────────────────────────────

DEFAULT_MODELS = {
    "dense":            "intfloat/multilingual-e5-large",
    "late_interaction": "jinaai/jina-colbert-v2",
    "rerank":           "Xenova/ms-marco-MiniLM-L-6-v2",
    "colbert_rerank":   "jinaai/jina-colbert-v2",
}

# ─── Collection Names (Qdrant) ─────────────────────────────────────────────────
# Format: <strategy>_<model_shortname>
# These names are returned in API responses so the caller knows which
# Qdrant collection to write to / read from.

COLLECTION_NAMES = {
    # Dense
    "intfloat/multilingual-e5-large":   "dense_multilingual_e5",
    "BAAI/bge-small-en-v1.5":           "dense_bge_small_en",
    "BAAI/bge-m3":                      "dense_bge_m3",
    "mxbai-embed-large":                "dense_mxbai_large",
    # Late Interaction (ColBERT)
    "colbert-ir/colbertv2.0":           "colbert_colbertv2",
    "jinaai/jina-colbert-v2":           "colbert_jina_v2",
    # Rerank – uses dense retrieval collection (scoring is separate)
    "Xenova/ms-marco-MiniLM-L-6-v2":   "rerank_multilingual_e5",
    # ColBERT + Rerank Strategy
    "COLBERT_RERANK_COLLECTION":      "colbert_rerank_jina_v2",
}

def get_collection_name(model_name: str, strategy: str = None) -> str | None:
    """Return the Qdrant collection name for a given model, or None for rerankers."""
    if strategy == "colbert_rerank":
        return COLLECTION_NAMES.get("COLBERT_RERANK_COLLECTION")
    return COLLECTION_NAMES.get(model_name)

# ─── Model Aliases ─────────────────────────────────────────────────────────────

MODEL_ALIASES = {
    "fast-bge-small-en-v1.5":     "BAAI/bge-small-en-v1.5",
    "fast-multilingual-e5-large": "intfloat/multilingual-e5-large",
}

def resolve_model_name(model_name: str, strategy: str) -> str:
    """Resolve alias and fall back to the strategy default if empty."""
    trimmed = (model_name or "").strip()
    if not trimmed:
        return DEFAULT_MODELS[strategy]
    return MODEL_ALIASES.get(trimmed, trimmed)

# ─── Available strategies / Execution Provider ─────────────────────────────────

ALL_STRATEGIES = ["dense", "late_interaction", "rerank", "colbert_rerank"]

def _resolve_providers() -> list[str]:
    provider_config = os.environ.get("FASTEMBED_EXECUTION_PROVIDER", "auto").lower()
    if "--gpu" in sys.argv:
        provider_config = "gpu"
    elif "--cpu" in sys.argv:
        provider_config = "cpu"

    if provider_config == "gpu":
        return ["CUDAExecutionProvider"]
    elif provider_config == "cpu":
        return ["CPUExecutionProvider"]
    else:
        # Default = try CUDA, then CPU
        return ["CUDAExecutionProvider", "CPUExecutionProvider"]

def _resolve_strategies() -> list[str]:
    """Return list of active strategies based on --strategy flags, default = all."""
    selected = [
        sys.argv[i + 1]
        for i, arg in enumerate(sys.argv)
        if arg == "--strategy" and i + 1 < len(sys.argv)
    ]
    if not selected:
        return ALL_STRATEGIES
    invalid = [s for s in selected if s not in ALL_STRATEGIES]
    if invalid:
        print(f"Vector. [Error] Unknown strategies: {invalid}. Valid: {ALL_STRATEGIES}")
        sys.exit(1)
    return selected

PROVIDERS = _resolve_providers()
ACTIVE_STRATEGIES = _resolve_strategies()
