// F16 — Persistencia do historico de execucoes.
//
// O historico e uma lista de entradas (method/url/status/tempo/timestamp +
// snapshot da request) gravada em `~/.config/ruan/history.json`. O FORMATO e
// montado no frontend (src/lib/historico.ts); aqui o Rust apenas le/grava o
// texto JSON cru, mantendo o backend agnostico ao shape exato da entrada (so
// precisamos saber que e um array JSON para aplicar o limite de tamanho).
//
// Robustez (mesmo contrato de state.json/globals.yml): ler um arquivo ausente
// ou corrompido NUNCA derruba o app -> devolve "[]" (lista vazia). So erros de
// ESCRITA sao propagados.
//
// Limite de tamanho: ao LER, cortamos para as ultimas MAX_HISTORY entradas. A
// convencao da lista (definida no front) e "mais recente primeiro", entao o
// corte mantem o PREFIXO. Isso protege contra um history.json que cresceu demais
// (ex.: editado a mao ou de uma versao sem limite).
//
// Reusa `config_dir_de` (pub) do modulo pai para resolver o diretorio de config.

use std::path::PathBuf;

use crate::app_state::config_dir_de;
use crate::store::error::StoreError;

const HISTORY_FILE: &str = "history.json";

/// Numero maximo de entradas mantidas ao ler. Espelha LIMITE_HISTORICO do front.
pub const MAX_HISTORY: usize = 200;

/// Resolve o diretorio de config lendo as env vars reais e delegando a logica
/// pura `config_dir_de` do modulo pai.
fn config_dir() -> Option<PathBuf> {
    let xdg = std::env::var("XDG_CONFIG_HOME").ok();
    let home = std::env::var("HOME").ok();
    config_dir_de(xdg.as_deref(), home.as_deref())
}

/// Caminho completo do `history.json`, se o diretorio de config for resolvivel.
fn history_path() -> Option<PathBuf> {
    config_dir().map(|d| d.join(HISTORY_FILE))
}

/// Normaliza o texto do historico para um JSON-array valido, ja LIMITADO a
/// `max` entradas (mantendo o prefixo = mais recentes). LOGICA PURA.
///
/// Tolerante: entrada vazia, JSON invalido, ou raiz que nao e array viram "[]".
/// Assim um `history.json` corrompido nunca derruba o load (nem propaga lixo
/// para o front).
pub fn normalizar_history_json(raw: &str, max: usize) -> String {
    let valor: serde_json::Value = match serde_json::from_str(raw) {
        Ok(v) => v,
        Err(_) => return "[]".to_string(),
    };
    let arr = match valor {
        serde_json::Value::Array(a) => a,
        _ => return "[]".to_string(),
    };
    let cortado: Vec<serde_json::Value> = if arr.len() > max {
        arr.into_iter().take(max).collect()
    } else {
        arr
    };
    // Serializar um Vec<Value> nunca falha; fallback defensivo para "[]".
    serde_json::to_string(&cortado).unwrap_or_else(|_| "[]".to_string())
}

/// Carrega o historico persistido como texto JSON (array). Tolerante a falha:
/// arquivo ausente/corrompido -> "[]". Aplica o limite de tamanho na leitura.
pub fn load_history() -> String {
    let path = match history_path() {
        Some(p) => p,
        None => return "[]".to_string(),
    };
    let raw = match std::fs::read_to_string(&path) {
        Ok(c) => c,
        Err(_) => return "[]".to_string(),
    };
    normalizar_history_json(&raw, MAX_HISTORY)
}

/// Grava o historico (texto JSON cru vindo do front), criando o diretorio de
/// config se preciso. O conteudo e NORMALIZADO/LIMITADO antes de escrever, para
/// o arquivo nunca crescer indefinidamente nem guardar JSON invalido.
pub fn save_history(json: String) -> Result<(), StoreError> {
    let path = history_path()
        .ok_or_else(|| StoreError::Io("nao foi possivel resolver o diretorio de config".into()))?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let conteudo = normalizar_history_json(&json, MAX_HISTORY);
    std::fs::write(&path, conteudo)?;
    Ok(())
}

// ---- Comandos IPC ----
//
// Estes #[tauri::command] precisam ser registrados no `invoke_handler` do
// `lib.rs` pela fase de Integracao (ver retorno do agente).

/// Comando IPC: devolve o historico persistido como texto JSON (array).
#[tauri::command]
pub fn load_history_cmd() -> String {
    load_history()
}

/// Comando IPC: persiste o historico (texto JSON cru) no disco.
#[tauri::command]
pub fn save_history_cmd(json: String) -> Result<(), StoreError> {
    save_history(json)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vazio_vira_array_vazio() {
        assert_eq!(normalizar_history_json("", 200), "[]");
        assert_eq!(normalizar_history_json("   ", 200), "[]");
    }

    #[test]
    fn json_invalido_vira_array_vazio() {
        assert_eq!(normalizar_history_json("{nao json", 200), "[]");
        assert_eq!(normalizar_history_json("null", 200), "[]");
    }

    #[test]
    fn raiz_nao_array_vira_array_vazio() {
        // Um objeto na raiz e invalido (esperamos array) -> "[]".
        assert_eq!(normalizar_history_json(r#"{"a":1}"#, 200), "[]");
        assert_eq!(normalizar_history_json("42", 200), "[]");
    }

    #[test]
    fn array_valido_passa_intacto() {
        let r = normalizar_history_json(r#"[{"id":"a"},{"id":"b"}]"#, 200);
        let v: serde_json::Value = serde_json::from_str(&r).unwrap();
        assert!(v.is_array());
        assert_eq!(v.as_array().unwrap().len(), 2);
    }

    #[test]
    fn corta_para_o_limite_mantendo_prefixo() {
        // 5 entradas, limite 3 -> mantem as 3 PRIMEIRAS (mais recentes).
        let r = normalizar_history_json(r#"[1,2,3,4,5]"#, 3);
        assert_eq!(r, "[1,2,3]");
    }

    #[test]
    fn nao_corta_quando_dentro_do_limite() {
        let r = normalizar_history_json(r#"[1,2]"#, 3);
        assert_eq!(r, "[1,2]");
        // Exatamente no limite tambem nao corta.
        let r2 = normalizar_history_json(r#"[1,2,3]"#, 3);
        assert_eq!(r2, "[1,2,3]");
    }

    #[test]
    fn limite_zero_esvazia() {
        let r = normalizar_history_json(r#"[1,2,3]"#, 0);
        assert_eq!(r, "[]");
    }

    #[test]
    fn array_vazio_continua_vazio() {
        assert_eq!(normalizar_history_json("[]", 200), "[]");
    }
}
