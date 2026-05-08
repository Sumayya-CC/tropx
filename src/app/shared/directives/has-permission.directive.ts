import { Directive, inject, input, TemplateRef, ViewContainerRef, effect } from '@angular/core';
import { AuthService } from '../../core/services/auth.service';

@Directive({
  selector: '[appHasPermission]',
  standalone: true,
})
export class HasPermissionDirective {
  private readonly _tpl = inject(TemplateRef);
  private readonly _vcr = inject(ViewContainerRef);
  private readonly _auth = inject(AuthService);

  appHasPermission = input<string>('');

  constructor() {
    // effect() reacts to both input signal and auth profile signal changes
    effect(() => {
      const permission = this.appHasPermission();
      const allowed = permission ? this._auth.hasPermission(permission) : false;

      this._vcr.clear();
      if (allowed) this._vcr.createEmbeddedView(this._tpl);
    });
  }
}
