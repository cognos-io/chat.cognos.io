import { Dialog } from '@angular/cdk/dialog';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';

import { CognosToastService } from '@cognos/ui-angular';

import { VaultService } from '@app/services/vault.service';

import { SidebarAccountActionsComponent } from './sidebar-account-actions.component';

describe('SidebarAccountActionsComponent', () => {
  let fixture: ComponentFixture<SidebarAccountActionsComponent>;
  let component: SidebarAccountActionsComponent;

  const dialog = { open: vi.fn() };
  const vault = { lock: vi.fn() };
  const toast = { notify: vi.fn() };
  const router = { navigate: vi.fn().mockResolvedValue(true) };

  beforeEach(async () => {
    dialog.open.mockReset();
    vault.lock.mockReset();
    toast.notify.mockReset();
    router.navigate.mockReset().mockResolvedValue(true);

    await TestBed.configureTestingModule({
      imports: [SidebarAccountActionsComponent],
      providers: [
        { provide: Dialog, useValue: dialog },
        { provide: VaultService, useValue: vault },
        { provide: CognosToastService, useValue: toast },
        { provide: Router, useValue: router },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SidebarAccountActionsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  const clickButton = (text: string): void => {
    const buttons = Array.from(
      fixture.nativeElement.querySelectorAll('button'),
    ) as HTMLButtonElement[];
    const match = buttons.find((b) => b.textContent?.trim().includes(text));
    if (!match) {
      throw new Error(`No button with text "${text}"`);
    }
    match.click();
  };

  // Sunny: all three actions render.
  it('renders Help, Lock and Log out', () => {
    const labels = Array.from(fixture.nativeElement.querySelectorAll('button')).map(
      (b) => (b as HTMLButtonElement).textContent?.trim(),
    );
    expect(labels).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Help'),
        expect.stringContaining('Lock'),
        expect.stringContaining('Log out'),
      ]),
    );
  });

  // Sunny: Lock locks the vault, shows a toast and signals the host.
  it('locks the vault and emits actioned', () => {
    const actioned = vi.fn();
    component.actioned.subscribe(actioned);

    clickButton('Lock');

    expect(vault.lock).toHaveBeenCalledOnce();
    expect(toast.notify).toHaveBeenCalledOnce();
    expect(actioned).toHaveBeenCalledOnce();
  });

  // Sunny: Log out routes to the logout flow.
  it('navigates to the logout route', () => {
    clickButton('Log out');

    expect(router.navigate).toHaveBeenCalledWith(['', 'auth', 'logout']);
  });

  // Sunny: Help opens the contact dialog.
  it('opens the help dialog', () => {
    clickButton('Help');

    expect(dialog.open).toHaveBeenCalledOnce();
  });
});
