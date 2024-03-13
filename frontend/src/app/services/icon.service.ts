import { Injectable, inject } from '@angular/core';
import { MatIconRegistry } from '@angular/material/icon';

@Injectable({
  providedIn: 'root',
})
export class IconService {
  matIconRegistry = inject(MatIconRegistry);

  constructor() {
    this.matIconRegistry.registerFontClassAlias('bootstrap', 'bi');
    this.matIconRegistry.setDefaultFontSetClass('bi');
  }
}
