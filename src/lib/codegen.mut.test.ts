// F18 — Code generation: testes SUPLEMENTARES focados em matar mutantes que
// sobrevivem a codegen.test.ts. Snapshots de string EXATA por gerador, dispatch
// distinto por linguagem, e ordens/formatacoes que asserts parciais nao fixam.
// LOGICA PURA (codegen.ts e o alvo de mutation).

import { describe, it, expect } from "vitest";
import {
  gerar,
  gerarCurl,
  gerarFetch,
  gerarAxios,
  gerarPython,
  montarUrlComParams,
  strJs,
  strPy,
  resolverCorpo,
  modoEhRaw,
  modoEhForm,
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

// ---------------------------------------------------------------------------
// Dispatcher distingue cada linguagem (mata case-swap no switch de `gerar`).
// ---------------------------------------------------------------------------

describe("gerar — dispatch distinto por linguagem", () => {
  const r = req({
    method: "POST",
    headers: [kv("X-A", "b")],
    body: { mode: "json", raw: "{}", form: [] },
  });
  it("curl == gerarCurl e contem 'curl '", () => {
    expect(gerar("curl", r)).toBe(gerarCurl(r));
    expect(gerar("curl", r).startsWith("curl ")).toBe(true);
  });
  it("fetch == gerarFetch e contem 'await fetch('", () => {
    expect(gerar("fetch", r)).toBe(gerarFetch(r));
    expect(gerar("fetch", r)).toContain("await fetch(");
  });
  it("axios == gerarAxios e contem 'await axios('", () => {
    expect(gerar("axios", r)).toBe(gerarAxios(r));
    expect(gerar("axios", r)).toContain("await axios(");
  });
  it("python == gerarPython e contem 'import requests'", () => {
    expect(gerar("python", r)).toBe(gerarPython(r));
    expect(gerar("python", r)).toContain("import requests");
  });
  it("as quatro saidas sao todas DIFERENTES entre si", () => {
    const outs = [
      gerar("curl", r),
      gerar("fetch", r),
      gerar("axios", r),
      gerar("python", r),
    ];
    expect(new Set(outs).size).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// cURL — string EXATA (mata mutantes em separadores, flags, ordem de linhas).
// ---------------------------------------------------------------------------

describe("gerarCurl — snapshot exato", () => {
  it("GET com header e param: linhas juntadas por ' \\\\\\n', -X antes dos -H", () => {
    const out = gerarCurl(
      req({ headers: [kv("Accept", "application/json")], params: [kv("q", "1")] }),
    );
    expect(out).toBe(
      "curl 'https://api.example.com/users?q=1' \\\n" +
        "  -X GET \\\n" +
        "  -H 'Accept: application/json'",
    );
  });

  it("POST json: ordem header-do-usuario, depois Content-Type injetado, depois -d", () => {
    const out = gerarCurl(
      req({
        method: "POST",
        headers: [kv("Authorization", "Bearer t")],
        body: { mode: "json", raw: '{"a":1}', form: [] },
      }),
    );
    expect(out).toBe(
      "curl 'https://api.example.com/users' \\\n" +
        "  -X POST \\\n" +
        "  -H 'Authorization: Bearer t' \\\n" +
        "  -H 'Content-Type: application/json' \\\n" +
        `  -d '{"a":1}'`,
    );
  });

  it("multipart usa --form e mantem a ordem dos pares habilitados", () => {
    const out = gerarCurl(
      req({
        method: "POST",
        body: {
          mode: "multipart",
          form: [kv("a", "1"), kv("skip", "x", false), kv("b", "2")],
        },
      }),
    );
    expect(out).toBe(
      "curl 'https://api.example.com/users' \\\n" +
        "  -X POST \\\n" +
        "  --form 'a=1' \\\n" +
        "  --form 'b=2'",
    );
  });
});

// ---------------------------------------------------------------------------
// fetch — snapshot exato (mata mutantes em preamble/blocos/virgulas).
// ---------------------------------------------------------------------------

describe("gerarFetch — snapshot exato", () => {
  it("GET simples sem headers nem body: so a chamada, sem preamble/linha em branco", () => {
    const out = gerarFetch(req());
    expect(out).toBe(
      'const response = await fetch("https://api.example.com/users", {\n' +
        '  method: "GET",\n' +
        "});",
    );
    // Sem preamble => nao comeca com linha em branco nem tem "\n\n".
    expect(out).not.toContain("\n\n");
  });

  it("urlencoded: preamble URLSearchParams + body: params, separados por linha em branco", () => {
    const out = gerarFetch(
      req({
        method: "POST",
        body: { mode: "form_urlencoded", form: [kv("a", "1")] },
      }),
    );
    expect(out).toBe(
      "const params = new URLSearchParams([\n" +
        '  ["a", "1"],\n' +
        "]);\n\n" +
        'const response = await fetch("https://api.example.com/users", {\n' +
        '  method: "POST",\n' +
        "  body: params,\n" +
        "});",
    );
  });
});

// ---------------------------------------------------------------------------
// axios — snapshot exato.
// ---------------------------------------------------------------------------

describe("gerarAxios — snapshot exato", () => {
  it("json: method lowercase, url, headers, data na ordem", () => {
    const out = gerarAxios(
      req({
        method: "POST",
        headers: [kv("X-A", "b")],
        body: { mode: "json", raw: "{}", form: [] },
      }),
    );
    expect(out).toBe(
      "const response = await axios({\n" +
        '  method: "post",\n' +
        '  url: "https://api.example.com/users",\n' +
        "  headers: {\n" +
        '    "X-A": "b",\n' +
        '    "Content-Type": "application/json",\n' +
        "  },\n" +
        '  data: "{}",\n' +
        "});",
    );
  });
});

// ---------------------------------------------------------------------------
// python — snapshot exato (ordem headers antes do corpo; files vs data).
// ---------------------------------------------------------------------------

describe("gerarPython — snapshot exato", () => {
  it("multipart: dict files= e kwarg files=files (nao data=)", () => {
    const out = gerarPython(
      req({
        method: "POST",
        body: { mode: "multipart", form: [kv("a", "1"), kv("b", "2")] },
      }),
    );
    expect(out).toBe(
      "import requests\n" +
        "\n" +
        "files = {\n" +
        '    "a": "1",\n' +
        '    "b": "2",\n' +
        "}\n" +
        "\n" +
        'response = requests.request("post", "https://api.example.com/users", files=files)',
    );
  });

  it("headers + json: headers=headers vem ANTES de data=data nos kwargs e o dict headers no topo", () => {
    const out = gerarPython(
      req({
        method: "PUT",
        headers: [kv("X", "y")],
        body: { mode: "json", raw: "{}", form: [] },
      }),
    );
    expect(out).toBe(
      "import requests\n" +
        "\n" +
        "headers = {\n" +
        '    "X": "y",\n' +
        '    "Content-Type": "application/json",\n' +
        "}\n" +
        'data = "{}"\n' +
        "\n" +
        'response = requests.request("put", "https://api.example.com/users", headers=headers, data=data)',
    );
  });
});

// ---------------------------------------------------------------------------
// Helpers de string e predicados (fixam ramos exatos).
// ---------------------------------------------------------------------------

describe("strJs / strPy / predicados de modo", () => {
  it("strJs envolve em aspas duplas e escapa", () => {
    expect(strJs('a"b')).toBe('"a\\"b"');
  });
  it("strPy envolve em aspas duplas e escapa", () => {
    expect(strPy('a"b')).toBe('"a\\"b"');
  });
  it("modoEhRaw so para json/text/xml", () => {
    expect(modoEhRaw("json")).toBe(true);
    expect(modoEhRaw("text")).toBe(true);
    expect(modoEhRaw("xml")).toBe(true);
    expect(modoEhRaw("form_urlencoded")).toBe(false);
    expect(modoEhRaw("none")).toBe(false);
  });
  it("modoEhForm so para form_urlencoded/multipart", () => {
    expect(modoEhForm("form_urlencoded")).toBe(true);
    expect(modoEhForm("multipart")).toBe(true);
    expect(modoEhForm("json")).toBe(false);
    expect(modoEhForm("none")).toBe(false);
  });
  it("montarUrlComParams nao mexe na url sem params (identidade)", () => {
    expect(montarUrlComParams("http://x/y", [])).toBe("http://x/y");
    expect(montarUrlComParams("http://x/y", undefined)).toBe("http://x/y");
  });
  it("resolverCorpo form preserva os pares na ordem e so habilitados", () => {
    const c = resolverCorpo({
      mode: "multipart",
      form: [kv("a", "1"), kv("b", "2", false), kv("c", "3")],
    });
    expect(c.kind === "form" && c.pairs.map((p) => p.name)).toEqual(["a", "c"]);
  });
});
