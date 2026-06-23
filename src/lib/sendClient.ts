// Cliente fino sobre o comando IPC `send_request` (src-tauri/src/http/commands.rs).
// Envolve `invoke(...)` com tipagem, igual ao padrao de src/lib/ipc.ts.

import { invoke } from "@tauri-apps/api/core";
import type { RequestData, ResponseData } from "./http-types";

/**
 * Dispara uma request HTTP via engine Rust e devolve a resposta estruturada.
 * Em erro de rede/timeout/URL invalida, o invoke REJEITA com um HttpError
 * serializado ({kind, message}) — use mensagemDeErro/isHttpError pra tratar.
 */
export function sendRequest(req: RequestData): Promise<ResponseData> {
  return invoke<ResponseData>("send_request", { req });
}
