// F17 — Import: OpenAPI / Swagger 3 -> Collection do ruan. Parser PURO.
// Alvo de mutation. Recebe o doc cru (string JSON ou objeto) e devolve
// { name, items } sem persistir. Entrada malformada -> erro tratado, nunca lanca.
//
// Mapeamento:
//   info.title              -> name
//   servers[0].url          -> base da URL (prefixo {{baseUrl}} se ausente)
//   paths[path][method]     -> uma RequestItem por operacao
//   operation.tags[0]       -> agrupa em pasta (sem tag -> raiz)
//   parameters (query/header)-> params/headers (path params viram {var} na URL)
//   requestBody (json)      -> body JSON (exemplo, se houver)
//   summary/description     -> docs/name
// Nao resolve $ref profundamente; usa exemplos rasos quando presentes.

import type {
  TreeItem,
  RequestItem,
  KeyValue,
  Body,
  Folder,
} from "../types";
import { novaRequest } from "../types";
import type { ImportResult, ParseResult } from "./curl";

const METODOS = [
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "head",
  "options",
] as const;

interface OAParam {
  name?: string;
  in?: string;
  required?: boolean;
  description?: string;
  schema?: { default?: unknown; example?: unknown };
  example?: unknown;
}

interface OAMediaType {
  schema?: unknown;
  example?: unknown;
  examples?: Record<string, { value?: unknown }>;
}

interface OARequestBody {
  content?: Record<string, OAMediaType>;
  required?: boolean;
}

interface OAOperation {
  tags?: string[];
  summary?: string;
  description?: string;
  operationId?: string;
  parameters?: OAParam[];
  requestBody?: OARequestBody;
}

interface OAPathItem {
  parameters?: OAParam[];
  [method: string]: OAOperation | OAParam[] | undefined;
}

interface OADoc {
  openapi?: string;
  swagger?: string;
  info?: { title?: string };
  servers?: Array<{ url?: string }>;
  host?: string;
  basePath?: string;
  schemes?: string[];
  paths?: Record<string, OAPathItem>;
}

/** Parseia um doc OpenAPI/Swagger. PURA. Nunca lanca: devolve ParseResult. */
export function parseOpenapi(entrada: string | unknown): ParseResult {
  let doc: OADoc;
  if (typeof entrada === "string") {
    try {
      doc = JSON.parse(entrada) as OADoc;
    } catch {
      return {
        ok: false,
        error: "Documento OpenAPI invalido (JSON nao parseavel).",
      };
    }
  } else if (entrada && typeof entrada === "object") {
    doc = entrada as OADoc;
  } else {
    return { ok: false, error: "Entrada OpenAPI vazia ou invalida." };
  }

  if (!doc.paths || typeof doc.paths !== "object") {
    return {
      ok: false,
      error: "Documento OpenAPI sem `paths` (formato nao reconhecido).",
    };
  }

  const name = (doc.info?.title && doc.info.title.trim()) || "API importada";
  const base = baseUrl(doc);

  // Agrupa por tag. Mantemos ordem de aparicao das tags.
  const porTag = new Map<string, TreeItem[]>();
  const semTag: TreeItem[] = [];
  let seqGlobal = 0;

  for (const [caminho, pathItem] of Object.entries(doc.paths)) {
    if (!pathItem || typeof pathItem !== "object") continue;
    const paramsDoPath = Array.isArray(pathItem.parameters)
      ? pathItem.parameters
      : [];

    for (const metodo of METODOS) {
      const op = pathItem[metodo] as OAOperation | undefined;
      if (!op || typeof op !== "object" || Array.isArray(op)) continue;

      const req = converterOperacao(
        metodo.toUpperCase(),
        caminho,
        op,
        paramsDoPath,
        base,
        seqGlobal,
      );
      const node: TreeItem = { type: "request", ...req };

      const tag = Array.isArray(op.tags) && op.tags[0] ? String(op.tags[0]) : "";
      if (tag) {
        const lista = porTag.get(tag) ?? [];
        lista.push(node);
        porTag.set(tag, lista);
      } else {
        semTag.push(node);
      }
      seqGlobal += 1;
    }
  }

  const items: TreeItem[] = [];
  let seqPasta = 0;
  for (const [tag, reqs] of porTag) {
    const folder: { type: "folder" } & Folder = {
      type: "folder",
      name: tag,
      seq: seqPasta,
      items: reqs.map((r, i) => ({ ...r, seq: i }) as TreeItem),
    };
    items.push(folder);
    seqPasta += 1;
  }
  // Requests sem tag vao na raiz, depois das pastas.
  for (const r of semTag) {
    items.push({ ...r, seq: seqPasta } as TreeItem);
    seqPasta += 1;
  }

  const collection: ImportResult = { name, items };
  return { ok: true, collection };
}

/** Deriva a base da URL do doc (OpenAPI 3 servers ou Swagger 2 host). PURA. */
export function baseUrl(doc: OADoc): string {
  if (Array.isArray(doc.servers) && doc.servers[0]?.url) {
    return String(doc.servers[0].url).replace(/\/$/, "");
  }
  if (doc.host) {
    const scheme =
      Array.isArray(doc.schemes) && doc.schemes.length
        ? doc.schemes[0]
        : "https";
    const basePath = doc.basePath ? String(doc.basePath) : "";
    return `${scheme}://${doc.host}${basePath}`.replace(/\/$/, "");
  }
  // Sem servidor declarado: usa variavel de ambiente do ruan.
  return "{{baseUrl}}";
}

/** Converte uma operacao OpenAPI em RequestItem. PURA. */
export function converterOperacao(
  method: string,
  caminho: string,
  op: OAOperation,
  paramsDoPath: OAParam[],
  base: string,
  seq: number,
): RequestItem {
  const nome =
    (op.summary && op.summary.trim()) ||
    (op.operationId && op.operationId.trim()) ||
    `${method} ${caminho}`;

  const req = novaRequest(nome, seq);
  req.method = method;
  req.url = juntarUrl(base, caminho);

  // Combina parametros do path-item com os da operacao (operacao tem prioridade
  // em caso de mesmo name+in, mas para simplicidade concatenamos e deduplicamos).
  const todos = [...paramsDoPath, ...(op.parameters ?? [])];
  const vistos = new Set<string>();
  const params: KeyValue[] = [];
  const headers: KeyValue[] = [];

  for (const p of todos) {
    if (!p || !p.name || !p.in) continue;
    const chave = `${p.in}:${p.name}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);

    const valor = valorExemplo(p);
    if (p.in === "query") {
      params.push({
        name: p.name,
        value: valor,
        enabled: p.required !== false,
        ...(p.description ? { description: String(p.description) } : {}),
      });
    } else if (p.in === "header") {
      headers.push({
        name: p.name,
        value: valor,
        enabled: p.required !== false,
        ...(p.description ? { description: String(p.description) } : {}),
      });
    }
    // path params ja estao na URL como {var}; nao adicionamos.
  }

  req.params = params;
  req.headers = headers;
  req.body = converterRequestBody(op.requestBody);
  if (op.description || op.summary) {
    req.docs = String(op.description ?? op.summary ?? "");
  }

  return req;
}

/** Extrai um valor de exemplo de um parametro. PURA. "" se nenhum. */
export function valorExemplo(p: OAParam): string {
  if (p.example !== undefined && p.example !== null) return String(p.example);
  if (p.schema) {
    if (p.schema.example !== undefined && p.schema.example !== null)
      return String(p.schema.example);
    if (p.schema.default !== undefined && p.schema.default !== null)
      return String(p.schema.default);
  }
  return "";
}

/** Monta o Body a partir do requestBody (prefere application/json). PURA. */
export function converterRequestBody(rb: OARequestBody | undefined): Body {
  if (!rb || !rb.content || typeof rb.content !== "object") {
    return { mode: "none" };
  }

  const content = rb.content;
  const json = content["application/json"];
  if (json) {
    const exemplo = exemploDeMedia(json);
    return {
      mode: "json",
      raw: exemplo !== undefined ? jsonBonito(exemplo) : "",
    };
  }

  if (content["application/xml"] || content["text/xml"]) {
    return { mode: "xml", raw: "" };
  }

  if (content["application/x-www-form-urlencoded"]) {
    return { mode: "form_urlencoded", form: [] };
  }

  const primeiro = Object.keys(content)[0];
  if (primeiro && primeiro.includes("json")) {
    const exemplo = exemploDeMedia(content[primeiro]);
    return {
      mode: "json",
      raw: exemplo !== undefined ? jsonBonito(exemplo) : "",
    };
  }

  return { mode: "text", raw: "" };
}

/** Pega um exemplo do media type (example direto ou examples[*].value). PURA. */
export function exemploDeMedia(media: OAMediaType): unknown {
  if (media.example !== undefined) return media.example;
  if (media.examples && typeof media.examples === "object") {
    for (const k of Object.keys(media.examples)) {
      const v = media.examples[k];
      if (v && "value" in v) return v.value;
    }
  }
  return undefined;
}

/** JSON.stringify tolerante e identado. PURA. */
function jsonBonito(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return "";
  }
}

/** Junta base + caminho sem duplicar barras. PURA. */
export function juntarUrl(base: string, caminho: string): string {
  const b = base.replace(/\/$/, "");
  const c = caminho.startsWith("/") ? caminho : `/${caminho}`;
  return `${b}${c}`;
}
