// Espelho TS dos tipos da engine HTTP (src-tauri/src/http/types.rs).
// camelCase no IPC, igual ao resto do projeto. Estes tipos sao o contrato de
// envio (RequestData) e de resposta (ResponseData) entre front e Rust.

import type { KeyValue, RequestItem, BodyMode } from "./types";

/** Subset de KeyValue usado no envio/resposta (name/value/enabled). */
export interface KeyVal {
  name: string;
  value: string;
  enabled: boolean;
}

/** Corpo da request no envio (subset enxuto do Body do store). */
export interface RequestBody {
  /** Modo (snake_case, igual ao BodyMode do store). */
  mode: string;
  /** Texto cru para json/text/xml. */
  raw?: string;
  /** Pares para form_urlencoded. */
  form: KeyVal[];
}

/** Request a ser enviada para o comando `send_request`. */
export interface RequestData {
  method: string;
  url: string;
  headers: KeyVal[];
  params: KeyVal[];
  body: RequestBody;
  /** Timeout em ms. Omitido => default no Rust (30s). */
  timeoutMs?: number;
}

/** Resposta estruturada devolvida pelo Rust. */
export interface ResponseData {
  status: number;
  statusText: string;
  headers: KeyVal[];
  body: string;
  /** True se o corpo nao era UTF-8 valido (decodificado lossy). */
  bodyTruncatedLossy: boolean;
  timeMs: number;
  sizeBytes: number;
}

/** Erro tipado de envio, espelha o serde {kind, message} do HttpError. */
export interface HttpError {
  kind:
    | "invalidUrl"
    | "invalidMethod"
    | "invalidHeader"
    | "build"
    | "timeout"
    | "connect"
    | "body"
    | "network";
  message: string;
}

/** Metodos HTTP oferecidos no builder (F4). */
export const HTTP_METHODS = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
] as const;

export type HttpMethod = (typeof HTTP_METHODS)[number];

/** Converte um KeyValue do store para o KeyVal enxuto de envio. */
export function paraKeyVal(kv: KeyValue): KeyVal {
  return { name: kv.name, value: kv.value, enabled: kv.enabled };
}

/**
 * Monta um RequestData a partir de um RequestItem do store (LOGICA PURA).
 * Filtra nada aqui (o Rust respeita `enabled`); apenas projeta os campos
 * relevantes pro envio. Mapeia Body do store -> RequestBody enxuto.
 */
export function requestDataDeItem(item: RequestItem): RequestData {
  return {
    method: item.method || "GET",
    url: item.url,
    headers: item.headers.map(paraKeyVal),
    params: item.params.map(paraKeyVal),
    body: bodyParaRequestBody(item.body.mode, item.body.raw, item.body.form),
  };
}

/** Projeta os campos do Body do store no RequestBody de envio. LOGICA PURA. */
export function bodyParaRequestBody(
  mode: BodyMode,
  raw: string | undefined,
  form: KeyValue[] | undefined,
): RequestBody {
  return {
    mode,
    raw,
    form: (form ?? []).map(paraKeyVal),
  };
}

/** Type guard: distingue HttpError de outros erros vindos do invoke. */
export function isHttpError(e: unknown): e is HttpError {
  return (
    typeof e === "object" &&
    e !== null &&
    "kind" in e &&
    "message" in e &&
    typeof (e as HttpError).message === "string"
  );
}

/** Normaliza qualquer erro do invoke numa mensagem legivel. LOGICA PURA. */
export function mensagemDeErro(e: unknown): string {
  if (isHttpError(e)) return e.message;
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return String(e);
}
