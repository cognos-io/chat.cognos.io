import { TestBed } from '@angular/core/testing';

import { describe, expect, it } from 'vitest';

import {
  type BookmarkListItem,
  CognosBookmarkListComponent,
} from './bookmark-list.component';

const LABELS = { empty: 'Nothing saved yet.', jump: 'Jump', remove: 'Remove' };

const ITEMS: BookmarkListItem[] = [
  { id: 'a', quote: 'First highlight', note: 'a note' },
  { id: 'b', quote: 'Second highlight' },
];

function render(inputs: Record<string, unknown>) {
  const fixture = TestBed.createComponent(CognosBookmarkListComponent);
  fixture.componentRef.setInput('labels', LABELS);
  for (const [key, value] of Object.entries(inputs)) {
    fixture.componentRef.setInput(key, value);
  }
  fixture.detectChanges();
  return fixture;
}

describe('CognosBookmarkListComponent', () => {
  it('shows the empty label when there are no bookmarks', () => {
    const fixture = render({ bookmarks: [] });
    const root = fixture.nativeElement as HTMLElement;

    expect(root.querySelector('.cog-bookmark-list')).toBeNull();
    expect(root.querySelector('.cog-bookmark-list__empty')?.textContent).toContain(
      'Nothing saved yet.',
    );
  });

  it('renders a row per bookmark with quote and optional note', () => {
    const fixture = render({ bookmarks: ITEMS });
    const root = fixture.nativeElement as HTMLElement;

    const rows = root.querySelectorAll('.cog-bookmark-list__item');
    expect(rows.length).toBe(2);
    expect(rows[0].querySelector('.cog-bookmark-list__quote')?.textContent).toContain(
      'First highlight',
    );
    expect(rows[0].querySelector('.cog-bookmark-list__note')?.textContent).toContain(
      'a note',
    );
    // Second has no note.
    expect(rows[1].querySelector('.cog-bookmark-list__note')).toBeNull();
  });

  it('emits jump and remove with the bookmark id', () => {
    const fixture = render({ bookmarks: ITEMS });
    let jumped = '';
    let removed = '';
    fixture.componentInstance.jump.subscribe((id: string) => (jumped = id));
    fixture.componentInstance.remove.subscribe((id: string) => (removed = id));

    const buttons = [
      ...fixture.nativeElement.querySelectorAll(
        '.cog-bookmark-list__item cog-button button',
      ),
    ] as HTMLButtonElement[];
    // First row: [Jump, Remove].
    buttons[0].click();
    expect(jumped).toBe('a');
    buttons[1].click();
    expect(removed).toBe('a');
  });
});
