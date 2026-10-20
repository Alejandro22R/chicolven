import { createContext } from 'preact';
import { useContext } from 'preact/hooks';
import type { Category, RateInfo, ScreenStatus, Settings } from '@chicolven/shared/types';

export interface AppState {
  settings: Settings | null;
  rate: RateInfo | null;
  categories: Category[];
  screenStatus: ScreenStatus[];
  defaultPin: boolean;
  /** Bumped when the server reports a content change; pages refetch on it. */
  revision: number;
  reloadShared: () => Promise<void>;
  toast: (message: string, kind?: 'ok' | 'error') => void;
}

export const AppContext = createContext<AppState>(null as unknown as AppState);
export const useApp = () => useContext(AppContext);
