import { Injectable, inject } from '@angular/core';
import { serverTimestamp } from '@angular/fire/firestore';
import { FirestoreService } from './firestore.service';
import { AuthService } from './auth.service';
import { Shop, PipelineStage, PipelineHistoryEntry } from '../models/shop.model';

@Injectable({ providedIn: 'root' })
export class PipelineService {
  private readonly firestore = inject(FirestoreService);
  private readonly auth = inject(AuthService);

  /** Change a prospect's stage: stamp enteredStageAt + append to history. */
  async changeStage(shop: Shop, newStage: PipelineStage): Promise<void> {
    if (shop.pipelineStage === newStage) return;
    const by = this.auth.getActionBy();
    const now = new Date();
    const entry: PipelineHistoryEntry = { stage: newStage, enteredAt: now, by: by ?? undefined };
    const history = [...(shop.pipelineHistory || []), entry];
    await this.firestore.updateDocument(`shops/${shop.id}`, {
      pipelineStage: newStage,
      pipelineEnteredStageAt: serverTimestamp(),
      pipelineHistory: history.map(h => ({
        stage: h.stage,
        // serverTimestamp() can't go inside an array; store the client Date for history entries.
        enteredAt: h.enteredAt,
        by: h.by ?? null,
      })),
    });
  }

  async setNextAction(shopId: string, date: Date | null, note: string | null): Promise<void> {
    await this.firestore.updateDocument(`shops/${shopId}`, {
      nextActionDate: date,
      nextActionNote: note?.trim() || null,
    });
  }

  async clearNextAction(shopId: string): Promise<void> {
    await this.firestore.updateDocument(`shops/${shopId}`, {
      nextActionDate: null,
      nextActionNote: null,
    });
  }

  async setPriority(shopId: string, priority: 'low' | 'medium' | 'high' | null): Promise<void> {
    await this.firestore.updateDocument(`shops/${shopId}`, { pipelinePriority: priority });
  }
}
