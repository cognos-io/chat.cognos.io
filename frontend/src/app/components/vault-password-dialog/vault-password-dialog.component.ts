import { Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatInputModule } from '@angular/material/input';

import { VaultService } from '../../services/vault.service';

@Component({
  selector: 'app-vault-password-dialog',
  standalone: true,
  imports: [MatButtonModule, ReactiveFormsModule, MatInputModule],
  templateUrl: './vault-password-dialog.component.html',
  styleUrl: './vault-password-dialog.component.scss',
})
export class VaultPasswordDialogComponent {
  vaultService = inject(VaultService);

  fb = inject(FormBuilder);

  vaultPasswordForm = this.fb.group({
    vaultPassword: ['', [Validators.required, Validators.minLength(8)]],
  });
}
