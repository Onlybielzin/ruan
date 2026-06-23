// F15 — Logica PURA das abas (multi-request). Alvo de mutation testing.
//
// Uma "aba" referencia uma request aberta no builder: a colecao de origem
// (collectionPath), um identificador estavel dentro dela (itemId, derivado do
// caminho relativo na arvore) e um snapshot da RequestItem em edicao. O dot de
// "nao salvo" (sujo) marca abas cujo snapshot divergiu do que esta no disco.
//
// Tudo aqui e funcao pura sobre arrays imutaveis (devolve novos arrays/objetos,
// nunca muta a entrada). O store (zustand) so orquestra estas funcoes e persiste
// o resultado. NAO ha React/IO neste arquivo.

import type { RequestItem } from "./types";

/**
 * Uma aba aberta. `id` e a identidade da aba para dedupe/ativacao; combina a
 * colecao de origem com o caminho relativo do item na arvore. Abas "avulsas"
 * (request nova ainda nao salva) usam um id sintetico sem collectionPath.
 */
export interface Tab {
  /** Identidade unica da aba (chave de dedupe, ativacao e React key). */
  id: string;
  /** Caminho da colecao de origem, ou null para uma request avulsa/nova. */
  collectionPath: string | null;
  /**
   * Caminho relativo do item dentro da colecao (slugs unidos por "/"), ou null
   * para uma request avulsa. Junto de collectionPath forma a identidade real.
   */
  itemPath: string | null;
  /** Titulo exibido na aba (normalmente o nome da request). */
  title: string;
  /** Snapshot da request em edicao nesta aba. */
  request: RequestItem;
  /** True quando ha alteracoes nao salvas (mostra o dot). */
  sujo: boolean;
}

/** Estado puro das abas: lista ordenada + id da aba ativa. */
export interface TabsState {
  /** Abas abertas, na ordem de exibicao. */
  tabs: Tab[];
  /** Id da aba ativa, ou null se nenhuma aberta. */
  activeId: string | null;
}

/** Estado vazio inicial. */
export function estadoVazio(): TabsState {
  return { tabs: [], activeId: null };
}

/**
 * Constroi o id de uma aba a partir da colecao e do caminho relativo do item.
 * Requests salvas tem id deterministico (mesma origem => mesma aba). Uma request
 * avulsa (collectionPath/itemPath null) recebe um id sintetico unico via `nonce`.
 */
export function idDaAba(
  collectionPath: string | null,
  itemPath: string | null,
  nonce?: string,
): string {
  if (collectionPath !== null && itemPath !== null) {
    return `${collectionPath}::${itemPath}`;
  }
  // Avulsa: sem origem estavel, usa nonce (ou um fallback) para nao deduplicar.
  return `avulsa::${nonce ?? "0"}`;
}

/** Acha o indice de uma aba pelo id (ou -1). PURA. */
export function indiceDe(state: TabsState, id: string): number {
  return state.tabs.findIndex((t) => t.id === id);
}

/** Retorna a aba ativa, ou undefined se nao houver. PURA. */
export function abaAtiva(state: TabsState): Tab | undefined {
  if (state.activeId === null) return undefined;
  return state.tabs.find((t) => t.id === state.activeId);
}

/**
 * Abre uma aba. DEDUPE por id: se ja existe uma aba com o mesmo id, NAO duplica;
 * apenas a ativa (preservando o snapshot/sujo existente — nao sobrescreve edicao
 * em andamento). Caso contrario, anexa a nova aba no fim e a ativa.
 */
export function abrir(state: TabsState, aba: Tab): TabsState {
  const existente = indiceDe(state, aba.id);
  if (existente >= 0) {
    return { tabs: state.tabs, activeId: aba.id };
  }
  return { tabs: [...state.tabs, aba], activeId: aba.id };
}

/**
 * Fecha a aba `id`. Se era a ativa, escolhe a proxima aba ativa: a vizinha a
 * direita se houver, senao a a esquerda, senao null (lista vazia). PURA.
 */
export function fechar(state: TabsState, id: string): TabsState {
  const idx = indiceDe(state, id);
  if (idx < 0) return state;
  const tabs = state.tabs.filter((t) => t.id !== id);

  let activeId = state.activeId;
  if (state.activeId === id) {
    if (tabs.length === 0) {
      activeId = null;
    } else {
      // Vizinha a direita (mesmo indice na nova lista) ou a ultima.
      const proximo = idx < tabs.length ? tabs[idx] : tabs[tabs.length - 1];
      activeId = proximo.id;
    }
  }
  return { tabs, activeId };
}

/** Ativa a aba `id` se existir; senao mantem o estado. PURA. */
export function ativar(state: TabsState, id: string): TabsState {
  if (indiceDe(state, id) < 0) return state;
  return { tabs: state.tabs, activeId: id };
}

/**
 * Marca a aba `id` como suja/limpa. Se nao existir, mantem o estado. PURA.
 * Mutacao imutavel: devolve nova lista so com a aba alvo trocada.
 */
export function marcarSujo(
  state: TabsState,
  id: string,
  sujo: boolean,
): TabsState {
  const idx = indiceDe(state, id);
  if (idx < 0) return state;
  if (state.tabs[idx].sujo === sujo) return state; // no-op estavel
  const tabs = state.tabs.map((t) => (t.id === id ? { ...t, sujo } : t));
  return { tabs, activeId: state.activeId };
}

/**
 * Atualiza o snapshot (e opcionalmente o titulo) da aba `id`. Marca a aba como
 * suja por padrao (uma edicao deixa pendente p/ salvar). Passe `sujo` explicito
 * para sobrescrever (ex.: ao salvar, `sujo:false`). PURA.
 */
export function atualizarRequestDaAba(
  state: TabsState,
  id: string,
  request: RequestItem,
  sujo = true,
): TabsState {
  const idx = indiceDe(state, id);
  if (idx < 0) return state;
  const tabs = state.tabs.map((t) =>
    t.id === id ? { ...t, request, title: request.name || t.title, sujo } : t,
  );
  return { tabs, activeId: state.activeId };
}

/**
 * Reordena uma aba do indice `from` para `to` (estilo drag-and-drop). Indices
 * fora do intervalo sao clampados; reordenacao no mesmo lugar e no-op. NAO altera
 * a aba ativa (a identidade da ativa segue valida). PURA.
 */
export function reordenar(state: TabsState, from: number, to: number): TabsState {
  const n = state.tabs.length;
  if (n === 0) return state;
  const origem = clamp(from, 0, n - 1);
  const destino = clamp(to, 0, n - 1);
  if (origem === destino) return state;
  const tabs = [...state.tabs];
  const [movida] = tabs.splice(origem, 1);
  tabs.splice(destino, 0, movida);
  return { tabs, activeId: state.activeId };
}

/** Clampa `v` no intervalo [min, max]. PURA. */
function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

// ---- Persistencia leve -----------------------------------------------------
// Persistimos apenas a IDENTIDADE das abas (id/origem/titulo), nunca o snapshot
// completo: ao restaurar a sessao, a Integracao recarrega a request do disco.
// Assim evitamos guardar edicoes nao salvas no localStorage e divergir do disco.

/** Forma serializavel/persistida de uma aba (sem o snapshot da request). */
export interface TabPersistido {
  id: string;
  collectionPath: string | null;
  itemPath: string | null;
  title: string;
}

/** Forma persistida do estado de abas. */
export interface TabsPersistido {
  tabs: TabPersistido[];
  activeId: string | null;
}

/** Projeta o estado para a forma persistida (descarta snapshot e sujo). PURA. */
export function paraPersistir(state: TabsState): TabsPersistido {
  return {
    tabs: state.tabs.map((t) => ({
      id: t.id,
      collectionPath: t.collectionPath,
      itemPath: t.itemPath,
      title: t.title,
    })),
    activeId: state.activeId,
  };
}

/**
 * Valida/normaliza um objeto cru (vindo do localStorage) para TabsPersistido.
 * Tolerante a lixo: descarta entradas malformadas; nunca lanca. PURA.
 */
export function dePersistido(raw: unknown): TabsPersistido {
  if (raw === null || typeof raw !== "object") {
    return { tabs: [], activeId: null };
  }
  const obj = raw as Record<string, unknown>;
  const brutos = Array.isArray(obj.tabs) ? obj.tabs : [];
  const tabs: TabPersistido[] = [];
  for (const b of brutos) {
    if (b === null || typeof b !== "object") continue;
    const r = b as Record<string, unknown>;
    if (typeof r.id !== "string") continue;
    tabs.push({
      id: r.id,
      collectionPath:
        typeof r.collectionPath === "string" ? r.collectionPath : null,
      itemPath: typeof r.itemPath === "string" ? r.itemPath : null,
      title: typeof r.title === "string" ? r.title : "",
    });
  }
  // activeId so e valido se apontar para uma aba presente.
  const activeId =
    typeof obj.activeId === "string" && tabs.some((t) => t.id === obj.activeId)
      ? obj.activeId
      : tabs.length > 0
        ? tabs[0].id
        : null;
  return { tabs, activeId };
}
