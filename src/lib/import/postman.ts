// F17 — Import: Postman Collection v2.1 -> Collection do ruan. Parser PURO.
// Alvo de mutation. Recebe o JSON cru (string ou objeto ja parseado) e devolve
// { name, items } sem persistir. Entrada malformada -> erro tratado, nunca lanca.
//
// Mapeamento:
//   collection.info.name        -> name
//   item[] (com .item)          -> pasta (TreeItem folder, recursivo)
//   item[] (com .request)       -> request (TreeItem request)
//   request.method             -> method
//   request.url (string|obj)   -> url + params (query)
//   request.header[]           -> headers
//   request.body (raw/url/...)-> body
//   request.auth               -> auth (basic/bearer/apikey)
// Variaveis {{x}} sao preservadas como texto (o ruan resolve em runtime).

import type {
  TreeItem,
  RequestItem,
  KeyValue,
  Body,
  BodyMode,
  Auth,
} from "../types";
import { novaRequest } from "../types";
import type { ImportResult, ParseResult } from "./curl";

interface PMHeader {
  key?: string;
  value?: string;
  disabled?: boolean;
  description?: string;
}

interface PMQuery {
  key?: string;
  value?: string | null;
  disabled?: boolean;
  description?: string;
}

interface PMUrl {
  raw?: string;
  host?: string[] | string;
  path?: Array<string | { value?: string }> | string;
  query?: PMQuery[];
  protocol?: string;
  port?: string;
}

interface PMBody {
  mode?: string;
  raw?: string;
  urlencoded?: PMHeader[];
  formdata?: Array<PMHeader & { type?: string }>;
  graphql?: { query?: string; variables?: string };
  options?: { raw?: { language?: string } };
}

interface PMAuthParam {
  key?: string;
  value?: unknown;
  type?: string;
}

interface PMAuth {
  type?: string;
  basic?: PMAuthParam[];
  bearer?: PMAuthParam[];
  apikey?: PMAuthParam[];
}

interface PMRequest {
  method?: string;
  url?: PMUrl | string;
  header?: PMHeader[] | string;
  body?: PMBody;
  auth?: PMAuth;
  description?: string;
}

interface PMItem {
  name?: string;
  item?: PMItem[];
  request?: PMRequest;
  description?: string;
  auth?: PMAuth;
}

interface PMCollection {
  info?: { name?: string };
  item?: PMItem[];
  auth?: PMAuth;
}

/** Parseia uma colecao Postman v2.1. PURA. Nunca lanca: devolve ParseResult. */
export function parsePostman(entrada: string | unknown): ParseResult {
  let raiz: PMCollection;
  if (typeof entrada === "string") {
    try {
      raiz = JSON.parse(entrada) as PMCollection;
    } catch {
      return { ok: false, error: "JSON invalido na colecao Postman." };
    }
  } else if (entrada && typeof entrada === "object") {
    raiz = entrada as PMCollection;
  } else {
    return { ok: false, error: "Entrada Postman vazia ou invalida." };
  }

  if (!Array.isArray(raiz.item)) {
    return {
      ok: false,
      error: "Colecao Postman sem `item[]` (formato nao reconhecido).",
    };
  }

  const name =
    (raiz.info?.name && raiz.info.name.trim()) || "Colecao importada";

  const items = raiz.item.map((it, i) => converterItem(it, i));

  const collection: ImportResult = { name, items };
  return { ok: true, collection };
}

/** Converte um PMItem em TreeItem (pasta se tem .item, senao request). PURA. */
export function converterItem(item: PMItem, seq: number): TreeItem {
  const nome = (item?.name && String(item.name)) || `item ${seq + 1}`;

  if (Array.isArray(item?.item)) {
    const filhos = item.item.map((f, i) => converterItem(f, i));
    const folder: TreeItem = {
      type: "folder",
      name: nome,
      seq,
      items: filhos,
    };
    const auth = item.auth ? converterAuth(item.auth) : null;
    if (auth) (folder as { auth?: Auth }).auth = auth;
    return folder;
  }

  const req = converterRequest(item.request ?? {}, nome, seq);
  if (item.description) req.docs = String(item.description);
  return { type: "request", ...req };
}

/** Converte um PMRequest em RequestItem do ruan. PURA. */
export function converterRequest(
  pm: PMRequest,
  nome: string,
  seq: number,
): RequestItem {
  const req = novaRequest(nome, seq);
  req.method = (pm.method ?? "GET").toUpperCase();

  const { url, params } = resolverUrl(pm.url);
  req.url = url;
  req.params = params;
  req.headers = converterHeaders(pm.header);
  req.body = converterBody(pm.body);

  if (pm.auth) {
    const auth = converterAuth(pm.auth);
    if (auth) req.auth = auth;
  }
  if (pm.description) req.docs = String(pm.description);

  return req;
}

/** Resolve a URL Postman (string ou objeto) em { url, params }. PURA. */
export function resolverUrl(url: PMUrl | string | undefined): {
  url: string;
  params: KeyValue[];
} {
  if (url === undefined || url === null) return { url: "", params: [] };

  if (typeof url === "string") {
    return { url: semQuery(url), params: paramsDeStringUrl(url) };
  }

  const params: KeyValue[] = Array.isArray(url.query)
    ? url.query
        .filter((q) => q && (q.key !== undefined || q.value !== undefined))
        .map((q) => ({
          name: q.key ?? "",
          value: q.value == null ? "" : String(q.value),
          enabled: !q.disabled,
          ...(q.description ? { description: String(q.description) } : {}),
        }))
    : [];

  // Prefere o raw (preserva {{vars}}); senao remonta de host/path.
  let base = "";
  if (typeof url.raw === "string" && url.raw !== "") {
    base = semQuery(url.raw);
  } else {
    base = remontarUrl(url);
  }

  return { url: base, params };
}

/** Remonta uma URL a partir de protocol/host/port/path. PURA. */
function remontarUrl(url: PMUrl): string {
  const proto = url.protocol ? `${url.protocol}://` : "";
  const host = Array.isArray(url.host)
    ? url.host.join(".")
    : (url.host ?? "");
  const port = url.port ? `:${url.port}` : "";
  const segments = Array.isArray(url.path)
    ? url.path.map((p) => (typeof p === "string" ? p : (p?.value ?? "")))
    : url.path
      ? [String(url.path)]
      : [];
  const path = segments.length ? `/${segments.join("/")}` : "";
  return `${proto}${host}${port}${path}`;
}

/** Remove a querystring de uma URL string. PURA. */
function semQuery(u: string): string {
  const q = u.indexOf("?");
  return q >= 0 ? u.slice(0, q) : u;
}

/** Extrai params da querystring de uma URL string. PURA. */
function paramsDeStringUrl(u: string): KeyValue[] {
  const q = u.indexOf("?");
  if (q < 0) return [];
  const hash = u.indexOf("#", q);
  const query = hash >= 0 ? u.slice(q + 1, hash) : u.slice(q + 1);
  const out: KeyValue[] = [];
  for (const par of query.split("&")) {
    if (par === "") continue;
    const eq = par.indexOf("=");
    const name = eq >= 0 ? par.slice(0, eq) : par;
    const value = eq >= 0 ? par.slice(eq + 1) : "";
    out.push({ name: decodificar(name), value: decodificar(value), enabled: true });
  }
  return out;
}

function decodificar(s: string): string {
  try {
    return decodeURIComponent(s.replace(/\+/g, " "));
  } catch {
    return s;
  }
}

/** Converte os headers Postman em KeyValue[]. PURA. */
export function converterHeaders(
  header: PMHeader[] | string | undefined,
): KeyValue[] {
  if (!Array.isArray(header)) return [];
  return header
    .filter((h) => h && h.key !== undefined)
    .map((h) => ({
      name: h.key ?? "",
      value: h.value ?? "",
      enabled: !h.disabled,
      ...(h.description ? { description: String(h.description) } : {}),
    }));
}

/** Converte o body Postman no Body do ruan. PURA. */
export function converterBody(body: PMBody | undefined): Body {
  if (!body || !body.mode) return { mode: "none" };

  switch (body.mode) {
    case "raw": {
      const raw = body.raw ?? "";
      const lang = body.options?.raw?.language;
      let mode: BodyMode = "text";
      if (lang === "json" || pareceJson(raw)) mode = "json";
      else if (lang === "xml") mode = "xml";
      return { mode, raw };
    }
    case "urlencoded": {
      return {
        mode: "form_urlencoded",
        form: paresHabilitados(body.urlencoded),
      };
    }
    case "formdata": {
      return {
        mode: "multipart",
        form: paresHabilitados(body.formdata),
      };
    }
    case "graphql": {
      return {
        mode: "graphql",
        graphql: {
          query: body.graphql?.query ?? "",
          variables: body.graphql?.variables ?? "",
        },
      };
    }
    case "file":
    case "none":
    default:
      return { mode: "none" };
  }
}

function paresHabilitados(arr: PMHeader[] | undefined): KeyValue[] {
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((p) => p && p.key !== undefined)
    .map((p) => ({
      name: p.key ?? "",
      value: p.value ?? "",
      enabled: !p.disabled,
    }));
}

/** Converte auth Postman -> Auth do ruan. PURA. null se nao mapeavel. */
export function converterAuth(pm: PMAuth | undefined): Auth | null {
  if (!pm || !pm.type) return null;

  const ler = (arr: PMAuthParam[] | undefined, chave: string): string => {
    if (!Array.isArray(arr)) return "";
    const p = arr.find((x) => x.key === chave);
    return p && p.value != null ? String(p.value) : "";
  };

  switch (pm.type) {
    case "basic":
      return {
        mode: "basic",
        username: ler(pm.basic, "username"),
        password: ler(pm.basic, "password"),
      };
    case "bearer":
      return { mode: "bearer", token: ler(pm.bearer, "token") };
    case "apikey": {
      const inValor = ler(pm.apikey, "in");
      return {
        mode: "apikey",
        key: ler(pm.apikey, "key"),
        value: ler(pm.apikey, "value"),
        placement: inValor === "query" ? "query" : "header",
      };
    }
    case "noauth":
      return { mode: "none" };
    default:
      return null;
  }
}

function pareceJson(raw: string): boolean {
  const t = raw.trim();
  if (!(t.startsWith("{") || t.startsWith("["))) return false;
  try {
    JSON.parse(t);
    return true;
  } catch {
    return false;
  }
}
