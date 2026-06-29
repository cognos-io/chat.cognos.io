import { TestBed } from '@angular/core/testing';

import { describe, expect, it } from 'vitest';

import type { CognosVaultFile } from '../vault.types';
import { CognosVaultListRowComponent } from './vault-list-row.component';

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

describe('CognosVaultListRowComponent', () => {
  function render(file: CognosVaultFile = FILE) {
    const fixture = TestBed.createComponent(CognosVaultListRowComponent);
    fixture.componentRef.setInput('file', file);
    fixture.detectChanges();
    return fixture;
  }

  it('renders the built-in English reference text by default', () => {
    expect(
      render().nativeElement.querySelector('.cog-vault-list-row__refs')?.textContent,
    ).toContain('3 chats');
  });

  it('overrides the reference text when refsText is provided', () => {
    const fixture = render();
    fixture.componentRef.setInput('refsText', 'In 3 chats');
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('.cog-vault-list-row__refs')?.textContent,
    ).toContain('In 3 chats');
  });

  it('hides the reference line when refsText is an empty string', () => {
    const fixture = render();
    fixture.componentRef.setInput('refsText', '');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.cog-vault-list-row__refs')).toBeNull();
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
      'button.cog-vault-list-row__refs',
    ) as HTMLButtonElement | null;
    expect(refs).not.toBeNull();
    refs?.click();
    expect(clicked).toBe(1);
  });

  it('emits open when the row itself is clicked', () => {
    const fixture = render();
    let opened: string | undefined;
    fixture.componentInstance.open.subscribe((file) => (opened = file.id));

    (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLElement>('.cog-vault-list-row')
      ?.click();

    expect(opened).toBe('v1');
  });

  it('does not emit open when the interactive reference button is clicked', () => {
    const fixture = render();
    fixture.componentRef.setInput('refsInteractive', true);
    fixture.detectChanges();
    let opened = 0;
    fixture.componentInstance.open.subscribe(() => (opened += 1));

    (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('button.cog-vault-list-row__refs')
      ?.click();

    expect(opened).toBe(0);
  });
});
