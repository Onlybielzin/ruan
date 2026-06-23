// F17 — Import: parser PURO de um unico comando cURL -> RequestItem do ruan.
// Alvo de mutation testing. Sem dependencias de IPC/Tauri: recebe a string do
// comando e devolve uma estrutura { name, items } (uma colecao em memoria, ainda
// nao persistida). Entrada malformada NUNCA lanca: devolve erro tratado.
//
// Cobre os casos comuns do cURL gerado por navegadores/ferramentas:
//   -X/--request METHOD, -H/--header "K: V", -d/--data/--data-raw/--data-urlencode/
//   --data-binary BODY, -u/--user user:pass (basic auth), --url URL, URL posicional,
//   querystring na URL -> params, -G (manda data como query), --json (corpo JSON),
//   -b/--cookie, --compressed (ignorado), continuacoes de linha com "\".

import type {
  RequestItem,
  TreeItem,
  KeyValue,
  Body,
  BodyMode,
} from "../types";
import { novaRequest } from "../types";

/** Resultado de um import: nome sugerido + nos de arvore (sem persistir). */
export interface ImportResult {
  name: string;
  items: TreeItem[];
}

/** Resultado tipado: ou sucesso com a colecao, ou erro legivel. */
export type ParseResult =
  | { ok: true; collection: ImportResult }
  | { ok: false; error: string };

/**
 * Tokeniza uma linha de comando shell respeitando aspas simples/duplas e
 * continuacoes de linha (`\` no fim). LOGICA PURA. Nao expande variaveis nem
 * executa nada — apenas separa argumentos como um shell faria no nivel basico.
 */
export function tokenizarShell(input: string): string[] {
  const tokens: string[] = [];
  let atual = "";
  let temToken = false;
  let aspas: '"' | "'" | null = null;
  let i = 0;

  while (i < input.length) {
    const c = input[i];

    if (aspas) {
      if (c === aspas) {
        aspas = null;
      } else if (aspas === '"' && c === "\\" && i + 1 < input.length) {
        // Em aspas duplas, \ escapa o proximo char (parcialmente como o shell).
        const prox = input[i + 1];
        atual += prox;
        i += 2;
        continue;
      } else {
        atual += c;
      }
      i += 1;
      continue;
    }

    if (c === '"' || c === "'") {
      aspas = c;
      temToken = true;
      i += 1;
      continue;
    }

    if (c === "\\") {
      const prox = input[i + 1];
      // Continuacao de linha: "\" seguido de quebra -> junta as linhas.
      if (prox === "\n" || prox === "\r") {
        i += prox === "\r" && input[i + 2] === "\n" ? 3 : 2;
        continue;
      }
      if (prox !== undefined) {
        atual += prox;
        temToken = true;
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }

    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      if (temToken) {
        tokens.push(atual);
        atual = "";
        temToken = false;
      }
      i += 1;
      continue;
    }

    atual += c;
    temToken = true;
    i += 1;
  }

  if (temToken) tokens.push(atual);
  return tokens;
}

/** Separa "Chave: Valor" de um -H. LOGICA PURA. Valor pode conter `:`. */
export function dividirHeader(raw: string): KeyValue | null {
  const idx = raw.indexOf(":");
  if (idx < 0) {
    const nome = raw.trim();
    if (!nome) return null;
    return { name: nome, value: "", enabled: true };
  }
  const name = raw.slice(0, idx).trim();
  if (!name) return null;
  const value = raw.slice(idx + 1).trim();
  return { name, value, enabled: true };
}

/** Quebra a querystring de uma URL em pares. LOGICA PURA. Decodifica %xx. */
export function paramsDaUrl(url: string): { base: string; params: KeyValue[] } {
  const hash = url.indexOf("#");
  const semHash = hash >= 0 ? url.slice(0, hash) : url;
  const q = semHash.indexOf("?");
  if (q < 0) return { base: semHash, params: [] };

  const base = semHash.slice(0, q);
  const query = semHash.slice(q + 1);
  const params: KeyValue[] = [];
  for (const par of query.split("&")) {
    if (par === "") continue;
    const eq = par.indexOf("=");
    const rawName = eq >= 0 ? par.slice(0, eq) : par;
    const rawValue = eq >= 0 ? par.slice(eq + 1) : "";
    params.push({
      name: decodificarComponente(rawName),
      value: decodificarComponente(rawValue),
      enabled: true,
    });
  }
  return { base, params };
}

/** decodeURIComponent tolerante: nunca lanca em entrada malformada. PURA. */
export function decodificarComponente(s: string): string {
  const maisEspaco = s.replace(/\+/g, " ");
  try {
    return decodeURIComponent(maisEspaco);
  } catch {
    return maisEspaco;
  }
}

/** Heuristica: detecta JSON valido para escolher o BodyMode. PURA. */
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

/** Flags do cURL que aceitam UM argumento (consomem o proximo token). */
const FLAGS_COM_ARG = new Set([
  "-X",
  "--request",
  "-H",
  "--header",
  "-d",
  "--data",
  "--data-raw",
  "--data-binary",
  "--data-urlencode",
  "--data-ascii",
  "--json",
  "-u",
  "--user",
  "-b",
  "--cookie",
  "-e",
  "--referer",
  "-A",
  "--user-agent",
  "--url",
  "-o",
  "--output",
  "-m",
  "--max-time",
  "--connect-timeout",
  "-T",
  "--upload-file",
  "-F",
  "--form",
]);

/**
 * Parseia UM comando cURL. LOGICA PURA. Devolve ParseResult; nunca lanca.
 * Aceita o comando com ou sem o prefixo `curl`.
 */
export function parseCurl(comando: string): ParseResult {
  if (typeof comando !== "string" || comando.trim() === "") {
    return { ok: false, error: "Comando cURL vazio." };
  }

  const tokens = tokenizarShell(comando);
  if (tokens.length === 0) {
    return { ok: false, error: "Comando cURL vazio." };
  }

  let inicio = 0;
  if (tokens[0] === "curl") inicio = 1;

  let metodoExplicito: string | null = null;
  let url: string | null = null;
  const headers: KeyValue[] = [];
  const dataParts: string[] = [];
  let dataUrlencoded = false;
  let usarGet = false; // -G/--get
  let username: string | null = null;
  let password: string | undefined;
  let jsonMode = false;
  const cookies: string[] = [];

  for (let i = inicio; i < tokens.length; i++) {
    let tok = tokens[i];
    if (tok === "curl") continue;

    // Forma --flag=valor: separa em flag + valor.
    let valorColado: string | null = null;
    if (tok.startsWith("--") && tok.includes("=")) {
      const eq = tok.indexOf("=");
      valorColado = tok.slice(eq + 1);
      tok = tok.slice(0, eq);
    }

    const pegaArg = (): string | null => {
      if (valorColado !== null) return valorColado;
      if (i + 1 < tokens.length) {
        i += 1;
        return tokens[i];
      }
      return null;
    };

    switch (tok) {
      case "-X":
      case "--request": {
        const v = pegaArg();
        if (v) metodoExplicito = v.toUpperCase();
        break;
      }
      case "-H":
      case "--header": {
        const v = pegaArg();
        if (v !== null) {
          const h = dividirHeader(v);
          if (h) headers.push(h);
        }
        break;
      }
      case "-d":
      case "--data":
      case "--data-raw":
      case "--data-binary":
      case "--data-ascii": {
        const v = pegaArg();
        if (v !== null) dataParts.push(v);
        break;
      }
      case "--data-urlencode": {
        const v = pegaArg();
        if (v !== null) {
          dataParts.push(v);
          dataUrlencoded = true;
        }
        break;
      }
      case "--json": {
        const v = pegaArg();
        if (v !== null) {
          dataParts.push(v);
          jsonMode = true;
        }
        break;
      }
      case "-G":
      case "--get":
        usarGet = true;
        break;
      case "-u":
      case "--user": {
        const v = pegaArg();
        if (v !== null) {
          const sep = v.indexOf(":");
          if (sep >= 0) {
            username = v.slice(0, sep);
            password = v.slice(sep + 1);
          } else {
            username = v;
          }
        }
        break;
      }
      case "-b":
      case "--cookie": {
        const v = pegaArg();
        if (v !== null) cookies.push(v);
        break;
      }
      case "-e":
      case "--referer": {
        const v = pegaArg();
        if (v !== null) headers.push({ name: "Referer", value: v, enabled: true });
        break;
      }
      case "-A":
      case "--user-agent": {
        const v = pegaArg();
        if (v !== null)
          headers.push({ name: "User-Agent", value: v, enabled: true });
        break;
      }
      case "--url": {
        const v = pegaArg();
        if (v) url = v;
        break;
      }
      // Flags com argumento que ignoramos (consumimos o arg pra nao virar URL).
      case "-o":
      case "--output":
      case "-m":
      case "--max-time":
      case "--connect-timeout":
      case "-T":
      case "--upload-file":
      case "-F":
      case "--form": {
        pegaArg();
        break;
      }
      default: {
        if (tok.startsWith("-")) {
          // Flag desconhecida sem arg (ex.: --compressed, -L, -k, -s, -v).
          // Se for uma flag que sabidamente consome arg, consome.
          if (FLAGS_COM_ARG.has(tok)) pegaArg();
          break;
        }
        // Token posicional: a URL (o primeiro nao-flag).
        if (url === null) url = tok;
        break;
      }
    }
  }

  if (!url) {
    return { ok: false, error: "Nenhuma URL encontrada no comando cURL." };
  }

  // Junta cookies num header Cookie unico, se houver e nao houver Cookie ja.
  if (cookies.length > 0 && !headers.some((h) => h.name.toLowerCase() === "cookie")) {
    headers.push({ name: "Cookie", value: cookies.join("; "), enabled: true });
  }

  // Varios -d sao concatenados com & pelo cURL (a menos que seja corpo cru
  // unico). Para -G e --data-urlencode tambem usamos & entre os pares.
  const juntarComAmp = dataUrlencoded || usarGet || dataParts.length > 1;
  const data = dataParts.join(juntarComAmp ? "&" : "");
  const temData = dataParts.length > 0;

  // Metodo: explicito vence; senao POST se ha corpo (e nao -G), senao GET.
  let method = metodoExplicito ?? (temData && !usarGet ? "POST" : "GET");

  // Resolve URL + querystring; se -G, o data vira params.
  let urlBase = url;
  let params: KeyValue[];
  if (usarGet && temData) {
    const sep = url.includes("?") ? "&" : "?";
    const resolvido = paramsDaUrl(url + sep + data);
    urlBase = resolvido.base;
    params = resolvido.params;
  } else {
    const resolvido = paramsDaUrl(url);
    urlBase = resolvido.base;
    params = resolvido.params;
  }

  const req = novaRequest(nomeDeUrl(urlBase, method));
  req.method = method;
  req.url = urlBase;
  req.headers = headers;
  req.params = params;

  // Corpo: so se ha data e nao foi consumido como query (-G).
  if (temData && !usarGet) {
    req.body = corpoDeData(data, headers, jsonMode);
  }

  // Basic auth via -u.
  if (username !== null) {
    req.auth = {
      mode: "basic",
      username,
      password: password ?? "",
    };
  }

  return {
    ok: true,
    collection: {
      name: req.name,
      items: [{ type: "request", ...req } as TreeItem],
    },
  };
}

/** Escolhe o Body conforme Content-Type e formato do data. PURA. */
function corpoDeData(
  data: string,
  headers: KeyValue[],
  jsonMode: boolean,
): Body {
  const ct = headers
    .find((h) => h.name.toLowerCase() === "content-type")
    ?.value?.toLowerCase();

  let mode: BodyMode = "text";
  if (jsonMode || ct?.includes("application/json") || pareceJson(data)) {
    mode = "json";
  } else if (ct?.includes("application/xml") || ct?.includes("text/xml")) {
    mode = "xml";
  } else if (
    ct?.includes("application/x-www-form-urlencoded") ||
    (ct === undefined && data.includes("=") && !data.includes("\n"))
  ) {
    return { mode: "form_urlencoded", form: formDeUrlencoded(data) };
  }

  return { mode, raw: data };
}

/** Quebra "a=1&b=2" em pares de form_urlencoded. PURA. */
export function formDeUrlencoded(data: string): KeyValue[] {
  const form: KeyValue[] = [];
  for (const par of data.split("&")) {
    if (par === "") continue;
    const eq = par.indexOf("=");
    const name = eq >= 0 ? par.slice(0, eq) : par;
    const value = eq >= 0 ? par.slice(eq + 1) : "";
    form.push({
      name: decodificarComponente(name),
      value: decodificarComponente(value),
      enabled: true,
    });
  }
  return form;
}

/** Nome legivel a partir da URL: "METHOD /path" ou o host. PURA. */
export function nomeDeUrl(url: string, method: string): string {
  try {
    const u = new URL(url);
    const caminho = u.pathname && u.pathname !== "/" ? u.pathname : u.hostname;
    return `${method} ${caminho}`.trim();
  } catch {
    // URL relativa ou com variaveis ({{base}}/x): usa o proprio texto.
    const limpo = url.split("?")[0];
    return `${method} ${limpo}`.trim();
  }
}

// Tipo re-exportado para conveniencia dos consumidores.
export type { RequestItem };
