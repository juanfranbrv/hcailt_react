import { create } from 'zustand';
import type { Provider } from '../types';

export type InputMethod = 'upload' | 'sample-medical' | 'sample-non-medical';

type State = {
  provider: Provider;
  model: string;
  tempMt: number;
  tempPlain: number;
  tempQe: number;
  inputMethod: InputMethod;
};

type Actions = {
  setProvider: (provider: Provider) => void;
  setModel: (model: string) => void;
  setInputMethod: (method: InputMethod) => void;
  setTemps: (temps: Partial<Pick<State, 'tempMt' | 'tempPlain' | 'tempQe'>>) => void;
};

export const providerModels: Record<Provider, string[]> = {
  openai: ['gpt-5.1', 'gpt-5-mini'],
  google: ['models/gemini-2.5-flash', 'models/gemini-flash-lite-latest'],
  groq: ['openai/gpt-oss-120b'],
  fireworks: ['accounts/fireworks/models/deepseek-v3p1-terminus'],
};

const defaultProvider: Provider = 'openai';

export const useAppStore = create<State & Actions>((set, get) => ({
  provider: defaultProvider,
  model: providerModels[defaultProvider][0],
  tempMt: 0.3,
  tempPlain: 0.7,
  tempQe: 0.2,
  inputMethod: 'upload',
  setProvider: (provider) =>
    set(() => ({
      provider,
      model: providerModels[provider][0],
    })),
  setModel: (model) => set(() => ({ model })),
  setInputMethod: (method) => set(() => ({ inputMethod: method })),
  setTemps: (temps) => set(() => ({ ...temps })),
  get state() {
    return get();
  },
}));