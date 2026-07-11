import { Component, EventEmitter, Input, Output, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

export interface LinkableItem {
  id: string;
  primaryText: string;
  secondaryText?: string;
}

@Component({
  selector: 'app-entity-link-modal',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="elm-backdrop" (click)="close.emit()"></div>
    <div class="elm-panel">
      <div class="elm-header">
        <h3>{{ title }}</h3>
        <button class="elm-close" (click)="close.emit()" aria-label="Close">&times;</button>
      </div>

      <div class="elm-search">
        <input type="text" [ngModel]="query()" (ngModelChange)="query.set($event)"
               [placeholder]="searchPlaceholder">
      </div>

      <div class="elm-body">
        @if (suggested().length > 0) {
          <div class="elm-section-label">Suggested matches</div>
          @for (item of suggested(); track item.id) {
            <button class="elm-row" [disabled]="busy" (click)="link.emit(item.id)">
              <span class="elm-row-main">
                <span class="elm-row-title">{{ item.primaryText }}</span>
                @if (item.secondaryText) { <span class="elm-row-sub">{{ item.secondaryText }}</span> }
              </span>
              <span class="elm-badge">Suggested</span>
            </button>
          }
          <div class="elm-divider"></div>
        }

        @if (others().length > 0) {
          @for (item of others(); track item.id) {
            <button class="elm-row" [disabled]="busy" (click)="link.emit(item.id)">
              <span class="elm-row-main">
                <span class="elm-row-title">{{ item.primaryText }}</span>
                @if (item.secondaryText) { <span class="elm-row-sub">{{ item.secondaryText }}</span> }
              </span>
              <span class="elm-arrow">→</span>
            </button>
          }
        } @else if (suggested().length === 0) {
          <div class="elm-empty">{{ emptyText }}</div>
        }
      </div>

      <div class="elm-footer">
        <button class="elm-addnew" [disabled]="busy" (click)="addNew.emit()">
          + {{ addNewLabel }}
        </button>
      </div>
    </div>
  `,
  styles: [`
    .elm-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.4); backdrop-filter: blur(4px); z-index: 1000; }
    .elm-panel { position: fixed; top: 50%; left: 50%; transform: translate(-50%,-50%);
      width: 92%; max-width: 520px; max-height: 80vh; background: #fff; border-radius: 12px;
      box-shadow: 0 20px 25px -5px rgba(0,0,0,.1); z-index: 1001; display: flex; flex-direction: column; overflow: hidden; }
    .elm-header { display: flex; align-items: center; justify-content: space-between; padding: 1.25rem 1.5rem; border-bottom: 1px solid var(--border-light); }
    .elm-header h3 { margin: 0; font-size: 1.15rem; font-weight: 700; color: var(--navy-deep); }
    .elm-close { background: none; border: none; font-size: 1.5rem; line-height: 1; color: var(--gray); cursor: pointer; }
    .elm-search { padding: 1rem 1.5rem 0.5rem; }
    .elm-search input { width: 100%; padding: .625rem .875rem; border: 1px solid var(--border-light); border-radius: 8px; font-size: .875rem; }
    .elm-search input:focus { outline: none; border-color: var(--navy-deep); box-shadow: 0 0 0 3px rgba(10,37,64,.1); }
    .elm-body { overflow-y: auto; padding: .25rem .75rem 1rem; flex: 1; }
    .elm-section-label { font-size: .7rem; text-transform: uppercase; letter-spacing: .05em; color: var(--gray); font-weight: 600; padding: .5rem .75rem .25rem; }
    .elm-row { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: .75rem;
      background: none; border: none; text-align: left; padding: .75rem; border-radius: 8px; cursor: pointer; transition: background .15s; }
    .elm-row:hover:not(:disabled) { background: #f8fafc; }
    .elm-row:disabled { opacity: .5; cursor: default; }
    .elm-row-main { display: flex; flex-direction: column; min-width: 0; }
    .elm-row-title { font-weight: 600; color: var(--text-dark); }
    .elm-row-sub { font-size: .8125rem; color: var(--gray); }
    .elm-badge { flex-shrink: 0; font-size: .7rem; font-weight: 600; padding: .2rem .5rem; border-radius: 20px; background: rgba(26,124,74,.1); color: var(--green); }
    .elm-arrow { flex-shrink: 0; color: var(--navy-deep); font-weight: 700; }
    .elm-divider { height: 1px; background: var(--border-light); margin: .5rem .75rem; }
    .elm-empty { padding: 2rem 1rem; text-align: center; color: var(--gray); font-size: .875rem; }
    .elm-footer { padding: 1rem 1.5rem; border-top: 1px solid var(--border-light); background: #f8fafc; }
    .elm-addnew { width: 100%; padding: .625rem; border: 1px dashed var(--navy-deep); background: #fff; color: var(--navy-deep);
      border-radius: 8px; font-weight: 600; font-size: .875rem; cursor: pointer; }
    .elm-addnew:hover:not(:disabled) { background: var(--navy-deep); color: #fff; }
  `]
})
export class EntityLinkModalComponent {
  @Input() title = 'Link';
  @Input() addNewLabel = 'Add New';
  @Input() searchPlaceholder = 'Search…';
  @Input() emptyText = 'No matches found.';
  @Input() busy = false;
  @Input() set items(v: LinkableItem[]) { this._items.set(v || []); }
  @Input() set suggestedIds(v: string[]) { this._suggested.set(new Set(v || [])); }

  @Output() link = new EventEmitter<string>();
  @Output() addNew = new EventEmitter<void>();
  @Output() close = new EventEmitter<void>();

  private _items = signal<LinkableItem[]>([]);
  private _suggested = signal<Set<string>>(new Set());
  query = signal('');

  suggested = computed(() => this._items().filter(i => this._suggested().has(i.id)));
  others = computed(() => {
    const q = this.query().trim().toLowerCase();
    const sug = this._suggested();
    let list = this._items().filter(i => !sug.has(i.id));
    if (q) list = list.filter(i =>
      i.primaryText.toLowerCase().includes(q) || (i.secondaryText || '').toLowerCase().includes(q));
    return list;
  });
}
