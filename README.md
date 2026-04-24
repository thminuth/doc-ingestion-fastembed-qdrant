# Vector

Dokumenten-Ingestion und Dokument-zu-Dokument-Suche mit Qdrant, FastEmbed und einer Angular-UI.

Fuer einen schnellen Einstieg (5-10 Minuten) siehe [README.quickstart.md](README.quickstart.md).
Diese Datei ist die ausfuehrliche Developer-Dokumentation.

Dieses Repository ist als 3-Service-Workspace aufgebaut:

1. `fastembed-server` (Python/FastAPI): lokale Embeddings und Reranking
2. `ingestion-server` (Node.js/Express): Upload, Ingestion, Query, Compare, Qdrant-Integration
3. `doc-ingestion-ui` (Angular): Weboberflaeche fuer Ingestion und Suche

Wichtig: Die Pipeline arbeitet lokal mit FastEmbed-Modellen und Qdrant. Es gibt keine aktive Ollama-Nutzung in der aktuellen Architektur.

## Inhalt

- [Architektur](#architektur)
- [Projektstruktur](#projektstruktur)
- [Voraussetzungen](#voraussetzungen)
- [Schnellstart](#schnellstart)
- [Start via VS Code Task](#start-via-vs-code-task)
- [Services einzeln starten](#services-einzeln-starten)
- [Konfiguration](#konfiguration)
- [Backend API (ingestion-server)](#backend-api-ingestion-server)
- [FastEmbed API (fastembed-server)](#fastembed-api-fastembed-server)
- [Datenmodell und Qdrant-Logik](#datenmodell-und-qdrant-logik)
- [Strategien und Modelle](#strategien-und-modelle)
- [Troubleshooting](#troubleshooting)
- [Entwicklung und Wartung](#entwicklung-und-wartung)

## Architektur

```text
+-------------------+         HTTP          +-----------------------+
|   Angular UI      | --------------------> |   ingestion-server    |
|  doc-ingestion-ui |                       |   (Express, Port 3100)|
+-------------------+                       +-----------+-----------+
                                                        |
                             Embedding/Rerank API       |
                                                        v
                                           +------------+-----------+
                                           |     fastembed-server   |
                                           |   (FastAPI, Port 8001) |
                                           +------------+-----------+
                                                        |
                                                        | Qdrant REST
                                                        v
                                           +------------+-----------+
                                           |        Qdrant          |
                                           |      (Port 6333)       |
                                           +------------------------+
```

### Anfragefluss (vereinfacht)

1. UI laedt Dokument hoch (`document`) und sendet `strategy` (+ optional `model`) an den Ingestion-Server.
2. Ingestion-Server extrahiert Text (PDF/DOCX/MD), bildet aktuell genau 1 Chunk (kompletter Text), fordert Embeddings vom FastEmbed-Server an.
3. Embeddings werden in Qdrant als Punkt gespeichert (dense oder multi-vector, je nach Strategie).
4. Bei Suche: Query -> Embedding -> Qdrant Query -> optional Cross-Encoder-Reranking -> Ergebnisliste.

## Projektstruktur

```text
doc-ingestion/
  .vscode/
    tasks.json
  doc-ingestion-ui/        # Angular Frontend
  fastembed-server/        # Python/FastAPI Embedding Server
  ingestion-server/        # Node.js/Express Gateway + Qdrant Zugriff
  test-data/               # Testdaten (Jobs, Kandidaten, Metadaten)
  environment.yml          # Conda Basisumgebung
```

## Voraussetzungen

### System

- Node.js 20+ (empfohlen LTS)
- npm 10+
- Python 3.10
- Conda (Miniconda/Anaconda)
- Qdrant lokal erreichbar (standardmaessig `http://127.0.0.1:6333`)

### Optional

- CUDA-faehige GPU fuer FastEmbed (wenn `--gpu` genutzt wird)

## Schnellstart

### 1) Dependencies installieren

#### FastEmbed Server (Python + npm scripts)

```bash
cd fastembed-server
npm install
```

Conda-Umgebung erstellen (falls noch nicht vorhanden):

```bash
cd ..
conda env create -f environment.yml
conda activate doc-ingestion
pip install "fastembed[gpu]" nvidia-cudnn-cu12
```

Wenn nur CPU gewuenscht ist, kann `fastembed[gpu]` durch `fastembed` ersetzt werden.

#### Ingestion Server

```bash
cd ingestion-server
npm install
```

#### UI

```bash
cd ../doc-ingestion-ui
npm install
```

### 2) Qdrant starten

Beispiel (Docker):

```bash
docker run -p 6333:6333 qdrant/qdrant
```

### 3) Services starten

Empfohlen ueber VS Code Task (siehe unten) oder manuell in drei Terminals.

## Start via VS Code Task

In `.vscode/tasks.json` ist ein Sammel-Task vorhanden:

- `Start: All Services`

Dieser startet sequenziell:

1. `Start: FastEmbed Server`
2. `Start: Ingestion Server`
3. `Start: UI`

Jeder Service startet in einem eigenen Terminal (`presentation.panel = "new"`).

Ausfuehrung:

- `Terminal -> Run Task -> Start: All Services`
- oder `Ctrl+Shift+B` (Default Build Task)

## Services einzeln starten

### FastEmbed Server

```bash
cd fastembed-server
npm run start:cpu
```

Alternativen:

- `npm run start` (auto provider)
- `npm run start:gpu`
- `npm run start:dense`
- `npm run start:colbert`
- `npm run start:rerank`

### Ingestion Server

```bash
cd ingestion-server
npm run dev
```

Build/Prod:

```bash
npm run build
npm run start
```

### UI

```bash
cd doc-ingestion-ui
npm start
```

Default Angular Dev URL: `http://localhost:4200`

## Konfiguration

## Ingestion Server (`ingestion-server/src/config.ts`)

Der Server nutzt folgende Umgebungsvariablen:

- `PORT` (Default: `3000`)
- `QDRANT_URL` (Default: `http://127.0.0.1:6333`)
- `FASTEMBED_API_URL` (Default: `http://127.0.0.1:8001`)

Hinweis: Die UI ruft aktuell fest `http://localhost:3100/...` auf. Fuer lokalen Betrieb sollte daher meist `PORT=3100` gesetzt sein.

Empfohlene `.env` (in `ingestion-server/.env`):

```env
PORT=3100
QDRANT_URL=http://127.0.0.1:6333
FASTEMBED_API_URL=http://127.0.0.1:8001
```

Hinweis zu Altwerten: In aelteren `.env` koennen noch historische Variablen wie `EMBED_PROVIDER` oder `OLLAMA_BASE_URL` stehen. Diese sind in der aktuellen Server-Konfiguration nicht mehr relevant.

### FastEmbed Server (`fastembed-server/config.py`)

Wichtige Defaults:

- Host: `0.0.0.0`
- Port: `8001`
- Cache-Verzeichnis: `fastembed-server/local_models_v2`
- Strategien:
  - `dense`
  - `late_interaction`
  - `rerank`
  - `colbert_rerank`

Provider-Steuerung:

- `--gpu` -> `CUDAExecutionProvider`
- `--cpu` -> `CPUExecutionProvider`
- ohne Flag -> zuerst CUDA, dann CPU

## Backend API (ingestion-server)

Base URL: `http://localhost:3100`

### Health

`GET /health`

Antwort:

```json
{ "status": "ok", "service": "doc-ingestion-service" }
```

### Ingestion

`POST /api/ingest`

- Content-Type: `multipart/form-data`
- File Field: `document`
- Form-Parameter:
  - `strategy` (pflicht)
  - `model` (optional)

Unterstuetzte Dateitypen:

- PDF (`application/pdf`)
- DOCX (`application/vnd.openxmlformats-officedocument.wordprocessingml.document`)
- Markdown (`text/markdown` oder Dateiendung `.md`)

Limit: 20 MB

Beispiel (curl):

```bash
curl -X POST "http://localhost:3100/api/ingest" \
  -F "document=@./test-data/candidates/cand_001_java_gold.md" \
  -F "strategy=late_interaction"
```

### Suche

`GET /api/ingest/query?q=...&strategy=...&limit=...&threshold=...&model=...`

Pflicht:

- `q`
- `strategy`

Optional:

- `limit` (Default 4)
- `threshold` (Default 0.4)
- `model`

Beispiel:

```bash
curl "http://localhost:3100/api/ingest/query?q=java+backend+spring&strategy=dense&limit=5&threshold=0.35"
```

### Compare (Dokument gegen Bestand)

`POST /api/ingest/compare`

- Content-Type: `multipart/form-data`
- File Field: `document`
- Form-Parameter:
  - `strategy` (pflicht)
  - `model` (optional)
  - `threshold` (optional)
  - `limit` (optional)

Beispiel:

```bash
curl -X POST "http://localhost:3100/api/ingest/compare" \
  -F "document=@./test-data/candidates/cand_001_java_gold.md" \
  -F "strategy=colbert_rerank" \
  -F "limit=10" \
  -F "threshold=0.3"
```

### Modellliste

`GET /api/ingest/models`

Antwort enthaelt verfügbare FastEmbed-Modelle.

### Auswahl-Logging

`POST /api/ingest/log-selection`

Body JSON:

```json
{ "strategy": "dense", "embeddingProvider": "fastembed" }
```

### Collections loeschen

`DELETE /api/ingest?strategy=<optional>`

Ohne `strategy`: versucht alle bekannten Strategie-Collections zu loeschen.

## FastEmbed API (fastembed-server)

Base URL: `http://127.0.0.1:8001`

### Global

- `GET /health`
- `GET /models`

### Dense

- `POST /dense/embed/passage`
- `POST /dense/embed/query`
- `GET /dense/health`

### Late Interaction (ColBERT)

- `POST /colbert/embed/passage`
- `POST /colbert/embed/query`
- `GET /colbert/health`

### Rerank

- `POST /rerank/`
- `POST /rerank/embed/passage`
- `POST /rerank/embed/query`
- `GET /rerank/health`

### ColBERT + Rerank (hybrid)

- `POST /colbert_rerank/embed/passage`
- `POST /colbert_rerank/embed/query`
- `GET /colbert_rerank/health`

## Datenmodell und Qdrant-Logik

### Speicherung

Die Speicherung erfolgt ueber `ingestion-server/src/pipeline/vectorStoreFactory.ts`.

- Ein Dokument wird als ein Punkt gespeichert
- Payload enthaelt Metadaten plus zusammengefuehrten Inhalt (`content`)
- Je nach Strategie werden dense oder multi-vectors geschrieben

### Collection-Konfiguration

- Distanz: `Cosine`
- Multi-vector (ColBERT): `multivector_config.comparator = max_sim`
- Collection wird bei inkompatibler Dimension/Config automatisch neu erstellt

### Query-Verhalten

- Dense/ColBERT: native Qdrant Query
- `rerank` / `colbert_rerank`: zweiter Pass mit Cross-Encoder (`/rerank/`)

## Strategien und Modelle

### Dense

Typisch:

- `intfloat/multilingual-e5-large` (Default)
- `BAAI/bge-small-en-v1.5`
- `BAAI/bge-m3`
- `mxbai-embed-large`

### Late Interaction

- `colbert-ir/colbertv2.0` (Default)
- preload zusaetzlich: `jinaai/jina-colbert-v2`

### Rerank

- Cross-Encoder Default: `Xenova/ms-marco-MiniLM-L-6-v2`
- Verwendet fuer Retrieval dense Embeddings als Basis

### ColBERT + Rerank

- Embedding: `jinaai/jina-colbert-v2`
- Reranking: `Xenova/ms-marco-MiniLM-L-6-v2`

## Troubleshooting

### UI startet nicht

Pruefen:

1. Backend laeuft auf Port `3100` (UI nutzt aktuell hardcodierte `http://localhost:3100` Endpoints).
2. `doc-ingestion-ui/node_modules` vorhanden (`npm install`).
3. Task-Start in VS Code: `Start: All Services`.

### VS Code Task bleibt haengen

Die Background-Matcher in `.vscode/tasks.json` warten auf spezifische Startmeldungen.
Wenn Logs abweichen, Matcher anpassen (insb. `endsPattern`).

### FastEmbed nicht erreichbar

Schnelltest:

```bash
curl http://127.0.0.1:8001/health
```

Wenn Fehler:

- Conda Environment `doc-ingestion` existiert?
- Python-Dependencies installiert?
- Richtiger Startmodus (`start:cpu` vs `start:gpu`)?

### Ingestion-Server kann FastEmbed nicht erreichen

Pruefen:

- `FASTEMBED_API_URL` in `ingestion-server/.env`
- Netzwerk/Firewall lokal
- FastEmbed Server wirklich gestartet

Der Adapter nutzt Retry-Delays (250/750/1500 ms) bei Netzwerkfehlern.

### Qdrant leer oder falsche Ergebnisse

Pruefen:

- Richtige `strategy` und ggf. `model` verwendet?
- Erwartete Collection vorhanden?
- `threshold` zu hoch?
- Bei Strategiewechsel ggf. erneut ingestieren.

## Entwicklung und Wartung

### Build-Checks

Ingestion Server:

```bash
cd ingestion-server
npm run build
```

UI Build:

```bash
cd ../doc-ingestion-ui
npm run build
```

### Hilfreiche Endpunkte

- Ingestion Health: `GET http://localhost:3100/health`
- FastEmbed Health: `GET http://127.0.0.1:8001/health`
- FastEmbed Modelle: `GET http://127.0.0.1:8001/models`

### Daten fuer Evaluation

Im Verzeichnis `test-data` liegen Beispiel-Jobs/Kandidaten zur funktionalen Pruefung der Matching-Qualitaet.
