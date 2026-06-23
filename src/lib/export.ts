// F17 — Export: Collection do ruan -> Postman Collection v2.1. PURO.
// Alvo de mutation. Recebe uma Collection (em memoria) e devolve o objeto
// Postman serializavel (e um helper que ja entrega a string JSON). O formato
// nativo do ruan continua sendo o disco YAML; aqui so cobrimos a saida Postman.
//
// Mapeamento inverso de import/postman.ts:
//   name        -> info.name + info.schema
//   folder      -> item com .item[] (recursivo)
//   request     -> item com .request
//   headers     -> request.header[]
//   params      -> url.query[] (e raw remontada com ?a=b)
//   body        -> request.body (raw/urlencoded/formdata/graphql)
//   auth        -> request.auth

import type {
  Collection,
  TreeItem,
  RequestItem,
  KeyValue,
  Body,
  Auth,
  Folder,
} from "./types";
import { isFolder, isRequest } from "./types";

const SCHEMA_V21 =
  "https://schema.getpostman.com/json/collection/v2.1.0/collection.json";

// ---- Plano de persistencia de uma colecao importada (PURO) ----
//
// O import gera uma arvore em memoria; para gravar no disco usamos os comandos
// EXISTENTES (create_folder + save_request). Este plano achata a arvore numa
// lista ordenada de operacoes que o componente executa via IPC, na ordem: pasta
// pai antes dos filhos. Mantemos a logica de caminho (dir) aqui, PURA e testavel.

/** Slug front-side, espelho do slug_seguro do backend. PURO. */
export function slugSeguro(nome: string): string {
  return nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Operacao de criar pasta (relativa a colecao). `dir` = pai (undefined=raiz). */
export interface OpCriarPasta {
  tipo: "pasta";
  dir?: string;
  name: string;
  seq: number;
}

/** Operacao de salvar request. `dir` = pasta destino (undefined=raiz). */
export interface OpSalvarRequest {
  tipo: "request";
  dir?: string;
  request: RequestItem;
}

export type OpPersistencia = OpCriarPasta | OpSalvarRequest;

/**
 * Achata uma arvore de TreeItem numa lista de operacoes de persistencia, em
 * ordem topologica (pasta antes do conteudo). LOGICA PURA. `dirBase` e o
 * subdiretorio inicial relativo (normalmente undefined = raiz da colecao).
 */
export function planoDePersistencia(
  items: TreeItem[] | undefined,
  dirBase?: string,
): OpPersistencia[] {
  const ops: OpPersistencia[] = [];
  if (!Array.isArray(items)) return ops;

  items.forEach((item, i) => {
    if (isFolder(item)) {
      const nome = item.name || `pasta-${i + 1}`;
      ops.push({ tipo: "pasta", dir: dirBase, name: nome, seq: i });
      const filhoDir = juntarDir(dirBase, slugSeguro(nome));
      ops.push(...planoDePersistencia(item.items, filhoDir));
    } else if (isRequest(item)) {
      ops.push({ tipo: "request", dir: dirBase, request: { ...item, seq: i } });
    }
  });

  return ops;
}

/** Junta segmentos de dir relativo com "/". undefined+x => x. PURO. */
export function juntarDir(base: string | undefined, seg: string): string {
  if (!base) return seg;
  return `${base}/${seg}`;
}

export interface PMExportHeader {
  key: string;
  value: string;
  disabled?: boolean;
  description?: string;
}

export interface PMExportQuery {
  key: string;
  value: string;
  disabled?: boolean;
}

export interface PMExportUrl {
  raw: string;
  host?: string[];
  path?: string[];
  query?: PMExportQuery[];
  protocol?: string;
}

export interface PMExportBody {
  mode: string;
  raw?: string;
  urlencoded?: PMExportHeader[];
  formdata?: Array<PMExportHeader & { type: string }>;
  graphql?: { query: string; variables: string };
  options?: { raw: { language: string } };
}

export interface PMExportAuthParam {
  key: string;
  value: string;
  type: "string";
}

export interface PMExportAuth {
  type: string;
  basic?: PMExportAuthParam[];
  bearer?: PMExportAuthParam[];
  apikey?: PMExportAuthParam[];
}

export interface PMExportRequest {
  method: string;
  header: PMExportHeader[];
  url: PMExportUrl;
  body?: PMExportBody;
  auth?: PMExportAuth;
  description?: string;
}

export interface PMExportItem {
  name: string;
  item?: PMExportItem[];
  request?: PMExportRequest;
  description?: string;
}

export interface PMExportCollection {
  info: { name: string; schema: string };
  item: PMExportItem[];
}

/** Exporta uma Collection do ruan para o objeto Postman v2.1. PURA. */
export function paraPostman(col: Collection): PMExportCollection {
  const items = Array.isArray(col?.items) ? col.items : [];
  return {
    info: {
      name: (col?.name && String(col.name)) || "Colecao",
      schema: SCHEMA_V21,
    },
    item: items.map(exportarItem),
  };
}

/** Helper: exporta direto para string JSON identada. PURA. */
export function paraPostmanString(col: Collection): string {
  return JSON.stringify(paraPostman(col), null, 2);
}

/** Converte um TreeItem em PMExportItem (pasta ou request). PURA. */
export function exportarItem(item: TreeItem): PMExportItem {
  if (isFolder(item)) {
    const folder = item as { type: "folder" } & Folder;
    const out: PMExportItem = {
      name: folder.name || "",
      item: Array.isArray(folder.items) ? folder.items.map(exportarItem) : [],
    };
    if (folder.auth) {
      const auth = exportarAuth(folder.auth);
      if (auth) (out as { auth?: PMExportAuth }).auth = auth;
    }
    return out;
  }

  const req = item as { type: "request" } & RequestItem;
  const out: PMExportItem = {
    name: req.name || "",
    request: exportarRequest(req),
  };
  if (req.docs) out.description = req.docs;
  return out;
}

/** Converte um RequestItem no request Postman. PURA. */
export function exportarRequest(req: RequestItem): PMExportRequest {
  const out: PMExportRequest = {
    method: (req.method || "GET").toUpperCase(),
    header: exportarHeaders(req.headers),
    url: exportarUrl(req.url, req.params),
  };

  const body = exportarBody(req.body);
  if (body) out.body = body;

  const auth = exportarAuth(req.auth);
  if (auth) out.auth = auth;

  if (req.docs) out.description = req.docs;

  return out;
}

/** Headers do ruan -> header[] Postman. Mantem disabled. PURA. */
export function exportarHeaders(headers: KeyValue[] | undefined): PMExportHeader[] {
  if (!Array.isArray(headers)) return [];
  return headers.map((h) => {
    const out: PMExportHeader = { key: h.name, value: h.value };
    if (h.enabled === false) out.disabled = true;
    if (h.description) out.description = h.description;
    return out;
  });
}

/** Monta a url Postman (raw + query[]) a partir de url + params. PURA. */
export function exportarUrl(
  url: string | undefined,
  params: KeyValue[] | undefined,
): PMExportUrl {
  const baseRaw = url ?? "";
  const query: PMExportQuery[] = Array.isArray(params)
    ? params.map((p) => {
        const q: PMExportQuery = { key: p.name, value: p.value };
        if (p.enabled === false) q.disabled = true;
        return q;
      })
    : [];

  const habilitados = query.filter((q) => !q.disabled);
  const raw =
    habilitados.length > 0
      ? `${baseRaw}${baseRaw.includes("?") ? "&" : "?"}${habilitados
          .map((q) => `${encodar(q.key)}=${encodar(q.value)}`)
          .join("&")}`
      : baseRaw;

  const out: PMExportUrl = { raw };
  if (query.length > 0) out.query = query;
  return out;
}

function encodar(s: string): string {
  // Preserva {{vars}} (encodeURIComponent quebraria as chaves).
  if (s.includes("{{")) return s;
  try {
    return encodeURIComponent(s);
  } catch {
    return s;
  }
}

/** Body do ruan -> body Postman. null se mode none. PURA. */
export function exportarBody(body: Body | undefined): PMExportBody | null {
  if (!body || body.mode === "none") return null;

  switch (body.mode) {
    case "json":
      return {
        mode: "raw",
        raw: body.raw ?? "",
        options: { raw: { language: "json" } },
      };
    case "xml":
      return {
        mode: "raw",
        raw: body.raw ?? "",
        options: { raw: { language: "xml" } },
      };
    case "text":
      return {
        mode: "raw",
        raw: body.raw ?? "",
        options: { raw: { language: "text" } },
      };
    case "form_urlencoded":
      return { mode: "urlencoded", urlencoded: exportarPares(body.form) };
    case "multipart":
      return {
        mode: "formdata",
        formdata: exportarPares(body.form).map((p) => ({ ...p, type: "text" })),
      };
    case "graphql":
      return {
        mode: "graphql",
        graphql: {
          query: body.graphql?.query ?? "",
          variables: body.graphql?.variables ?? "",
        },
      };
    default:
      return null;
  }
}

function exportarPares(form: KeyValue[] | undefined): PMExportHeader[] {
  if (!Array.isArray(form)) return [];
  return form.map((p) => {
    const out: PMExportHeader = { key: p.name, value: p.value };
    if (p.enabled === false) out.disabled = true;
    return out;
  });
}

/** Auth do ruan -> auth Postman. null se none/inherit. PURA. */
export function exportarAuth(auth: Auth | undefined): PMExportAuth | null {
  if (!auth || auth.mode === "none" || auth.mode === "inherit") return null;

  const p = (key: string, value: string): PMExportAuthParam => ({
    key,
    value,
    type: "string",
  });

  switch (auth.mode) {
    case "basic":
      return {
        type: "basic",
        basic: [
          p("username", auth.username ?? ""),
          p("password", auth.password ?? ""),
        ],
      };
    case "bearer":
      return { type: "bearer", bearer: [p("token", auth.token ?? "")] };
    case "apikey":
      return {
        type: "apikey",
        apikey: [
          p("key", auth.key ?? ""),
          p("value", auth.value ?? ""),
          p("in", auth.placement === "query" ? "query" : "header"),
        ],
      };
    default:
      return null;
  }
}
