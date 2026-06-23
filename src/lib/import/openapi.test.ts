// Testes da logica PURA de src/lib/import/openapi.ts (F17).
import { describe, it, expect } from "vitest";
import {
  parseOpenapi,
  baseUrl,
  converterOperacao,
  valorExemplo,
  converterRequestBody,
  exemploDeMedia,
  juntarUrl,
} from "./openapi";
import { isFolder, isRequest } from "../types";

describe("parseOpenapi", () => {
  it("erro em JSON invalido", () => {
    expect(parseOpenapi("{nope").ok).toBe(false);
  });
  it("erro em entrada nula", () => {
    expect(parseOpenapi(null).ok).toBe(false);
  });
  it("erro sem paths", () => {
    expect(parseOpenapi({ info: { title: "x" } }).ok).toBe(false);
  });

  it("nome vem de info.title", () => {
    const r = parseOpenapi({ info: { title: "Pets" }, paths: {} });
    expect(r.ok && r.collection.name).toBe("Pets");
  });
  it("nome default", () => {
    const r = parseOpenapi({ paths: {} });
    expect(r.ok && r.collection.name).toBe("API importada");
  });

  it("agrupa por tag em pastas", () => {
    const r = parseOpenapi({
      info: { title: "API" },
      servers: [{ url: "http://api" }],
      paths: {
        "/users": {
          get: { tags: ["users"], summary: "Lista" },
          post: { tags: ["users"], summary: "Cria" },
        },
        "/health": { get: { summary: "Health" } },
      },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const items = r.collection.items;
    const pasta = items.find((i) => isFolder(i));
    expect(pasta && isFolder(pasta) && pasta.name).toBe("users");
    expect(pasta && isFolder(pasta) && pasta.items.length).toBe(2);
    // health sem tag fica na raiz
    const solto = items.find((i) => isRequest(i));
    expect(solto && isRequest(solto) && solto.name).toBe("Health");
  });

  it("monta URL com base do servidor", () => {
    const r = parseOpenapi({
      info: { title: "x" },
      servers: [{ url: "http://api/v1" }],
      paths: { "/users": { get: {} } },
    });
    if (!r.ok) throw new Error("ok");
    const req = r.collection.items[0];
    expect(isRequest(req) && req.url).toBe("http://api/v1/users");
  });
});

describe("baseUrl", () => {
  it("usa servers[0].url sem barra final", () => {
    expect(baseUrl({ servers: [{ url: "http://api/" }] })).toBe("http://api");
  });
  it("swagger 2 host+basePath+scheme", () => {
    expect(
      baseUrl({ host: "api.x", basePath: "/v2", schemes: ["http"] }),
    ).toBe("http://api.x/v2");
  });
  it("swagger 2 default https", () => {
    expect(baseUrl({ host: "api.x" })).toBe("https://api.x");
  });
  it("fallback para variavel", () => {
    expect(baseUrl({})).toBe("{{baseUrl}}");
  });
});

describe("converterOperacao", () => {
  it("nome usa summary", () => {
    const req = converterOperacao("GET", "/x", { summary: "Sumario" }, [], "b", 0);
    expect(req.name).toBe("Sumario");
  });
  it("nome usa operationId quando sem summary", () => {
    const req = converterOperacao("GET", "/x", { operationId: "getX" }, [], "b", 0);
    expect(req.name).toBe("getX");
  });
  it("nome fallback method+path", () => {
    const req = converterOperacao("GET", "/x", {}, [], "b", 0);
    expect(req.name).toBe("GET /x");
  });
  it("separa params query e header", () => {
    const req = converterOperacao(
      "GET",
      "/x",
      {
        parameters: [
          { name: "q", in: "query", example: "v" },
          { name: "X-H", in: "header", required: true },
          { name: "id", in: "path" },
        ],
      },
      [],
      "http://b",
      0,
    );
    expect(req.params).toEqual([
      { name: "q", value: "v", enabled: true },
    ]);
    expect(req.headers).toEqual([{ name: "X-H", value: "", enabled: true }]);
  });
  it("query nao-required fica enabled true por default mas respeita false", () => {
    const req = converterOperacao(
      "GET",
      "/x",
      { parameters: [{ name: "opt", in: "query", required: false }] },
      [],
      "b",
      0,
    );
    expect(req.params[0].enabled).toBe(false);
  });
  it("combina params do path-item", () => {
    const req = converterOperacao(
      "GET",
      "/x",
      { parameters: [{ name: "a", in: "query" }] },
      [{ name: "b", in: "query" }],
      "b",
      0,
    );
    expect(req.params.map((p) => p.name).sort()).toEqual(["a", "b"]);
  });
  it("deduplica por in+name", () => {
    const req = converterOperacao(
      "GET",
      "/x",
      { parameters: [{ name: "a", in: "query", example: "op" }] },
      [{ name: "a", in: "query", example: "path" }],
      "b",
      0,
    );
    expect(req.params.length).toBe(1);
    expect(req.params[0].value).toBe("path");
  });
});

describe("valorExemplo", () => {
  it("example direto", () => {
    expect(valorExemplo({ example: 5 })).toBe("5");
  });
  it("schema.example", () => {
    expect(valorExemplo({ schema: { example: "x" } })).toBe("x");
  });
  it("schema.default", () => {
    expect(valorExemplo({ schema: { default: 10 } })).toBe("10");
  });
  it("vazio sem nada", () => {
    expect(valorExemplo({})).toBe("");
  });
});

describe("converterRequestBody", () => {
  it("sem content vira none", () => {
    expect(converterRequestBody(undefined)).toEqual({ mode: "none" });
    expect(converterRequestBody({})).toEqual({ mode: "none" });
  });
  it("json com exemplo", () => {
    const b = converterRequestBody({
      content: { "application/json": { example: { a: 1 } } },
    });
    expect(b.mode).toBe("json");
    expect(b.raw).toBe('{\n  "a": 1\n}');
  });
  it("json sem exemplo vira raw vazio", () => {
    const b = converterRequestBody({ content: { "application/json": {} } });
    expect(b).toEqual({ mode: "json", raw: "" });
  });
  it("xml", () => {
    expect(
      converterRequestBody({ content: { "application/xml": {} } }).mode,
    ).toBe("xml");
  });
  it("urlencoded", () => {
    expect(
      converterRequestBody({
        content: { "application/x-www-form-urlencoded": {} },
      }).mode,
    ).toBe("form_urlencoded");
  });
});

describe("exemploDeMedia", () => {
  it("example direto", () => {
    expect(exemploDeMedia({ example: 1 })).toBe(1);
  });
  it("examples[*].value", () => {
    expect(exemploDeMedia({ examples: { a: { value: 9 } } })).toBe(9);
  });
  it("undefined sem nada", () => {
    expect(exemploDeMedia({})).toBeUndefined();
  });
});

describe("juntarUrl", () => {
  it("evita barra dupla", () => {
    expect(juntarUrl("http://x/", "/y")).toBe("http://x/y");
  });
  it("adiciona barra quando falta", () => {
    expect(juntarUrl("http://x", "y")).toBe("http://x/y");
  });
});

describe("openapi — casos extras p/ mutacao", () => {
  it("itera todos os metodos HTTP (head/options/patch)", () => {
    const r = parseOpenapi({
      info: { title: "x" },
      paths: {
        "/a": {
          patch: { summary: "P" },
          head: { summary: "H" },
          options: { summary: "O" },
        },
      },
    });
    if (!r.ok) throw new Error("ok");
    const metodos = r.collection.items
      .filter(isRequest)
      .map((i) => (i as { method: string }).method)
      .sort();
    expect(metodos).toEqual(["HEAD", "OPTIONS", "PATCH"]);
  });

  it("ignora chave de path que nao e operacao (ex.: parameters array)", () => {
    const r = parseOpenapi({
      info: { title: "x" },
      paths: { "/a": { get: { summary: "G" }, parameters: [] } },
    });
    if (!r.ok) throw new Error("ok");
    expect(r.collection.items.filter(isRequest)).toHaveLength(1);
  });

  it("valorExemplo: example null cai para schema", () => {
    expect(valorExemplo({ example: null, schema: { default: "d" } })).toBe("d");
  });
  it("valorExemplo: schema.example null cai para schema.default", () => {
    expect(valorExemplo({ schema: { example: null, default: "d" } })).toBe("d");
  });

  it("baseUrl: schemes vazio usa https", () => {
    expect(baseUrl({ host: "h", schemes: [] })).toBe("https://h");
  });
  it("baseUrl: servers tem prioridade sobre host", () => {
    expect(baseUrl({ servers: [{ url: "http://s" }], host: "h" })).toBe("http://s");
  });

  it("converterRequestBody: fallback p/ media type *+json", () => {
    const b = converterRequestBody({
      content: { "application/vnd.api+json": { example: { a: 1 } } },
    });
    expect(b.mode).toBe("json");
    expect(b.raw).toContain('"a": 1');
  });
  it("converterRequestBody: media desconhecida vira text", () => {
    expect(
      converterRequestBody({ content: { "text/csv": {} } }).mode,
    ).toBe("text");
  });

  it("exemploDeMedia prefere example direto sobre examples[]", () => {
    expect(exemploDeMedia({ example: 1, examples: { a: { value: 2 } } })).toBe(1);
  });

  it("path param nao entra em params nem headers (so na URL)", () => {
    const req = converterOperacao(
      "GET",
      "/u/{id}",
      { parameters: [{ name: "id", in: "path", required: true }] },
      [],
      "http://b",
      0,
    );
    expect(req.params).toEqual([]);
    expect(req.headers).toEqual([]);
    expect(req.url).toBe("http://b/u/{id}");
  });

  it("seq global incrementa entre operacoes e pastas", () => {
    const r = parseOpenapi({
      info: { title: "x" },
      paths: {
        "/a": { get: { tags: ["t"], summary: "A" } },
        "/b": { get: { summary: "B" } },
      },
    });
    if (!r.ok) throw new Error("ok");
    // 1 pasta (tag t) + 1 request solto = 2 itens na raiz
    expect(r.collection.items).toHaveLength(2);
  });
});
