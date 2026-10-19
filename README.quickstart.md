# Vector Quickstart

Kurzfassung fuer neue Nutzer: Dieses Repository besteht aus drei Services und startet lokal mit Qdrant.

- UI: `doc-ingestion-ui` (Angular, Port 4200)
- Gateway/API: `ingestion-server` (Express, Port 3100)
- Embedding/Rerank: `fastembed-server` (FastAPI, Port 8001)

Wenn du die komplette technische Doku brauchst, siehe [README.md](README.md).

## 1. Voraussetzungen

- Node.js 20+
- npm 10+
- Python 3.10 (z. B. Homebrew `python3.10`)
- Docker (oder lokaler Qdrant)

Conda ist **nicht** noetig: der FastEmbed-Server laeuft aus dem projekt-lokalen
venv `fastembed-server/.venv`. Wer Conda bevorzugt, kann `environment.yml`
weiterhin nutzen (siehe Abschnitt 3).

## 2. Qdrant starten

```bash
docker run -p 6333:6333 qdrant/qdrant
```

Health check:

```bash
curl http://127.0.0.1:6333/collections
```

## 3. Abhaengigkeiten installieren

Empfohlen – alles auf einmal, aus dem Repo-Root:

```bash
npm run setup
```

Das erledigt:

1. `fastembed-server/.venv` (Python 3.10) anlegen und `requirements.cpu.txt` installieren
2. `node_modules` fuer Root, `ingestion-server` und `doc-ingestion-ui` installieren

Voraussetzung: `python3.10` liegt im PATH. Anderer Interpreter:

```bash
PYTHON=/opt/homebrew/bin/python3.10 npm run setup
```

### Manuell (Alternative)

FastEmbed-Server (Python, projekt-lokales venv):

```bash
cd fastembed-server
python3.10 -m venv .venv
./.venv/bin/python -m pip install --upgrade pip
./.venv/bin/python -m pip install -r requirements.cpu.txt
```

Node-Services:

```bash
npm install
npm --prefix ingestion-server install
npm --prefix doc-ingestion-ui install
```

### GPU / Conda (optional)

Fuer CUDA (Linux/Windows) gibt es weiterhin `environment.yml`:

```bash
conda env create -f environment.yml
conda activate doc-ingestion
pip install "fastembed[gpu]" nvidia-cudnn-cu12
```

Dann muss der FastEmbed-Start auf den Conda-Interpreter zeigen:

```bash
FASTEMBED_PYTHON="conda run --no-capture-output -n doc-ingestion python" npm start
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

Aus dem Repo-Root:

```bash
npm start
```

Startet alle drei Services in einem Terminal und erzwingt die Reihenfolge
automatisch ueber Health-Checks:

1. FastEmbed Server (Port 8001)
2. Ingestion Server (Port 3100, wartet auf 8001)
3. UI (Port 4200, wartet auf 3100)

Beenden mit `Ctrl+C` (beendet alle drei).

Alternative in VS Code:

- `Terminal -> Run Task -> Start: All Services`

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
  - venv fehlt/kaputt? `npm run setup:python` (legt `fastembed-server/.venv` neu an).
  - Python-Pakete pruefen: `fastembed-server/.venv/bin/python -m pip install -r fastembed-server/requirements.cpu.txt`.
- Keine Treffer in Suche:
  - Dokument zuerst ingestieren; `threshold` ggf. senken.

## 10. Was ist wo?

- API-Routen: `ingestion-server/src/routes/ingest-controller.ts`
- FastEmbed Strategien: `fastembed-server/strategies/`
- VS Code Tasks: `.vscode/tasks.json`
- Ausfuehrliche Doku: [README.md](README.md)
