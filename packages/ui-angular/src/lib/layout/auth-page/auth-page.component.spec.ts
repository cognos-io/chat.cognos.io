import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { describe, expect, it } from 'vitest';

import { CognosAuthPageComponent } from './auth-page.component';

@Component({
  standalone: true,
  imports: [CognosAuthPageComponent],
  template: `
    <cog-auth-page>
      <h1 class="auth-page__title">Welcome</h1>
    </cog-auth-page>
  `,
})
class HostComponent {}

describe('CognosAuthPageComponent', () => {
  it('renders the centred auth card around projected content', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const card = fixture.nativeElement.querySelector('.auth-page__card');
    expect(card).not.toBeNull();
    expect(card.querySelector('.auth-page__title')?.textContent).toContain('Welcome');
  });
});
