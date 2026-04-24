"use strict";

import { v4 as uuidv4 } from "uuid";
import extractDocxText from "../extractors/docxExtractor";
import extractPdfText from "../extractors/pdfExtractor";
import { FastEmbedAdapter } from "./fastembedAdapter";
import { Document } from "./qdrantNativeSearch";
import { addMultiVectorDocumentToStore } from "./vectorStoreFactory";

import { DocType, IngestPipelineInput, IngestPipelineResult } from "./types";

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

  // Create Documents
  const chunks: Document[] = rawChunks.map((content) => ({
    pageContent: content.trim(),
    metadata: {
      ...metadata,
      docType,
      chunkId: uuidv4(),
    },
  }));

  if (chunks.length === 0) {
    throw new Error("No content extracted from document.");
  }

  // 4. Embedding & Storage
  const embeddings = new FastEmbedAdapter({ strategy, model: input.model });

  const docId = uuidv4();
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
