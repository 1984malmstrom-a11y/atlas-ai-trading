import { VictorDataProvider } from './types';

const providers: VictorDataProvider[] = [];

export function registerProvider(p: VictorDataProvider){
  if (!providers.find(x=> x.providerId === p.providerId)) providers.push(p);
}

export function getProviders(): VictorDataProvider[]{
  return providers.slice();
}

export function clearProviders(){ providers.length = 0; }

const registry = { registerProvider, getProviders, clearProviders };
export default registry;
