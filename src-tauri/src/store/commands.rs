// Comandos IPC do store. TODO input vindo do front e NAO-CONFIAVEL: validamos
// caminhos e nomes aqui antes de tocar o disco.

use std::path::PathBuf;

use tauri::{AppHandle, State};

use crate::store::error::StoreError;
use crate::store::fs_store;
use crate::store::models::{Collection, RequestItem};
use crate::store::watcher::CollectionWatchers;

/// Resolve o `dir` (Option<String>) vindo do front em um `target_dir` e valida,
/// como DEFESA EM PROFUNDIDADE, que ele esta dentro de `collection_dir` ANTES de
/// qualquer toque no disco. O `dir` e input nao-confiavel: sem esta checagem, a
/// protecao contra traversal dependeria so do `dentro_de` la no fundo do
/// fs_store. Se `dir` for None, usa a raiz da colecao (trivialmente dentro).
fn resolver_target_dir(
    collection_dir: &PathBuf,
    dir: Option<String>,
) -> Result<PathBuf, StoreError> {
    let target_dir = match dir {
        Some(d) => PathBuf::from(d),
        None => collection_dir.clone(),
    };
    fs_store::dentro_de(collection_dir, &target_dir)?;
    Ok(target_dir)
}

/// Abre/carrega a colecao no diretorio `path`, retornando a arvore completa.
#[tauri::command]
pub fn open_collection(path: String) -> Result<Collection, StoreError> {
    let dir = PathBuf::from(&path);
    fs_store::load_collection(&dir)
}

/// Grava uma request. `dir` (subdiretorio) deve estar dentro de `collection_path`.
/// Se `dir` for None, grava na raiz da colecao.
#[tauri::command]
pub fn save_request(
    collection_path: String,
    dir: Option<String>,
    request: RequestItem,
) -> Result<String, StoreError> {
    let collection_dir = PathBuf::from(&collection_path);
    let target_dir = resolver_target_dir(&collection_dir, dir)?;
    let written = fs_store::save_request(&collection_dir, &target_dir, &request)?;
    Ok(written.display().to_string())
}

/// Cria uma subpasta dentro da colecao.
#[tauri::command]
pub fn create_folder(
    collection_path: String,
    dir: Option<String>,
    name: String,
    seq: u32,
) -> Result<String, StoreError> {
    let collection_dir = PathBuf::from(&collection_path);
    let target_dir = resolver_target_dir(&collection_dir, dir)?;
    let created = fs_store::create_folder(&collection_dir, &target_dir, &name, seq)?;
    Ok(created.display().to_string())
}

/// Remove uma request pelo nome dentro de `dir` (ou da raiz da colecao).
#[tauri::command]
pub fn delete_request(
    collection_path: String,
    dir: Option<String>,
    name: String,
) -> Result<(), StoreError> {
    let collection_dir = PathBuf::from(&collection_path);
    let target_dir = resolver_target_dir(&collection_dir, dir)?;
    fs_store::delete_request(&collection_dir, &target_dir, &name)
}

/// Liga o watcher de filesystem para a colecao em `path`.
#[tauri::command]
pub fn watch_collection(
    app: AppHandle,
    watchers: State<'_, CollectionWatchers>,
    path: String,
) -> Result<(), StoreError> {
    let dir = PathBuf::from(&path);
    watchers.watch(app, &dir)
}

/// Desliga o watcher de filesystem da colecao em `path`.
#[tauri::command]
pub fn unwatch_collection(
    watchers: State<'_, CollectionWatchers>,
    path: String,
) -> Result<(), StoreError> {
    let dir = PathBuf::from(&path);
    watchers.unwatch(&dir)
}
