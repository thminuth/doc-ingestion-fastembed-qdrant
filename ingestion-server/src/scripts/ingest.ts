'use strict';

import fs from 'fs';
import path from 'path';
import runIngestPipeline from '../pipeline/ingest';

/**
 * CLI Script zum Ingestieren lokaler Dateien.
 * Anwendung: ts-node src/scripts/ingest.ts <datei-pfad>
 */
async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Bitte einen Dateipfad angeben: ts-node src/scripts/ingest.ts <fp>');
    process.exit(1);
  }

  const absolutePath = path.resolve(filePath);
  if (!fs.existsSync(absolutePath)) {
    console.error(`Datei nicht gefunden: ${absolutePath}`);
    process.exit(1);
  }

  const buffer = fs.readFileSync(absolutePath);
  const ext = path.extname(absolutePath).toLowerCase();
  let mimetype = 'text/plain';

  if (ext === '.pdf') mimetype = 'application/pdf';
  else if (ext === '.docx') mimetype = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  else if (ext === '.md') mimetype = 'text/markdown';

  console.log(`[Script] Ingestiere ${path.basename(absolutePath)}...`);

  try {
    const result = await runIngestPipeline({
      buffer,
      mimetype,
      metadata: {
        filename: path.basename(absolutePath),
        mimetype,
        uploadedAt: new Date().toISOString(),
      },
    });

    console.log(`[Script] Erfolg! IDs: ${result.ids.join(', ')} | Chunks: ${result.chunkCount}`);
  } catch (err: any) {
    console.error(`[Script] Fehler: ${err.message}`);
    process.exit(1);
  }
}

main().catch(console.error);
