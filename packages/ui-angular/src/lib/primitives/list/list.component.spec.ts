import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { describe, expect, it } from 'vitest';

import { CognosListItemComponent } from './list-item.component';
import { CognosListComponent } from './list.component';

@Component({
  standalone: true,
  imports: [CognosListComponent, CognosListItemComponent],
  template: `
    <cog-list>
      <cog-list-item>A</cog-list-item>
      <cog-list-item>B</cog-list-item>
    </cog-list>
  `,
})
class HostComponent {}

describe('CognosListComponent', () => {
  it('exposes list / listitem roles for assistive tech', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const list = fixture.nativeElement.querySelector('cog-list') as HTMLElement;
    const items = fixture.nativeElement.querySelectorAll('cog-list-item');

    expect(list.getAttribute('role')).toBe('list');
    expect(items).toHaveLength(2);
    expect((items[0] as HTMLElement).getAttribute('role')).toBe('listitem');
  });
});
