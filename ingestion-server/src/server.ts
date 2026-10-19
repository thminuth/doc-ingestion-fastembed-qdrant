import config from './config';
import { ensurePayloadIndexes } from './pipeline/qdrantNativeSearch';
import createApp from './startup/app';

const app = createApp();

process.on('unhandledRejection', (reason, promise) => {
  console.error('[doc-ingestion-service] !!! UNHANDLED REJECTION !!!');
  console.error('Promise:', promise);
  console.error('Reason:', reason);
  // We don't exit here, but we log the hell out of it.
});

process.on('uncaughtException', (err) => {
  console.error('[doc-ingestion-service] !!! UNCAUGHT EXCEPTION - CRASHING !!!');
  console.error(err.stack || err);
  process.exit(1);
});

app.listen(config.port, async () => {
  console.log(`[doc-ingestion-service] Server läuft auf Port ${config.port}`);
  console.log(`[doc-ingestion-service] Qdrant: ${config.qdrantUrl} (Collections resolved dynamically)`);
});
