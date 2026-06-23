// Logica PURA da arvore da sidebar (F3) — sem React, sem IPC. Alvo de mutation
// testing. A sidebar (componente) delega aqui todo o calculo de ordenacao,
// reordenacao e geracao de nomes; o componente so renderiza e dispara IPC.

import type { TreeItem } from "./types";
import { isFolder } from "./types";

/** Discriminador de tipo do item, no formato que o backend espera ("kind"). */
export type ItemKind = "folder" | "request";

/** `kind` de um TreeItem, no string que os comandos Rust esperam. */
export function kindOf(item: TreeItem): ItemKind {
  return isFolder(item) ? "folder" : "request";
}

/**
 * Ordena irmaos do mesmo jeito que o backend (`fs_store::ordenar_items`):
 * por `seq` crescente, desempatando por nome (ordem lexicografica estavel).
 * Retorna uma NOVA lista; nao muta a entrada.
 */
export function ordenarItems(items: TreeItem[] | null | undefined): TreeItem[] {
  // Defesa na costura IPC: o backend pode (por bug de serde) nao mandar `items`.
  // Tolerar nullish evita derrubar toda a arvore com TypeError no render.
  if (!items) return [];
  return [...items].sort((a, b) => {
    if (a.seq !== b.seq) return a.seq - b.seq;
    return compararNome(a.name, b.name);
  });
}

/** Comparacao de nomes deterministica (igual ao `cmp` de string do Rust). */
export function compararNome(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * Reordena `items` movendo o item no indice `from` para a posicao `to`
 * (semantica de "arrastar e soltar antes do item em `to`"). Retorna uma NOVA
 * lista. Indices fora do intervalo sao clampeados.
 */
export function reordenar(
  items: TreeItem[],
  from: number,
  to: number,
): TreeItem[] {
  const n = items.length;
  if (n === 0) return [];
  const origem = clamp(from, 0, n - 1);
  let destino = clamp(to, 0, n);
  const copia = [...items];
  const [movido] = copia.splice(origem, 1);
  // Apos remover, se o destino estava depois da origem, ele desloca uma posicao.
  if (destino > origem) destino -= 1;
  copia.splice(destino, 0, movido);
  return copia;
}

/** Clampa `v` no intervalo [min, max]. */
export function clamp(v: number, min: number, max: number): number {
  if (v < min) return min;
  if (v > max) return max;
  return v;
}

/**
 * Calcula o `seq` que um item deve ter para ocupar a posicao `index` numa lista
 * `items` ja ordenada por seq. Estrategia simples e estavel: o novo seq e o
 * indice (0-based). O chamador deve, ao reordenar, reescrever os seqs de TODOS
 * os irmaos via `seqsSequenciais`, garantindo posicoes inteiras sem colisao.
 */
export function seqParaPosicao(index: number): number {
  return Math.max(0, Math.trunc(index));
}

/**
 * Dada uma lista ja na ordem desejada, retorna pares {name, kind, seq} com seqs
 * sequenciais 0..n-1. Usado apos um drag-and-drop para persistir a nova ordem
 * (um `move_item` por irmao cujo seq mudou). Inclui `seqAntigo` para o chamador
 * decidir se precisa persistir (evita IPC desnecessario).
 */
export interface SeqUpdate {
  name: string;
  kind: ItemKind;
  seq: number;
  seqAntigo: number;
}

export function seqsSequenciais(ordenados: TreeItem[]): SeqUpdate[] {
  return ordenados.map((item, i) => ({
    name: item.name,
    kind: kindOf(item),
    seq: i,
    seqAntigo: item.seq,
  }));
}

/** So os updates cujo seq efetivamente mudou (evita IPC redundante). */
export function updatesNecessarios(ordenados: TreeItem[]): SeqUpdate[] {
  return seqsSequenciais(ordenados).filter((u) => u.seq !== u.seqAntigo);
}

/**
 * Gera um nome de copia unico dado o nome original e os nomes ja existentes
 * entre os irmaos. Primeiro tenta "<base> copia"; se colidir, "<base> copia 2",
 * "<base> copia 3", etc. Comparacao case-sensitive (igual ao disco).
 */
export function nomeCopia(original: string, existentes: string[]): string {
  const set = new Set(existentes);
  const base = `${original} copia`;
  if (!set.has(base)) return base;
  let i = 2;
  while (set.has(`${base} ${i}`)) i += 1;
  return `${base} ${i}`;
}

/**
 * Gera um nome novo unico para criar pasta/request (ex.: "Nova pasta",
 * "Nova pasta 2", ...). `prefixo` e a base sem sufixo numerico.
 */
export function nomeNovoUnico(prefixo: string, existentes: string[]): string {
  const set = new Set(existentes);
  if (!set.has(prefixo)) return prefixo;
  let i = 2;
  while (set.has(`${prefixo} ${i}`)) i += 1;
  return `${prefixo} ${i}`;
}

/**
 * Valida (no front, espelhando `slug::validar_nome` do Rust) se um nome e
 * aceitavel: nao-vazio apos trim, sem `/` `\` `\0`, diferente de "." e "..",
 * e nao-absoluto. Retorna mensagem de erro (string) ou null se valido.
 *
 * IMPORTANTE: esta validacao e de CONVENIENCIA (feedback rapido na UI). A
 * fonte de verdade da seguranca e o backend (`slug_seguro`), que revalida.
 */
export function validarNomeFront(nome: string): string | null {
  const t = nome.trim();
  if (t.length === 0) return "Nome nao pode ser vazio";
  if (t === "." || t === "..") return "Nome invalido";
  if (nome.includes("/") || nome.includes("\\"))
    return "Nome nao pode conter barras";
  if (nome.includes("\0")) return "Nome invalido";
  if (ehAbsoluto(nome)) return "Nome nao pode ser um caminho absoluto";
  return null;
}

/** Espelho do `eh_absoluto` do Rust: prefixo `/`, `\` ou drive letter `X:`. */
export function ehAbsoluto(nome: string): boolean {
  if (nome.length === 0) return false;
  const c0 = nome[0];
  if (c0 === "/" || c0 === "\\") return true;
  if (nome.length >= 2) {
    const ehLetra = /[a-zA-Z]/.test(c0);
    if (ehLetra && nome[1] === ":") return true;
  }
  return false;
}

/**
 * Mapeia um metodo HTTP para uma cor de badge (hex). Determinista; default
 * cinza para metodos desconhecidos. Sem emoji — so cor + texto no componente.
 */
export function corMetodo(method: string): string {
  switch (method.toUpperCase()) {
    case "GET":
      return "#4ec9b0"; // teal (mesmo accent do tema)
    case "POST":
      return "#dcb67a"; // ambar
    case "PUT":
      return "#569cd6"; // azul
    case "PATCH":
      return "#c586c0"; // roxo
    case "DELETE":
      return "#d16969"; // vermelho
    case "HEAD":
    case "OPTIONS":
      return "#808080"; // cinza
    default:
      return "#808080";
  }
}

/**
 * Rotulo curto do metodo para o badge (compacto, no maximo 4 chars). Mantem o
 * metodo em maiusculas; trunca metodos longos/custom para caber.
 */
export function rotuloMetodo(method: string): string {
  const m = method.toUpperCase();
  return m.length <= 4 ? m : m.slice(0, 4);
}
