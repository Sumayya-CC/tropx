import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { PortalNavbarComponent } from '../../../shared/components/portal-navbar/portal-navbar.component';

@Component({
  selector: 'app-portal-shell',
  standalone: true,
  imports: [RouterOutlet, PortalNavbarComponent],
  templateUrl: './portal-shell.component.html',
  styleUrl: './portal-shell.component.scss'
})
export class PortalShellComponent {}
