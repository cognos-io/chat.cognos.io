import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { ConversationImportClient } from '@app/import/conversation-import-client';
import { ConversationImportPersistence } from '@app/import/conversation-import-persistence';
import { Analytics } from '@app/services/analytics/analytics';

import { ConversationImport } from './conversation-import';

describe('ConversationImport', () => {
  let component: ConversationImport;
  let fixture: ComponentFixture<ConversationImport>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ConversationImport],
      providers: [
        provideRouter([]),
        {
          provide: ConversationImportClient,
          useValue: { cancel: vi.fn(), parse: vi.fn() },
        },
        {
          provide: ConversationImportPersistence,
          useValue: { persist: vi.fn() },
        },
        { provide: Analytics, useValue: { track: vi.fn(), page: vi.fn() } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ConversationImport);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('shows source choices before source-specific instructions', () => {
    expect(fixture.nativeElement.textContent).toContain('ChatGPT');
    expect(fixture.nativeElement.textContent).toContain('Claude');
    expect(fixture.nativeElement.querySelector('input[type="file"]')).toBeNull();

    component.chooseSource('claude');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('input[type="file"]')).toBeTruthy();
  });
});
