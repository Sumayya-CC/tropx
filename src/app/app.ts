import { Component, effect, inject, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Title, Meta } from '@angular/platform-browser';
import { SettingsService } from './core/services/settings.service';
import { ToastComponent } from './shared/components/toast/toast.component';
import { MonitoringContextService } from './core/monitoring/monitoring-context.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, ToastComponent],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
  protected readonly title = signal('tropx');

  private readonly titleService = inject(Title);
  private readonly meta = inject(Meta);
  private readonly settingsService = inject(SettingsService);
  // Injected only to force eager instantiation — it has no template
  // output. Keeps Sentry's user context synced with the signed-in role.
  private readonly monitoringContext = inject(MonitoringContextService);

  constructor() {
    effect(() => {
      const logoUrl = this.settingsService.business().logoUrl;
      const tradingName = this.settingsService.business().tradingName;

      // 1. Set document <title>
      this.titleService.setTitle(`${tradingName || 'Tropx Wholesale'} | Wholesale Portal`);

      // 2. Dynamically set favicon
      const link: HTMLLinkElement =
        document.querySelector("link[rel*='icon']") ||
        document.createElement('link');
      link.type = 'image/png';
      link.rel = 'shortcut icon';
      link.href = logoUrl || 'favicon.ico';
      document.head.appendChild(link);

      // 3. Update og:title meta tag
      this.meta.updateTag({
        property: 'og:title',
        content: tradingName || 'Tropx Wholesale'
      });
    });
  }
}
