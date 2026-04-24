"use strict";

import dotenv from "dotenv";
dotenv.config();

export interface Config {
  port: number;
  // forced to qdrant for ColBERT support
  vectorStore: "qdrant";
  qdrantUrl: string;

  // Removed qdrantCollection to force dynamic resolution
  // Embedding Config
  embeddingProvider: "fastembed";
  fastEmbedCacheDir: string;
  fastEmbedApiUrl: string;
}

const config: Config = {
  port: parseInt(process.env.PORT ?? "3000", 10),
  vectorStore: "qdrant",
  qdrantUrl: process.env.QDRANT_URL ?? "http://127.0.0.1:6333",

  embeddingProvider: "fastembed",
  fastEmbedCacheDir: "local_cache_v2",
  fastEmbedApiUrl: process.env.FASTEMBED_API_URL ?? "http://127.0.0.1:8001",
};

export default config;
