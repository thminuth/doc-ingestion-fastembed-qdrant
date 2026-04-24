# Vector Quickstart

Kurzfassung fuer neue Nutzer: Dieses Repository besteht aus drei Services und startet lokal mit Qdrant.

- UI: `doc-ingestion-ui` (Angular, Port 4200)
- Gateway/API: `ingestion-server` (Express, Port 3100)
- Embedding/Rerank: `fastembed-server` (FastAPI, Port 8001)

Wenn du die komplette technische Doku brauchst, siehe [README.md](README.md).

## 1. Voraussetzungen

- Node.js 20+
- npm 10+
- Python 3.10
- Conda
- Docker (oder lokaler Qdrant)

## 2. Qdrant starten

```bash
docker run -p 6333:6333 qdrant/qdrant
```

Health check:

```bash
curl http://127.0.0.1:6333/collections
```

## 3. Abhaengigkeiten installieren

### FastEmbed Server

```bash
cd fastembed-server
npm install
```

Conda-Umgebung (einmalig):

```bash
cd ..
conda env create -f environment.yml
conda activate doc-ingestion
pip install "fastembed[gpu]" nvidia-cudnn-cu12
```

CPU-only Alternative:

```bash
pip install fastembed
```

### Ingestion Server

```bash
cd ingestion-server
npm install
```

### UI

```bash
cd ../doc-ingestion-ui
npm install
```

## 4. Environment setzen

Datei: `ingestion-server/.env`

```env
PORT=3100
QDRANT_URL=http://127.0.0.1:6333
FASTEMBED_API_URL=http://127.0.0.1:8001
```

Hinweis: Die UI verwendet aktuell fest `http://localhost:3100`.

## 5. Alles starten (empfohlen)

In VS Code:

- `Terminal -> Run Task -> Start: All Services`

Der Task startet in dieser Reihenfolge und in separaten Terminals:

1. FastEmbed Server
2. Ingestion Server
3. UI (zuletzt)

## 6. Manuell starten (Alternative)

Terminal 1:

```bash
cd fastembed-server
npm run start:cpu
```

Terminal 2:

```bash
cd ingestion-server
npm run dev
```

Terminal 3:

```bash
cd doc-ingestion-ui
npm start
```

## 7. Smoke Tests

### FastEmbed

```bash
curl http://127.0.0.1:8001/health
```

### Ingestion API

```bash
curl http://localhost:3100/health
```

### UI

Im Browser oeffnen:

- `http://localhost:4200`

## 8. Erster Ingestion-Test

```bash
curl -X POST "http://localhost:3100/api/ingest" \
  -F "document=@./test-data/candidates/cand_001_java_gold.md" \
  -F "strategy=late_interaction"
```

Suche:

```bash
curl "http://localhost:3100/api/ingest/query?q=java+backend+spring&strategy=late_interaction&limit=5&threshold=0.35"
```

## 9. Haeufige Probleme

- UI startet, zeigt aber Fehler:
  - Pruefe, ob Ingestion auf Port 3100 laeuft.
- Ingestion kann nicht embeddieren:
  - Pruefe `FASTEMBED_API_URL` und FastEmbed Health.
- FastEmbed startet nicht:
  - Pruefe Conda-Env `doc-ingestion` und Python-Pakete.
- Keine Treffer in Suche:
  - Dokument zuerst ingestieren; `threshold` ggf. senken.

## 10. Was ist wo?

- API-Routen: `ingestion-server/src/routes/ingest-controller.ts`
- FastEmbed Strategien: `fastembed-server/strategies/`
- VS Code Tasks: `.vscode/tasks.json`
- Ausfuehrliche Doku: [README.md](README.md)
