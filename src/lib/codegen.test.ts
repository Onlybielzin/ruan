import { describe, it, expect } from "vitest";
import {
  gerar,
  gerarCurl,
  gerarFetch,
  gerarAxios,
  gerarPython,
  copiarComoCurl,
  montarUrlComParams,
  habilitados,
  metodoDe,
  resolverCorpo,
  escaparShell,
  escaparJsDouble,
  escaparPyDouble,
  temHeader,
  isLinguagem,
  contentTypeDeRaw,
  LINGUAGENS,
} from "./codegen";
import type { RequestData, KeyVal } from "./http-types";

function kv(name: string, value: string, enabled = true): KeyVal {
  return { name, value, enabled };
}

function req(over: Partial<RequestData> = {}): RequestData {
  return {
    method: "GET",
    url: "https://api.example.com/users",
    headers: [],
    params: [],
    body: { mode: "none", form: [] },
    ...over,
  };
}

describe("habilitados", () => {
  it("filtra enabled === false, mantem undefined", () => {
    const r = habilitados([
      kv("a", "1"),
      kv("b", "2", false),
      { name: "c", value: "3" } as KeyVal,
    ]);
    expect(r.map((p) => p.name)).toEqual(["a", "c"]);
  });
  it("undefined -> []", () => {
    expect(habilitados(undefined)).toEqual([]);
  });
});

describe("montarUrlComParams", () => {
  it("anexa params habilitados com ?", () => {
    expect(montarUrlComParams("http://x/y", [kv("a", "1"), kv("b", "2")])).toBe(
      "http://x/y?a=1&b=2",
    );
  });
  it("usa & se ja tem ?", () => {
    expect(montarUrlComParams("http://x/y?z=0", [kv("a", "1")])).toBe(
      "http://x/y?z=0&a=1",
    );
  });
  it("encoda nome e valor", () => {
    expect(montarUrlComParams("http://x", [kv("a b", "c&d")])).toBe(
      "http://x?a%20b=c%26d",
    );
  });
  it("sem params habilitados -> url intacta", () => {
    expect(montarUrlComParams("http://x", [kv("a", "1", false)])).toBe(
      "http://x",
    );
  });
});

describe("metodoDe", () => {
  it("uppercase", () => {
    expect(metodoDe(req({ method: "post" }))).toBe("POST");
  });
  it("vazio -> GET", () => {
    expect(metodoDe(req({ method: "" }))).toBe("GET");
  });
});

describe("resolverCorpo", () => {
  it("json raw", () => {
    const c = resolverCorpo({ mode: "json", raw: '{"a":1}', form: [] });
    expect(c).toEqual({
      kind: "raw",
      text: '{"a":1}',
      contentType: "application/json",
    });
  });
  it("text e xml raw com content-type proprio", () => {
    expect(resolverCorpo({ mode: "text", raw: "oi", form: [] })).toEqual({
      kind: "raw",
      text: "oi",
      contentType: "text/plain",
    });
    expect(resolverCorpo({ mode: "xml", raw: "<a/>", form: [] })).toEqual({
      kind: "raw",
      text: "<a/>",
      contentType: "application/xml",
    });
  });
  it("raw vazio -> none", () => {
    expect(resolverCorpo({ mode: "json", raw: "", form: [] })).toEqual({
      kind: "none",
    });
  });
  it("raw undefined (sem campo raw) -> none", () => {
    expect(resolverCorpo({ mode: "json", form: [] }).kind).toBe("none");
  });
  it("form_urlencoded com pares so habilitados", () => {
    const c = resolverCorpo({
      mode: "form_urlencoded",
      form: [kv("a", "1"), kv("b", "2", false)],
    });
    expect(c.kind).toBe("form");
    expect(c.kind === "form" && c.pairs.map((p) => p.name)).toEqual(["a"]);
  });
  it("form sem pares habilitados -> none", () => {
    expect(
      resolverCorpo({ mode: "form_urlencoded", form: [kv("a", "1", false)] }).kind,
    ).toBe("none");
    expect(resolverCorpo({ mode: "multipart", form: [] }).kind).toBe("none");
  });
  it("none e desconhecido -> none", () => {
    expect(resolverCorpo({ mode: "none", form: [] }).kind).toBe("none");
    expect(resolverCorpo({ mode: "graphql", form: [] }).kind).toBe("none");
    expect(resolverCorpo(undefined).kind).toBe("none");
  });
});

describe("escapes", () => {
  it("shell escapa aspa simples", () => {
    expect(escaparShell("a'b")).toBe(`'a'\\''b'`);
  });
  it("shell envolve em aspas simples sem alterar outros chars", () => {
    expect(escaparShell("a b\"c")).toBe(`'a b"c'`);
  });
  it("js double", () => {
    expect(escaparJsDouble('a"b\\c\n')).toBe('a\\"b\\\\c\\n');
  });
  it("js double escapa \\r e \\t e ordem barra-antes", () => {
    expect(escaparJsDouble("\r\t")).toBe("\\r\\t");
    // barra invertida deve ser escapada ANTES das aspas (senao dobraria errado)
    expect(escaparJsDouble('\\"')).toBe('\\\\\\"');
  });
  it("py double", () => {
    expect(escaparPyDouble('a"b\\c\n')).toBe('a\\"b\\\\c\\n');
  });
  it("py double escapa \\r e \\t", () => {
    expect(escaparPyDouble("\r\t")).toBe("\\r\\t");
  });
});

describe("temHeader / contentTypeDeRaw", () => {
  it("case-insensitive", () => {
    expect(temHeader([kv("Content-Type", "x")], "content-type")).toBe(true);
    expect(temHeader([kv("X", "y")], "content-type")).toBe(false);
  });
  it("content type por modo", () => {
    expect(contentTypeDeRaw("json")).toBe("application/json");
    expect(contentTypeDeRaw("xml")).toBe("application/xml");
    expect(contentTypeDeRaw("text")).toBe("text/plain");
    expect(contentTypeDeRaw("none")).toBeNull();
  });
});

describe("gerarCurl", () => {
  it("GET basico com header", () => {
    const out = gerarCurl(req({ headers: [kv("Accept", "application/json")] }));
    expect(out).toContain("curl 'https://api.example.com/users'");
    expect(out).toContain("-X GET");
    expect(out).toContain("-H 'Accept: application/json'");
  });
  it("POST json injeta content-type e -d", () => {
    const out = gerarCurl(
      req({ method: "POST", body: { mode: "json", raw: '{"a":1}', form: [] } }),
    );
    expect(out).toContain("-X POST");
    expect(out).toContain("-H 'Content-Type: application/json'");
    expect(out).toContain(`-d '{"a":1}'`);
  });
  it("nao duplica content-type se ja existe", () => {
    const out = gerarCurl(
      req({
        method: "POST",
        headers: [kv("content-type", "application/json")],
        body: { mode: "json", raw: "{}", form: [] },
      }),
    );
    expect(out.match(/Content-Type|content-type/g)?.length).toBe(1);
  });
  it("multipart usa --form, urlencoded usa --data-urlencode", () => {
    const m = gerarCurl(
      req({ method: "POST", body: { mode: "multipart", form: [kv("f", "v")] } }),
    );
    expect(m).toContain("--form 'f=v'");
    const u = gerarCurl(
      req({
        method: "POST",
        body: { mode: "form_urlencoded", form: [kv("f", "v")] },
      }),
    );
    expect(u).toContain("--data-urlencode 'f=v'");
  });
  it("params na url", () => {
    expect(gerarCurl(req({ params: [kv("q", "1")] }))).toContain(
      "users?q=1",
    );
  });
});

describe("gerarFetch", () => {
  it("inclui method e headers", () => {
    const out = gerarFetch(req({ method: "DELETE", headers: [kv("X", "y")] }));
    expect(out).toContain('method: "DELETE"');
    expect(out).toContain('"X": "y"');
    expect(out).toContain("await fetch(");
  });
  it("json body com content-type", () => {
    const out = gerarFetch(
      req({ method: "POST", body: { mode: "json", raw: '{"a":1}', form: [] } }),
    );
    expect(out).toContain('"Content-Type": "application/json"');
    expect(out).toContain('body: "{\\"a\\":1}"');
  });
  it("urlencoded usa URLSearchParams", () => {
    const out = gerarFetch(
      req({
        method: "POST",
        body: { mode: "form_urlencoded", form: [kv("a", "1")] },
      }),
    );
    expect(out).toContain("new URLSearchParams");
    expect(out).toContain("body: params");
  });
  it("multipart usa FormData", () => {
    const out = gerarFetch(
      req({ method: "POST", body: { mode: "multipart", form: [kv("a", "1")] } }),
    );
    expect(out).toContain("new FormData()");
    expect(out).toContain("formData.append");
    expect(out).toContain("body: formData");
  });
});

describe("gerarAxios", () => {
  it("method lowercase e url", () => {
    const out = gerarAxios(req({ method: "PUT" }));
    expect(out).toContain('method: "put"');
    expect(out).toContain("await axios(");
  });
  it("json vira data", () => {
    const out = gerarAxios(
      req({ method: "POST", body: { mode: "json", raw: "{}", form: [] } }),
    );
    expect(out).toContain("data:");
  });
});

describe("gerarPython", () => {
  it("import e requests.request", () => {
    const out = gerarPython(req());
    expect(out).toContain("import requests");
    expect(out).toContain("requests.request(");
    expect(out).toContain('"get"');
  });
  it("headers dict", () => {
    const out = gerarPython(req({ headers: [kv("X", "y")] }));
    expect(out).toContain("headers = {");
    expect(out).toContain("headers=headers");
  });
  it("json -> data=", () => {
    const out = gerarPython(
      req({ method: "POST", body: { mode: "json", raw: "{}", form: [] } }),
    );
    expect(out).toContain("data=data");
  });
  it("multipart -> files=", () => {
    const out = gerarPython(
      req({ method: "POST", body: { mode: "multipart", form: [kv("a", "1")] } }),
    );
    expect(out).toContain("files=files");
  });
});

describe("gerarCurl — estrutura", () => {
  it("GET sem corpo ainda emite -X GET explicito", () => {
    const out = gerarCurl(req({ method: "GET" }));
    expect(out).toContain("-X GET");
    expect(out).not.toContain("-d ");
  });
  it("junta linhas com ' \\\\\\n' (continuacao de shell)", () => {
    const out = gerarCurl(req({ headers: [kv("A", "b")] }));
    expect(out).toContain(" \\\n");
  });
  it("escapa aspa simples dentro do header", () => {
    const out = gerarCurl(req({ headers: [kv("X", "a'b")] }));
    expect(out).toContain(`'X: a'\\''b'`);
  });
  it("params habilitados anexados antes do corpo", () => {
    const out = gerarCurl(
      req({
        method: "POST",
        params: [kv("q", "1"), kv("skip", "x", false)],
        body: { mode: "text", raw: "oi", form: [] },
      }),
    );
    expect(out).toContain("users?q=1");
    expect(out).not.toContain("skip");
  });
});

describe("gerarFetch — estrutura", () => {
  it("sem headers nao emite bloco headers", () => {
    const out = gerarFetch(req({ headers: [] }));
    expect(out).not.toContain("headers:");
  });
  it("sem corpo nao emite body", () => {
    const out = gerarFetch(req());
    expect(out).not.toContain("body:");
  });
  it("urlencoded monta URLSearchParams com pares e usa body: params", () => {
    const out = gerarFetch(
      req({
        method: "POST",
        body: { mode: "form_urlencoded", form: [kv("a", "1"), kv("b", "2")] },
      }),
    );
    expect(out).toContain('["a", "1"]');
    expect(out).toContain('["b", "2"]');
    expect(out).toContain("body: params");
    expect(out).not.toContain("body: formData");
  });
  it("nao re-injeta content-type se header ja existe (json)", () => {
    const out = gerarFetch(
      req({
        method: "POST",
        headers: [kv("Content-Type", "application/json")],
        body: { mode: "json", raw: "{}", form: [] },
      }),
    );
    expect((out.match(/[Cc]ontent-[Tt]ype/g) ?? []).length).toBe(1);
  });
});

describe("gerarAxios — estrutura", () => {
  it("urlencoded usa preamble URLSearchParams e data: params", () => {
    const out = gerarAxios(
      req({
        method: "POST",
        body: { mode: "form_urlencoded", form: [kv("a", "1")] },
      }),
    );
    expect(out).toContain("new URLSearchParams");
    expect(out).toContain("data: params");
  });
  it("multipart usa preamble FormData e data: formData", () => {
    const out = gerarAxios(
      req({ method: "POST", body: { mode: "multipart", form: [kv("a", "1")] } }),
    );
    expect(out).toContain("new FormData()");
    expect(out).toContain("formData.append(\"a\", \"1\")");
    expect(out).toContain("data: formData");
  });
  it("sem headers nao emite bloco headers", () => {
    expect(gerarAxios(req())).not.toContain("headers:");
  });
});

describe("gerarPython — estrutura", () => {
  it("urlencoded vira dict data= (nao files=)", () => {
    const out = gerarPython(
      req({
        method: "POST",
        body: { mode: "form_urlencoded", form: [kv("a", "1")] },
      }),
    );
    expect(out).toContain("data = {");
    expect(out).toContain("data=data");
    expect(out).not.toContain("files=files");
  });
  it("headers entram antes do corpo nos kwargs (headers=headers primeiro)", () => {
    const out = gerarPython(
      req({
        method: "POST",
        headers: [kv("X", "y")],
        body: { mode: "json", raw: "{}", form: [] },
      }),
    );
    const idxHeaders = out.indexOf("headers=headers");
    const idxData = out.indexOf("data=data");
    expect(idxHeaders).toBeGreaterThanOrEqual(0);
    expect(idxData).toBeGreaterThan(idxHeaders);
  });
  it("sem corpo nem headers so import + request", () => {
    const out = gerarPython(req());
    expect(out).not.toContain("data=");
    expect(out).not.toContain("headers=");
    expect(out.startsWith("import requests")).toBe(true);
  });
});

describe("gerar / copiarComoCurl / isLinguagem", () => {
  it("dispatcher cobre todas as linguagens", () => {
    for (const l of LINGUAGENS) {
      expect(typeof gerar(l, req())).toBe("string");
      expect(gerar(l, req()).length).toBeGreaterThan(0);
    }
  });
  it("copiarComoCurl == gerarCurl", () => {
    expect(copiarComoCurl(req())).toBe(gerarCurl(req()));
  });
  it("isLinguagem", () => {
    expect(isLinguagem("curl")).toBe(true);
    expect(isLinguagem("ruby")).toBe(false);
  });
});
