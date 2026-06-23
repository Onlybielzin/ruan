// Cliente fino sobre os comandos IPC do store (src-tauri/src/store/commands.rs).
// Envolve `invoke(...)` com tipagem. Cada funcao corresponde a um #[tauri::command].

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { Collection, RequestItem } from "./types";

/** Nome do evento emitido pelo watcher quando a colecao muda no disco. */
export const EVENT_COLLECTION_CHANGED = "collection-changed";

export interface CollectionChangedEvent {
  path: string;
}

/** Abre/carrega a colecao no diretorio `path`. */
export function openCollection(path: string): Promise<Collection> {
  return invoke<Collection>("open_collection", { path });
}

/**
 * Grava uma request. `dir` opcional e o subdiretorio dentro da colecao;
 * se omitido, grava na raiz. Retorna o caminho do arquivo gravado.
 */
export function saveRequest(
  collectionPath: string,
  request: RequestItem,
  dir?: string,
): Promise<string> {
  return invoke<string>("save_request", { collectionPath, dir, request });
}

/** Cria uma subpasta dentro da colecao. Retorna o caminho criado. */
export function createFolder(
  collectionPath: string,
  name: string,
  seq: number,
  dir?: string,
): Promise<string> {
  return invoke<string>("create_folder", { collectionPath, dir, name, seq });
}

/** Remove uma request pelo nome dentro de `dir` (ou raiz da colecao). */
export function deleteRequest(
  collectionPath: string,
  name: string,
  dir?: string,
): Promise<void> {
  return invoke<void>("delete_request", { collectionPath, dir, name });
}

/** Liga o watcher de filesystem para a colecao em `path`. */
export function watchCollection(path: string): Promise<void> {
  return invoke<void>("watch_collection", { path });
}

/** Desliga o watcher de filesystem da colecao em `path`. */
export function unwatchCollection(path: string): Promise<void> {
  return invoke<void>("unwatch_collection", { path });
}

/** Assina o evento `collection-changed`. Retorna funcao para desassinar. */
export function onCollectionChanged(
  handler: (event: CollectionChangedEvent) => void,
): Promise<UnlistenFn> {
  return listen<CollectionChangedEvent>(EVENT_COLLECTION_CHANGED, (e) =>
    handler(e.payload),
  );
}
