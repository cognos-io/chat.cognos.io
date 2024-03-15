import PocketBase from 'pocketbase';

import { environment } from '../../environments/environment';
import { TypedPocketBase } from '../types/pocketbase-types';

const pocketbaseFactory = () => {
  return new PocketBase(environment.pocketbaseBaseUrl) as TypedPocketBase;
};

export const providePocketbase = () => {
  return {
    provide: PocketBase,
    useFactory: pocketbaseFactory,
  };
};
