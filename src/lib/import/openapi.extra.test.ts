// F17 — Testes SUPLEMENTARES da logica PURA de import/openapi.ts.
// Foco em mutantes que escapam da suite base: ordem de schemes, fallback
// servers->host, path param ausente da URL/params/headers, content-type "json"
// por substring, exemplos falsy (0), iteracao de varios metodos e chaves
// nao-metodo ignoradas, juntarUrl com base ja sem barra.
import { describe, it, expect } from "vitest";
import {
  parseOpenapi,
  baseUrl,
  converterOperacao,
  converterRequestBody,
  exemploDeMedia,
} from "./openapi";
import { isRequest, isFolder } from "../types";
import type { TreeItem } from "../types";

function asReq(item: TreeItem) {
  if (!isRequest(item)) throw new Error("esperava request");
  return item;
}

describe("baseUrl — casos de borda extras", () => {
  it("usa o PRIMEIRO scheme quando ha varios", () => {
    // mata mutante que troque schemes[0] por schemes[1] ou ultima posicao.
    expect(baseUrl({ host: "h.com", schemes: ["http", "https"] })).toBe(
      "http://h.com",
    );
  });

  it("servers presente mas sem [0].url cai para host", () => {
    expect(baseUrl({ servers: [{}], host: "h.com" })).toBe("https://h.com");
  });

  it("schemes vazio nao quebra e usa https", () => {
    expect(baseUrl({ host: "h.com", schemes: [] })).toBe("https://h.com");
  });

  it("basePath e concatenado e barra final removida", () => {
    expect(baseUrl({ host: "h.com", basePath: "/api/" })).toBe(
      "https://h.com/api",
    );
  });
});

describe("converterOperacao — path param NAO vira params nem headers", () => {
  it("path param fica so na URL (como {var}), nunca em params/headers", () => {
    const r = converterOperacao(
      "GET",
      "/pets/{petId}",
      { parameters: [{ name: "petId", in: "path", required: true }] },
      [],
      "https://a.com",
      0,
    );
    expect(r.url).toBe("https://a.com/pets/{petId}");
    expect(r.params.some((p) => p.name === "petId")).toBe(false);
    expect(r.headers.some((h) => h.name === "petId")).toBe(false);
  });

  it("query e header de mesmo nome coexistem (chave inclui o 'in')", () => {
    const r = converterOperacao(
      "GET",
      "/x",
      {
        parameters: [
          { name: "tok", in: "query" },
          { name: "tok", in: "header" },
        ],
      },
      [],
      "https://a.com",
      0,
    );
    expect(r.params.some((p) => p.name === "tok")).toBe(true);
    expect(r.headers.some((h) => h.name === "tok")).toBe(true);
  });

  it("param do path-item PERDE para o da operacao? nao: path-item vem primeiro e vence no dedupe", () => {
    const r = converterOperacao(
      "GET",
      "/x",
      { parameters: [{ name: "q", in: "query", schema: { default: "op" } }] },
      [{ name: "q", in: "query", schema: { default: "path" } }],
      "https://a.com",
      0,
    );
    const q = r.params.filter((p) => p.name === "q");
    expect(q).toHaveLength(1);
    expect(q[0].value).toBe("path");
  });
});

describe("converterRequestBody — content-type por substring 'json'", () => {
  it("application/vnd.api+json e tratado como json com exemplo", () => {
    const b = converterRequestBody({
      content: { "application/vnd.api+json": { example: { x: 1 } } },
    });
    expect(b.mode).toBe("json");
    expect(b.raw).toBe(JSON.stringify({ x: 1 }, null, 2));
  });

  it("content-type binario desconhecido -> text vazio (nao json)", () => {
    const b = converterRequestBody({ content: { "image/png": {} } });
    expect(b.mode).toBe("text");
    expect(b.raw).toBe("");
  });

  it("text/xml mapeia para xml (alem de application/xml)", () => {
    expect(converterRequestBody({ content: { "text/xml": {} } }).mode).toBe(
      "xml",
    );
  });
});

describe("exemploDeMedia — valores falsy preservados", () => {
  it("example === 0 e retornado, nao tratado como ausente", () => {
    expect(exemploDeMedia({ example: 0 })).toBe(0);
  });
  it("examples[*].value === false e retornado", () => {
    expect(exemploDeMedia({ examples: { a: { value: false } } })).toBe(false);
  });
  it("examples entry sem 'value' e ignorada", () => {
    expect(exemploDeMedia({ examples: { a: {} } })).toBeUndefined();
  });
});

describe("parseOpenapi — iteracao de metodos e agrupamento", () => {
  it("processa get/put/patch e ignora chaves nao-metodo (x-extra, parameters)", () => {
    const r = parseOpenapi({
      info: { title: "M" },
      paths: {
        "/r": {
          parameters: [{ name: "shared", in: "query" }],
          get: { summary: "g" },
          put: { summary: "p" },
          patch: { summary: "pa" },
          "x-extra": { foo: 1 },
        },
      },
    });
    if (!r.ok) throw new Error("falhou");
    expect(r.collection.items).toHaveLength(3);
    const g = asReq(r.collection.items[0]);
    expect(g.params.some((p) => p.name === "shared")).toBe(true);
  });

  it("pastas (com tag) vem ANTES das requests sem tag na raiz", () => {
    const r = parseOpenapi({
      info: { title: "API" },
      servers: [{ url: "https://a.com" }],
      paths: {
        "/tagged": { get: { tags: ["grp"], summary: "T" } },
        "/loose": { get: { summary: "L" } },
      },
    });
    if (!r.ok) throw new Error("falhou");
    expect(isFolder(r.collection.items[0])).toBe(true);
    expect(isRequest(r.collection.items[1])).toBe(true);
  });

  it("seq dos filhos da pasta e reindexado de 0", () => {
    const r = parseOpenapi({
      info: { title: "API" },
      paths: {
        "/a": { get: { tags: ["g"] }, post: { tags: ["g"] } },
      },
    });
    if (!r.ok) throw new Error("falhou");
    const pasta = r.collection.items[0];
    if (!isFolder(pasta)) throw new Error("esperava pasta");
    expect(pasta.items.map((i) => i.seq)).toEqual([0, 1]);
  });
});
