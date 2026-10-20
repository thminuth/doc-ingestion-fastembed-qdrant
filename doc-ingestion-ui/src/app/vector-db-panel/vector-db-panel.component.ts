import { CommonModule } from '@angular/common';
import {
  AfterViewInit,
  Component,
  DestroyRef,
  ElementRef,
  Input,
  OnChanges,
  OnInit,
  SimpleChanges,
  ViewChild,
  inject,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Observable, finalize, of } from 'rxjs';

import { NzAlertModule } from 'ng-zorro-antd/alert';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzCardModule } from 'ng-zorro-antd/card';
import { NzDividerModule } from 'ng-zorro-antd/divider';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzInputNumberModule } from 'ng-zorro-antd/input-number';
import { NzListModule } from 'ng-zorro-antd/list';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { NzSliderModule } from 'ng-zorro-antd/slider';
import { NzSpinModule } from 'ng-zorro-antd/spin';
import { NzToolTipModule } from 'ng-zorro-antd/tooltip';
import { NzUploadFile, NzUploadModule } from 'ng-zorro-antd/upload';

import {
  IngestService,
  QueryResult,
  ThresholdProfile,
  UploadResult,
} from '../ingest.service';

@Component({
  selector: 'app-vector-db-panel',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    NzButtonModule,
    NzUploadModule,
    NzSpinModule,
    NzCardModule,
    NzListModule,
    NzIconModule,
    NzSliderModule,
    NzSelectModule,
    NzToolTipModule,
    NzInputNumberModule,
    NzAlertModule,
    NzDividerModule,
    NzInputModule,
  ],
  templateUrl: './vector-db-panel.component.html',
  styleUrls: ['./vector-db-panel.component.css'],
})
export class VectorDbPanelComponent implements OnInit, OnChanges, AfterViewInit {
  @Input() availableEmbedders: any = null;
  @Input() thresholdProfiles: Record<string, ThresholdProfile> | null = null;
  @Input() collectionCounts: Record<string, number> | null = null;
  /** Counts refreshed after uploads - they take precedence over the initial load. */
  private liveCollectionCounts: Record<string, number> | null = null;
  @Input() storageKeyPrefix: string = 'panel1';
  @ViewChild('ingestUpload', { read: ElementRef })
  ingestUpload?: ElementRef<HTMLElement>;

  uploadingCount = 0;
  get isUploading(): boolean {
    return this.uploadingCount > 0;
  }
  /** Fortschritt des aktuellen Upload-Batches. */
  uploadTotal = 0;
  uploadDone = 0;
  isClearing = false;

  selectedVectorStore: 'qdrant' = 'qdrant';
  selectedEmbeddingProvider: 'fastembed' = 'fastembed';
  strategy = '';
  selectedModel = '';
  uploadResults: UploadResult[] = [];
  errorMessages: string[] = [];
  /** Kurzmeldung des letzten Upload-Batches (keine Dateiliste). */
  uploadSummary: { indexed: number; failed: number } | null = null;

  get currentFastEmbedModels(): string[] {
    if (!this.availableEmbedders || !this.availableEmbedders[this.strategy])
      return [];
    return Object.keys(this.availableEmbedders[this.strategy].models || {});
  }

  private isInitialized = false;
  private hasAutoSelectedWithData = false;

  // Search state
  searchQuery = '';
  searchThreshold = 0.5;
  searchLimit = 10;

  // Threshold scale for the active strategy (from the backend profiles)
  thresholdMin = 0;
  thresholdMax = 1;
  thresholdStep = 0.01;
  thresholdLabel = 'Score-Schwelle';
  private appliedThresholdStrategy: string | null = null;

  isSearching = false;
  queryResult: QueryResult | null = null;
  searchError: string | null = null;

  // Compare state
  isComparing = false;
  compareResult: {
    store: string;
    collection?: string;
    results: any[];
    exactMatch?: boolean;
  } | null = null;
  compareError: string | null = null;
  compareFilename: string | null = null;
  /** Raw file of the last comparison - needed to index it on demand. */
  private compareFile: File | null = null;
  isIndexingCompareFile = false;

  private destroyRef = inject(DestroyRef);

  constructor(
    private msg: NzMessageService,
    private ingestService: IngestService,
  ) {}

  ngOnInit(): void {
    this.LOADPersistedValues();
    this.isInitialized = true;
    this.updateDefaults();
  }

  private LOADPersistedValues(): void {
    this.selectedEmbeddingProvider = 'fastembed';
    // Der alte Key (Default 'dense') wird bewusst nicht gelesen: die App
    // startet mit der ColBERT-Strategie, die in diesem Setup verwendet wird.
    this.strategy = localStorage.getItem(this.getStrategyStorageKey()) || '';
    this.searchLimit = parseInt(
      localStorage.getItem(this.getStorageKey('searchLimit')) || '10',
      10,
    );
  }

  private getStorageKey(prop: string): string {
    return `doc_${prop}_${this.storageKeyPrefix}`;
  }

  /**
   * Strategie-Key v2: die frueher gespeicherte Strategie (Default 'dense')
   * wird ignoriert, damit die App mit der ColBERT-Strategie startet, die
   * tatsaechlich verwendet wird.
   */
  private getStrategyStorageKey(): string {
    return this.getStorageKey('strategy_v2');
  }

  private getThresholdStorageKey(strategy: string): string {
    // v2: defaults changed for short manual queries; ignore values persisted
    // by the previous scale so the new defaults actually apply.
    return this.getStorageKey(`threshold_v2_${strategy}`);
  }

  get currentThresholdProfile(): ThresholdProfile {
    return (
      this.thresholdProfiles?.[this.strategy] ?? {
        strategy: this.strategy || 'default',
        label: 'Score-Schwelle',
        description: '',
        min: 0,
        max: 1,
        step: 0.01,
        default: 0.5,
        normalization: 'none',
        prefilterThreshold: 0,
      }
    );
  }

  /**
   * Applies the strategy-specific slider scale and restores the persisted
   * threshold for that strategy (or the calibrated default).
   */
  private applyThresholdProfile(): void {
    const profile = this.currentThresholdProfile;
    this.thresholdMin = profile.min;
    this.thresholdMax = profile.max;
    this.thresholdStep = profile.step;
    this.thresholdLabel = profile.label;

    // Wait for the backend profiles before choosing a default value.
    if (!this.thresholdProfiles) return;

    if (this.appliedThresholdStrategy !== this.strategy) {
      // Only per-strategy values are honoured. Legacy installations stored a
      // single `searchThreshold` (0.5) which would defeat the calibrated
      // per-strategy defaults, so it is intentionally ignored.
      const stored = localStorage.getItem(
        this.getThresholdStorageKey(this.strategy),
      );
      const parsed = stored !== null ? parseFloat(stored) : NaN;

      this.searchThreshold = Number.isFinite(parsed)
        ? this.clampThreshold(parsed, profile)
        : profile.default;
      this.appliedThresholdStrategy = this.strategy;
    } else {
      this.searchThreshold = this.clampThreshold(this.searchThreshold, profile);
    }
  }

  private clampThreshold(value: number, profile: ThresholdProfile): number {
    return Math.min(profile.max, Math.max(profile.min, value));
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (
      changes['availableEmbedders'] ||
      changes['thresholdProfiles'] ||
      changes['collectionCounts']
    ) {
      this.updateDefaults();
    }
  }

  private updateDefaults(): void {
    if (this.availableEmbedders) {
      if (!this.strategy || !this.availableEmbedders[this.strategy]) {
        // Default: ColBERT (Late Interaction) - die App ist auf Multivector-
        // Ingestion ausgelegt und das ist die Strategie mit den besten Scores.
        this.strategy = 'late_interaction';
      }

      // After the persisted values are loaded, make sure the active strategy
      // points at a collection that actually contains data. Otherwise a
      // comparison silently runs against an empty collection (e.g. Dense while
      // the documents were ingested with ColBERT) and only returns unrelated
      // hits instead of the compared document itself.
      if (this.isInitialized) {
        this.autoSelectStrategyWithData();
      }

      const stratData = this.availableEmbedders[this.strategy];
      const modelMap = stratData?.models || {};
      const models = Object.keys(modelMap);

      if (this.strategy === 'colbert_rerank') {
        this.selectedModel = 'jinaai/jina-colbert-v2';
      } else if (!this.selectedModel || !models.includes(this.selectedModel)) {
        this.selectedModel =
          stratData?.default || (models.length > 0 ? models[0] : '');
      }
    }

    this.applyThresholdProfile();

    if (this.isInitialized) {
      this.onModelChange();
    }
  }

  onModelChange(): void {
    if (!this.isInitialized) return;

    localStorage.setItem(
      this.getStorageKey('embeddingProvider'),
      this.selectedEmbeddingProvider,
    );
    localStorage.setItem(this.getStrategyStorageKey(), this.strategy);
    // Do not persist the fallback value before the backend profiles arrived.
    if (this.thresholdProfiles) {
      localStorage.setItem(
        this.getThresholdStorageKey(this.strategy),
        this.searchThreshold.toString(),
      );
    }
    localStorage.setItem(
      this.getStorageKey('searchLimit'),
      this.searchLimit.toString(),
    );

    this.ingestService
      .logModelSelection(this.strategy, this.selectedEmbeddingProvider)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe();
  }

  onProviderChange(): void {
    this.updateDefaults();
  }

  /**
   * Point count of a strategy's "best" collection (the one of its models with
   * the most points). Returns 0 if the strategy has no collection with data.
   */
  private strategyPointCount(strategy: string): number {
    const models = this.availableEmbedders?.[strategy]?.models ?? {};
    const counts = this.effectiveCollectionCounts;
    let max = 0;
    for (const collection of Object.values(models)) {
      const points = counts?.[collection as string] ?? 0;
      if (points > max) max = points;
    }
    return max;
  }

  /**
   * On the initial load only: if the persisted strategy has no data, switch to
   * the strategy/model that actually holds documents. Prevents the "document
   * not found, only similar ones" confusion when the DB was filled with one
   * strategy (e.g. ColBERT) but the UI still had another one selected (Dense).
   */
  private autoSelectStrategyWithData(): void {
    if (this.hasAutoSelectedWithData) return;
    if (!this.availableEmbedders) return;
    const counts = this.effectiveCollectionCounts;
    if (!counts || Object.keys(counts).length === 0) return;
    this.hasAutoSelectedWithData = true;

    if (this.strategyPointCount(this.strategy) > 0) return;

    const order = ['late_interaction', 'dense', 'colbert_rerank', 'rerank'];
    let bestStrategy = '';
    let bestPoints = 0;
    for (const candidate of order) {
      if (!this.availableEmbedders[candidate]) continue;
      const points = this.strategyPointCount(candidate);
      if (points > bestPoints) {
        bestPoints = points;
        bestStrategy = candidate;
      }
    }
    if (!bestStrategy || bestPoints === 0) return;

    const models = this.availableEmbedders[bestStrategy]?.models ?? {};
    let bestModel = this.availableEmbedders[bestStrategy]?.default ?? '';
    let bestModelPoints = -1;
    for (const [model, collection] of Object.entries(models)) {
      const points = counts[collection as string] ?? 0;
      if (points > bestModelPoints) {
        bestModelPoints = points;
        bestModel = model;
      }
    }

    console.log(
      `[VectorDbPanel] Auto-Select: '${this.strategy}' hat keine Daten, wechsle zu '${bestStrategy}' (${bestPoints} Punkte, Collection '${models[bestModel]}')`,
    );
    this.strategy = bestStrategy;
    this.selectedModel =
      bestStrategy === 'colbert_rerank' ? 'jinaai/jina-colbert-v2' : bestModel;
    this.applyThresholdProfile();
    this.onModelChange();
  }

  get activeCollectionName(): string {
    const models = this.availableEmbedders?.[this.strategy]?.models ?? {};
    return models[this.selectedModel] ?? '';
  }

  get effectiveCollectionCounts(): Record<string, number> | null {
    return this.liveCollectionCounts ?? this.collectionCounts;
  }

  get activeCollectionPoints(): number | null {
    const counts = this.effectiveCollectionCounts;
    if (!counts || !this.activeCollectionName) return null;
    return counts[this.activeCollectionName] ?? 0;
  }

  get showEmptyCollectionHint(): boolean {
    return (
      !!this.effectiveCollectionCounts &&
      !!this.activeCollectionName &&
      this.activeCollectionPoints === 0
    );
  }

  get populatedCollections(): string {
    const counts = this.effectiveCollectionCounts;
    if (!counts) return '';
    return Object.entries(counts)
      .filter(([, points]) => points > 0)
      .map(([name, points]) => `${name} (${points})`)
      .join(', ');
  }

  /**
   * Reloads the point counts of all collections so the UI always shows the
   * real state of the database (e.g. after an upload batch).
   */
  private refreshCollectionCounts(): void {
    this.ingestService
      .getModels()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.liveCollectionCounts = res.collections ?? {};
          // Die Datenlage hat sich geaendert (z. B. nach einem Upload oder
          // nach "Clear DB") -> Strategie erneut an die vorhandenen
          // Collections anpassen, damit Suche/Vergleich nicht ins Leere laufen.
          this.hasAutoSelectedWithData = false;
          this.autoSelectStrategyWithData();
        },
        error: () => {
          /* keep the previous counts */
        },
      });
  }

  performSearch(): void {
    if (!this.searchQuery.trim()) return;
    this.isSearching = true;
    this.searchError = null;
    this.queryResult = null;

    const limitValue = Number(this.searchLimit);
    console.log(
      `[VectorDbPanel] performSearch - Query: "${this.searchQuery}", Limit (Raw): ${this.searchLimit}, Limit (Num): ${limitValue}, Threshold: ${this.searchThreshold}`,
    );

    this.ingestService
      .queryDocuments({
        query: this.searchQuery.trim(),
        threshold: this.searchThreshold,
        vectorStore: this.selectedVectorStore,
        strategy: this.strategy,
        embeddingProvider: this.selectedEmbeddingProvider,
        limit: limitValue,
        model: this.selectedModel,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.isSearching = false;
          this.queryResult = res;
        },
        error: (err) => {
          this.isSearching = false;
          this.searchError = err.error?.message || 'Search failed.';
        },
      });
  }

  /**
   * ng-zorro 19.x uebergibt in beforeUpload/beforeCompare die rohe File-Instanz
   * (kein NzUploadFile-Wrapper). Beide Formen werden hier abgedeckt, sonst
   * werden Dateien stillschweigend verworfen.
   */
  private extractFile(file: unknown): File | null {
    if (!file) return null;
    if (file instanceof File) return file;
    const candidate = (file as any).file ?? (file as any).originFileObj ?? null;
    return candidate instanceof File ? candidate : null;
  }

  /**
   * ng-zorro calls this for every file picked via the file dialog. The upload
   * itself is done by our own queue (see enqueueUploads) so that the number of
   * parallel requests stays under control and the progress can be displayed.
   */
  beforeUpload = (file: NzUploadFile): Observable<boolean> => {
    const raw = this.extractFile(file);
    if (raw) {
      this.enqueueUploads([raw]);
    } else {
      this.errorMessages.push(
        `${(file as any)?.name ?? 'Datei'}: Datei konnte nicht gelesen werden.`,
      );
    }
    // false => ng-zorro must not upload the file itself
    return of(false);
  };

  // ---------------------------------------------------------------------------
  // Upload-Queue
  // ---------------------------------------------------------------------------

  private uploadQueue: File[] = [];
  private uploadActive = 0;
  private uploadSucceeded = 0;
  private uploadFailed = 0;
  private readonly uploadConcurrency = 4;

  private enqueueUploads(files: File[]): void {
    const accepted = files.filter((f) => this.isSupportedFile(f));
    if (accepted.length === 0) {
      this.msg.warning('Keine unterstützten Dateien gefunden (PDF, DOCX, MD).');
      return;
    }
    // Neuer Batch -> Meldungen des vorherigen Batches zurücksetzen.
    if (this.uploadActive === 0 && this.uploadQueue.length === 0) {
      this.errorMessages = [];
      this.uploadResults = [];
      this.uploadSummary = null;
    }
    this.uploadTotal += accepted.length;
    this.uploadQueue.push(...accepted);
    this.pumpUploadQueue();
  }

  private pumpUploadQueue(): void {
    while (
      this.uploadActive < this.uploadConcurrency &&
      this.uploadQueue.length > 0
    ) {
      const file = this.uploadQueue.shift() as File;
      this.uploadActive++;
      this.ingestService
        .uploadDocument(
          file,
          this.selectedVectorStore,
          this.strategy,
          this.selectedEmbeddingProvider,
          this.selectedModel,
        )
        .pipe(
          takeUntilDestroyed(this.destroyRef),
          finalize(() => {
            this.uploadActive--;
            this.pumpUploadQueue();
            this.uploadingCount = this.uploadActive + this.uploadQueue.length;
            if (this.uploadActive === 0 && this.uploadQueue.length === 0) {
              this.onUploadBatchFinished();
            }
          }),
        )
        .subscribe({
          next: (res) => {
            this.uploadSucceeded++;
            this.uploadDone++;
            this.uploadResults.push(res);
          },
          error: (err) => {
            this.uploadFailed++;
            this.uploadDone++;
            const errMsg = err.error?.message || 'Upload fehlgeschlagen.';
            this.errorMessages.push(`${file.name}: ${errMsg}`);
          },
        });
    }
    this.uploadingCount = this.uploadActive + this.uploadQueue.length;
  }

  private onUploadBatchFinished(): void {
    this.refreshCollectionCounts();
    this.uploadSummary = {
      indexed: this.uploadSucceeded,
      failed: this.uploadFailed,
    };
    if (this.uploadSucceeded > 0 || this.uploadFailed > 0) {
      this.msg.success(
        `${this.uploadSucceeded} Dokument(e) indexiert, ${this.uploadFailed} Fehler.`,
      );
    }
    this.uploadSucceeded = 0;
    this.uploadFailed = 0;
    this.uploadTotal = 0;
    this.uploadDone = 0;
  }

  private isSupportedFile(file: File): boolean {
    const name = (file.name || '').toLowerCase();
    if (name.endsWith('.md') || name.endsWith('.pdf') || name.endsWith('.docx')) {
      return true;
    }
    return [
      'text/markdown',
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ].includes(file.type);
  }

  // ---------------------------------------------------------------------------
  // Ordner-Drop
  // ---------------------------------------------------------------------------

  /**
   * Chromium's readEntries() returns at most 100 entries per call. ng-zorro
   * only calls it once, so uploading a folder silently lost everything after
   * the first 100 files. We intercept the drop in the capture phase (ng-zorro
   * never sees it) and collect the folder ourselves.
   */
  ngAfterViewInit(): void {
    this.ingestUpload?.nativeElement.addEventListener(
      'drop',
      (event: DragEvent) => this.onFolderDrop(event),
      true,
    );
  }

  private onFolderDrop(event: DragEvent): void {
    const dataTransfer = event.dataTransfer;
    if (!dataTransfer) return;
    event.preventDefault();
    event.stopPropagation();

    const entries: FileSystemEntry[] = [];
    for (const item of Array.from(dataTransfer.items ?? [])) {
      const entry = (item as any).webkitGetAsEntry?.();
      if (entry) entries.push(entry);
    }

    void (async () => {
      let files: File[] = [];
      for (const entry of entries) {
        await this.collectEntryFiles(entry, files);
      }
      if (files.length === 0) {
        files = Array.from(dataTransfer.files ?? []);
      }
      if (files.length === 0) {
        this.msg.warning('Keine Dateien im Drop gefunden.');
        return;
      }
      this.msg.info(
        `${files.length} Datei(en) erkannt - Upload wird gestartet.`,
      );
      this.enqueueUploads(files);
    })();
  }

  private collectEntryFiles(
    entry: FileSystemEntry,
    out: File[],
  ): Promise<void> {
    if (entry.isFile) {
      return new Promise<void>((resolve) => {
        (entry as FileSystemFileEntry).file(
          (file) => {
            out.push(file);
            resolve();
          },
          () => resolve(),
        );
      });
    }
    if (!entry.isDirectory) return Promise.resolve();

    const reader = (entry as FileSystemDirectoryEntry).createReader();
    return new Promise<void>((resolve) => {
      const readBatch = (): void => {
        reader.readEntries(
          (entries) => {
            // readEntries() liefert max. 100 Eintraege pro Aufruf - sie muss
            // so lange wiederholt werden, bis ein leeres Array kommt.
            if (!entries.length) {
              resolve();
              return;
            }
            Promise.all(
              entries.map((child) => this.collectEntryFiles(child, out)),
            ).then(readBatch);
          },
          () => resolve(),
        );
      };
      readBatch();
    });
  }

  clearDatabase(): void {
    this.isClearing = true;
    this.ingestService
      .clearDatabase(this.selectedVectorStore, this.strategy)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.isClearing = false;
          this.msg.success(res.message);
          this.queryResult = null;
          this.compareResult = null;
          this.refreshCollectionCounts();
        },
        error: (err) => {
          this.isClearing = false;
          this.msg.error(err.error?.message || 'Löschen fehlgeschlagen.');
        },
      });
  }

  beforeCompare = (file: NzUploadFile): boolean => {
    this.compareResult = null;
    this.compareError = null;
    this.compareFilename = (file as any)?.name ?? null;
    this.compareFile = this.extractFile(file);
    this.isComparing = true;

    if (this.compareFile) {
      this.runCompare(this.compareFile, this.compareFilename ?? 'Dokument');
    } else {
      this.isComparing = false;
      this.compareError = 'Datei konnte nicht gelesen werden.';
    }
    return false;
  };

  /**
   * Runs the comparison for a given file (raw File + display name).
   */
  private runCompare(file: File, displayName: string): void {
    this.isComparing = true;

    const limitValue = Number(this.searchLimit);
    console.log(
      `[VectorDbPanel] runCompare - File: ${displayName}, Limit: ${limitValue}`,
    );

    this.ingestService
      .compareDocument({
        file: file as any,
        vectorStore: this.selectedVectorStore,
        strategy: this.strategy,
        threshold: this.searchThreshold,
        embeddingProvider: this.selectedEmbeddingProvider,
        limit: limitValue,
        model: this.selectedModel,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.isComparing = false;
          this.compareResult = res;
        },
        error: (err) => {
          this.isComparing = false;
          this.compareError = err.error?.message || 'Comparison failed.';
        },
      });
  }

  /**
   * Indexes the compared document (it was not part of the collection) and
   * repeats the comparison - afterwards the document leads the ranking with
   * a score of 1.0.
   */
  indexAndCompareAgain(): void {
    if (!this.compareFile) return;
    this.isIndexingCompareFile = true;

    this.ingestService
      .uploadDocument(
        this.compareFile,
        this.selectedVectorStore,
        this.strategy,
        this.selectedEmbeddingProvider,
        this.selectedModel,
      )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.isIndexingCompareFile = false;
          this.msg.success(
            `${res.filename} wurde indexiert (${res.chunkCount} Chunks) - Vergleich wird wiederholt.`,
          );
          this.refreshCollectionCounts();
          this.runCompare(this.compareFile!, this.compareFilename ?? res.filename);
        },
        error: (err) => {
          this.isIndexingCompareFile = false;
          this.compareError = err.error?.message || 'Indexierung fehlgeschlagen.';
        },
      });
  }
}
