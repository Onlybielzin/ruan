// Testes de ENDURECIMENTO (mutation-killing) da logica PURA de src/lib/codegen.ts
// (F18). Complementam codegen.test.ts focando em mutantes que sobrevivem:
// escapes exatos, boundaries de habilitados/temHeader, seletor de flag por modo,
// injecao de Content-Type so quando ausente, e o dispatcher por linguagem.
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
  contentTypeDeRaw,
  temHeader,
  modoEhRaw,
  modoEhForm,
  escaparShell,
  escaparJsDouble,
  strJs,
  escaparPyDouble,
  strPy,
  isLinguagem,
  LINGUAGENS,
  ROTULO_LINGUAGEM,
  type Linguagem,
} from "./codegen";
import type { RequestData, KeyVal, RequestBody } from "./http-types";

function kv(name: string, value: string, enabled = true): KeyVal {
  return { name, value, enabled };
}

function req(over: Partial<RequestData> = {}): RequestData {
  return {
    method: "GET",
    url: "http://x",
    headers: [],
    params: [],
    body: { mode: "none", form: [] },
    ...over,
  };
}

// ---- habilitados: boundary enabled===false vs undefined vs true -------------
describe("habilitados", () => {
  it("undefined -> []", () => {
    expect(habilitados(undefined)).toEqual([]);
  });
  it("mantem enabled true e enabled undefined; remove SO enabled===false", () => {
    const pares = [
      kv("a", "1", true),
      { name: "b", value: "2" } as unknown as KeyVal, // enabled undefined
      kv("c", "3", false),
    ];
    const r = habilitados(pares);
    expect(r.map((p) => p.name)).toEqual(["a", "b"]);
  });
});

// ---- montarUrlComParams: separador, encode, vazio ---------------------------
describe("montarUrlComParams", () => {
  it("sem params habilitados devolve a url intacta", () => {
    expect(montarUrlComParams("http://x", [])).toBe("http://x");
    expect(montarUrlComParams("http://x", [kv("a", "1", false)])).toBe("http://x");
  });
  it("usa ? quando nao ha query", () => {
    expect(montarUrlComParams("http://x", [kv("a", "1")])).toBe("http://x?a=1");
  });
  it("usa & quando ja ha ?", () => {
    expect(montarUrlComParams("http://x?z=0", [kv("a", "1")])).toBe(
      "http://x?z=0&a=1",
    );
  });
  it("percent-encoda nome e valor", () => {
    expect(montarUrlComParams("http://x", [kv("a b", "c&d")])).toBe(
      "http://x?a%20b=c%26d",
    );
  });
  it("junta multiplos com &", () => {
    expect(montarUrlComParams("http://x", [kv("a", "1"), kv("b", "2")])).toBe(
      "http://x?a=1&b=2",
    );
  });
});

// ---- metodoDe: default e uppercase ------------------------------------------
describe("metodoDe", () => {
  it("vazio -> GET", () => {
    expect(metodoDe(req({ method: "" }))).toBe("GET");
  });
  it("uppercase", () => {
    expect(metodoDe(req({ method: "post" }))).toBe("POST");
  });
});

// ---- modoEhRaw / modoEhForm: cada membro -----------------------------------
describe("modos", () => {
  it("raw cobre json/text/xml e nada mais", () => {
    expect(modoEhRaw("json")).toBe(true);
    expect(modoEhRaw("text")).toBe(true);
    expect(modoEhRaw("xml")).toBe(true);
    expect(modoEhRaw("form_urlencoded")).toBe(false);
    expect(modoEhRaw("none")).toBe(false);
  });
  it("form cobre form_urlencoded/multipart e nada mais", () => {
    expect(modoEhForm("form_urlencoded")).toBe(true);
    expect(modoEhForm("multipart")).toBe(true);
    expect(modoEhForm("json")).toBe(false);
    expect(modoEhForm("none")).toBe(false);
  });
});

// ---- contentTypeDeRaw: cada caso ------------------------------------------
describe("contentTypeDeRaw", () => {
  it("json/xml/text e fallback null", () => {
    expect(contentTypeDeRaw("json")).toBe("application/json");
    expect(contentTypeDeRaw("xml")).toBe("application/xml");
    expect(contentTypeDeRaw("text")).toBe("text/plain");
    expect(contentTypeDeRaw("none")).toBeNull();
    expect(contentTypeDeRaw("multipart")).toBeNull();
  });
});

// ---- resolverCorpo: discriminadas + corpo raw vazio = none ------------------
describe("resolverCorpo", () => {
  it("undefined -> none", () => {
    expect(resolverCorpo(undefined)).toEqual({ kind: "none" });
  });
  it("raw vazio -> none (nao raw vazio)", () => {
    expect(resolverCorpo({ mode: "json", raw: "", form: [] })).toEqual({
      kind: "none",
    });
  });
  it("raw nao vazio -> raw com contentType", () => {
    expect(resolverCorpo({ mode: "json", raw: "{}", form: [] })).toEqual({
      kind: "raw",
      text: "{}",
      contentType: "application/json",
    });
  });
  it("form sem pares habilitados -> none", () => {
    expect(
      resolverCorpo({ mode: "multipart", form: [kv("a", "1", false)] }),
    ).toEqual({ kind: "none" });
  });
  it("form com pares -> form", () => {
    const r = resolverCorpo({ mode: "form_urlencoded", form: [kv("a", "1")] });
    expect(r.kind).toBe("form");
  });
  it("modo desconhecido -> none", () => {
    expect(resolverCorpo({ mode: "weird", form: [] } as RequestBody)).toEqual({
      kind: "none",
    });
  });
});

// ---- temHeader: case-insensitive --------------------------------------------
describe("temHeader", () => {
  it("acha case-insensitive", () => {
    expect(temHeader([kv("Content-Type", "x")], "content-type")).toBe(true);
    expect(temHeader([kv("CONTENT-TYPE", "x")], "content-type")).toBe(true);
  });
  it("nao acha quando ausente", () => {
    expect(temHeader([kv("Accept", "x")], "content-type")).toBe(false);
  });
});

// ---- ESCAPES exatos (centro de mutantes de string) --------------------------
describe("escaparShell", () => {
  it("envolve em aspas simples", () => {
    expect(escaparShell("abc")).toBe("'abc'");
  });
  it("neutraliza aspa simples com '\\''", () => {
    expect(escaparShell("a'b")).toBe(`'a'\\''b'`);
  });
  it("deixa metacaracteres de shell inertes (dentro das aspas)", () => {
    expect(escaparShell("$(whoami)")).toBe("'$(whoami)'");
    expect(escaparShell("; rm -rf ~")).toBe("'; rm -rf ~'");
  });
});

describe("escaparJsDouble / strJs", () => {
  it("escapa barra, aspas, e controles \\n\\r\\t", () => {
    expect(escaparJsDouble('a\\b"c\nd\re\tf')).toBe('a\\\\b\\"c\\nd\\re\\tf');
  });
  it("strJs envolve em aspas duplas", () => {
    expect(strJs('x"y')).toBe('"x\\"y"');
  });
  it("ordem: barra escapada antes das demais (sem dupla-escapar \\n)", () => {
    // string com backslash literal seguido de n NAO deve virar newline escapado
    expect(escaparJsDouble("\\n")).toBe("\\\\n");
  });
});

describe("escaparPyDouble / strPy", () => {
  it("escapa igual ao JS", () => {
    expect(escaparPyDouble('a\\b"c\nd')).toBe('a\\\\b\\"c\\nd');
  });
  it("strPy envolve em aspas duplas", () => {
    expect(strPy("x")).toBe('"x"');
  });
});

// ---- isLinguagem / LINGUAGENS / ROTULO --------------------------------------
describe("metadados", () => {
  it("LINGUAGENS exato", () => {
    expect(LINGUAGENS).toEqual(["curl", "fetch", "axios", "python"]);
  });
  it("isLinguagem true para validas, false p/ outras", () => {
    for (const l of LINGUAGENS) expect(isLinguagem(l)).toBe(true);
    expect(isLinguagem("ruby")).toBe(false);
    expect(isLinguagem("")).toBe(false);
  });
  it("ROTULO_LINGUAGEM cobre todas", () => {
    for (const l of LINGUAGENS) expect(ROTULO_LINGUAGEM[l]).toBeTruthy();
  });
});

// ---- dispatcher gerar() encaminha p/ cada gerador ---------------------------
describe("gerar dispatcher", () => {
  const r = req({ method: "POST", url: "http://x", body: { mode: "json", raw: "{}", form: [] } });
  it("curl == gerarCurl", () => expect(gerar("curl", r)).toBe(gerarCurl(r)));
  it("fetch == gerarFetch", () => expect(gerar("fetch", r)).toBe(gerarFetch(r)));
  it("axios == gerarAxios", () => expect(gerar("axios", r)).toBe(gerarAxios(r)));
  it("python == gerarPython", () => expect(gerar("python", r)).toBe(gerarPython(r)));
  it("linguagem invalida cai em curl (fallback)", () => {
    expect(gerar("zzz" as Linguagem, r)).toBe(gerarCurl(r));
  });
  it("copiarComoCurl == gerarCurl", () => {
    expect(copiarComoCurl(r)).toBe(gerarCurl(r));
  });
});

// ---- cURL: forma exata, params na url, header, Content-Type auto ------------
describe("gerarCurl", () => {
  it("GET simples com -X explicito e params", () => {
    const out = gerarCurl(req({ url: "http://x", params: [kv("a", "1")] }));
    expect(out).toContain("curl 'http://x?a=1'");
    expect(out).toContain("-X GET");
  });
  it("header habilitado emitido; desabilitado nao", () => {
    const out = gerarCurl(
      req({ headers: [kv("A", "1"), kv("B", "2", false)] }),
    );
    expect(out).toContain("-H 'A: 1'");
    expect(out).not.toContain("'B: 2'");
  });
  it("raw json injeta Content-Type quando ausente", () => {
    const out = gerarCurl(req({ body: { mode: "json", raw: "{}", form: [] } }));
    expect(out).toContain("-H 'Content-Type: application/json'");
    expect(out).toContain("-d '{}'");
  });
  it("raw json NAO duplica Content-Type quando ja presente", () => {
    const out = gerarCurl(
      req({
        headers: [kv("content-type", "application/json; charset=utf-8")],
        body: { mode: "json", raw: "{}", form: [] },
      }),
    );
    expect(out.match(/Content-Type/gi)?.length).toBe(1);
  });
  it("multipart usa --form; urlencoded usa --data-urlencode", () => {
    const mp = gerarCurl(req({ body: { mode: "multipart", form: [kv("f", "v")] } }));
    expect(mp).toContain("--form 'f=v'");
    expect(mp).not.toContain("--data-urlencode");
    const ue = gerarCurl(
      req({ body: { mode: "form_urlencoded", form: [kv("f", "v")] } }),
    );
    expect(ue).toContain("--data-urlencode 'f=v'");
    expect(ue).not.toContain("--form");
  });
});

// ---- fetch: shape do objeto, headers, body raw e form -----------------------
describe("gerarFetch", () => {
  it("inclui method e url string-escaped", () => {
    const out = gerarFetch(req({ method: "delete", url: "http://x" }));
    expect(out).toContain('await fetch("http://x"');
    expect(out).toContain('method: "DELETE",');
  });
  it("omite bloco headers quando nao ha headers", () => {
    const out = gerarFetch(req());
    expect(out).not.toContain("headers:");
  });
  it("raw vira body string + Content-Type no headers", () => {
    const out = gerarFetch(req({ body: { mode: "json", raw: '{"k":1}', form: [] } }));
    expect(out).toContain('"Content-Type": "application/json",');
    expect(out).toContain('body: "{\\"k\\":1}",');
  });
  it("multipart usa FormData.append", () => {
    const out = gerarFetch(req({ body: { mode: "multipart", form: [kv("f", "v")] } }));
    expect(out).toContain("const formData = new FormData();");
    expect(out).toContain('formData.append("f", "v");');
    expect(out).toContain("body: formData,");
  });
  it("urlencoded usa URLSearchParams", () => {
    const out = gerarFetch(
      req({ body: { mode: "form_urlencoded", form: [kv("f", "v")] } }),
    );
    expect(out).toContain("new URLSearchParams(");
    expect(out).toContain("body: params,");
  });
});

// ---- axios: method lowercase, url field, data --------------------------------
describe("gerarAxios", () => {
  it("method em minusculas e url", () => {
    const out = gerarAxios(req({ method: "PUT", url: "http://x" }));
    expect(out).toContain('method: "put",');
    expect(out).toContain('url: "http://x",');
  });
  it("raw vira data + content-type", () => {
    const out = gerarAxios(req({ body: { mode: "text", raw: "hi", form: [] } }));
    expect(out).toContain('"Content-Type": "text/plain",');
    expect(out).toContain('data: "hi",');
  });
  it("multipart usa formData", () => {
    const out = gerarAxios(req({ body: { mode: "multipart", form: [kv("f", "v")] } }));
    expect(out).toContain("new FormData()");
    expect(out).toContain("data: formData,");
  });
});

// ---- python: import, method lowercase, kwargs --------------------------------
describe("gerarPython", () => {
  it("sempre comeca com import requests", () => {
    expect(gerarPython(req()).startsWith("import requests")).toBe(true);
  });
  it("method lowercase em requests.request", () => {
    const out = gerarPython(req({ method: "PATCH", url: "http://x" }));
    expect(out).toContain('requests.request("patch", "http://x"');
  });
  it("raw vira data=data com Content-Type no headers", () => {
    const out = gerarPython(req({ body: { mode: "json", raw: "{}", form: [] } }));
    expect(out).toContain("headers = {");
    expect(out).toContain('"Content-Type": "application/json",');
    expect(out).toContain("data = ");
    expect(out).toContain("data=data");
  });
  it("multipart usa files=files; urlencoded usa data=data", () => {
    const mp = gerarPython(req({ body: { mode: "multipart", form: [kv("f", "v")] } }));
    expect(mp).toContain("files = {");
    expect(mp).toContain("files=files");
    const ue = gerarPython(
      req({ body: { mode: "form_urlencoded", form: [kv("f", "v")] } }),
    );
    expect(ue).toContain("data = {");
    expect(ue).toContain("data=data");
  });
});

// ---- SEGURANCA: nenhuma injecao real ----------------------------------------
describe("seguranca (sem injecao)", () => {
  it("valor malicioso de header fica como dado em cURL", () => {
    const out = gerarCurl(
      req({ headers: [kv("X", "v'; rm -rf ~ #")] }),
    );
    expect(out).toContain(`-H 'X: v'\\''; rm -rf ~ #'`);
  });
  it("nome de header com newline nao injeta nova flag em cURL", () => {
    const out = gerarCurl(req({ headers: [kv("X\nInjected", "$(whoami)")] }));
    // o newline fica DENTRO das aspas simples; nao gera linha "-H" extra
    expect(out).not.toMatch(/\n\s*-H 'Injected/);
  });
  it("nao interpola {{vars}} (literal cru)", () => {
    const out = gerarFetch(req({ headers: [kv("Authorization", "Bearer {{token}}")] }));
    expect(out).toContain("{{token}}");
  });
});
