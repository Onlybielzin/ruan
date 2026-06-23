// F16 — Historico de execucoes (LOGICA PURA, alvo de mutation).
//
// Monta entradas de historico a partir de (request, response/erro), aplica o
// limite de tamanho (mantendo as MAIS RECENTES) e serializa/parseia a lista de
// forma TOLERANTE (JSON ausente/corrompido -> lista vazia, nunca quebra).
//
// Decisao de design: NENHUMA funcao aqui chama Date.now()/Math.random() por
// dentro. O timestamp e o id sao recebidos como argumento, para que a logica
// seja deterministica e testavel. Quem chama (o store) injeta o relogio.

import type { RequestItem } from "./types";
import type { ResponseData } from "./http-types";

/** Limite default de entradas guardadas (as mais recentes). */
export const LIMITE_HISTORICO = 200;

/**
 * Uma entrada do historico de execucoes. `status`/`timeMs`/`sizeBytes` sao
 * `null` quando o envio falhou (erro de rede/timeout) — nao houve resposta.
 * `requestSnapshot` guarda a request completa no momento do envio, para poder
 * restaura-la no builder depois.
 */
export interface HistoricoEntry {
  id: string;
  method: string;
  url: string;
  status: number | null;
  timeMs: number | null;
  sizeBytes: number | null;
  timestampMs: number;
  requestSnapshot: RequestItem;
}

/**
 * Monta uma HistoricoEntry a partir de uma request e de uma resposta. PURO:
 * recebe `id` e `timestampMs` de fora (nada de Date.now/random aqui dentro).
 */
export function montarEntry(
  id: string,
  timestampMs: number,
  request: RequestItem,
  response: ResponseData,
): HistoricoEntry {
  return {
    id,
    method: request.method || "GET",
    url: request.url,
    status: response.status,
    timeMs: response.timeMs,
    sizeBytes: response.sizeBytes,
    timestampMs,
    requestSnapshot: request,
  };
}

/**
 * Monta uma HistoricoEntry de um envio que FALHOU (sem resposta). status/timeMs/
 * sizeBytes ficam null. PURO (id/timestamp injetados).
 */
export function montarEntryErro(
  id: string,
  timestampMs: number,
  request: RequestItem,
): HistoricoEntry {
  return {
    id,
    method: request.method || "GET",
    url: request.url,
    status: null,
    timeMs: null,
    sizeBytes: null,
    timestampMs,
    requestSnapshot: request,
  };
}

/**
 * Acrescenta uma entrada NO TOPO (mais recente primeiro) e corta para no maximo
 * `limite` entradas, descartando as MAIS ANTIGAS. PURO. Nunca muta a lista de
 * entrada (devolve um novo array).
 */
export function adicionarEntry(
  lista: HistoricoEntry[],
  entry: HistoricoEntry,
  limite: number = LIMITE_HISTORICO,
): HistoricoEntry[] {
  const nova = [entry, ...lista];
  return limitar(nova, limite);
}

/**
 * Corta a lista para no maximo `limite`, mantendo as PRIMEIRAS (que, pela
 * convencao deste modulo, sao as mais recentes). Limite <= 0 => lista vazia.
 * PURO.
 */
export function limitar(
  lista: HistoricoEntry[],
  limite: number = LIMITE_HISTORICO,
): HistoricoEntry[] {
  if (limite <= 0) return [];
  if (lista.length <= limite) return lista.slice();
  return lista.slice(0, limite);
}

/** Serializa a lista de historico para o texto JSON que vai pro disco. PURO. */
export function serializarHistorico(lista: HistoricoEntry[]): string {
  return JSON.stringify(lista);
}

/**
 * Parseia o JSON do historico de forma TOLERANTE. Qualquer falha (vazio, JSON
 * invalido, raiz que nao e array, entradas malformadas) resulta em descartar o
 * que nao presta: retorna apenas as entradas validas, na ordem original, ja
 * limitada. NUNCA lanca. PURO.
 */
export function parsearHistorico(
  json: string | null | undefined,
  limite: number = LIMITE_HISTORICO,
): HistoricoEntry[] {
  if (typeof json !== "string" || json.trim() === "") return [];
  let bruto: unknown;
  try {
    bruto = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(bruto)) return [];
  const validas: HistoricoEntry[] = [];
  for (const item of bruto) {
    const e = normalizarEntry(item);
    if (e) validas.push(e);
  }
  return limitar(validas, limite);
}

/**
 * Valida/normaliza uma entrada bruta vinda do disco. Retorna `null` se nao tiver
 * o minimo necessario (id, method, url, timestampMs). Campos numericos opcionais
 * viram `null` se ausentes/invalidos; `requestSnapshot` ausente nao invalida a
 * entrada (vira um snapshot minimo, para a lista ainda exibir e nao quebrar).
 * PURO.
 */
export function normalizarEntry(bruto: unknown): HistoricoEntry | null {
  if (typeof bruto !== "object" || bruto === null) return null;
  const o = bruto as Record<string, unknown>;
  if (typeof o.id !== "string" || o.id === "") return null;
  if (typeof o.method !== "string") return null;
  if (typeof o.url !== "string") return null;
  if (typeof o.timestampMs !== "number" || !Number.isFinite(o.timestampMs)) {
    return null;
  }
  return {
    id: o.id,
    method: o.method,
    url: o.url,
    status: numeroOuNull(o.status),
    timeMs: numeroOuNull(o.timeMs),
    sizeBytes: numeroOuNull(o.sizeBytes),
    timestampMs: o.timestampMs,
    requestSnapshot: snapshotOuMinimo(o.requestSnapshot, o.method, o.url),
  };
}

/** number finito -> ele mesmo; qualquer outra coisa -> null. PURO. */
function numeroOuNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Garante um RequestItem utilizavel para restauracao. Se o snapshot do disco
 * nao for um objeto, monta um minimo a partir de method/url. NAO faz normalizacao
 * profunda aqui (o store/`setRequest` ja normaliza via `normalizarRequest`); so
 * evita undefined.
 */
function snapshotOuMinimo(
  v: unknown,
  method: string,
  url: string,
): RequestItem {
  if (typeof v === "object" && v !== null) {
    return v as RequestItem;
  }
  return {
    name: "",
    seq: 0,
    method: method || "GET",
    url,
    headers: [],
    params: [],
    body: { mode: "none" },
    auth: { mode: "none" },
    scripts: { pre: "", post: "" },
    tests: "",
    docs: "",
  };
}
