// Testes de ENDURECIMENTO (mutation-killing + robustez) para os parsers de
// import (F17): curl, postman, openapi, e o round-trip export->parsePostman.
// Complementam curl.test.ts/postman.test.ts/openapi.test.ts/export.test.ts.
//
// IMPORTANTE: documenta tambem o BUG REAL de recursao em parsePostman (estouro
// de pilha em colecao profundamente aninhada) via teste .skip (ver nota abaixo).
import { describe, it, expect } from "vitest";
import { parseCurl, tokenizarShell, dividirHeader, paramsDaUrl, formDeUrlencoded, nomeDeUrl } from "./curl";
import { parsePostman, converterItem } from "./postman";
import { parseOpenapi } from "./openapi";
import { paraPostman } from "../export";
import { isFolder, isRequest, novaRequest } from "../types";
import type { Collection, TreeItem } from "../types";

// =============================================================================
// cURL — robustez "nunca lanca" e tokenizacao
// =============================================================================
describe("parseCurl robustez", () => {
  it("vazio / nao-string -> erro tratado", () => {
    expect(parseCurl("").ok).toBe(false);
    expect(parseCurl("   ").ok).toBe(false);
    expect(parseCurl(undefined as unknown as string).ok).toBe(false);
  });
  it("sem URL -> erro", () => {
    expect(parseCurl("curl -X POST").ok).toBe(false);
  });
  it("aspas nao fechadas nao lancam (devolvem resultado)", () => {
    expect(() => parseCurl("curl 'http://x")).not.toThrow();
  });
  it("comando com URL minima funciona", () => {
    const r = parseCurl("curl http://x/y");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.collection.items.length).toBe(1);
  });
  it("--data implica POST quando sem -X", () => {
    const r = parseCurl("curl http://x -d 'a=1'");
    expect(r.ok && (r.collection.items[0] as { method: string }).method).toBe("POST");
  });
  it("-X explicito vence o POST implicito", () => {
    const r = parseCurl("curl http://x -X PUT -d 'a=1'");
    expect(r.ok && (r.collection.items[0] as { method: string }).method).toBe("PUT");
  });
  it("-G manda data como query e mantem GET", () => {
    const r = parseCurl("curl -G http://x -d 'a=1' -d 'b=2'");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const item = r.collection.items[0] as { method: string; params: { name: string }[]; body?: unknown };
    expect(item.method).toBe("GET");
    expect(item.params.map((p) => p.name)).toEqual(["a", "b"]);
  });
  it("-u user:pass vira basic auth", () => {
    const r = parseCurl("curl http://x -u alice:secret");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const item = r.collection.items[0] as { auth?: { mode: string; username: string; password: string } };
    expect(item.auth).toEqual({ mode: "basic", username: "alice", password: "secret" });
  });
  it("varios cookies viram um header Cookie unico", () => {
    const r = parseCurl("curl http://x -b a=1 -b b=2");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const item = r.collection.items[0] as { headers: { name: string; value: string }[] };
    const cookie = item.headers.find((h) => h.name === "Cookie");
    expect(cookie?.value).toBe("a=1; b=2");
  });
});

describe("tokenizarShell", () => {
  it("aspas simples preservam o conteudo cru", () => {
    expect(tokenizarShell("a 'b c' d")).toEqual(["a", "b c", "d"]);
  });
  it("aspas duplas com escape \\", () => {
    expect(tokenizarShell('"a\\"b"')).toEqual(['a"b']);
  });
  it("continuacao de linha com barra junta linhas", () => {
    expect(tokenizarShell("curl \\\nhttp://x")).toEqual(["curl", "http://x"]);
  });
  it("aspa vazia gera token vazio", () => {
    expect(tokenizarShell("''")).toEqual([""]);
  });
});

describe("helpers cURL", () => {
  it("dividirHeader separa no primeiro :", () => {
    expect(dividirHeader("A: b:c")).toEqual({ name: "A", value: "b:c", enabled: true });
  });
  it("dividirHeader sem : vira nome sem valor", () => {
    expect(dividirHeader("A")).toEqual({ name: "A", value: "", enabled: true });
  });
  it("dividirHeader vazio -> null", () => {
    expect(dividirHeader("   ")).toBeNull();
    expect(dividirHeader(": x")).toBeNull();
  });
  it("paramsDaUrl decodifica e separa base", () => {
    expect(paramsDaUrl("http://x/y?a=1%202&b=c")).toEqual({
      base: "http://x/y",
      params: [
        { name: "a", value: "1 2", enabled: true },
        { name: "b", value: "c", enabled: true },
      ],
    });
  });
  it("formDeUrlencoded quebra pares", () => {
    expect(formDeUrlencoded("a=1&b=2")).toEqual([
      { name: "a", value: "1", enabled: true },
      { name: "b", value: "2", enabled: true },
    ]);
  });
  it("nomeDeUrl usa pathname ou host", () => {
    expect(nomeDeUrl("http://x/users", "GET")).toBe("GET /users");
    expect(nomeDeUrl("http://x/", "POST")).toBe("POST x");
  });
});

// =============================================================================
// OpenAPI — casos reais + malformado
// =============================================================================
describe("parseOpenapi robustez", () => {
  it("JSON invalido -> erro tratado", () => {
    expect(parseOpenapi("{nao json").ok).toBe(false);
  });
  it("entrada nula / nao-objeto -> erro", () => {
    expect(parseOpenapi(null).ok).toBe(false);
    expect(parseOpenapi(42).ok).toBe(false);
  });
  it("doc sem paths -> erro tratado (nunca lanca)", () => {
    expect(() => parseOpenapi({ info: { title: "x" } })).not.toThrow();
    expect(parseOpenapi({ info: { title: "x" } }).ok).toBe(false);
  });
  it("doc minimo gera uma request por operacao", () => {
    const r = parseOpenapi({
      info: { title: "API" },
      servers: [{ url: "https://api.x.com" }],
      paths: {
        "/users": {
          get: { summary: "List", tags: ["Users"] },
          post: { summary: "Create", tags: ["Users"] },
        },
      },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.collection.name).toBe("API");
    // tag "Users" agrupa numa pasta
    const folder = r.collection.items.find((i) => isFolder(i));
    expect(folder && isFolder(folder) && folder.items.length).toBe(2);
  });
  it("aceita string JSON", () => {
    const r = parseOpenapi(
      JSON.stringify({ info: { title: "X" }, paths: { "/p": { get: {} } } }),
    );
    expect(r.ok).toBe(true);
  });
});

// =============================================================================
// Postman — round-trip basico export -> parsePostman
// =============================================================================
describe("round-trip export(ruan)->parsePostman", () => {
  it("preserva nome, metodo, headers, params e body json", () => {
    const req = novaRequest("Get User");
    req.method = "POST";
    req.url = "https://api.x.com/users";
    req.headers = [{ name: "Accept", value: "application/json", enabled: true }];
    req.params = [{ name: "page", value: "2", enabled: true }];
    req.body = { mode: "json", raw: '{"k":1}' };
    req.auth = { mode: "bearer", token: "{{token}}" };

    const col: Collection = {
      name: "Minha API",
      items: [{ type: "request", ...req } as TreeItem],
    } as Collection;

    const pm = paraPostman(col);
    const parsed = parsePostman(pm);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(parsed.collection.name).toBe("Minha API");
    const item = parsed.collection.items[0];
    expect(isRequest(item)).toBe(true);
    if (!isRequest(item)) return;
    expect(item.method).toBe("POST");
    expect(item.url).toBe("https://api.x.com/users");
    expect(item.headers).toContainEqual({
      name: "Accept",
      value: "application/json",
      enabled: true,
    });
    expect(item.params).toContainEqual({ name: "page", value: "2", enabled: true });
    expect(item.body.mode).toBe("json");
    expect(item.auth).toEqual({ mode: "bearer", token: "{{token}}" });
  });

  it("preserva estrutura de pasta no round-trip", () => {
    const req = novaRequest("Inner");
    req.url = "http://x/inner";
    const col: Collection = {
      name: "C",
      items: [
        {
          type: "folder",
          name: "Group",
          seq: 0,
          items: [{ type: "request", ...req } as TreeItem],
        } as TreeItem,
      ],
    } as Collection;

    const parsed = parsePostman(paraPostman(col));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const folder = parsed.collection.items[0];
    expect(isFolder(folder)).toBe(true);
    if (!isFolder(folder)) return;
    expect(folder.name).toBe("Group");
    expect(isRequest(folder.items[0])).toBe(true);
  });
});

// =============================================================================
// Postman — robustez de profundidade
// =============================================================================
describe("parsePostman profundidade moderada", () => {
  it("aninhamento moderado (50 niveis) NAO lanca e converte", () => {
    let node: { name: string; item?: unknown[]; request?: unknown } = {
      name: "leaf",
      request: { url: "http://x" },
    };
    for (let i = 0; i < 50; i++) node = { name: "f" + i, item: [node] };
    const col = { info: { name: "deep" }, item: [node] };
    expect(() => parsePostman(col)).not.toThrow();
    expect(parsePostman(col).ok).toBe(true);
  });

  // BUG REAL (reportado): converterItem/parsePostman recursam SEM limite de
  // profundidade. Uma colecao Postman muito aninhada (entrada nao-confiavel)
  // lanca RangeError NAO capturado, violando o contrato "nunca lanca" do
  // arquivo. Este teste fica .skip para nao quebrar a suite enquanto o bug nao
  // e corrigido; quando houver guarda de profundidade, troque para it() e
  // espere { ok: false }.
  it.skip("BUG: aninhamento profundo deveria devolver erro, nao lancar RangeError", () => {
    let node: { name: string; item?: unknown[]; request?: unknown } = {
      name: "leaf",
      request: { url: "http://x" },
    };
    for (let i = 0; i < 60000; i++) node = { name: "f" + i, item: [node] };
    const col = { info: { name: "deep" }, item: [node] };
    // Comportamento DESEJADO (apos fix): nunca lanca, devolve erro tratado.
    expect(() => parsePostman(col)).not.toThrow();
    expect(parsePostman(col).ok).toBe(false);
  });
});

// converterItem: seq/nome default e propagacao de docs
describe("converterItem extras", () => {
  it("request sem nome usa 'item N' (1-based)", () => {
    expect(converterItem({ request: {} }, 4).name).toBe("item 5");
  });
  it("propaga description -> docs em request", () => {
    const node = converterItem(
      { name: "R", request: { url: "http://x" }, description: "doc" },
      0,
    );
    expect(isRequest(node) && node.docs).toBe("doc");
  });
});
