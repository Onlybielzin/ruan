// F18 — Code generation: gera o snippet de uma RequestData em varias
// linguagens (cURL, fetch JS, axios JS, Python requests). LOGICA PURA — todo o
// arquivo e alvo de mutation testing. Sem React, sem clipboard, sem IO: recebe
// um RequestData (de http-types) e devolve uma string.
//
// Regras gerais respeitadas por todos os geradores:
//  - method/url/headers/params/body sao lidos do RequestData.
//  - SO pares com `enabled !== false` entram (headers, params, form).
//  - params habilitados sao anexados a url como query string.
//  - body conforme o `mode`: json/text/xml -> raw; form_urlencoded/multipart
//    -> pares form; none/desconhecido -> sem corpo.
//  - escape correto de aspas por linguagem.

import type { RequestData, KeyVal, RequestBody } from "./http-types";

/** Linguagens/alvos suportados pelo gerador. */
export const LINGUAGENS = ["curl", "fetch", "axios", "python"] as const;

export type Linguagem = (typeof LINGUAGENS)[number];

/** Rotulo amigavel de cada linguagem (para a UI). */
export const ROTULO_LINGUAGEM: Record<Linguagem, string> = {
  curl: "cURL",
  fetch: "JavaScript — fetch",
  axios: "JavaScript — axios",
  python: "Python — requests",
};

/** Type guard: a string e uma Linguagem suportada. */
export function isLinguagem(x: string): x is Linguagem {
  return (LINGUAGENS as readonly string[]).includes(x);
}

// ---------------------------------------------------------------------------
// Helpers puros compartilhados
// ---------------------------------------------------------------------------

/** So os pares habilitados (enabled !== false trata undefined como ligado). */
export function habilitados(pares: KeyVal[] | undefined): KeyVal[] {
  return (pares ?? []).filter((p) => p.enabled !== false);
}

/**
 * Anexa os params (habilitados) como query string na url. Preserva o que ja
 * houver na url (concatena com & se ja tiver `?`). Sem params -> url intacta.
 */
export function montarUrlComParams(
  url: string,
  params: KeyVal[] | undefined,
): string {
  const ativos = habilitados(params);
  if (ativos.length === 0) return url;
  const qs = ativos
    .map((p) => `${encodeURIComponent(p.name)}=${encodeURIComponent(p.value)}`)
    .join("&");
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}${qs}`;
}

/** Metodo normalizado em maiusculas; vazio -> GET. */
export function metodoDe(req: RequestData): string {
  return (req.method || "GET").toUpperCase();
}

/** True se o modo do corpo carrega um raw textual (json/text/xml). */
export function modoEhRaw(mode: string): boolean {
  return mode === "json" || mode === "text" || mode === "xml";
}

/** True se o modo do corpo e baseado em pares (form_urlencoded/multipart). */
export function modoEhForm(mode: string): boolean {
  return mode === "form_urlencoded" || mode === "multipart";
}

/**
 * Resolve o corpo efetivo a enviar a partir do RequestBody. Devolve um
 * discriminado simples que cada gerador consome do seu jeito.
 *   - { kind: "none" }                 sem corpo
 *   - { kind: "raw", text, contentType } raw textual (+ content-type sugerido)
 *   - { kind: "form", pairs }          pares habilitados
 */
export type CorpoResolvido =
  | { kind: "none" }
  | { kind: "raw"; text: string; contentType: string | null }
  | { kind: "form"; pairs: KeyVal[] };

export function resolverCorpo(body: RequestBody | undefined): CorpoResolvido {
  if (!body) return { kind: "none" };
  if (modoEhRaw(body.mode)) {
    const text = body.raw ?? "";
    if (text === "") return { kind: "none" };
    return { kind: "raw", text, contentType: contentTypeDeRaw(body.mode) };
  }
  if (modoEhForm(body.mode)) {
    const pairs = habilitados(body.form);
    if (pairs.length === 0) return { kind: "none" };
    return { kind: "form", pairs };
  }
  return { kind: "none" };
}

/** Content-Type sugerido para um corpo raw, ou null (nao sugere). */
export function contentTypeDeRaw(mode: string): string | null {
  if (mode === "json") return "application/json";
  if (mode === "xml") return "application/xml";
  if (mode === "text") return "text/plain";
  return null;
}

/** True se algum header habilitado tem o nome dado (case-insensitive). */
export function temHeader(headers: KeyVal[], nome: string): boolean {
  const alvo = nome.toLowerCase();
  return headers.some((h) => h.name.toLowerCase() === alvo);
}

// ---------------------------------------------------------------------------
// Escapes por linguagem
// ---------------------------------------------------------------------------

/**
 * Escapa para aspas SIMPLES de shell (cURL). A unica sequencia perigosa em
 * single-quote de POSIX shell e a propria aspa simples: fechamos a aspa,
 * inserimos uma aspa escapada e reabrimos -> `'\''`.
 */
export function escaparShell(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** Escapa o conteudo de uma string entre aspas duplas de JS. */
export function escaparJsDouble(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
}

/** String JS entre aspas duplas, ja escapada. */
export function strJs(s: string): string {
  return `"${escaparJsDouble(s)}"`;
}

/** Escapa o conteudo de uma string entre aspas duplas de Python. */
export function escaparPyDouble(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
}

/** String Python entre aspas duplas, ja escapada. */
export function strPy(s: string): string {
  return `"${escaparPyDouble(s)}"`;
}

// ---------------------------------------------------------------------------
// cURL
// ---------------------------------------------------------------------------

export function gerarCurl(req: RequestData): string {
  const url = montarUrlComParams(req.url, req.params);
  const method = metodoDe(req);
  const headers = habilitados(req.headers);
  const corpo = resolverCorpo(req.body);

  const linhas: string[] = [`curl ${escaparShell(url)}`];

  // -X so quando nao for o default implicito (GET sem corpo / POST com corpo).
  // Para clareza e previsibilidade, sempre emitimos o metodo explicito.
  linhas.push(`  -X ${method}`);

  for (const h of headers) {
    linhas.push(`  -H ${escaparShell(`${h.name}: ${h.value}`)}`);
  }

  if (corpo.kind === "raw") {
    if (corpo.contentType && !temHeader(headers, "content-type")) {
      linhas.push(`  -H ${escaparShell(`Content-Type: ${corpo.contentType}`)}`);
    }
    linhas.push(`  -d ${escaparShell(corpo.text)}`);
  } else if (corpo.kind === "form") {
    for (const p of corpo.pairs) {
      // --form para multipart; --data-urlencode para form_urlencoded.
      const flag =
        req.body?.mode === "multipart" ? "--form" : "--data-urlencode";
      linhas.push(`  ${flag} ${escaparShell(`${p.name}=${p.value}`)}`);
    }
  }

  return linhas.join(" \\\n");
}

// ---------------------------------------------------------------------------
// fetch (JS)
// ---------------------------------------------------------------------------

export function gerarFetch(req: RequestData): string {
  const url = montarUrlComParams(req.url, req.params);
  const method = metodoDe(req);
  const headers = habilitados(req.headers);
  const corpo = resolverCorpo(req.body);

  const headerPairs: Array<[string, string]> = headers.map((h) => [
    h.name,
    h.value,
  ]);

  let body: string | null = null;
  if (corpo.kind === "raw") {
    if (corpo.contentType && !temHeader(headers, "content-type")) {
      headerPairs.push(["Content-Type", corpo.contentType]);
    }
    body = strJs(corpo.text);
  } else if (corpo.kind === "form") {
    if (req.body?.mode === "multipart") {
      const linhas = corpo.pairs
        .map((p) => `formData.append(${strJs(p.name)}, ${strJs(p.value)});`)
        .join("\n");
      body = "formData";
      return montarFetch(url, method, headerPairs, body, [
        "const formData = new FormData();",
        linhas,
      ]);
    }
    const usp = corpo.pairs
      .map((p) => `  [${strJs(p.name)}, ${strJs(p.value)}],`)
      .join("\n");
    body = "params";
    return montarFetch(url, method, headerPairs, body, [
      `const params = new URLSearchParams([\n${usp}\n]);`,
    ]);
  }

  return montarFetch(url, method, headerPairs, body, []);
}

function montarFetch(
  url: string,
  method: string,
  headerPairs: Array<[string, string]>,
  body: string | null,
  preamble: string[],
): string {
  const opts: string[] = [`  method: ${strJs(method)},`];
  if (headerPairs.length > 0) {
    const hs = headerPairs
      .map(([k, v]) => `    ${strJs(k)}: ${strJs(v)},`)
      .join("\n");
    opts.push(`  headers: {\n${hs}\n  },`);
  }
  if (body !== null) {
    opts.push(`  body: ${body},`);
  }
  const pre = preamble.filter((p) => p !== "").join("\n");
  const chamada = `const response = await fetch(${strJs(url)}, {\n${opts.join(
    "\n",
  )}\n});`;
  return pre ? `${pre}\n\n${chamada}` : chamada;
}

// ---------------------------------------------------------------------------
// axios (JS)
// ---------------------------------------------------------------------------

export function gerarAxios(req: RequestData): string {
  const url = montarUrlComParams(req.url, req.params);
  const method = metodoDe(req).toLowerCase();
  const headers = habilitados(req.headers);
  const corpo = resolverCorpo(req.body);

  const headerPairs: Array<[string, string]> = headers.map((h) => [
    h.name,
    h.value,
  ]);

  const preamble: string[] = [];
  let dataExpr: string | null = null;

  if (corpo.kind === "raw") {
    if (corpo.contentType && !temHeader(headers, "content-type")) {
      headerPairs.push(["Content-Type", corpo.contentType]);
    }
    dataExpr = strJs(corpo.text);
  } else if (corpo.kind === "form") {
    if (req.body?.mode === "multipart") {
      const linhas = corpo.pairs
        .map((p) => `formData.append(${strJs(p.name)}, ${strJs(p.value)});`)
        .join("\n");
      preamble.push(`const formData = new FormData();\n${linhas}`);
      dataExpr = "formData";
    } else {
      const usp = corpo.pairs
        .map((p) => `  [${strJs(p.name)}, ${strJs(p.value)}],`)
        .join("\n");
      preamble.push(`const params = new URLSearchParams([\n${usp}\n]);`);
      dataExpr = "params";
    }
  }

  const campos: string[] = [
    `  method: ${strJs(method)},`,
    `  url: ${strJs(url)},`,
  ];
  if (headerPairs.length > 0) {
    const hs = headerPairs
      .map(([k, v]) => `    ${strJs(k)}: ${strJs(v)},`)
      .join("\n");
    campos.push(`  headers: {\n${hs}\n  },`);
  }
  if (dataExpr !== null) {
    campos.push(`  data: ${dataExpr},`);
  }

  const chamada = `const response = await axios({\n${campos.join("\n")}\n});`;
  const pre = preamble.join("\n\n");
  return pre ? `${pre}\n\n${chamada}` : chamada;
}

// ---------------------------------------------------------------------------
// Python requests
// ---------------------------------------------------------------------------

export function gerarPython(req: RequestData): string {
  const url = montarUrlComParams(req.url, req.params);
  const method = metodoDe(req).toLowerCase();
  const headers = habilitados(req.headers);
  const corpo = resolverCorpo(req.body);

  const headerPairs: Array<[string, string]> = headers.map((h) => [
    h.name,
    h.value,
  ]);

  const preamble: string[] = [];
  const kwargs: string[] = [];

  if (corpo.kind === "raw") {
    if (corpo.contentType && !temHeader(headers, "content-type")) {
      headerPairs.push(["Content-Type", corpo.contentType]);
    }
    preamble.push(`data = ${strPy(corpo.text)}`);
    kwargs.push("data=data");
  } else if (corpo.kind === "form") {
    const dict = corpo.pairs
      .map((p) => `    ${strPy(p.name)}: ${strPy(p.value)},`)
      .join("\n");
    if (req.body?.mode === "multipart") {
      preamble.push(`files = {\n${dict}\n}`);
      kwargs.push("files=files");
    } else {
      preamble.push(`data = {\n${dict}\n}`);
      kwargs.push("data=data");
    }
  }

  if (headerPairs.length > 0) {
    const hs = headerPairs
      .map(([k, v]) => `    ${strPy(k)}: ${strPy(v)},`)
      .join("\n");
    preamble.unshift(`headers = {\n${hs}\n}`);
    kwargs.unshift("headers=headers");
  }

  const args = [`${strPy(method)}`, `${strPy(url)}`, ...kwargs].join(", ");
  const chamada = `response = requests.request(${args})`;

  const linhas = ["import requests", ""];
  if (preamble.length > 0) {
    linhas.push(...preamble, "");
  }
  linhas.push(chamada);
  return linhas.join("\n");
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

/** Dispatcher: gera o snippet da request na linguagem pedida. LOGICA PURA. */
export function gerar(linguagem: Linguagem, req: RequestData): string {
  switch (linguagem) {
    case "curl":
      return gerarCurl(req);
    case "fetch":
      return gerarFetch(req);
    case "axios":
      return gerarAxios(req);
    case "python":
      return gerarPython(req);
    default:
      // Exhaustivo: se um novo membro de LINGUAGENS for adicionado e nao
      // tratado, o TS acusa. Em runtime, cai num cURL como fallback seguro.
      return gerarCurl(req);
  }
}

/** Atalho: o snippet cURL da request (usado pelo botao "Copy as cURL"). */
export function copiarComoCurl(req: RequestData): string {
  return gerarCurl(req);
}
