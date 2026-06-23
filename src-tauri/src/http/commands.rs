// Comando IPC da engine HTTP (F4) + integracao com o cookie jar (F14).
//
// REGISTRAR NO lib.rs (fase de Integracao):
//   http::commands::send_request
//   .manage(http::cookies::CookieJarState::new())   // estado do cookie jar (F14)
//
// F14: o cookie jar compartilhado vive no estado Tauri (CookieJarState). O
// send_request consulta o estado: se o jar estiver LIGADO (default), injeta o
// store compartilhado no Client para manter cookies entre requests; desligado,
// roda como antes (sem sessao). Se o estado nao estiver gerenciado (cenario de
// compat/transicao), cai no caminho sem jar.

use crate::http::cookies::CookieJarState;
use crate::http::engine;
use crate::http::types::{HttpError, RequestData, ResponseData};

/// Dispara uma request HTTP e devolve a resposta estruturada.
/// Erros de rede/timeout/URL invalida viram HttpError serializado ({kind,message}),
/// nunca panic.
///
/// F14: usa o cookie jar compartilhado do estado quando ligado. O estado e
/// sempre `.manage`-ado no lib.rs (default ON); quando o toggle esta OFF,
/// `jar_para_envio()` devolve `None` e o envio roda sem cookie store.
#[tauri::command]
pub async fn send_request(
    req: RequestData,
    jar: tauri::State<'_, CookieJarState>,
) -> Result<ResponseData, HttpError> {
    let jar_para_envio = jar.jar_para_envio();
    engine::send_com_jar(req, jar_para_envio).await
}
