import { CommonModule } from '@angular/common';
import {
  Component,
  DestroyRef,
  Input,
  OnChanges,
  OnInit,
  SimpleChanges,
  inject,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Observable } from 'rxjs';

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

import { IngestService, QueryResult, UploadResult } from '../ingest.service';

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
export class VectorDbPanelComponent implements OnInit, OnChanges {
  @Input() availableEmbedders: any = null;
  @Input() storageKeyPrefix: string = 'panel1';

  uploadingCount = 0;
  get isUploading(): boolean {
    return this.uploadingCount > 0;
  }
  isClearing = false;

  selectedVectorStore: 'qdrant' = 'qdrant';
  selectedEmbeddingProvider: 'fastembed' = 'fastembed';
  strategy = '';
  selectedModel = '';
  uploadResults: UploadResult[] = [];
  errorMessages: string[] = [];

  get currentFastEmbedModels(): string[] {
    if (!this.availableEmbedders || !this.availableEmbedders[this.strategy])
      return [];
    return Object.keys(this.availableEmbedders[this.strategy].models || {});
  }

  private isInitialized = false;

  // Search state
  searchQuery = '';
  searchThreshold = 0.5;
  searchLimit = 10;
  isSearching = false;
  queryResult: QueryResult | null = null;
  searchError: string | null = null;

  // Compare state
  isComparing = false;
  compareResult: { store: string; results: any[] } | null = null;
  compareError: string | null = null;
  compareFilename: string | null = null;

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
    this.strategy = localStorage.getItem(this.getStorageKey('strategy')) || '';
    this.searchThreshold = parseFloat(
      localStorage.getItem(this.getStorageKey('searchThreshold')) || '0.5',
    );
    this.searchLimit = parseInt(
      localStorage.getItem(this.getStorageKey('searchLimit')) || '10',
      10,
    );
  }

  private getStorageKey(prop: string): string {
    return `doc_${prop}_${this.storageKeyPrefix}`;
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['availableEmbedders']) {
      this.updateDefaults();
    }
  }

  private updateDefaults(): void {
    if (this.availableEmbedders) {
      if (!this.strategy || !this.availableEmbedders[this.strategy]) {
        this.strategy = 'dense';
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
    localStorage.setItem(this.getStorageKey('strategy'), this.strategy);
    localStorage.setItem(
      this.getStorageKey('searchThreshold'),
      this.searchThreshold.toString(),
    );
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

  beforeUpload = (file: NzUploadFile): Observable<boolean> => {
    return new Observable((observer) => {
      this.uploadingCount++;
      this.ingestService
        .uploadDocument(
          file as any,
          this.selectedVectorStore,
          this.strategy,
          this.selectedEmbeddingProvider,
          this.selectedModel,
        )
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (res) => {
            this.uploadingCount--;
            this.uploadResults.push(res);
            this.msg.success(
              `${res.filename} erfolgreich indexiert (${res.chunkCount} Chunks)`,
            );
            observer.next(false);
            observer.complete();
          },
          error: (err) => {
            this.uploadingCount--;
            const errMsg = err.error?.message || 'Upload fehlgeschlagen.';
            this.errorMessages.push(`${file.name}: ${errMsg}`);
            this.msg.error(errMsg);
            observer.next(false);
            observer.complete();
          },
        });
    });
  };

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
    this.compareFilename = file.name || null;
    this.isComparing = true;

    const limitValue = Number(this.searchLimit);
    console.log(
      `[VectorDbPanel] beforeCompare - File: ${this.compareFilename}, Limit: ${limitValue}`,
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
    return false;
  };
}
