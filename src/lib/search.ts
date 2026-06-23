// F19 — Busca global e filtro do command palette (LOGICA PURA, alvo de mutation).
//
// `buscar(colecoes, termo)` varre a arvore de TODAS as colecoes abertas e devolve
// os matches (requests por nome+url, pastas por nome) com a identidade necessaria
// para abrir/navegar (collectionPath, itemPath) e um score simples para ordenar:
// prefixo > inicio-de-palavra > substring; nome bate mais forte que url. PURO:
// nao toca em stores, nao usa Date/random — recebe o snapshot das colecoes pronto.
//
// `filtrarComandos(comandos, termo)` filtra/ordena a lista de acoes do palette
// pelo mesmo criterio textual. Tambem PURO.
//
// A reconstrucao do `itemPath` (slugs unidos por "/") espelha exatamente o que o
// Sidebar/tabs usam, para que o resultado da busca abra a MESMA aba (mesma
// identidade estavel collectionPath/itemPath).

import type { Collection, RequestItem, TreeItem } from "./types";
import { isFolder, isRequest } from "./types";
import { slugFront } from "../store/collectionsStore";

/** Tipo do no encontrado: uma request ou uma pasta. */
export type TipoResultado = "request" | "folder";

/** Um resultado de busca na arvore das colecoes abertas. */
export interface ResultadoBusca {
  tipo: TipoResultado;
  /** Caminho absoluto da colecao (chave do collectionsStore). */
  collectionPath: string;
  /** Nome de exibicao da colecao (para mostrar de onde vem o item). */
  collectionName: string;
  /**
   * itemPath relativo (slugs unidos por "/"). Para request, identifica a aba.
   * Para pasta, e o caminho da propria pasta (sem request final).
   */
  itemPath: string;
  /** Nome do item (request ou pasta). */
  name: string;
  /** url da request (vazio para pasta). */
  url: string;
  /** Metodo HTTP da request (vazio para pasta). */
  method: string;
  /** Snapshot da request encontrada (undefined para pasta). */
  request?: RequestItem;
  /** Score do match (maior = mais relevante). */
  score: number;
}

// Pesos de score: prefixo do termo bate mais forte que inicio-de-palavra, que
// bate mais que substring no meio. Match no NOME vale mais que no URL.
const SCORE_PREFIXO = 100;
const SCORE_PALAVRA = 60;
const SCORE_SUBSTRING = 30;
const PESO_URL = 0.5; // url contribui com metade do peso de um match de nome.

/**
 * Pontua quao bem `termo` (ja em minusculas) casa em `alvo`. Retorna 0 se nao
 * casa. Maior = melhor: prefixo > inicio-de-palavra > substring. Casamento e
 * case-insensitive (assume `termo` ja minusculo; normaliza `alvo`). PURO.
 */
export function scoreMatch(alvo: string, termo: string): number {
  if (termo === "") return 0;
  const t = termo;
  const a = alvo.toLowerCase();
  const idx = a.indexOf(t);
  if (idx < 0) return 0;
  if (idx === 0) return SCORE_PREFIXO;
  // Inicio de palavra: caractere anterior e um separador comum.
  const anterior = a[idx - 1];
  if (anterior === " " || anterior === "-" || anterior === "_" || anterior === "/") {
    return SCORE_PALAVRA;
  }
  return SCORE_SUBSTRING;
}

/**
 * Score combinado de uma request para o termo: considera nome e url, pegando o
 * melhor de cada e somando o do url com peso reduzido. 0 = nao casa em nada.
 * PURO.
 */
export function scoreRequest(req: RequestItem, termo: string): number {
  const nome = scoreMatch(req.name, termo);
  const url = scoreMatch(req.url, termo);
  if (nome === 0 && url === 0) return 0;
  return nome + url * PESO_URL;
}

/** Junta um dir relativo (slugs) com mais um slug, tolerando dir vazio. PURO. */
function juntarItemPath(dir: string, slug: string): string {
  return dir === "" ? slug : `${dir}/${slug}`;
}

/**
 * Varre recursivamente os itens de uma colecao acumulando resultados que casam
 * `termo`. `dir` e o caminho relativo (slugs) do nivel atual. PURO.
 */
function varrerItens(
  itens: TreeItem[],
  dir: string,
  collectionPath: string,
  collectionName: string,
  termo: string,
  acc: ResultadoBusca[],
): void {
  for (const item of itens) {
    if (isRequest(item)) {
      const score = scoreRequest(item, termo);
      if (score > 0) {
        acc.push({
          tipo: "request",
          collectionPath,
          collectionName,
          itemPath: juntarItemPath(dir, slugFront(item.name)),
          name: item.name,
          url: item.url,
          method: item.method,
          request: item,
          score,
        });
      }
    } else if (isFolder(item)) {
      const proprioPath = juntarItemPath(dir, slugFront(item.name));
      const score = scoreMatch(item.name, termo);
      if (score > 0) {
        acc.push({
          tipo: "folder",
          collectionPath,
          collectionName,
          itemPath: proprioPath,
          name: item.name,
          url: "",
          method: "",
          score,
        });
      }
      // Desce para os filhos da pasta.
      varrerItens(item.items, proprioPath, collectionPath, collectionName, termo, acc);
    }
  }
}

/**
 * Busca global: varre a arvore de cada colecao aberta e devolve os matches
 * ordenados por score (desc) e, em empate, por nome (asc, case-insensitive).
 * `colecoes` mapeia collectionPath -> Collection (igual ao collectionsStore).
 * Termo vazio/so-espacos => sem resultados. PURO.
 */
export function buscar(
  colecoes: Record<string, Collection>,
  termo: string,
): ResultadoBusca[] {
  const t = termo.trim().toLowerCase();
  if (t === "") return [];
  const acc: ResultadoBusca[] = [];
  for (const path of Object.keys(colecoes)) {
    const col = colecoes[path];
    if (!col) continue;
    varrerItens(col.items, "", path, col.name, t, acc);
  }
  return ordenarPorScore(acc);
}

/** Ordena por score desc, empate por nome asc (case-insensitive). PURO. */
export function ordenarPorScore<T extends { score: number; name: string }>(
  itens: T[],
): T[] {
  return itens.slice().sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
  });
}

// ---- Command palette --------------------------------------------------------

/**
 * Um comando do palette. `id` e estavel; `label` e o que casa a busca e aparece;
 * `keywords` sao termos extras pesquisaveis (sinonimos). `run` e executado pela
 * UI ao escolher (a Integracao injeta a acao real). `secao` agrupa visualmente.
 */
export interface Comando {
  id: string;
  label: string;
  keywords?: string[];
  secao?: string;
  run: () => void;
}

/**
 * Score de um comando para o termo: melhor entre o label e cada keyword. 0 = nao
 * casa. PURO.
 */
export function scoreComando(cmd: Comando, termo: string): number {
  let melhor = scoreMatch(cmd.label, termo);
  for (const k of cmd.keywords ?? []) {
    const s = scoreMatch(k, termo);
    if (s > melhor) melhor = s;
  }
  return melhor;
}

/**
 * Filtra e ordena os comandos pelo termo. Termo vazio => devolve TODOS na ordem
 * original (o palette mostra a lista completa de acoes quando nao ha texto).
 * Com termo, mantem so os que casam, ordenados por score desc / label asc. PURO.
 */
export function filtrarComandos(comandos: Comando[], termo: string): Comando[] {
  const t = termo.trim().toLowerCase();
  if (t === "") return comandos.slice();
  const comScore = comandos
    .map((c) => ({ c, score: scoreComando(c, t) }))
    .filter((x) => x.score > 0);
  comScore.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.c.label.toLowerCase().localeCompare(b.c.label.toLowerCase());
  });
  return comScore.map((x) => x.c);
}

/**
 * Move um indice de selecao por `delta` dentro de uma lista de tamanho `n`,
 * com WRAP-AROUND (passa do fim volta ao inicio e vice-versa). Lista vazia => 0.
 * Usado pela navegacao por setas do palette. PURO.
 */
export function moverSelecao(atual: number, delta: number, n: number): number {
  if (n <= 0) return 0;
  return ((atual + delta) % n + n) % n;
}
