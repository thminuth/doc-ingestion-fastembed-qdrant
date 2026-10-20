"use strict";

import { createHash } from "crypto";
import extractDocxText from "../extractors/docxExtractor";
import extractPdfText from "../extractors/pdfExtractor";
import { FastEmbedAdapter } from "./fastembedAdapter";
import { Document } from "./qdrantNativeSearch";
import { addMultiVectorDocumentToStore } from "./vectorStoreFactory";

import { DocType, IngestPipelineInput, IngestPipelineResult } from "./types";

/**
 * Deterministische Punkt-ID aus dem Dokumentinhalt.
 *
 * Dadurch ist das Ingest idempotent: Wird dasselbe Dokument erneut hochgeladen
 * (z. B. beim wiederholten Upload eines Ordners), wird derselbe Punkt
 * ueberschrieben statt ein Duplikat anzulegen. Andernfalls wuerde ein
 * Dokumentenvergleich denselben Text mehrfach mit Score 1.0 liefern.
 */
const contentPointId = (text: string): string => {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  const hash = createHash("sha1").update(normalized).digest("hex");
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    hash.slice(12, 16),
    hash.slice(16, 20),
    hash.slice(20, 32),
  ].join("-");
};

/**
 * Main ingestion flow: extract -> embed -> store.
 */
const runIngestPipeline = async (
  input: IngestPipelineInput,
): Promise<IngestPipelineResult> => {
  const { buffer, mimetype, metadata, strategy } = input;
  const filename = metadata.filename.toLowerCase();

  // 1. Determine docType
  let docType: DocType = "unknown";
  if (filename.includes("-beschreibung")) docType = "description";
  else if (filename.includes("-firmendaten")) docType = "company";
  else if (filename.endsWith(".md")) docType = "offer";

  // 2. Extract text
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

  // 3. No Chunking: The documents are small, so we use the complete document text.
  const rawChunks = [text];

  // Deterministische ID: gleicher Inhalt -> gleicher Punkt (idempotentes Ingest)
  const docId = contentPointId(text);

  // Create Documents
  const chunks: Document[] = rawChunks.map((content) => ({
    pageContent: content.trim(),
    metadata: {
      ...metadata,
      docType,
      chunkId: docId,
    },
  }));

  if (chunks.length === 0) {
    throw new Error("No content extracted from document.");
  }

  // 4. Embedding & Storage
  const embeddings = new FastEmbedAdapter({ strategy, model: input.model });

  const { collectionName } = await addMultiVectorDocumentToStore(
    docId,
    chunks,
    embeddings,
  );

  return {
    ids: [docId],
    chunkCount: chunks.length,
    docType,
    collectionName,
  };
};

export default runIngestPipeline;
