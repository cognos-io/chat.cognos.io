import { TestBed } from '@angular/core/testing';

import { describe, expect, it } from 'vitest';

import type { CognosVaultFile } from '../vault.types';
import { CognosVaultCardComponent } from './vault-card.component';

const FILE: CognosVaultFile = {
  id: 'v1',
  name: 'Tenancy agreement.pdf',
  ext: 'pdf',
  size: '1.2 MB',
  meta: 'PDF',
  kind: 'doc',
  refs: 3,
  when: '2 weeks ago',
};

describe('CognosVaultCardComponent', () => {
  function render(file: CognosVaultFile = FILE) {
    const fixture = TestBed.createComponent(CognosVaultCardComponent);
    fixture.componentRef.setInput('file', file);
    fixture.detectChanges();
    return fixture;
  }

  it('renders the built-in English reference text by default', () => {
    const referenced = render();
    expect(
      referenced.nativeElement.querySelector('.cog-vault-card__refs')?.textContent,
    ).toContain('In 3 chats');

    const unreferenced = render({ ...FILE, refs: 0 });
    expect(
      unreferenced.nativeElement.querySelector('.cog-vault-card__refs')?.textContent,
    ).toContain('Not referenced');
  });

  it('overrides the reference text when refsText is provided', () => {
    const fixture = render();
    fixture.componentRef.setInput('refsText', 'In 3 chats (translated)');
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('.cog-vault-card__refs')?.textContent,
    ).toContain('In 3 chats (translated)');
  });

  it('hides the reference line when refsText is an empty string', () => {
    const fixture = render();
    fixture.componentRef.setInput('refsText', '');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.cog-vault-card__refs')).toBeNull();
  });

  it('uses moreLabel as the accessible label of the more button', () => {
    const fixture = render();
    fixture.componentRef.setInput('moreLabel', 'File actions');
    fixture.detectChanges();

    const more = fixture.nativeElement.querySelector('button[aria-label]');
    expect(more?.getAttribute('aria-label')).toBe('File actions');
  });

  it('renders the reference line as a button and emits refsClick when interactive', () => {
    const fixture = render();
    fixture.componentRef.setInput('refsInteractive', true);
    fixture.detectChanges();

    let clicked = 0;
    fixture.componentInstance.refsClick.subscribe(() => (clicked += 1));

    const refs = (fixture.nativeElement as HTMLElement).querySelector(
      'button.cog-vault-card__refs',
    ) as HTMLButtonElement | null;
    expect(refs).not.toBeNull();
    refs?.click();
    expect(clicked).toBe(1);
  });
});
