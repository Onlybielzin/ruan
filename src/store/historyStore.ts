// F16 — Store Zustand do historico de execucoes.
//
// Guarda a lista de entradas (mais recente primeiro) e persiste no disco via os
// comandos IPC `load_history_cmd` / `save_history_cmd` (history.json no diretorio
// de config do app). A logica pura (montar/limitar/serializar/parsear) vive em
// src/lib/historico.ts; este store so orquestra estado + persistencia.
//
// IMPORTANTE: este store NAO conhece o requestStore. Quem registra novas
// execucoes e o HistoryPanel, reagindo as responses (useEffect), chamando
// `registrar(entry)`. Assim mantemos a propriedade de arquivos (nao tocamos no
// requestStore).

import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type { HistoricoEntry } from "../lib/historico";
import {
  LIMITE_HISTORICO,
  adicionarEntry,
  serializarHistorico,
  parsearHistorico,
} from "../lib/historico";

// ---- Wrappers IPC (cada um e um #[tauri::command] registrado na Integracao) ----

/** Le o historico persistido como texto JSON (array). */
export function ipcLoadHistory(): Promise<string> {
  return invoke<string>("load_history_cmd");
}

/** Persiste o historico (texto JSON cru) no disco. */
export function ipcSaveHistory(json: string): Promise<void> {
  return invoke<void>("save_history_cmd", { json });
}

interface HistoryState {
  /** Entradas do historico, MAIS RECENTE PRIMEIRO. */
  entries: HistoricoEntry[];
  error: string | null;

  /**
   * Acrescenta uma entrada no topo, aplica o limite e PERSISTE (dispara o save
   * em background; o estado em memoria ja reflete a nova lista). PURO no calculo
   * (delega a `adicionarEntry`).
   */
  registrar: (entry: HistoricoEntry) => void;
  /** Esvazia o historico (memoria + disco). */
  limpar: () => Promise<void>;
  /** Carrega o historico persistido do disco (tolerante a falha). */
  carregar: () => Promise<void>;
}

export const useHistoryStore = create<HistoryState>((set, get) => ({
  entries: [],
  error: null,

  registrar: (entry) => {
    const atualizadas = adicionarEntry(get().entries, entry, LIMITE_HISTORICO);
    set({ entries: atualizadas });
    // Persiste em background: o usuario nao espera o disco para ver a entrada.
    void persistir(atualizadas).catch((e) => set({ error: String(e) }));
  },

  limpar: async () => {
    set({ entries: [], error: null });
    try {
      await ipcSaveHistory(serializarHistorico([]));
    } catch (e) {
      set({ error: String(e) });
    }
  },

  carregar: async () => {
    set({ error: null });
    try {
      const json = await ipcLoadHistory();
      set({ entries: parsearHistorico(json, LIMITE_HISTORICO) });
    } catch (e) {
      set({ error: String(e) });
    }
  },
}));

/** Serializa e grava a lista no disco. Helper isolado para o catch do registrar. */
async function persistir(entries: HistoricoEntry[]): Promise<void> {
  await ipcSaveHistory(serializarHistorico(entries));
}
