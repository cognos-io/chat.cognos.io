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
});
