// Comando IPC da engine HTTP (F4).
//
// REGISTRAR NO lib.rs (fase de Integracao):
//   http::commands::send_request
//
// Nao ha estado Tauri (.manage) necessario: o cliente reqwest e criado por
// envio (timeout por request). Se no futuro quisermos reaproveitar conexoes,
// da pra mover um Client pro estado gerenciado.

use crate::http::engine;
use crate::http::types::{HttpError, RequestData, ResponseData};

/// Dispara uma request HTTP e devolve a resposta estruturada.
/// Erros de rede/timeout/URL invalida viram HttpError serializado ({kind,message}),
/// nunca panic.
#[tauri::command]
pub async fn send_request(req: RequestData) -> Result<ResponseData, HttpError> {
    engine::send(req).await
}
