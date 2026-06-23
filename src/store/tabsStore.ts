// F15 — Store Zustand das abas (multi-request). Orquestra a logica pura de
// `lib/tabs.ts` e persiste APENAS a identidade das abas no localStorage do
// webview (decisao do M3: simplicidade, sem comando Tauri novo). O snapshot
// completo NUNCA vai pro localStorage — a Integracao recarrega a request do
// disco ao restaurar a sessao.
//
// A costura aba-ativa <-> requestStore e da Integracao (App.tsx): ela observa
// `activeId`, chama `requestStore.setRequest(snapshot)` ao trocar de aba e, ao
// editar a request, espelha de volta via `atualizarRequestAtiva`.

import { create } from "zustand";
import type { RequestItem } from "../lib/types";
import { novaRequest } from "../lib/types";
import {
  type Tab,
  type TabsPersistido,
  abrir,
  ativar,
  atualizarRequestDaAba,
  dePersistido,
  estadoVazio,
  fechar,
  idDaAba,
  marcarSujo,
  paraPersistir,
  reordenar,
} from "../lib/tabs";

const STORAGE_KEY = "ruan.tabs.v1";

interface TabsStoreState {
  /** Abas abertas, na ordem de exibicao. */
  tabs: Tab[];
  /** Id da aba ativa, ou null. */
  activeId: string | null;

  /**
   * Abre (ou ativa, se ja aberta) a aba de uma request salva. `request` e o
   * snapshot inicial; `itemPath` e o caminho relativo na arvore (slugs unidos
   * por "/"), que junto de `collectionPath` forma a identidade estavel.
   */
  abrirRequest: (
    collectionPath: string,
    itemPath: string,
    request: RequestItem,
  ) => string;
  /** Abre uma aba avulsa (request nova ainda nao salva). Sempre cria nova. */
  abrirNova: (request?: RequestItem) => string;
  /** Fecha a aba `id`; reativa uma vizinha se era a ativa. */
  fecharAba: (id: string) => void;
  /** Ativa a aba `id`. */
  ativarAba: (id: string) => void;
  /** Reordena (drag-and-drop) do indice `from` para `to`. */
  reordenarAba: (from: number, to: number) => void;
  /** Marca/limpa o dot de nao-salvo da aba `id`. */
  marcarSujo: (id: string, sujo: boolean) => void;
  /**
   * Atualiza o snapshot da aba `id` (marca suja por padrao). A Integracao chama
   * isto ao editar a request da aba ativa.
   */
  atualizarRequestDaAba: (
    id: string,
    request: RequestItem,
    sujo?: boolean,
  ) => void;
  /** Acucar: atualiza o snapshot da aba ATIVA (no-op se nenhuma ativa). */
  atualizarRequestAtiva: (request: RequestItem, sujo?: boolean) => void;
  /**
   * Restaura as abas persistidas. Recebe um `carregar` que, dada a identidade
   * (collectionPath/itemPath), devolve a RequestItem do disco (ou null se sumiu).
   * Abas que nao carregam sao descartadas. A Integracao fornece `carregar`
   * (lendo da arvore ja aberta no collectionsStore).
   */
  restaurar: (
    carregar: (
      collectionPath: string | null,
      itemPath: string | null,
    ) => RequestItem | null,
  ) => void;
}

/** Le e valida o estado persistido do localStorage. Best-effort: nunca lanca. */
export function lerPersistido(): TabsPersistido {
  try {
    const cru = localStorage.getItem(STORAGE_KEY);
    if (cru === null) return { tabs: [], activeId: null };
    return dePersistido(JSON.parse(cru));
  } catch {
    return { tabs: [], activeId: null };
  }
}

/** Persiste so a identidade das abas. Best-effort: erro nao quebra a UI. */
function persistir(tabs: Tab[], activeId: string | null): void {
  try {
    const dados = paraPersistir({ tabs, activeId });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(dados));
  } catch {
    // best-effort (ex.: storage cheio/desabilitado) — ignora.
  }
}

/** Contador para ids sinteticos de abas avulsas (unicidade na sessao). */
let nonceAvulsa = 0;

export const useTabsStore = create<TabsStoreState>((set, get) => ({
  ...estadoVazio(),

  abrirRequest: (collectionPath, itemPath, request) => {
    const id = idDaAba(collectionPath, itemPath);
    const aba: Tab = {
      id,
      collectionPath,
      itemPath,
      title: request.name || "Request",
      request,
      sujo: false,
    };
    const proximo = abrir(get(), aba);
    set(proximo);
    persistir(proximo.tabs, proximo.activeId);
    return id;
  },

  abrirNova: (request) => {
    const req = request ?? novaRequest("Nova Request");
    const id = idDaAba(null, null, String(nonceAvulsa++));
    const aba: Tab = {
      id,
      collectionPath: null,
      itemPath: null,
      title: req.name || "Nova Request",
      request: req,
      sujo: false,
    };
    const proximo = abrir(get(), aba);
    set(proximo);
    persistir(proximo.tabs, proximo.activeId);
    return id;
  },

  fecharAba: (id) => {
    const proximo = fechar(get(), id);
    set(proximo);
    persistir(proximo.tabs, proximo.activeId);
  },

  ativarAba: (id) => {
    const proximo = ativar(get(), id);
    set(proximo);
    persistir(proximo.tabs, proximo.activeId);
  },

  reordenarAba: (from, to) => {
    const proximo = reordenar(get(), from, to);
    set(proximo);
    persistir(proximo.tabs, proximo.activeId);
  },

  marcarSujo: (id, sujo) => {
    const proximo = marcarSujo(get(), id, sujo);
    set(proximo);
    // Sujo nao e persistido (so identidade); nao precisa reescrever o storage.
  },

  atualizarRequestDaAba: (id, request, sujo = true) => {
    const proximo = atualizarRequestDaAba(get(), id, request, sujo);
    set(proximo);
    // O titulo pode ter mudado (nome da request): reescreve a identidade.
    persistir(proximo.tabs, proximo.activeId);
  },

  atualizarRequestAtiva: (request, sujo = true) => {
    const { activeId } = get();
    if (activeId === null) return;
    get().atualizarRequestDaAba(activeId, request, sujo);
  },

  restaurar: (carregar) => {
    const persistido = lerPersistido();
    const tabs: Tab[] = [];
    for (const p of persistido.tabs) {
      const req = carregar(p.collectionPath, p.itemPath);
      if (req === null) continue; // sumiu do disco: descarta a aba
      tabs.push({
        id: p.id,
        collectionPath: p.collectionPath,
        itemPath: p.itemPath,
        title: p.title || req.name || "Request",
        request: req,
        sujo: false,
      });
    }
    const activeId =
      persistido.activeId !== null &&
      tabs.some((t) => t.id === persistido.activeId)
        ? persistido.activeId
        : tabs.length > 0
          ? tabs[0].id
          : null;
    set({ tabs, activeId });
    persistir(tabs, activeId);
  },
}));
