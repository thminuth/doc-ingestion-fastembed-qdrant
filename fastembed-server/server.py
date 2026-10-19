"""
FastEmbed Vector Server — Generic Core
=======================================
Handles CUDA setup, ONNX Runtime initialization, FastAPI app creation, and
strategy router registration. Each strategy is an optional module:

  /dense/*    — TextEmbedding   (.passage_embed / .query_embed)
  /colbert/*  — LateInteractionTextEmbedding (.passage_embed / .query_embed)
  /rerank/*   — TextCrossEncoder (.rerank)

Startup flags:
  --strategy dense            activate only the dense strategy
  --strategy colbert          activate only the late-interaction strategy
  --strategy rerank           activate only the reranking strategy
  (can be combined, default = all three)

Execution provider flags:
  --gpu   force CUDAExecutionProvider
  --cpu   force CPUExecutionProvider
  (default = auto: CUDA preferred, fallback to CPU)
"""

import os
import sys
from contextlib import asynccontextmanager
from fastapi import FastAPI
import uvicorn
import onnxruntime as ort

from config import PROVIDERS, ACTIVE_STRATEGIES, DEFAULT_MODELS

# ─── CUDA / DLL setup (Windows only) ─────────────────────────────────────────

def _setup_cuda_paths():
    if os.name != "nt":
        return
    import site
    try:
        for sp in site.getsitepackages():
            nvidia_bins = [
                os.path.join(sp, "nvidia", "cuda_runtime", "bin"),
                os.path.join(sp, "nvidia", "cublas", "bin"),
                os.path.join(sp, "nvidia", "cudnn", "bin"),
                os.path.join(sp, "onnxruntime", "capi"),
            ]
            for bin_path in nvidia_bins:
                if os.path.exists(bin_path):
                    print(f"Vector. Adding DLL directory: {bin_path}")
                    os.add_dll_directory(bin_path)
                    os.environ["PATH"] = bin_path + os.pathsep + os.environ["PATH"]
    except Exception as e:
        print(f"Vector. Warning during DLL setup: {e}")

_setup_cuda_paths()

try:
    if hasattr(ort, "preload_dlls"):
        ort.preload_dlls()
except Exception:
    pass


# ─── Lifespan: startup / shutdown ─────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    print("Vector. ──────────────────────────────────────────")
    print(f"Vector. FastEmbed Server starting")
    print(f"Vector. Active strategies : {ACTIVE_STRATEGIES}")
    print(f"Vector. Execution providers: {PROVIDERS}")

    available_providers = ort.get_available_providers()
    if "CUDAExecutionProvider" in available_providers:
        print("Vector. [OK] CUDAExecutionProvider available → GPU acceleration enabled")
    else:
        print("Vector. [INFO] CUDAExecutionProvider not found → using CPU")

    # Preload default models for all active strategies
    if "dense" in ACTIVE_STRATEGIES:
        from strategies.dense import preload as preload_dense
        print("Vector. Preloading Dense model...")
        preload_dense(PROVIDERS)

    if "late_interaction" in ACTIVE_STRATEGIES:
        from strategies.late_interaction import preload as preload_colbert
        print("Vector. Preloading ColBERT model...")
        preload_colbert(PROVIDERS)

    if "rerank" in ACTIVE_STRATEGIES:
        from strategies.rerank import preload as preload_rerank
        print("Vector. Preloading Rerank model...")
        preload_rerank()

    if "colbert_rerank" in ACTIVE_STRATEGIES:
        from strategies.colbert_rerank import preload as preload_cr
        print("Vector. Preloading ColBERT-Rerank model...")
        preload_cr(PROVIDERS)

    print("Vector. All models ready. Server is up.")
    print("Vector. ──────────────────────────────────────────")

    yield  # Server runs here

    print("Vector. Server shutting down.")


# ─── App assembly ─────────────────────────────────────────────────────────────

app = FastAPI(
    title="FastEmbed Vector Server",
    description=(
        "Multi-strategy embedding server: Dense, Late Interaction (ColBERT), "
        "and Cross-Encoder Reranking via fastembed."
    ),
    version="2.0.0",
    lifespan=lifespan,
)

# Register strategy routers based on active strategies
if "dense" in ACTIVE_STRATEGIES:
    from strategies.dense import router as dense_router
    app.include_router(dense_router)

if "late_interaction" in ACTIVE_STRATEGIES:
    from strategies.late_interaction import router as colbert_router
    app.include_router(colbert_router)

if "rerank" in ACTIVE_STRATEGIES:
    from strategies.rerank import router as rerank_router
    app.include_router(rerank_router)

if "colbert_rerank" in ACTIVE_STRATEGIES:
    from strategies.colbert_rerank import router as cr_router
    app.include_router(cr_router)


# ─── Global endpoints ──────────────────────────────────────────────────────────

@app.get("/health", tags=["Server"])
async def health():
    """Overall server health and active strategy summary."""
    strategy_status = {}

    if "dense" in ACTIVE_STRATEGIES:
        from strategies.dense import _model_cache as dense_cache
        strategy_status["dense"] = {
            "active": True,
            "endpoints": ["/dense/embed/passage", "/dense/embed/query"],
            "loaded_models": list(dense_cache.keys()),
        }

    if "late_interaction" in ACTIVE_STRATEGIES:
        from strategies.late_interaction import _model_cache as colbert_cache
        strategy_status["late_interaction"] = {
            "active": True,
            "endpoints": ["/colbert/embed/passage", "/colbert/embed/query"],
            "loaded_models": list(colbert_cache.keys()),
        }

    if "rerank" in ACTIVE_STRATEGIES:
        from strategies.rerank import _model_cache as rerank_cache
        strategy_status["rerank"] = {
            "active": True,
            "endpoints": ["/rerank/"],
            "loaded_models": list(rerank_cache.keys()),
        }

    return {
        "status": "ok",
        "version": "2.0.0",
        "providers": PROVIDERS,
        "strategies": strategy_status,
    }


@app.get("/models", tags=["Server"])
async def list_models():
    """List all available models per strategy with their collection names."""
    from config import COLLECTION_NAMES, DEFAULT_MODELS
    return {
        "dense": {
            "default": DEFAULT_MODELS["dense"],
            "models": {
                k: v for k, v in COLLECTION_NAMES.items()
                if v and v.startswith("dense_")
            },
        },
        "late_interaction": {
            "default": DEFAULT_MODELS["late_interaction"],
            "models": {
                k: v for k, v in COLLECTION_NAMES.items()
                if v and v.startswith("colbert_") and not v.startswith("colbert_rerank_")
            },
        },
        "rerank": {
            "default": DEFAULT_MODELS["rerank"],
            "models": {
                 k: v for k, v in COLLECTION_NAMES.items()
                 if v and v.startswith("rerank_")
            }
        },
        "colbert_rerank": {
            "default": DEFAULT_MODELS["colbert_rerank"],
            "models": {
                 k: v for k, v in COLLECTION_NAMES.items()
                 if v and v.startswith("colbert_rerank_")
            }
        },
    }


# ─── Entry point ──────────────────────────────────────────────────────────────

if __name__ == "__main__":
    from config import SERVER_HOST, SERVER_PORT
    print(f"Vector. Starting on {SERVER_HOST}:{SERVER_PORT}")
    uvicorn.run(app, host=SERVER_HOST, port=SERVER_PORT)
