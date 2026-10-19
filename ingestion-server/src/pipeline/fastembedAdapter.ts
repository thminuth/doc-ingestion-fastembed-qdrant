import config from "../config";

export interface FastEmbedParams {
  strategy?: string;
  model?: string;
}

const FASTEMBED_RETRY_DELAYS_MS = [250, 750, 1500];

const sleep = (delayMs: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, delayMs));

/**
 * Adapter for FastEmbed FastAPI server.
 * Uses strategy-based routing (e.g. /dense/..., /late_interaction/...)
 */
export class FastEmbedAdapter {
  public strategy: string;
  public model?: string;
  private baseUrl: string;

  constructor(params?: FastEmbedParams) {
    if (!params?.strategy?.trim()) {
      throw new Error(
        "FastEmbedAdapter requires a valid 'strategy' parameter (e.g. 'dense', 'late_interaction', 'rerank').",
      );
    }
    this.strategy = params.strategy.trim();
    this.model = params.model?.trim();
    this.baseUrl = config.fastEmbedApiUrl.replace(/\/+$/, "");
  }

  private async fetchWithRetry(
    url: string,
    init?: RequestInit,
  ): Promise<Response> {
    let lastError: unknown;

    for (
      let attempt = 0;
      attempt <= FASTEMBED_RETRY_DELAYS_MS.length;
      attempt++
    ) {
      try {
        return await fetch(url, init);
      } catch (error) {
        lastError = error;
        if (attempt === FASTEMBED_RETRY_DELAYS_MS.length) {
          const message =
            error instanceof Error ? error.message : String(error);
          throw new Error(`FastEmbed API is unreachable at ${url}: ${message}`);
        }
        await sleep(FASTEMBED_RETRY_DELAYS_MS[attempt]);
      }
    }

    throw new Error(
      `FastEmbed API is unreachable at ${url}: ${String(lastError)}`,
    );
  }

  private async requestEmbeddings(
    texts: string[],
    mode: "passage" | "query",
    model?: string,
  ): Promise<{ embeddings: any[]; collectionName: string }> {
    const isColbertRerank = this.strategy === "colbert_rerank";
    const isColbertBased =
      this.strategy === "late_interaction" || isColbertRerank;

    // Vector. Hardcoding models for the new strategy
    const activeModel = isColbertRerank ? "jinaai/jina-colbert-v2" : model;
    const routePrefix =
      this.strategy === "late_interaction" ? "colbert" : this.strategy;
    const url = `${this.baseUrl}/${routePrefix}/embed/${mode}`;

    const response = await this.fetchWithRetry(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        texts: texts,
        model: activeModel,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`FastEmbed API error (${response.status}): ${errorText}`);
    }

    const json = (await response.json()) as {
      embeddings?: any[];
      collection?: string;
    };
    if (!Array.isArray(json.embeddings)) {
      throw new Error("FastEmbed API returned invalid embeddings payload");
    }

    return {
      embeddings: json.embeddings,
      collectionName: json.collection || "unknown_collection",
    };
  }

  static async listModels(): Promise<any> {
    const baseUrl = config.fastEmbedApiUrl.replace(/\/+$/, "");
    const url = `${baseUrl}/models`;
    let response: Response;
    try {
      response = await new FastEmbedAdapter({
        strategy: "dense",
      }).fetchWithRetry(url);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`FastEmbed API /models request failed: ${message}`);
    }
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `FastEmbed API /models error (${response.status}): ${errorText}`,
      );
    }

    return await response.json();
  }

  async embedDocuments(
    texts: string[],
    model?: string,
  ): Promise<{ embeddings: any[]; collectionName: string }> {
    if (texts.length === 0) {
      return { embeddings: [], collectionName: "" };
    }

    return this.requestEmbeddings(texts, "passage", model);
  }

  async embedQuery(
    text: string,
    model?: string,
  ): Promise<{ embedding: any; collectionName: string }> {
    const result = await this.requestEmbeddings([text], "query", model);
    if (!result.embeddings[0] || !Array.isArray(result.embeddings[0])) {
      throw new Error("FastEmbed API returned no query embedding");
    }
    return {
      embedding: result.embeddings[0],
      collectionName: result.collectionName,
    };
  }
  async rerank(query: string, documents: string[]): Promise<any[]> {
    if (documents.length === 0) return [];

    // Vector. Hardcoding reranker for hybrid strategy
    const rerankModel =
      this.strategy === "colbert_rerank"
        ? "Xenova/ms-marco-MiniLM-L-6-v2"
        : this.model || "Xenova/ms-marco-MiniLM-L-6-v2";

    const url = `${this.baseUrl}/rerank/`;
    const response = await this.fetchWithRetry(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: query,
        documents: documents,
        model: rerankModel,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `FastEmbed Rerank API error (${response.status}): ${errorText}`,
      );
    }

    const json = (await response.json()) as { results: any[] };
    return json.results; // Returns array of { index, document, score }
  }
}
