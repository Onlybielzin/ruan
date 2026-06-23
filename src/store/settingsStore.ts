// F20 — Store Zustand das configuracoes GLOBAIS do app (AppSettings). Persiste
// no localStorage do webview (decisao M4: simplicidade, sem comando Tauri novo,
// igual ao tabsStore). A logica pura de normalizacao/composicao vive em
// `lib/settings.ts` (alvo de mutation); aqui so guardamos estado, persistimos e
// expomos acoes de set.
//
// A aplicacao do TEMA/FONTE no root e da Integracao (App.tsx): ela observa
// `theme`/`fontSize` e reflete num atributo/classe do elemento raiz.

import { create } from "zustand";
import type { AppSettings, Theme } from "../lib/settings";
import { APP_SETTINGS_PADRAO, normalizarAppSettings } from "../lib/settings";

const STORAGE_KEY = "ruan.settings.v1";

interface SettingsStoreState {
  /** Config global atual (sempre normalizada/saneada). */
  settings: AppSettings;

  /** Substitui um subconjunto dos campos (patch generico) e persiste. */
  atualizar: (patch: Partial<AppSettings>) => void;
  /** Acucar tipado por campo (UI fina chama estes). */
  setProxy: (proxy: string) => void;
  setSslVerify: (sslVerify: boolean) => void;
  setTimeoutMs: (timeoutMs: number) => void;
  setTheme: (theme: Theme) => void;
  setFontSize: (fontSize: number) => void;
  /** Restaura os defaults de fabrica. */
  resetar: () => void;
}

/** Le e normaliza o estado persistido. Best-effort: nunca lanca. */
export function lerPersistido(): AppSettings {
  try {
    const cru = localStorage.getItem(STORAGE_KEY);
    if (cru === null) return { ...APP_SETTINGS_PADRAO };
    return normalizarAppSettings(JSON.parse(cru));
  } catch {
    return { ...APP_SETTINGS_PADRAO };
  }
}

/** Persiste a config. Best-effort: erro (storage cheio/off) nao quebra a UI. */
function persistir(settings: AppSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // ignora
  }
}

export const useSettingsStore = create<SettingsStoreState>((set, get) => ({
  settings: lerPersistido(),

  atualizar: (patch) => {
    // Renormaliza apos o merge: garante saneamento mesmo se a UI mandar lixo.
    const settings = normalizarAppSettings({ ...get().settings, ...patch });
    persistir(settings);
    set({ settings });
  },

  setProxy: (proxy) => get().atualizar({ proxy }),
  setSslVerify: (sslVerify) => get().atualizar({ sslVerify }),
  setTimeoutMs: (timeoutMs) => get().atualizar({ timeoutMs }),
  setTheme: (theme) => get().atualizar({ theme }),
  setFontSize: (fontSize) => get().atualizar({ fontSize }),

  resetar: () => {
    const settings = { ...APP_SETTINGS_PADRAO };
    persistir(settings);
    set({ settings });
  },
}));
