// Watcher de filesystem por colecao. Observa o diretorio da colecao e emite o
// evento Tauri `collection-changed` quando algo muda no disco, para o front
// recarregar a arvore.
//
// O registro de watchers fica num estado gerenciado pelo Tauri (CollectionWatchers),
// indexado pelo caminho canonico da colecao. watch_collection liga; unwatch desliga.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::store::error::StoreError;

/// Nome do evento emitido pro front.
pub const EVENT_COLLECTION_CHANGED: &str = "collection-changed";

/// Payload do evento `collection-changed`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectionChanged {
    /// Caminho da colecao que mudou.
    pub path: String,
}

/// Estado gerenciado: watchers ativos indexados pelo caminho canonico.
#[derive(Default)]
pub struct CollectionWatchers {
    inner: Mutex<HashMap<PathBuf, RecommendedWatcher>>,
}

impl CollectionWatchers {
    pub fn new() -> Self {
        Self::default()
    }

    /// Liga o watcher para `dir`. Idempotente: re-observar a mesma colecao
    /// substitui o watcher anterior.
    pub fn watch(&self, app: AppHandle, dir: &Path) -> Result<(), StoreError> {
        let canon = dir
            .canonicalize()
            .map_err(|_| StoreError::ColecaoNaoEncontrada(dir.display().to_string()))?;

        let path_str = canon.display().to_string();
        let app_clone = app.clone();

        let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
            if res.is_ok() {
                // Avisa o front; ele decide recarregar. Erro de emit e ignorado
                // (janela fechada, etc).
                let _ = app_clone.emit(
                    EVENT_COLLECTION_CHANGED,
                    CollectionChanged {
                        path: path_str.clone(),
                    },
                );
            }
        })?;

        watcher.watch(&canon, RecursiveMode::Recursive)?;

        let mut map = self
            .inner
            .lock()
            .map_err(|e| StoreError::Watcher(e.to_string()))?;
        map.insert(canon, watcher);
        Ok(())
    }

    /// Desliga o watcher de `dir`, se existir.
    pub fn unwatch(&self, dir: &Path) -> Result<(), StoreError> {
        let canon = dir.canonicalize().unwrap_or_else(|_| dir.to_path_buf());
        let mut map = self
            .inner
            .lock()
            .map_err(|e| StoreError::Watcher(e.to_string()))?;
        // Dropar o watcher para de observar.
        map.remove(&canon);
        Ok(())
    }
}
