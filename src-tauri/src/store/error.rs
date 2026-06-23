// Erros do store. Implementa Serialize para virar string amigavel no IPC.

use serde::{Serialize, Serializer};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum StoreError {
    #[error("nome invalido: '{0}'")]
    InvalidName(String),

    #[error("nome rejeitado por path traversal: '{0}'")]
    PathTraversal(String),

    #[error("caminho fora do diretorio da colecao: '{0}'")]
    EscapaColecao(String),

    #[error("colecao nao encontrada em: '{0}'")]
    ColecaoNaoEncontrada(String),

    #[error("arquivo .yml excede o limite de tamanho: '{0}'")]
    ArquivoMuitoGrande(String),

    #[error("erro de YAML: {0}")]
    Yaml(String),

    #[error("erro de I/O: {0}")]
    Io(String),

    #[error("erro do watcher: {0}")]
    Watcher(String),
}

impl From<serde_yaml::Error> for StoreError {
    fn from(e: serde_yaml::Error) -> Self {
        StoreError::Yaml(e.to_string())
    }
}

impl From<std::io::Error> for StoreError {
    fn from(e: std::io::Error) -> Self {
        StoreError::Io(e.to_string())
    }
}

impl From<notify::Error> for StoreError {
    fn from(e: notify::Error) -> Self {
        StoreError::Watcher(e.to_string())
    }
}

// Serializa como a mensagem de erro (Display) para o front receber string limpa.
impl Serialize for StoreError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}
