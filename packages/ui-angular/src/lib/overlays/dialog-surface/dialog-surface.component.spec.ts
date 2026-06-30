import { TestBed } from '@angular/core/testing';

import { describe, expect, it } from 'vitest';

import { CognosDialogSurfaceComponent } from './dialog-surface.component';

describe('CognosDialogSurfaceComponent', () => {
  function render(width: number | null = null) {
    const fixture = TestBed.createComponent(CognosDialogSurfaceComponent);
    fixture.componentRef.setInput('title', 'Edit conversation');
    fixture.componentRef.setInput('width', width);
    fixture.detectChanges();
    return fixture;
  }

  const surface = (fixture: ReturnType<typeof render>) =>
    fixture.nativeElement.querySelector('.cog-dialog-surface') as HTMLElement;

  const widthVar = (fixture: ReturnType<typeof render>) =>
    surface(fixture).style.getPropertyValue('--_surface-width').trim();

  it('shrinks to fit content when no width is set', () => {
    const fixture = render(null);

    expect(widthVar(fixture)).toBe('');
  });

  it('applies a responsive clamp when a width is set', () => {
    const fixture = render(560);

    expect(widthVar(fixture)).toBe('min(560px, calc(100vw - 32px))');
  });
});
