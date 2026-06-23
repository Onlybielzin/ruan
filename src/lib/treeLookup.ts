// Integracao M3 (F15) — localizacao de uma RequestItem na arvore de uma colecao
// a partir do `itemPath` (slugs unidos por "/", como gerado pelo Sidebar/tabs).
//
// Usado pela restauracao de sessao de abas: dado collectionPath/itemPath, anda
// a arvore ja aberta no collectionsStore e devolve a RequestItem (ou null se o
// item sumiu do disco). LOGICA PURA — recebe a colecao pronta.

import type { Collection, RequestItem, TreeItem } from "./types";
import { isRequest, isFolder } from "./types";
import { slugFront } from "../store/collectionsStore";

/**
 * Acha uma RequestItem na arvore pela sequencia de slugs do `itemPath`.
 * O ultimo segmento e o slug da request; os anteriores sao slugs de pastas.
 * Retorna null se qualquer segmento nao casar (item movido/renomeado/apagado).
 * PURA.
 */
export function acharRequestPorItemPath(
  colecao: Collection | undefined,
  itemPath: string | null,
): RequestItem | null {
  if (!colecao || itemPath === null) return null;
  const segmentos = itemPath.split("/").filter((s) => s.length > 0);
  if (segmentos.length === 0) return null;

  let nivel: TreeItem[] = colecao.items;
  // Desce pelas pastas (todos menos o ultimo segmento).
  for (let i = 0; i < segmentos.length - 1; i++) {
    const slug = segmentos[i];
    const pasta = nivel.find(
      (it) => isFolder(it) && slugFront(it.name) === slug,
    );
    if (!pasta || !isFolder(pasta)) return null;
    nivel = pasta.items;
  }
  const ultimo = segmentos[segmentos.length - 1];
  const req = nivel.find(
    (it) => isRequest(it) && slugFront(it.name) === ultimo,
  );
  return req && isRequest(req) ? req : null;
}

/**
 * Monta o `itemPath` (slugs unidos por "/") a partir do `dir` relativo de uma
 * pasta (slugs ja unidos por "/", ou undefined na raiz) e do NOME da request.
 * PURA. Espelha a identidade usada pelo Sidebar para abrir abas.
 */
export function itemPathDe(dir: string | undefined, nomeRequest: string): string {
  const reqSlug = slugFront(nomeRequest);
  const d = (dir ?? "").trim();
  return d === "" ? reqSlug : `${d}/${reqSlug}`;
}
