// Testes da logica PURA de src/lib/import/postman.ts (F17).
import { describe, it, expect } from "vitest";
import {
  parsePostman,
  converterItem,
  converterRequest,
  resolverUrl,
  converterHeaders,
  converterBody,
  converterAuth,
} from "./postman";
import { isFolder, isRequest } from "../types";

describe("parsePostman", () => {
  it("erro em JSON invalido", () => {
    expect(parsePostman("{nao json")).toEqual({
      ok: false,
      error: "JSON invalido na colecao Postman.",
    });
  });
  it("erro em entrada nula", () => {
    expect(parsePostman(null).ok).toBe(false);
    expect(parsePostman(123).ok).toBe(false);
  });
  it("erro sem item[]", () => {
    const r = parsePostman({ info: { name: "x" } });
    expect(r.ok).toBe(false);
  });

  it("nome vem de info.name", () => {
    const r = parsePostman({ info: { name: "Minha API" }, item: [] });
    expect(r.ok && r.collection.name).toBe("Minha API");
  });
  it("nome default quando ausente", () => {
    const r = parsePostman({ item: [] });
    expect(r.ok && r.collection.name).toBe("Colecao importada");
  });

  it("aceita objeto ja parseado", () => {
    const r = parsePostman({
      info: { name: "x" },
      item: [{ name: "r", request: { method: "GET", url: "http://x" } }],
    });
    expect(r.ok && r.collection.items.length).toBe(1);
  });

  it("colecao completa string com pasta e request", () => {
    const json = JSON.stringify({
      info: { name: "API" },
      item: [
        {
          name: "Pasta",
          item: [
            { name: "Req", request: { method: "POST", url: "http://x/y" } },
          ],
        },
      ],
    });
    const r = parsePostman(json);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const folder = r.collection.items[0];
    expect(isFolder(folder)).toBe(true);
    if (!isFolder(folder)) return;
    expect(folder.name).toBe("Pasta");
    expect(isRequest(folder.items[0])).toBe(true);
  });
});

describe("converterItem", () => {
  it("item com .item vira pasta", () => {
    const node = converterItem({ name: "P", item: [] }, 0);
    expect(node.type).toBe("folder");
    expect(node.seq).toBe(0);
  });
  it("item com request vira request", () => {
    const node = converterItem(
      { name: "R", request: { method: "GET", url: "http://x" } },
      2,
    );
    expect(node.type).toBe("request");
    expect(node.seq).toBe(2);
  });
  it("nome default quando ausente", () => {
    const node = converterItem({ request: {} }, 3);
    expect(node.name).toBe("item 4");
  });
  it("propaga auth de pasta", () => {
    const node = converterItem(
      { name: "P", item: [], auth: { type: "bearer", bearer: [{ key: "token", value: "t" }] } },
      0,
    );
    expect(isFolder(node) && node.auth?.mode).toBe("bearer");
  });
});

describe("resolverUrl", () => {
  it("undefined da vazio", () => {
    expect(resolverUrl(undefined)).toEqual({ url: "", params: [] });
  });
  it("string com query", () => {
    const r = resolverUrl("http://x/y?a=1&b=2");
    expect(r.url).toBe("http://x/y");
    expect(r.params).toEqual([
      { name: "a", value: "1", enabled: true },
      { name: "b", value: "2", enabled: true },
    ]);
  });
  it("objeto com raw e query[]", () => {
    const r = resolverUrl({
      raw: "http://x/y?a=1",
      query: [
        { key: "a", value: "1" },
        { key: "b", value: "2", disabled: true },
      ],
    });
    expect(r.url).toBe("http://x/y");
    expect(r.params).toEqual([
      { name: "a", value: "1", enabled: true },
      { name: "b", value: "2", enabled: false },
    ]);
  });
  it("remonta de host/path quando sem raw", () => {
    const r = resolverUrl({
      protocol: "https",
      host: ["api", "x", "com"],
      path: ["v1", "users"],
    });
    expect(r.url).toBe("https://api.x.com/v1/users");
  });
  it("path com objetos {value}", () => {
    const r = resolverUrl({ host: "x", path: [{ value: "a" }, "b"] });
    expect(r.url).toBe("x/a/b");
  });
  it("query com value null vira string vazia", () => {
    const r = resolverUrl({ raw: "http://x", query: [{ key: "k", value: null }] });
    expect(r.params[0]).toEqual({ name: "k", value: "", enabled: true });
  });
});

describe("converterHeaders", () => {
  it("nao-array da vazio", () => {
    expect(converterHeaders(undefined)).toEqual([]);
    expect(converterHeaders("x")).toEqual([]);
  });
  it("mapeia key/value/disabled", () => {
    expect(
      converterHeaders([
        { key: "A", value: "1" },
        { key: "B", value: "2", disabled: true },
      ]),
    ).toEqual([
      { name: "A", value: "1", enabled: true },
      { name: "B", value: "2", enabled: false },
    ]);
  });
});

describe("converterBody", () => {
  it("sem mode vira none", () => {
    expect(converterBody(undefined)).toEqual({ mode: "none" });
    expect(converterBody({})).toEqual({ mode: "none" });
  });
  it("raw json explicito", () => {
    expect(
      converterBody({ mode: "raw", raw: "{}", options: { raw: { language: "json" } } }),
    ).toEqual({ mode: "json", raw: "{}" });
  });
  it("raw detecta json pelo formato", () => {
    expect(converterBody({ mode: "raw", raw: '{"a":1}' }).mode).toBe("json");
  });
  it("raw texto puro", () => {
    expect(converterBody({ mode: "raw", raw: "hello" })).toEqual({
      mode: "text",
      raw: "hello",
    });
  });
  it("urlencoded vira form_urlencoded", () => {
    const b = converterBody({
      mode: "urlencoded",
      urlencoded: [{ key: "a", value: "1" }],
    });
    expect(b.mode).toBe("form_urlencoded");
    expect(b.form).toEqual([{ name: "a", value: "1", enabled: true }]);
  });
  it("formdata vira multipart", () => {
    expect(
      converterBody({ mode: "formdata", formdata: [{ key: "f", value: "v" }] }).mode,
    ).toBe("multipart");
  });
  it("graphql", () => {
    const b = converterBody({
      mode: "graphql",
      graphql: { query: "{ x }", variables: "{}" },
    });
    expect(b).toEqual({
      mode: "graphql",
      graphql: { query: "{ x }", variables: "{}" },
    });
  });
  it("file vira none", () => {
    expect(converterBody({ mode: "file" })).toEqual({ mode: "none" });
  });
});

describe("converterAuth", () => {
  it("sem type vira null", () => {
    expect(converterAuth(undefined)).toBeNull();
    expect(converterAuth({})).toBeNull();
  });
  it("basic", () => {
    expect(
      converterAuth({
        type: "basic",
        basic: [
          { key: "username", value: "u" },
          { key: "password", value: "p" },
        ],
      }),
    ).toEqual({ mode: "basic", username: "u", password: "p" });
  });
  it("bearer", () => {
    expect(
      converterAuth({ type: "bearer", bearer: [{ key: "token", value: "t" }] }),
    ).toEqual({ mode: "bearer", token: "t" });
  });
  it("apikey em query", () => {
    expect(
      converterAuth({
        type: "apikey",
        apikey: [
          { key: "key", value: "k" },
          { key: "value", value: "v" },
          { key: "in", value: "query" },
        ],
      }),
    ).toEqual({ mode: "apikey", key: "k", value: "v", placement: "query" });
  });
  it("apikey default header", () => {
    const a = converterAuth({
      type: "apikey",
      apikey: [{ key: "key", value: "k" }],
    });
    expect(a?.placement).toBe("header");
  });
  it("noauth vira none", () => {
    expect(converterAuth({ type: "noauth" })).toEqual({ mode: "none" });
  });
  it("tipo desconhecido vira null", () => {
    expect(converterAuth({ type: "oauth2" })).toBeNull();
  });
});

describe("converterRequest", () => {
  it("monta request completa", () => {
    const req = converterRequest(
      {
        method: "post",
        url: "http://x/y?a=1",
        header: [{ key: "H", value: "v" }],
        body: { mode: "raw", raw: '{"k":1}' },
        auth: { type: "bearer", bearer: [{ key: "token", value: "t" }] },
        description: "doc",
      },
      "Req",
      0,
    );
    expect(req.method).toBe("POST");
    expect(req.url).toBe("http://x/y");
    expect(req.params).toEqual([{ name: "a", value: "1", enabled: true }]);
    expect(req.headers).toEqual([{ name: "H", value: "v", enabled: true }]);
    expect(req.body.mode).toBe("json");
    expect(req.auth.mode).toBe("bearer");
    expect(req.docs).toBe("doc");
  });
  it("method default GET", () => {
    expect(converterRequest({}, "R", 0).method).toBe("GET");
  });
});

describe("postman — casos extras p/ mutacao", () => {
  it("converterItem: docs da request viram req.docs", () => {
    const node = converterItem(
      { name: "R", request: { method: "GET", url: "http://x" }, description: "doc" },
      0,
    );
    expect(isRequest(node) && node.docs).toBe("doc");
  });

  it("resolverUrl objeto: descarta query sem key nem value", () => {
    const r = resolverUrl({
      raw: "http://x",
      query: [{ disabled: true }, { key: "a", value: "1" }],
    });
    expect(r.params).toEqual([{ name: "a", value: "1", enabled: true }]);
  });

  it("resolverUrl objeto sem raw usa remontagem (host/path)", () => {
    const r = resolverUrl({ host: ["a", "b"], path: ["c"] });
    expect(r.url).toBe("a.b/c");
  });

  it("resolverUrl raw vazio cai na remontagem", () => {
    const r = resolverUrl({ raw: "", host: "h", path: ["p"] });
    expect(r.url).toBe("h/p");
  });

  it("converterHeaders descarta entradas sem key", () => {
    expect(converterHeaders([{ value: "v" }, { key: "K", value: "x" }])).toEqual([
      { name: "K", value: "x", enabled: true },
    ]);
  });

  it("converterBody graphql usa defaults quando campos ausentes", () => {
    expect(converterBody({ mode: "graphql" })).toEqual({
      mode: "graphql",
      graphql: { query: "", variables: "" },
    });
  });

  it("converterBody formdata respeita disabled", () => {
    const b = converterBody({
      mode: "formdata",
      formdata: [
        { key: "a", value: "1" },
        { key: "b", value: "2", disabled: true },
      ],
    });
    expect(b.form).toEqual([
      { name: "a", value: "1", enabled: true },
      { name: "b", value: "2", enabled: false },
    ]);
  });

  it("converterAuth basic com param value ausente -> string vazia", () => {
    const a = converterAuth({ type: "basic", basic: [{ key: "username", value: "u" }] });
    expect(a).toEqual({ mode: "basic", username: "u", password: "" });
  });

  it("converterAuth apikey value null vira vazio", () => {
    const a = converterAuth({
      type: "apikey",
      apikey: [{ key: "key", value: null }],
    });
    expect(a?.mode === "apikey" && a.key).toBe("");
  });
});
