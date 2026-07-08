// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import { findMessageElement, scrollMessageIntoView } from './scroll-to-message';

function makeContainer(ids: string[]): HTMLElement {
  const container = document.createElement('div');
  for (const id of ids) {
    const li = document.createElement('li');
    li.id = id;
    container.appendChild(li);
  }
  return container;
}

describe('findMessageElement', () => {
  it('returns the element whose id matches the record id', () => {
    const container = makeContainer(['abc123', 'def456']);
    const el = findMessageElement(container, 'def456');
    expect(el).not.toBeNull();
    expect(el?.id).toBe('def456');
  });

  it('returns null when the record id is missing (temp chat / streaming)', () => {
    const container = makeContainer(['abc123']);
    expect(findMessageElement(container, undefined)).toBeNull();
    expect(findMessageElement(container, '')).toBeNull();
  });

  it('returns null when the message is not in the rendered page', () => {
    const container = makeContainer(['abc123']);
    expect(findMessageElement(container, 'not-loaded')).toBeNull();
  });

  it('returns null when there is no container', () => {
    expect(findMessageElement(null, 'abc123')).toBeNull();
  });

  it('does not break on ids containing CSS-special characters', () => {
    const container = makeContainer(['weird.id:with"chars']);
    const el = findMessageElement(container, 'weird.id:with"chars');
    expect(el?.id).toBe('weird.id:with"chars');
  });
});

describe('scrollMessageIntoView', () => {
  it('scrolls the found element into centre and reports true', () => {
    const container = makeContainer(['msg-1']);
    const target = container.querySelector<HTMLElement>('#msg-1')!;
    const scrollIntoView = vi.fn();
    target.scrollIntoView = scrollIntoView;

    expect(scrollMessageIntoView(container, 'msg-1')).toBe(true);
    expect(scrollIntoView).toHaveBeenCalledWith({
      block: 'center',
      behavior: 'smooth',
    });
  });

  it('honours the smooth=false flag', () => {
    const container = makeContainer(['msg-1']);
    const target = container.querySelector<HTMLElement>('#msg-1')!;
    const scrollIntoView = vi.fn();
    target.scrollIntoView = scrollIntoView;

    scrollMessageIntoView(container, 'msg-1', false);
    expect(scrollIntoView).toHaveBeenCalledWith({
      block: 'center',
      behavior: 'instant',
    });
  });

  it('reports false and does nothing when the target is absent', () => {
    const container = makeContainer(['msg-1']);
    expect(scrollMessageIntoView(container, 'missing')).toBe(false);
  });
});
