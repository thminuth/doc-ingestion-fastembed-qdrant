"use strict";

import express, { NextFunction, Request, Response, Router } from "express";
import config from "../config";
import extractDocxText from "../extractors/docxExtractor";
import extractPdfText from "../extractors/pdfExtractor";
import uploadMiddleware from "../middleware/upload";
import { FastEmbedAdapter } from "../pipeline/fastembedAdapter";
import runIngestPipeline from "../pipeline/ingest";
import {
  ensurePayloadIndexes,
  qdrantNativeSearch,
} from "../pipeline/qdrantNativeSearch";
import { IngestPipelineResult } from "../pipeline/types";
import { clearVectorStore } from "../pipeline/vectorStoreFactory";

type FastEmbedModelsResponse = Record<
  string,
  {
    models?: Record<string, string>;
  }
>;

const router: Router = express.Router();

// POST /api/ingest – Nimmt ein PDF, DOCX oder MD entgegen, verarbeitet es und speichert es in Qdrant
router.post("/", uploadMiddleware, ingestHandler);

// GET /api/query – Führt eine Vektor-Ähnlichkeitssuche durch
router.get("/query", queryHandler);

// GET /api/ingest/models – Liefert verfügbare Modelle (FastEmbed)
router.get("/models", modelsHandler);

// POST /api/ingest/log-selection – Loggt die Modell-Auswahl in die Konsole
router.post("/log-selection", logSelectionHandler);

// POST /api/ingest/compare – Extrahiert ein Dokument und vergleich es gegen Qdrant
router.post("/compare", uploadMiddleware, compareHandler);

// DELETE /api/ingest – Löscht alle Dokumente aus Qdrant
router.delete("/", clearHandler);

async function ingestHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.file) {
      res.status(400).json({
        message:
          'Keine Datei hochgeladen. Bitte das Feld "document" verwenden.',
      });
      return;
    }

    const { buffer, mimetype, originalname } = req.file;
    const strategySelected = req.body.strategy;
    if (!strategySelected) {
      res
        .status(400)
        .json({ message: "Parameter 'strategy' ist zwingend erforderlich." });
      return;
    }

    console.log(
      `[doc-ingestion-service] Ingestion gestartet | Datei: ${originalname} | Strategy: ${strategySelected}`,
    );

    const result: IngestPipelineResult = await runIngestPipeline({
      buffer,
      mimetype,
      strategy: strategySelected,
      model: req.body.model,
      metadata: {
        filename: originalname,
        mimetype,
        uploadedAt: new Date().toISOString(),
      },
    });

    // Nach erfolgreichem Ingest: Indizes sicherstellen
    await ensurePayloadIndexes(result.collectionName).catch((err) =>
      console.warn("[ingest] Index-Fehler (ignoriert):", err.message),
    );

    res.status(200).json({
      message: "Dokument erfolgreich gespeichert.",
      filename: originalname,
      docType: result.docType,
      chunkCount: result.chunkCount,
      ids: result.ids,
      collectionName: result.collectionName,
    });
  } catch (err: any) {
    console.error(
      `[ingest-controller] Ingestion fehlgeschlagen für '${req.file?.originalname}':`,
      err.message,
    );
    next(err);
  }
}

async function queryHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const query = req.query.q as string;

    if (!query) {
      res.status(400).json({ message: "Suchbegriff (q) fehlt." });
      return;
    }
    const limitStr = req.query["limit"] as string;
    const limit = limitStr ? parseInt(limitStr, 10) : 4;

    const thresholdStr = req.query["threshold"] as string;
    const threshold = thresholdStr ? parseFloat(thresholdStr) : 0.4;
    const strategy = req.query["strategy"] as string | undefined;

    console.log(
      `[ingest-controller] queryHandler - limit detected: ${limitStr} -> ${limit}`,
    );

    if (!strategy) {
      res
        .status(400)
        .json({ message: "Parameter 'strategy' ist zwingend erforderlich." });
      return;
    }

    console.log(
      `[doc-ingestion-service] Suche | Query: "${query}" | Strategy: ${strategy}`,
    );

    const model = req.query.model as string | undefined;
    const embeddings = new FastEmbedAdapter({ strategy, model });
    const results = await qdrantNativeSearch(query, embeddings, {
      limit,
      scoreThreshold: threshold,
    });

    const formattedResults = results.map(([doc, score]) => ({
      text: doc.pageContent,
      score,
      metadata: doc.metadata,
    }));

    res.status(200).json({
      query,
      results: formattedResults,
    });
  } catch (err: any) {
    console.error(`[ingest-controller] Suche fehlgeschlagen:`, err.message);
    next(err);
  }
}

async function clearHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const strategy = req.query.strategy as string | undefined;

    // We get all models to figure out the collection name, or loop them to clear all
    const baseUrl = config.fastEmbedApiUrl.replace(/\/+$/, "");
    const response = await fetch(`${baseUrl}/models`);
    if (!response.ok) {
      throw new Error(`Failed to list fastembed models: ${response.status}`);
    }
    const json = (await response.json()) as FastEmbedModelsResponse;

    let clearedCount = 0;

    for (const [stratName, stratData] of Object.entries(json)) {
      if (strategy && stratName !== strategy) continue;

      const models = (stratData as any).models || {};
      for (const [_, collectionName] of Object.entries(models)) {
        if (!collectionName) continue;
        try {
          await clearVectorStore("qdrant", collectionName as string);
          clearedCount++;
        } catch (err: any) {
          console.warn(
            `Could not clear collection ${collectionName}: ${err.message}`,
          );
        }
      }
    }

    res
      .status(200)
      .json({ message: `${clearedCount} Qdrant Collections wurden geleert.` });
  } catch (err) {
    next(err);
  }
}

async function modelsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const models = await FastEmbedAdapter.listModels();
    res.status(200).json({
      embedders: models,
      llms: [],
    });
  } catch (err: any) {
    next(err);
  }
}

async function logSelectionHandler(req: Request, res: Response): Promise<void> {
  const { strategy, embeddingProvider } = req.body;
  if (!strategy) {
    res.status(400).json({ message: "Parameter 'strategy' fehlt." });
    return;
  }
  console.log(
    `[doc-ingestion-service] Auswahl: ${embeddingProvider || "fastembed"} | ${strategy}`,
  );
  res.status(204).send();
}

async function compareHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.file) {
      res.status(400).json({ message: "Keine Datei geladen." });
      return;
    }

    const { buffer, mimetype, originalname } = req.file;
    const strategy = req.body.strategy as string | undefined;

    if (!strategy) {
      res
        .status(400)
        .json({ message: "Parameter 'strategy' ist zwingend erforderlich." });
      return;
    }

    const threshold = req.body.threshold
      ? parseFloat(req.body.threshold as string)
      : 0.4;

    console.log(
      `[doc-ingestion-service] Vergleich gestartet | Datei: ${originalname} | Strategy: ${strategy}`,
    );

    // AI comparison logic: extract -> split -> embed -> search
    let text = "";
    if (mimetype === "application/pdf") {
      text = await extractPdfText(buffer);
    } else if (
      mimetype ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ) {
      text = await extractDocxText(buffer);
    } else {
      text = buffer.toString("utf-8");
    }

    // No Chunking: The documents are small, so we use the complete document text.
    const chunks = [text];
    const model = req.body.model as string | undefined;
    const embeddings = new FastEmbedAdapter({ strategy, model });
    const result = await embeddings.embedDocuments(chunks, model);
    const indexName = result.collectionName;

    // Pass the first (and only) embedding result.
    // If Dense: it's a number[] (1D)
    // If ColBERT: it's a number[][] (2D matrix)
    const queryVector = result.embeddings[0];

    const limit = req.body.limit ? parseInt(req.body.limit as string, 10) : 10;

    const rawResults = await qdrantNativeSearch(text, embeddings, {
      limit,
      scoreThreshold: threshold,
      indexName: indexName,
      queryVectors: queryVector as any,
    });

    const mapped = rawResults
      .sort((a, b) => b[1] - a[1])
      .map(([doc, score]) => ({
        text: doc.pageContent,
        score,
        metadata: doc.metadata,
      }));

    res.status(200).json({ store: "qdrant", results: mapped });
  } catch (err: any) {
    console.error(`[ingest-controller] Vergleich fehlgeschlagen:`, err.message);
    next(err);
  }
}

export default router;
