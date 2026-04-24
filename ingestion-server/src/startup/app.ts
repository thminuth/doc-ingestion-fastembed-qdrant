'use strict';

import cors from 'cors';
import express, { Application, NextFunction, Request, Response } from 'express';
import config from '../config';
import { ensurePayloadIndexes } from '../pipeline/qdrantNativeSearch';
import ingestController from '../routes/ingest-controller';

const createApp = (): Application => {
  const app: Application = express();

  // Security
  app.disable('x-powered-by');

  // CORS
  app.use(cors());

  // Body parsers
  app.use(express.json({ limit: '100kb' }));
  app.use(express.urlencoded({ extended: true }));

  // Routes
  app.use('/api/ingest', ingestController);

  // Health check
  app.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({ status: 'ok', service: 'doc-ingestion-service' });
  });

  // Global error handler
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[Error]', err.message, err.stack);

    if (err.message.includes('Ungültiger Dateityp')) {
      res.status(400).json({ message: err.message });
      return;
    }
    if (err.message.includes('File too large')) {
      res.status(413).json({ message: 'Datei zu groß. Maximale Größe: 20 MB.' });
      return;
    }

    res.status(500).json({ message: 'Interner Serverfehler.' });
  });

  return app;
};

export default createApp;
