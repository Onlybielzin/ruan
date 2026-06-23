// F14 — Store Zustand do cookie jar. Espelha o estado do backend (lista de
// cookies + toggle on/off) e expõe acoes que invocam os comandos Tauri.
//
// O backend (reqwest::cookie::Jar) NAO itera cookies sozinho: para listar, ele
// precisa dos DOMINIOS de interesse. Mantemos aqui um conjunto de dominios
// "vistos" (host das URLs das requests enviadas) e o passamos ao comando
// list_cookies. O App.tsx (Integracao) deve chamar `registrarDominio(host)`
// apos cada envio bem-sucedido para o jar ficar visivel na UI.

import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

/** Um cookie como exposto pelo backend (camelCase, espelha CookieInfo). */
export interface CookieInfo {
  dominio: string;
  nome: string;
  valor: string;
  path: string;
  secure: boolean;
}

// ---- Wrappers IPC (cada um = um #[tauri::command] da F14) ----

/** Lista cookies guardados para os `dominios`, opcionalmente filtrando. */
export function ipcListCookies(
  dominios: string[],
  filtro?: string,
): Promise<CookieInfo[]> {
  return invoke<CookieInfo[]>("list_cookies", { dominios, filtro: filtro ?? null });
}

/**
 * Limpa cookies. O Jar do reqwest nao remove seletivamente: passar `dominio`
 * ainda limpa TUDO, e o backend devolve `false` para sinalizar que nao foi
 * seletivo. Sem `dominio`, limpa tudo e devolve `true`.
 */
export function ipcClearCookies(dominio?: string): Promise<boolean> {
  return invoke<boolean>("clear_cookies", { dominio: dominio ?? null });
}

/** Liga/desliga a injecao do jar na engine. Retorna o novo estado. */
export function ipcSetCookiesEnabled(on: boolean): Promise<boolean> {
  return invoke<boolean>("set_cookies_enabled", { on });
}

/** Le se o jar esta ligado. */
export function ipcCookiesEnabled(): Promise<boolean> {
  return invoke<boolean>("cookies_enabled");
}

// ---- Logica PURA (testavel) ----

/**
 * Extrai o host de uma URL para registrar como dominio "visto". Aceita URL
 * sem protocolo (assume https). Retorna "" se nao der pra parsear — o chamador
 * ignora vazio. PURA.
 */
export function hostDeUrl(url: string): string {
  const u = (url ?? "").trim();
  if (u === "") return "";
  try {
    return new URL(u).host;
  } catch {
    try {
      return new URL(`https://${u}`).host;
    } catch {
      return "";
    }
  }
}

/**
 * Aplica um filtro de substring (case-insensitive) sobre o dominio dos cookies.
 * Filtro vazio/undefined nao filtra. PURA — espelha `dominio_casa` do backend
 * para a UI poder filtrar localmente sem ida ao backend.
 */
export function filtrarCookies(
  cookies: CookieInfo[],
  filtro?: string,
): CookieInfo[] {
  const f = (filtro ?? "").trim().toLowerCase();
  if (f === "") return cookies;
  return cookies.filter((c) => c.dominio.toLowerCase().includes(f));
}

/**
 * Agrupa cookies por dominio, preservando a ordem de primeira aparicao do
 * dominio. PURA — usada pela UI para mostrar secoes por dominio.
 */
export function agruparPorDominio(
  cookies: CookieInfo[],
): { dominio: string; cookies: CookieInfo[] }[] {
  const ordem: string[] = [];
  const mapa = new Map<string, CookieInfo[]>();
  for (const c of cookies) {
    if (!mapa.has(c.dominio)) {
      mapa.set(c.dominio, []);
      ordem.push(c.dominio);
    }
    mapa.get(c.dominio)!.push(c);
  }
  return ordem.map((dominio) => ({ dominio, cookies: mapa.get(dominio)! }));
}

interface CookiesState {
  /** Cookies atualmente carregados do backend. */
  cookies: CookieInfo[];
  /** True se o jar esta ligado (injetado na engine). Default ON. */
  enabled: boolean;
  /** True enquanto uma operacao IPC esta em andamento. */
  loading: boolean;
  /** Mensagem do ultimo erro de IPC (null se ok). */
  error: string | null;
  /** Filtro de dominio aplicado na UI (substring). */
  filtro: string;
  /** Dominios "vistos" das requests enviadas — usados para listar no jar. */
  dominiosVistos: string[];

  /** Registra o host de uma request enviada (idempotente). */
  registrarDominio: (host: string) => void;
  /** Define o filtro de dominio da UI. */
  setFiltro: (filtro: string) => void;
  /** (Re)carrega a lista de cookies do backend para os dominios vistos. */
  recarregar: () => Promise<void>;
  /** Liga/desliga o jar e atualiza o estado. */
  setEnabled: (on: boolean) => Promise<void>;
  /** Le o estado do toggle do backend (ex: na montagem da UI). */
  carregarEnabled: () => Promise<void>;
  /** Limpa cookies (todos; `dominio` e best-effort por limitacao do Jar). */
  limpar: (dominio?: string) => Promise<void>;
}

function mensagem(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  try {
    return JSON.stringify(e);
  } catch {
    return "erro desconhecido";
  }
}

export const useCookiesStore = create<CookiesState>((set, get) => ({
  cookies: [],
  enabled: true,
  loading: false,
  error: null,
  filtro: "",
  dominiosVistos: [],

  registrarDominio: (host) => {
    const h = (host ?? "").trim();
    if (h === "") return;
    set((state) =>
      state.dominiosVistos.includes(h)
        ? state
        : { dominiosVistos: [...state.dominiosVistos, h] },
    );
  },

  setFiltro: (filtro) => set({ filtro }),

  recarregar: async () => {
    set({ loading: true, error: null });
    try {
      const cookies = await ipcListCookies(get().dominiosVistos);
      set({ cookies, loading: false });
    } catch (e) {
      set({ loading: false, error: mensagem(e) });
    }
  },

  setEnabled: async (on) => {
    set({ loading: true, error: null });
    try {
      const novo = await ipcSetCookiesEnabled(on);
      set({ enabled: novo, loading: false });
    } catch (e) {
      set({ loading: false, error: mensagem(e) });
    }
  },

  carregarEnabled: async () => {
    try {
      const on = await ipcCookiesEnabled();
      set({ enabled: on });
    } catch (e) {
      set({ error: mensagem(e) });
    }
  },

  limpar: async (dominio) => {
    set({ loading: true, error: null });
    try {
      await ipcClearCookies(dominio);
      // Re-lista depois de limpar (o jar foi trocado por um vazio no backend).
      const cookies = await ipcListCookies(get().dominiosVistos);
      set({ cookies, loading: false });
    } catch (e) {
      set({ loading: false, error: mensagem(e) });
    }
  },
}));
