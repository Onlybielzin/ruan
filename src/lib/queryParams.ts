// F5 — Logica PURA de query params (alvo de mutation testing).
//
// Modelo de sincronizacao bidirecional URL <-> tabela:
// - A URL guarda base (esquema/host/path/fragmento) + query string.
// - A tabela e a lista de {name,value,enabled,description}; apenas linhas
//   `enabled` com nome nao-vazio entram na URL ao reconstruir.
// - parseQueryString(url) extrai os pares da query (todos como enabled, pois o
//   que esta na URL esta "ativo"). buildUrl(base, params) reconstroi a URL
//   colando so os params habilitados.
//
// Encoding: usamos encodeURIComponent/decodeURIComponent (percent-encoding
// padrao). Chaves repetidas sao preservadas (lista, nao mapa). Valores vazios
// permitidos (name sem `=`... aqui sempre emitimos `name=`; ver nota abaixo).

import type { KeyValue } from "./types";

/** Linha da tabela de params. Subset estavel de KeyValue. */
export interface ParamRow {
  name: string;
  value: string;
  enabled: boolean;
  description?: string;
}

/**
 * Divide uma URL em base (tudo antes do `?`) e query string crua (sem o `?`,
 * sem o fragmento `#...`). O fragmento e devolvido separado para ser recolado
 * por buildUrl, preservando o resto da URL. LOGICA PURA.
 */
export function splitUrl(url: string): {
  base: string;
  query: string;
  hash: string;
} {
  // Separa o fragmento primeiro (so o primeiro `#` conta).
  let semHash = url;
  let hash = "";
  const iHash = url.indexOf("#");
  if (iHash >= 0) {
    semHash = url.slice(0, iHash);
    hash = url.slice(iHash); // inclui o `#`
  }

  const iQ = semHash.indexOf("?");
  if (iQ < 0) {
    return { base: semHash, query: "", hash };
  }
  return {
    base: semHash.slice(0, iQ),
    query: semHash.slice(iQ + 1),
    hash,
  };
}

/**
 * Decodifica um componente percent-encoded de forma tolerante: `+` vira espaco
 * (convencao de query string) e sequencias `%` invalidas sao devolvidas como
 * estao em vez de lancar. LOGICA PURA.
 */
export function decodeComponent(s: string): string {
  const comMais = s.replace(/\+/g, " ");
  try {
    return decodeURIComponent(comMais);
  } catch {
    return comMais;
  }
}

/** Codifica um componente para query string (percent-encoding). LOGICA PURA. */
export function encodeComponent(s: string): string {
  return encodeURIComponent(s);
}

/**
 * Parseia a query string crua (sem `?`) numa lista de pares. Preserva ordem e
 * chaves repetidas. Aceita `name` (sem `=`, valor vazio) e `name=` e `=value`.
 * Segmentos totalmente vazios (entre `&&`) sao ignorados. LOGICA PURA.
 */
export function parseQueryString(query: string): ParamRow[] {
  if (query.length === 0) return [];
  const linhas: ParamRow[] = [];
  for (const seg of query.split("&")) {
    if (seg.length === 0) continue; // ignora `&&` e bordas
    const iEq = seg.indexOf("=");
    let name: string;
    let value: string;
    if (iEq < 0) {
      name = seg;
      value = "";
    } else {
      name = seg.slice(0, iEq);
      value = seg.slice(iEq + 1);
    }
    linhas.push({
      name: decodeComponent(name),
      value: decodeComponent(value),
      enabled: true,
    });
  }
  return linhas;
}

/**
 * Extrai os params da query de uma URL completa. Atalho de
 * splitUrl + parseQueryString. LOGICA PURA.
 */
export function parseUrlParams(url: string): ParamRow[] {
  return parseQueryString(splitUrl(url).query);
}

/**
 * Monta a query string (sem `?`) a partir dos params. So entram linhas
 * habilitadas com nome nao-vazio. Valores vazios viram `name=`. Preserva ordem
 * e repetidas. LOGICA PURA.
 */
export function buildQueryString(params: ParamRow[]): string {
  const partes: string[] = [];
  for (const p of params) {
    if (!p.enabled) continue;
    if (p.name.length === 0) continue;
    partes.push(`${encodeComponent(p.name)}=${encodeComponent(p.value)}`);
  }
  return partes.join("&");
}

/**
 * Reconstroi a URL completa a partir de uma base e dos params, recolando o
 * fragmento. A `base` pode vir com `?...` antiga e/ou `#...`: normalizamos
 * extraindo so o trecho antes do `?` (a query e sempre regerada dos params) e
 * preservando o fragmento existente na base se houver. LOGICA PURA.
 */
export function buildUrl(base: string, params: ParamRow[]): string {
  const { base: limpa, hash } = splitUrl(base);
  const query = buildQueryString(params);
  return limpa + (query.length > 0 ? `?${query}` : "") + hash;
}

/**
 * Aplica edicao da TABELA -> URL: pega a url atual (so para preservar
 * base/hash) e a lista de params editada, e devolve a url reconstruida.
 * LOGICA PURA.
 */
export function aplicarParamsNaUrl(url: string, params: ParamRow[]): string {
  return buildUrl(url, params);
}

/**
 * Sincroniza URL -> TABELA preservando linhas que o usuario adicionou mas ainda
 * nao "valem" na URL (desabilitadas, ou habilitadas com nome vazio). A query da
 * URL e a fonte das linhas habilitadas+nomeadas; as demais (rascunho) sao
 * mantidas na mesma ordem relativa ao final. LOGICA PURA.
 *
 * Estrategia: as linhas vindas da URL substituem todas as linhas "ativas"
 * anteriores (mesma semantica), e reanexamos as linhas de rascunho
 * (desabilitadas ou sem nome) que estavam na tabela.
 */
export function sincronizarUrlParaParams(
  url: string,
  paramsAtuais: ParamRow[],
): ParamRow[] {
  const daUrl = parseUrlParams(url);
  const rascunhos = paramsAtuais.filter(
    (p) => !p.enabled || p.name.length === 0,
  );
  return [...daUrl, ...rascunhos];
}

/** Converte KeyValue do store em ParamRow. LOGICA PURA. */
export function keyValueParaRow(kv: KeyValue): ParamRow {
  return {
    name: kv.name,
    value: kv.value,
    enabled: kv.enabled,
    description: kv.description,
  };
}

/** Converte ParamRow em KeyValue do store (para gravar em params). LOGICA PURA. */
export function rowParaKeyValue(row: ParamRow): KeyValue {
  const kv: KeyValue = {
    name: row.name,
    value: row.value,
    enabled: row.enabled,
  };
  if (row.description !== undefined && row.description.length > 0) {
    kv.description = row.description;
  }
  return kv;
}

/** Linha vazia padrao (rascunho habilitado, ainda sem nome). LOGICA PURA. */
export function linhaVazia(): ParamRow {
  return { name: "", value: "", enabled: true };
}
