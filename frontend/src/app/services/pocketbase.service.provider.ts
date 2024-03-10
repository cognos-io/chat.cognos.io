import { environment } from '../../environments/environment';
import { TypedPocketBase } from '../types/pocketbase-types';
import PocketBase from 'pocketbase';

const pocketbaseFactory = () => {
  return new PocketBase(environment.pocketbaseBaseUrl) as TypedPocketBase;
};

export const providePocketbase = () => {
  return {
    provide: PocketBase,
    useFactory: pocketbaseFactory,
  };
};
