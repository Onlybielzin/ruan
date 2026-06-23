// F17 — Testes SUPLEMENTARES da logica PURA de export.ts.
// Foco em mutantes que escapam da base: round-trip de arvore aninhada via
// paraPostmanString, escolha do separador ?/& no raw, encodar preservando
// {{vars}}, disabled vs habilitado no raw, apikey placement, multipart type.
import { describe, it, expect } from "vitest";
import {
  paraPostman,
  paraPostmanString,
  exportarUrl,
  exportarBody,
  exportarAuth,
} from "./export";
import { novaRequest } from "./types";
import type { Collection, TreeItem, KeyValue } from "./types";

function kv(name: string, value: string, enabled = true): KeyValue {
  return { name, value, enabled };
}

describe("paraPostman / paraPostmanString — round-trip de arvore aninhada", () => {
  const r1 = novaRequest("Lista");
  r1.method = "get";
  r1.url = "https://api/users";
  r1.params = [kv("page", "2")];

  const r2 = novaRequest("Cria");
  r2.method = "POST";
  r2.url = "https://api/users";
  r2.body = { mode: "json", raw: '{"n":1}' };
  r2.auth = { mode: "bearer", token: "tok" };

  const col: Collection = {
    name: "API",
    version: "1",
    items: [
      {
        type: "folder",
        name: "Users",
        seq: 0,
        items: [
          { type: "request", ...r1 },
          { type: "request", ...r2 },
        ],
      } as TreeItem,
    ],
  };

  it("preserva o aninhamento pasta -> 2 requests", () => {
    const out = paraPostman(col);
    expect(out.item).toHaveLength(1);
    expect(out.item[0].name).toBe("Users");
    expect(out.item[0].item).toHaveLength(2);
    expect(out.item[0].request).toBeUndefined();
  });

  it("metodo e normalizado para maiusculas no export", () => {
    const out = paraPostman(col);
    const lista = out.item[0].item![0];
    expect(lista.request?.method).toBe("GET");
  });

  it("paraPostmanString produz JSON re-parseavel equivalente a paraPostman", () => {
    const s = paraPostmanString(col);
    const reparsed = JSON.parse(s);
    expect(reparsed).toEqual(paraPostman(col));
  });

  it("body e auth descem nas requests certas", () => {
    const out = paraPostman(col);
    const cria = out.item[0].item![1];
    expect(cria.request?.body?.mode).toBe("raw");
    expect(cria.request?.body?.options?.raw.language).toBe("json");
    expect(cria.request?.auth?.type).toBe("bearer");
  });
});

describe("exportarUrl — separador e encoding", () => {
  it("primeiro param usa ? quando a url nao tem query", () => {
    expect(exportarUrl("http://x", [kv("a", "1")]).raw).toBe("http://x?a=1");
  });

  it("usa & quando a url ja contem ?", () => {
    expect(exportarUrl("http://x?z=0", [kv("a", "1")]).raw).toBe(
      "http://x?z=0&a=1",
    );
  });

  it("multiplos params habilitados unidos por &", () => {
    expect(exportarUrl("http://x", [kv("a", "1"), kv("b", "2")]).raw).toBe(
      "http://x?a=1&b=2",
    );
  });

  it("param desabilitado fica fora do raw mas presente em query[] com disabled", () => {
    const out = exportarUrl("http://x", [kv("a", "1"), kv("b", "2", false)]);
    expect(out.raw).toBe("http://x?a=1");
    expect(out.query).toEqual([
      { key: "a", value: "1" },
      { key: "b", value: "2", disabled: true },
    ]);
  });

  it("preserva {{vars}} sem percent-encode mas encoda o resto", () => {
    expect(exportarUrl("http://x", [kv("t", "{{token}}")]).raw).toBe(
      "http://x?t={{token}}",
    );
    expect(exportarUrl("http://x", [kv("q", "a b")]).raw).toBe(
      "http://x?q=a%20b",
    );
  });

  it("sem params habilitados o raw e a url intacta (sem ?)", () => {
    expect(exportarUrl("http://x", [kv("a", "1", false)]).raw).toBe("http://x");
  });
});

describe("exportarBody — variantes nao cobertas", () => {
  it("text vira raw com language text", () => {
    expect(exportarBody({ mode: "text", raw: "oi" })).toEqual({
      mode: "raw",
      raw: "oi",
      options: { raw: { language: "text" } },
    });
  });

  it("multipart marca cada par com type 'text'", () => {
    const b = exportarBody({ mode: "multipart", form: [kv("f", "v")] });
    expect(b?.mode).toBe("formdata");
    expect(b?.formdata).toEqual([{ key: "f", value: "v", type: "text" }]);
  });

  it("form_urlencoded mantem disabled nos pares", () => {
    const b = exportarBody({
      mode: "form_urlencoded",
      form: [kv("a", "1"), kv("b", "2", false)],
    });
    expect(b?.urlencoded).toEqual([
      { key: "a", value: "1" },
      { key: "b", value: "2", disabled: true },
    ]);
  });
});

describe("exportarAuth — apikey placement", () => {
  it("placement query => in:query", () => {
    const a = exportarAuth({ mode: "apikey", key: "k", value: "v", placement: "query" });
    expect(a?.apikey?.find((p) => p.key === "in")?.value).toBe("query");
  });
  it("placement ausente => in:header (default)", () => {
    const a = exportarAuth({ mode: "apikey", key: "k", value: "v" });
    expect(a?.apikey?.find((p) => p.key === "in")?.value).toBe("header");
  });
  it("basic preserva ordem username, password", () => {
    const a = exportarAuth({ mode: "basic", username: "u", password: "p" });
    expect(a?.basic?.map((x) => x.key)).toEqual(["username", "password"]);
  });
});
