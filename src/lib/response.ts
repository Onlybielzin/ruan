// Logica PURA do viewer de resposta (F8). Alvo de mutation testing.
// Sem dependencias de React/DOM: formatacao de tamanho, deteccao de tipo de
// conteudo a partir do content-type, pretty-print de JSON, faixa/cor de status
// e extracao de cookies dos headers. Componentes React delegam a estas funcoes.

import type { KeyVal, ResponseData } from "./http-types";

/** Categorias de conteudo que o viewer sabe renderizar. */
export type ContentKind =
  | "json"
  | "html"
  | "xml"
  | "image"
  | "pdf"
  | "text"
  | "binary";

/** Faixa de status HTTP (informacional..erro de servidor). */
export type StatusClass = "1xx" | "2xx" | "3xx" | "4xx" | "5xx" | "unknown";

/**
 * Formata um tamanho em bytes para string legivel (B / KB / MB / GB).
 * Usa base 1024. Negativos sao tratados como 0. LOGICA PURA.
 */
export function formatarTamanho(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const unidades = ["B", "KB", "MB", "GB", "TB"];
  let valor = bytes;
  let i = 0;
  while (valor >= 1024 && i < unidades.length - 1) {
    valor /= 1024;
    i += 1;
  }
  // Bytes inteiros sem casas; demais com ate 2 casas, sem zeros a direita.
  const texto = i === 0 ? String(Math.round(valor)) : arredondar(valor);
  return `${texto} ${unidades[i]}`;
}

/** Arredonda para no maximo 2 casas decimais e remove zeros a direita. */
function arredondar(valor: number): string {
  const fixo = valor.toFixed(2);
  // Remove ".00" -> "" e "X.Y0" -> "X.Y".
  return fixo.replace(/\.?0+$/, "");
}

/** Formata um tempo em ms de forma legivel (ms ate 1s, depois s). LOGICA PURA. */
export function formatarTempo(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0 ms";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${arredondar(ms / 1000)} s`;
}

/**
 * Extrai o mime base de um valor de header content-type, em minusculas e sem
 * parametros (";charset=..."). Retorna "" se vazio. LOGICA PURA.
 */
export function mimeBase(contentType: string | undefined | null): string {
  if (!contentType) return "";
  const semParametros = contentType.split(";")[0];
  return semParametros.trim().toLowerCase();
}

/**
 * Classifica um content-type numa ContentKind. Reconhece json (inclui +json),
 * html, xml (inclui +xml), image/*, pdf e text/*; o resto vira "binary".
 * LOGICA PURA.
 */
export function detectarTipoConteudo(
  contentType: string | undefined | null,
): ContentKind {
  const mime = mimeBase(contentType);
  if (mime === "") return "text";
  if (mime === "application/json" || mime.endsWith("+json")) return "json";
  if (mime === "text/html" || mime === "application/xhtml+xml") return "html";
  if (
    mime === "application/xml" ||
    mime === "text/xml" ||
    mime.endsWith("+xml")
  ) {
    return "xml";
  }
  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("text/")) return "text";
  // Alguns textuais comuns sem prefixo text/.
  if (
    mime === "application/javascript" ||
    mime === "application/ecmascript" ||
    mime === "application/x-www-form-urlencoded" ||
    mime === "application/graphql"
  ) {
    return "text";
  }
  return "binary";
}

/**
 * Busca (case-insensitive) o valor do primeiro header com o nome dado.
 * Retorna undefined se nao existir. LOGICA PURA.
 */
export function headerValor(
  headers: KeyVal[],
  nome: string,
): string | undefined {
  const alvo = nome.toLowerCase();
  for (const h of headers) {
    if (h.name.toLowerCase() === alvo) return h.value;
  }
  return undefined;
}

/** Atalho: content-type da resposta (ou undefined). LOGICA PURA. */
export function contentTypeDeResposta(
  resposta: Pick<ResponseData, "headers">,
): string | undefined {
  return headerValor(resposta.headers, "content-type");
}

/**
 * Pretty-print de JSON. Tenta parsear `texto`; se valido, reindenta com 2
 * espacos. Se invalido, retorna o texto original inalterado (ok: false).
 * Nunca lanca. LOGICA PURA.
 */
export function prettyJson(
  texto: string,
  espacos = 2,
): { ok: boolean; texto: string } {
  if (texto.trim().length === 0) return { ok: false, texto };
  try {
    const valor = JSON.parse(texto);
    return { ok: true, texto: JSON.stringify(valor, null, espacos) };
  } catch {
    return { ok: false, texto };
  }
}

/** Classifica um status code numa faixa. LOGICA PURA. */
export function classeDeStatus(status: number): StatusClass {
  if (status >= 100 && status < 200) return "1xx";
  if (status >= 200 && status < 300) return "2xx";
  if (status >= 300 && status < 400) return "3xx";
  if (status >= 400 && status < 500) return "4xx";
  if (status >= 500 && status < 600) return "5xx";
  return "unknown";
}

/**
 * Cor hex associada a faixa do status (verde 2xx, ciano 1xx, amarelo 3xx,
 * laranja 4xx, vermelho 5xx, cinza desconhecido). LOGICA PURA.
 */
export function corDeStatus(status: number): string {
  switch (classeDeStatus(status)) {
    case "1xx":
      return "#22d3ee";
    case "2xx":
      return "#22c55e";
    case "3xx":
      return "#eab308";
    case "4xx":
      return "#f97316";
    case "5xx":
      return "#ef4444";
    default:
      return "#9ca3af";
  }
}

/** Um cookie parseado de um header Set-Cookie. */
export interface CookieInfo {
  name: string;
  value: string;
  /** Atributos restantes (Path, HttpOnly, Secure, etc.), na ordem original. */
  attributes: { name: string; value: string }[];
}

/**
 * Faz parse de UM valor de Set-Cookie em nome/valor + atributos. Atributos sem
 * "=" (HttpOnly, Secure) ficam com value "". Retorna null se nao houver par
 * nome=valor inicial valido. LOGICA PURA.
 */
export function parseSetCookie(linha: string): CookieInfo | null {
  const partes = linha.split(";");
  const primeiro = partes[0] ?? "";
  const idx = primeiro.indexOf("=");
  if (idx < 0) return null;
  const name = primeiro.slice(0, idx).trim();
  if (name.length === 0) return null;
  const value = primeiro.slice(idx + 1).trim();
  const attributes = partes.slice(1).map((p) => {
    const a = p.indexOf("=");
    if (a < 0) return { name: p.trim(), value: "" };
    return { name: p.slice(0, a).trim(), value: p.slice(a + 1).trim() };
  });
  return { name, value, attributes };
}

/**
 * Extrai todos os cookies dos headers Set-Cookie de uma resposta (ignora
 * linhas invalidas). LOGICA PURA.
 */
export function extrairCookies(headers: KeyVal[]): CookieInfo[] {
  const out: CookieInfo[] = [];
  for (const h of headers) {
    if (h.name.toLowerCase() !== "set-cookie") continue;
    const c = parseSetCookie(h.value);
    if (c) out.push(c);
  }
  return out;
}

/**
 * Conta ocorrencias (case-insensitive) de `termo` em `texto`. Termo vazio => 0.
 * Usado pela busca dentro do body. LOGICA PURA.
 */
export function contarOcorrencias(texto: string, termo: string): number {
  if (termo.length === 0) return 0;
  const alvo = texto.toLowerCase();
  const t = termo.toLowerCase();
  let count = 0;
  let from = 0;
  for (;;) {
    const i = alvo.indexOf(t, from);
    if (i < 0) break;
    count += 1;
    from = i + t.length;
  }
  return count;
}

/**
 * Indica se uma ContentKind deve ser renderizada como dado binario (imagem/pdf)
 * em vez de texto. LOGICA PURA.
 */
export function ehBinario(kind: ContentKind): boolean {
  return kind === "image" || kind === "pdf" || kind === "binary";
}
