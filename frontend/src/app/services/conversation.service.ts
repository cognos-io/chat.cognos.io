import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

interface ConversationState {}

@Injectable({
  providedIn: 'root',
})
export class ConversationService {
  // sources
  readonly conversation$ = new Subject();

  constructor() {}
}
