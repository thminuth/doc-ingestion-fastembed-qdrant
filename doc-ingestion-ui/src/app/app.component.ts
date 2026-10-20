import { CommonModule } from '@angular/common';
import { Component, DestroyRef, inject, OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzSpinModule } from 'ng-zorro-antd/spin';
import { IngestService } from './ingest.service';
import { ThresholdProfile } from './ingest.service';
import { VectorDbPanelComponent } from './vector-db-panel/vector-db-panel.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, NzSpinModule, VectorDbPanelComponent],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css'],
})
export class AppComponent implements OnInit {
  availableEmbedders: any = null;
  thresholdProfiles: Record<string, ThresholdProfile> | null = null;
  collectionCounts: Record<string, number> = {};
  isLoadingModels = true;
  private destroyRef = inject(DestroyRef);

  constructor(
    private msg: NzMessageService,
    private ingestService: IngestService,
  ) {}

  ngOnInit(): void {
    this.ingestService
      .getModels()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.availableEmbedders = res.embedders;
          this.thresholdProfiles = res.thresholds;
          this.collectionCounts = res.collections ?? {};
          this.isLoadingModels = false;
          console.log(
            '[AppComponent] Modelle geladen:',
            Object.keys(res.embedders ?? {}).length,
            'Strategien, Collections:',
            this.collectionCounts,
          );
        },
        error: () => {
          this.isLoadingModels = false;
          this.msg.error('Konnte keine Embedding-Modelle laden.');
        },
      });
  }
}
