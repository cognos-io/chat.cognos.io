import { TestBed } from '@angular/core/testing';

import { describe, expect, it } from 'vitest';

import { CognosDialogActionsComponent } from './dialog-actions.component';

describe('CognosDialogActionsComponent', () => {
  it('defaults to an end-aligned inline row', () => {
    const fixture = TestBed.createComponent(CognosDialogActionsComponent);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.className).toContain('cog-dialog-actions--end');
    expect(host.className).toContain('cog-dialog-actions--m-inline');
  });

  it('reflects the configured align and mobile layout', () => {
    const fixture = TestBed.createComponent(CognosDialogActionsComponent);
    fixture.componentRef.setInput('align', 'between');
    fixture.componentRef.setInput('mobile', 'split');
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.className).toContain('cog-dialog-actions--between');
    expect(host.className).toContain('cog-dialog-actions--m-split');
  });
});
