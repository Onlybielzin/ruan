// F7 — Logica PURA do editor de body multi-modo. Sem React, sem IPC: tudo aqui
// e funcao pura e testavel (alvo de mutation testing). O componente BodyEditor
// delega a estas funcoes; o store guarda o resultado.
//
// Decisoes de modelagem:
// - O Content-Type so e setado automaticamente se o usuario NAO definiu um
//   header Content-Type manualmente (case-insensitive).
// - multipart guarda os pares em Body.form (igual form_urlencoded). Um par que
//   representa um arquivo usa o prefixo MULTIPART_FILE_PREFIX no `value` para
//   carregar o caminho do arquivo (o backend de envio resolve o caminho).

import type { BodyMode, KeyValue } from "./types";

/** Modos oferecidos no seletor da UI, na ordem de exibicao. */
export const BODY_MODES: readonly BodyMode[] = [
  "none",
  "json",
  "text",
  "xml",
  "form_urlencoded",
  "multipart",
  "graphql",
] as const;

/** Rotulo amigavel de cada modo para a UI. LOGICA PURA. */
export function rotuloModo(mode: BodyMode): string {
  switch (mode) {
    case "none":
      return "Nenhum";
    case "json":
      return "JSON";
    case "text":
      return "Text";
    case "xml":
      return "XML";
    case "form_urlencoded":
      return "Form URL Encoded";
    case "multipart":
      return "Multipart Form";
    case "graphql":
      return "GraphQL";
    default:
      return mode;
  }
}

/** True se o modo usa um editor de texto cru (CodeMirror). LOGICA PURA. */
export function modoUsaRaw(mode: BodyMode): boolean {
  return (
    mode === "json" || mode === "text" || mode === "xml" || mode === "graphql"
  );
}

/** True se o modo usa uma tabela key/value. LOGICA PURA. */
export function modoUsaForm(mode: BodyMode): boolean {
  return mode === "form_urlencoded" || mode === "multipart";
}

/**
 * Content-Type que cada modo implica. null quando o modo nao define corpo
 * (none) ou nao tem um Content-Type fixo previsivel (multipart precisa de um
 * boundary gerado no envio, entao NAO devolvemos aqui). LOGICA PURA.
 *
 * Espelha src-tauri/src/http/engine.rs::content_type_default, exceto que aqui
 * tambem cobrimos a intencao de multipart (mas devolvendo null por causa do
 * boundary — quem monta o boundary e a engine de envio).
 */
export function contentTypeDeModo(mode: BodyMode): string | null {
  switch (mode) {
    case "json":
    case "graphql":
      return "application/json";
    case "xml":
      return "application/xml";
    case "text":
      return "text/plain";
    case "form_urlencoded":
      return "application/x-www-form-urlencoded";
    case "multipart":
    case "none":
    default:
      return null;
  }
}

const CONTENT_TYPE = "content-type";

/**
 * Indice (0-based) do primeiro header Content-Type habilitado e com nome
 * preenchido, comparando case-insensitive. -1 se nao houver. LOGICA PURA.
 */
export function indiceContentType(headers: readonly KeyValue[]): number {
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i];
    if (h.enabled && h.name.trim().toLowerCase() === CONTENT_TYPE) {
      return i;
    }
  }
  return -1;
}

/** True se ja existe um header Content-Type habilitado. LOGICA PURA. */
export function temContentTypeManual(headers: readonly KeyValue[]): boolean {
  return indiceContentType(headers) >= 0;
}

/**
 * Aplica o Content-Type automatico do modo aos headers, SEM sobrescrever um
 * Content-Type que o usuario ja definiu manualmente. LOGICA PURA — devolve um
 * novo array (nao muta a entrada).
 *
 * Regras:
 * - Se o usuario ja tem um header Content-Type habilitado -> nao mexe.
 * - Se o modo nao tem Content-Type fixo (none/multipart) -> nao mexe.
 * - Caso contrario, adiciona um header Content-Type com o valor do modo.
 */
export function aplicarContentTypeAuto(
  headers: readonly KeyValue[],
  mode: BodyMode,
): KeyValue[] {
  const copia = headers.map((h) => ({ ...h }));
  if (temContentTypeManual(copia)) return copia;
  const ct = contentTypeDeModo(mode);
  if (ct === null) return copia;
  copia.push({ name: "Content-Type", value: ct, enabled: true });
  return copia;
}

/** Resultado de uma tentativa de formatar/validar JSON. */
export interface ResultadoJson {
  /** True se o texto e JSON valido. */
  ok: boolean;
  /** Texto formatado (so quando ok). Igual ao texto original quando ok=false. */
  texto: string;
  /** Mensagem de erro quando ok=false; string vazia quando ok. */
  erro: string;
}

/**
 * Formata (pretty-print) um JSON com indentacao de `espacos`. Se o texto nao
 * for JSON valido, devolve ok=false com a mensagem do parser e o texto
 * original intacto. LOGICA PURA. Texto so com espacos em branco e tratado como
 * valido-vazio (devolve string vazia), pra nao acusar erro num campo em branco.
 */
export function formatarJson(texto: string, espacos = 2): ResultadoJson {
  if (texto.trim().length === 0) {
    return { ok: true, texto: "", erro: "" };
  }
  try {
    const valor = JSON.parse(texto);
    return { ok: true, texto: JSON.stringify(valor, null, espacos), erro: "" };
  } catch (e) {
    return {
      ok: false,
      texto,
      erro: e instanceof Error ? e.message : String(e),
    };
  }
}

/** True se o texto e JSON valido (ou vazio). LOGICA PURA. */
export function jsonValido(texto: string): boolean {
  return formatarJson(texto).ok;
}

// ---- Multipart: marcacao de campos de arquivo -----------------------------
// O modelo KeyValue do store nao tem um campo dedicado a arquivo. Para nao
// alterar o schema (propriedade de outra feature), codificamos um campo de
// arquivo no proprio `value` com um prefixo sentinela. A engine de envio (ou a
// fase de Integracao) interpreta o prefixo para anexar o arquivo.

/** Prefixo sentinela que marca um par multipart como upload de arquivo. */
export const MULTIPART_FILE_PREFIX = "@file:";

/** True se o par representa um upload de arquivo. LOGICA PURA. */
export function ehCampoArquivo(par: KeyValue): boolean {
  return par.value.startsWith(MULTIPART_FILE_PREFIX);
}

/**
 * Caminho do arquivo de um par marcado como arquivo (sem o prefixo). Devolve
 * string vazia se ainda nao ha arquivo selecionado ou o par nao e arquivo.
 * LOGICA PURA.
 */
export function caminhoDoCampoArquivo(par: KeyValue): string {
  if (!ehCampoArquivo(par)) return "";
  return par.value.slice(MULTIPART_FILE_PREFIX.length);
}

/** Monta o `value` de um par de arquivo a partir de um caminho. LOGICA PURA. */
export function valueDeArquivo(caminho: string): string {
  return MULTIPART_FILE_PREFIX + caminho;
}

/**
 * Nome de exibicao (basename) de um caminho de arquivo, lidando com separadores
 * "/" e "\\". Devolve string vazia para caminho vazio. LOGICA PURA.
 */
export function nomeDoArquivo(caminho: string): string {
  if (caminho.length === 0) return "";
  const normalizado = caminho.replace(/\\/g, "/");
  const partes = normalizado.split("/");
  return partes[partes.length - 1];
}

/** Cria um par key/value vazio e habilitado (linha nova da tabela). PURA. */
export function novoPar(): KeyValue {
  return { name: "", value: "", enabled: true };
}
