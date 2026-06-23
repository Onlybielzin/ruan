// Testes da logica PURA de src/lib/export.ts (F17).
import { describe, it, expect } from "vitest";
import {
  paraPostman,
  paraPostmanString,
  exportarItem,
  exportarRequest,
  exportarHeaders,
  exportarUrl,
  exportarBody,
  exportarAuth,
  planoDePersistencia,
  juntarDir,
  slugSeguro,
} from "./export";
import { novaRequest } from "./types";
import { parsePostman } from "./import/postman";
import { isFolder, isRequest } from "./types";
import type { Collection, TreeItem, KeyValue } from "./types";

function kv(name: string, value: string, enabled = true): KeyValue {
  return { name, value, enabled };
}

describe("paraPostman", () => {
  it("info com nome e schema", () => {
    const out = paraPostman({ name: "API", version: "1", items: [] });
    expect(out.info.name).toBe("API");
    expect(out.info.schema).toContain("v2.1.0");
    expect(out.item).toEqual([]);
  });
  it("nome default quando vazio", () => {
    const out = paraPostman({ name: "", version: "1", items: [] });
    expect(out.info.name).toBe("Colecao");
  });
  it("tolera items ausente", () => {
    const out = paraPostman({ name: "x" } as unknown as Collection);
    expect(out.item).toEqual([]);
  });
});

describe("paraPostmanString", () => {
  it("devolve JSON identado e re-parseavel", () => {
    const s = paraPostmanString({ name: "API", version: "1", items: [] });
    expect(s).toContain("\n");
    expect(JSON.parse(s).info.name).toBe("API");
  });
});

describe("exportarItem", () => {
  it("pasta vira item com .item[]", () => {
    const folder: TreeItem = {
      type: "folder",
      name: "P",
      seq: 0,
      items: [{ type: "request", ...novaRequest("R") }],
    };
    const out = exportarItem(folder);
    expect(out.name).toBe("P");
    expect(out.item?.length).toBe(1);
    expect(out.request).toBeUndefined();
  });
  it("request vira item com .request", () => {
    const req = novaRequest("R");
    req.url = "http://x";
    const out = exportarItem({ type: "request", ...req });
    expect(out.request?.method).toBe("GET");
    expect(out.item).toBeUndefined();
  });
  it("docs viram description da request", () => {
    const req = novaRequest("R");
    req.docs = "minha doc";
    const out = exportarItem({ type: "request", ...req });
    expect(out.description).toBe("minha doc");
  });
  it("auth de pasta exportada", () => {
    const folder: TreeItem = {
      type: "folder",
      name: "P",
      seq: 0,
      items: [],
      auth: { mode: "bearer", token: "t" },
    };
    const out = exportarItem(folder);
    expect((out as { auth?: { type: string } }).auth?.type).toBe("bearer");
  });
});

describe("exportarHeaders", () => {
  it("nao-array da vazio", () => {
    expect(exportarHeaders(undefined)).toEqual([]);
  });
  it("mapeia e marca disabled", () => {
    expect(exportarHeaders([kv("A", "1"), kv("B", "2", false)])).toEqual([
      { key: "A", value: "1" },
      { key: "B", value: "2", disabled: true },
    ]);
  });
});

describe("exportarUrl", () => {
  it("sem params raw == url", () => {
    expect(exportarUrl("http://x", [])).toEqual({ raw: "http://x" });
  });
  it("remonta raw com query habilitada", () => {
    const out = exportarUrl("http://x", [kv("a", "1"), kv("b", "2")]);
    expect(out.raw).toBe("http://x?a=1&b=2");
    expect(out.query?.length).toBe(2);
  });
  it("ignora params desabilitados no raw mas mantem em query[]", () => {
    const out = exportarUrl("http://x", [kv("a", "1"), kv("b", "2", false)]);
    expect(out.raw).toBe("http://x?a=1");
    expect(out.query).toEqual([
      { key: "a", value: "1" },
      { key: "b", value: "2", disabled: true },
    ]);
  });
  it("usa & quando ja ha ?", () => {
    const out = exportarUrl("http://x?z=0", [kv("a", "1")]);
    expect(out.raw).toBe("http://x?z=0&a=1");
  });
  it("preserva variaveis sem encodar", () => {
    const out = exportarUrl("http://x", [kv("a", "{{val}}")]);
    expect(out.raw).toBe("http://x?a={{val}}");
  });
  it("encoda espacos", () => {
    const out = exportarUrl("http://x", [kv("a", "b c")]);
    expect(out.raw).toBe("http://x?a=b%20c");
  });
});

describe("exportarBody", () => {
  it("none vira null", () => {
    expect(exportarBody({ mode: "none" })).toBeNull();
    expect(exportarBody(undefined)).toBeNull();
  });
  it("json vira raw com language json", () => {
    expect(exportarBody({ mode: "json", raw: "{}" })).toEqual({
      mode: "raw",
      raw: "{}",
      options: { raw: { language: "json" } },
    });
  });
  it("xml", () => {
    expect(exportarBody({ mode: "xml", raw: "<a/>" })?.options?.raw.language).toBe(
      "xml",
    );
  });
  it("form_urlencoded", () => {
    const b = exportarBody({ mode: "form_urlencoded", form: [kv("a", "1")] });
    expect(b?.mode).toBe("urlencoded");
    expect(b?.urlencoded).toEqual([{ key: "a", value: "1" }]);
  });
  it("multipart marca type text", () => {
    const b = exportarBody({ mode: "multipart", form: [kv("a", "1")] });
    expect(b?.mode).toBe("formdata");
    expect(b?.formdata?.[0]).toEqual({ key: "a", value: "1", type: "text" });
  });
  it("graphql", () => {
    const b = exportarBody({
      mode: "graphql",
      graphql: { query: "{x}", variables: "{}" },
    });
    expect(b).toEqual({
      mode: "graphql",
      graphql: { query: "{x}", variables: "{}" },
    });
  });
});

describe("exportarAuth", () => {
  it("none e inherit viram null", () => {
    expect(exportarAuth({ mode: "none" })).toBeNull();
    expect(exportarAuth({ mode: "inherit" })).toBeNull();
    expect(exportarAuth(undefined)).toBeNull();
  });
  it("basic", () => {
    expect(exportarAuth({ mode: "basic", username: "u", password: "p" })).toEqual({
      type: "basic",
      basic: [
        { key: "username", value: "u", type: "string" },
        { key: "password", value: "p", type: "string" },
      ],
    });
  });
  it("bearer", () => {
    expect(exportarAuth({ mode: "bearer", token: "t" })).toEqual({
      type: "bearer",
      bearer: [{ key: "token", value: "t", type: "string" }],
    });
  });
  it("apikey em query", () => {
    const a = exportarAuth({
      mode: "apikey",
      key: "k",
      value: "v",
      placement: "query",
    });
    expect(a?.apikey?.find((p) => p.key === "in")?.value).toBe("query");
  });
  it("apikey default header", () => {
    const a = exportarAuth({ mode: "apikey", key: "k", value: "v" });
    expect(a?.apikey?.find((p) => p.key === "in")?.value).toBe("header");
  });
});

describe("slugSeguro", () => {
  it("slugifica com hifens", () => {
    expect(slugSeguro("Minha Pasta")).toBe("minha-pasta");
  });
  it("remove diacriticos", () => {
    expect(slugSeguro("Café Résumé")).toBe("cafe-resume");
  });
  it("apara hifens das pontas", () => {
    expect(slugSeguro("  !x!  ")).toBe("x");
  });
});

describe("juntarDir", () => {
  it("base undefined retorna segmento", () => {
    expect(juntarDir(undefined, "a")).toBe("a");
  });
  it("junta com barra", () => {
    expect(juntarDir("a", "b")).toBe("a/b");
  });
});

describe("planoDePersistencia", () => {
  it("lista vazia/undefined sem ops", () => {
    expect(planoDePersistencia(undefined)).toEqual([]);
    expect(planoDePersistencia([])).toEqual([]);
  });

  it("requests na raiz", () => {
    const r1 = novaRequest("A");
    const r2 = novaRequest("B");
    const ops = planoDePersistencia([
      { type: "request", ...r1 },
      { type: "request", ...r2 },
    ]);
    expect(ops).toHaveLength(2);
    expect(ops[0]).toMatchObject({ tipo: "request", dir: undefined });
    expect(ops[0].tipo === "request" && ops[0].request.seq).toBe(0);
    expect(ops[1].tipo === "request" && ops[1].request.seq).toBe(1);
  });

  it("pasta vem antes do conteudo com dir derivado do slug", () => {
    const reqFilho = novaRequest("Filho");
    const ops = planoDePersistencia([
      {
        type: "folder",
        name: "Minha Pasta",
        seq: 0,
        items: [{ type: "request", ...reqFilho }],
      },
    ]);
    expect(ops[0]).toEqual({
      tipo: "pasta",
      dir: undefined,
      name: "Minha Pasta",
      seq: 0,
    });
    expect(ops[1]).toMatchObject({ tipo: "request", dir: "minha-pasta" });
  });

  it("aninhamento profundo acumula dir", () => {
    const req = novaRequest("R");
    const ops = planoDePersistencia([
      {
        type: "folder",
        name: "A",
        seq: 0,
        items: [
          {
            type: "folder",
            name: "B",
            seq: 0,
            items: [{ type: "request", ...req }],
          },
        ],
      },
    ]);
    const reqOp = ops.find((o) => o.tipo === "request");
    expect(reqOp?.dir).toBe("a/b");
    // ordem: pasta A, pasta B (dir=a), request (dir=a/b)
    expect(ops.map((o) => o.tipo)).toEqual(["pasta", "pasta", "request"]);
    expect(ops[1]).toMatchObject({ tipo: "pasta", dir: "a", name: "B" });
  });
});

describe("round-trip basico", () => {
  it("exporta request com headers, params, body e auth", () => {
    const req = novaRequest("Cria");
    req.method = "POST";
    req.url = "http://api/users";
    req.headers = [kv("Content-Type", "application/json")];
    req.params = [kv("debug", "1")];
    req.body = { mode: "json", raw: '{"n":1}' };
    req.auth = { mode: "bearer", token: "tok" };

    const out = exportarRequest(req);
    expect(out.method).toBe("POST");
    expect(out.url.raw).toBe("http://api/users?debug=1");
    expect(out.header).toEqual([{ key: "Content-Type", value: "application/json" }]);
    expect(out.body?.mode).toBe("raw");
    expect(out.auth?.type).toBe("bearer");
  });

  it("export -> parsePostman preserva metodo, url, header, params e auth", () => {
    const req = novaRequest("Cria");
    req.method = "POST";
    req.url = "http://api/users";
    req.headers = [kv("Authorization", "Bearer x")];
    req.params = [kv("page", "2")];
    req.body = { mode: "json", raw: '{"n":1}' };
    req.auth = { mode: "bearer", token: "tok" };

    const col: Collection = {
      name: "API",
      version: "1",
      items: [
        {
          type: "folder",
          name: "Users",
          seq: 0,
          items: [{ type: "request", ...req }],
        },
      ],
    };

    const json = paraPostmanString(col);
    const back = parsePostman(json);
    expect(back.ok).toBe(true);
    if (!back.ok) return;

    expect(back.collection.name).toBe("API");
    const pasta = back.collection.items[0];
    expect(isFolder(pasta)).toBe(true);
    if (!isFolder(pasta)) return;
    const r = pasta.items[0];
    expect(isRequest(r)).toBe(true);
    if (!isRequest(r)) return;

    expect(r.method).toBe("POST");
    expect(r.url).toBe("http://api/users");
    expect(r.headers).toEqual([
      { name: "Authorization", value: "Bearer x", enabled: true },
    ]);
    expect(r.params).toEqual([{ name: "page", value: "2", enabled: true }]);
    expect(r.body.mode).toBe("json");
    expect(r.body.raw).toBe('{"n":1}');
    expect(r.auth).toEqual({ mode: "bearer", token: "tok" });
  });

  it("round-trip de auth basic e apikey(query)", () => {
    const mk = (auth: import("./types").Auth): Collection => {
      const req = novaRequest("R");
      req.url = "http://x";
      req.auth = auth;
      return { name: "C", version: "1", items: [{ type: "request", ...req }] };
    };

    const basic = parsePostman(
      paraPostmanString(mk({ mode: "basic", username: "u", password: "p" })),
    );
    expect(basic.ok).toBe(true);
    if (basic.ok && isRequest(basic.collection.items[0])) {
      expect((basic.collection.items[0] as { auth: unknown }).auth).toEqual({
        mode: "basic",
        username: "u",
        password: "p",
      });
    }

    const apikey = parsePostman(
      paraPostmanString(
        mk({ mode: "apikey", key: "k", value: "v", placement: "query" }),
      ),
    );
    expect(apikey.ok).toBe(true);
    if (apikey.ok && isRequest(apikey.collection.items[0])) {
      const a = (apikey.collection.items[0] as { auth: { placement: string } }).auth;
      expect(a.placement).toBe("query");
    }
  });
});
