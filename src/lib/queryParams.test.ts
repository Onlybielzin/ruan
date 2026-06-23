// Testes da logica PURA de query params (F5). Alvo de mutation testing.
import { describe, it, expect } from "vitest";
import type { KeyValue } from "./types";
import {
  splitUrl,
  decodeComponent,
  encodeComponent,
  parseQueryString,
  parseUrlParams,
  buildQueryString,
  buildUrl,
  aplicarParamsNaUrl,
  sincronizarUrlParaParams,
  keyValueParaRow,
  rowParaKeyValue,
  linhaVazia,
  type ParamRow,
} from "./queryParams";

// ----------------------------------------------------------------------------
// splitUrl
// ----------------------------------------------------------------------------
describe("splitUrl", () => {
  it("url sem query nem hash: base = url, query e hash vazios", () => {
    expect(splitUrl("https://api.x.com/v1/users")).toEqual({
      base: "https://api.x.com/v1/users",
      query: "",
      hash: "",
    });
  });

  it("string vazia", () => {
    expect(splitUrl("")).toEqual({ base: "", query: "", hash: "" });
  });

  it("separa a query removendo o `?`", () => {
    expect(splitUrl("https://x.com/p?a=1&b=2")).toEqual({
      base: "https://x.com/p",
      query: "a=1&b=2",
      hash: "",
    });
  });

  it("query vazia apos `?`", () => {
    expect(splitUrl("https://x.com/p?")).toEqual({
      base: "https://x.com/p",
      query: "",
      hash: "",
    });
  });

  it("separa o fragmento e o inclui com o `#`", () => {
    expect(splitUrl("https://x.com/p#secao")).toEqual({
      base: "https://x.com/p",
      query: "",
      hash: "#secao",
    });
  });

  it("hash vazio (apenas `#`) ainda inclui o `#`", () => {
    expect(splitUrl("https://x.com/p#")).toEqual({
      base: "https://x.com/p",
      query: "",
      hash: "#",
    });
  });

  it("query E hash juntos: hash separado primeiro, query nao contem o `#...`", () => {
    expect(splitUrl("https://x.com/p?a=1&b=2#frag")).toEqual({
      base: "https://x.com/p",
      query: "a=1&b=2",
      hash: "#frag",
    });
  });

  it("so o primeiro `#` conta; `#` posteriores ficam dentro do hash", () => {
    expect(splitUrl("https://x.com/p?a=1#f1#f2")).toEqual({
      base: "https://x.com/p",
      query: "a=1",
      hash: "#f1#f2",
    });
  });

  it("um `?` dentro do fragmento NAO e tratado como query (hash sai primeiro)", () => {
    expect(splitUrl("https://x.com/p#frag?naoquery")).toEqual({
      base: "https://x.com/p",
      query: "",
      hash: "#frag?naoquery",
    });
  });

  it("so o primeiro `?` separa a query; `?` seguintes ficam na query", () => {
    expect(splitUrl("https://x.com/p?a=1?b=2")).toEqual({
      base: "https://x.com/p",
      query: "a=1?b=2",
      hash: "",
    });
  });

  it("base vazia com apenas query", () => {
    expect(splitUrl("?a=1")).toEqual({ base: "", query: "a=1", hash: "" });
  });
});

// ----------------------------------------------------------------------------
// decodeComponent
// ----------------------------------------------------------------------------
describe("decodeComponent", () => {
  it("string vazia devolve vazia", () => {
    expect(decodeComponent("")).toBe("");
  });

  it("`+` vira espaco", () => {
    expect(decodeComponent("a+b")).toBe("a b");
  });

  it("multiplos `+` viram multiplos espacos", () => {
    expect(decodeComponent("a++b")).toBe("a  b");
  });

  it("decodifica percent-encoding (%20 -> espaco)", () => {
    expect(decodeComponent("a%20b")).toBe("a b");
  });

  it("decodifica caractere especial percent-encoded (%26 -> &)", () => {
    expect(decodeComponent("x%26y")).toBe("x&y");
  });

  it("decodifica UTF-8 multibyte (cafe acentuado)", () => {
    expect(decodeComponent("caf%C3%A9")).toBe("café");
  });

  it("sequencia `%` malformada solitaria e devolvida como esta (nao lanca)", () => {
    expect(() => decodeComponent("%")).not.toThrow();
    expect(decodeComponent("%")).toBe("%");
  });

  it("sequencia `%zz` invalida devolvida como esta (mas com `+`->espaco aplicado)", () => {
    expect(decodeComponent("a+%zz")).toBe("a %zz");
  });

  it("string sem nada a decodificar devolve identica", () => {
    expect(decodeComponent("plain")).toBe("plain");
  });

  it("combina `+`->espaco e percent juntos", () => {
    expect(decodeComponent("a+b%21c")).toBe("a b!c");
  });
});

// ----------------------------------------------------------------------------
// encodeComponent
// ----------------------------------------------------------------------------
describe("encodeComponent", () => {
  it("string vazia", () => {
    expect(encodeComponent("")).toBe("");
  });

  it("espaco vira %20 (nao `+`)", () => {
    expect(encodeComponent("a b")).toBe("a%20b");
  });

  it("escapa `&` e `=` (delimitadores)", () => {
    expect(encodeComponent("a&b=c")).toBe("a%26b%3Dc");
  });

  it("nao escapa alfanumericos", () => {
    expect(encodeComponent("Abc123")).toBe("Abc123");
  });

  it("escapa caracteres unicode", () => {
    expect(encodeComponent("é")).toBe("%C3%A9");
  });
});

// ----------------------------------------------------------------------------
// parseQueryString
// ----------------------------------------------------------------------------
describe("parseQueryString", () => {
  it("query vazia retorna lista vazia", () => {
    expect(parseQueryString("")).toEqual([]);
  });

  it("um par simples", () => {
    expect(parseQueryString("a=1")).toEqual([
      { name: "a", value: "1", enabled: true },
    ]);
  });

  it("multiplos pares preservam ordem", () => {
    expect(parseQueryString("a=1&b=2&c=3")).toEqual([
      { name: "a", value: "1", enabled: true },
      { name: "b", value: "2", enabled: true },
      { name: "c", value: "3", enabled: true },
    ]);
  });

  it("todas as linhas vem enabled:true", () => {
    const r = parseQueryString("a=1&b=2");
    expect(r.every((p) => p.enabled === true)).toBe(true);
  });

  it("chaves repetidas sao preservadas (nao deduplicadas)", () => {
    expect(parseQueryString("a=1&a=2")).toEqual([
      { name: "a", value: "1", enabled: true },
      { name: "a", value: "2", enabled: true },
    ]);
  });

  it("`name` sem `=` vira valor vazio", () => {
    expect(parseQueryString("flag")).toEqual([
      { name: "flag", value: "", enabled: true },
    ]);
  });

  it("`name=` (com `=` mas sem valor) vira valor vazio", () => {
    expect(parseQueryString("a=")).toEqual([
      { name: "a", value: "", enabled: true },
    ]);
  });

  it("`=value` (sem nome) vira name vazio", () => {
    expect(parseQueryString("=v")).toEqual([
      { name: "", value: "v", enabled: true },
    ]);
  });

  it("segmentos vazios entre `&&` sao ignorados", () => {
    expect(parseQueryString("a=1&&b=2")).toEqual([
      { name: "a", value: "1", enabled: true },
      { name: "b", value: "2", enabled: true },
    ]);
  });

  it("bordas `&` (inicio e fim) ignoradas", () => {
    expect(parseQueryString("&a=1&")).toEqual([
      { name: "a", value: "1", enabled: true },
    ]);
  });

  it("query so com `&` retorna lista vazia", () => {
    expect(parseQueryString("&&&")).toEqual([]);
  });

  it("valor com `=` extra: split no PRIMEIRO `=` apenas", () => {
    expect(parseQueryString("a=1=2")).toEqual([
      { name: "a", value: "1=2", enabled: true },
    ]);
  });

  it("decodifica name e value (percent e `+`)", () => {
    expect(parseQueryString("a%20b=c+d")).toEqual([
      { name: "a b", value: "c d", enabled: true },
    ]);
  });

  it("decodifica `%26` no valor sem quebrar em novo par", () => {
    expect(parseQueryString("a=x%26y")).toEqual([
      { name: "a", value: "x&y", enabled: true },
    ]);
  });
});

// ----------------------------------------------------------------------------
// parseUrlParams
// ----------------------------------------------------------------------------
describe("parseUrlParams", () => {
  it("extrai params de uma URL completa", () => {
    expect(parseUrlParams("https://x.com/p?a=1&b=2")).toEqual([
      { name: "a", value: "1", enabled: true },
      { name: "b", value: "2", enabled: true },
    ]);
  });

  it("URL sem query retorna lista vazia", () => {
    expect(parseUrlParams("https://x.com/p")).toEqual([]);
  });

  it("ignora o fragmento ao extrair params", () => {
    expect(parseUrlParams("https://x.com/p?a=1#frag")).toEqual([
      { name: "a", value: "1", enabled: true },
    ]);
  });

  it("URL so com `?` retorna lista vazia", () => {
    expect(parseUrlParams("https://x.com/p?")).toEqual([]);
  });
});

// ----------------------------------------------------------------------------
// buildQueryString
// ----------------------------------------------------------------------------
describe("buildQueryString", () => {
  it("lista vazia retorna string vazia", () => {
    expect(buildQueryString([])).toBe("");
  });

  it("um par habilitado", () => {
    expect(buildQueryString([{ name: "a", value: "1", enabled: true }])).toBe(
      "a=1",
    );
  });

  it("multiplos pares juntos com `&`, preservando ordem", () => {
    expect(
      buildQueryString([
        { name: "a", value: "1", enabled: true },
        { name: "b", value: "2", enabled: true },
      ]),
    ).toBe("a=1&b=2");
  });

  it("linha desabilitada e ignorada", () => {
    expect(
      buildQueryString([
        { name: "a", value: "1", enabled: false },
        { name: "b", value: "2", enabled: true },
      ]),
    ).toBe("b=2");
  });

  it("todas desabilitadas -> string vazia", () => {
    expect(
      buildQueryString([
        { name: "a", value: "1", enabled: false },
        { name: "b", value: "2", enabled: false },
      ]),
    ).toBe("");
  });

  it("linha com nome vazio e ignorada mesmo habilitada", () => {
    expect(
      buildQueryString([
        { name: "", value: "x", enabled: true },
        { name: "a", value: "1", enabled: true },
      ]),
    ).toBe("a=1");
  });

  it("valor vazio vira `name=`", () => {
    expect(buildQueryString([{ name: "a", value: "", enabled: true }])).toBe(
      "a=",
    );
  });

  it("escapa `&` e `=` no name e value (sem smuggling de par)", () => {
    expect(
      buildQueryString([{ name: "a&b", value: "c=d", enabled: true }]),
    ).toBe("a%26b=c%3Dd");
  });

  it("escapa espacos como %20", () => {
    expect(
      buildQueryString([{ name: "key one", value: "val two", enabled: true }]),
    ).toBe("key%20one=val%20two");
  });

  it("chaves repetidas preservadas", () => {
    expect(
      buildQueryString([
        { name: "a", value: "1", enabled: true },
        { name: "a", value: "2", enabled: true },
      ]),
    ).toBe("a=1&a=2");
  });

  it("mistura: enabled+nomeada entra, demais saem", () => {
    expect(
      buildQueryString([
        { name: "ok", value: "1", enabled: true },
        { name: "", value: "2", enabled: true },
        { name: "off", value: "3", enabled: false },
        { name: "ok2", value: "", enabled: true },
      ]),
    ).toBe("ok=1&ok2=");
  });
});

// ----------------------------------------------------------------------------
// buildUrl
// ----------------------------------------------------------------------------
describe("buildUrl", () => {
  it("base limpa + um param", () => {
    expect(
      buildUrl("https://x.com/p", [{ name: "a", value: "1", enabled: true }]),
    ).toBe("https://x.com/p?a=1");
  });

  it("sem params habilitados -> sem `?`", () => {
    expect(buildUrl("https://x.com/p", [])).toBe("https://x.com/p");
  });

  it("todos desabilitados -> sem `?`", () => {
    expect(
      buildUrl("https://x.com/p", [
        { name: "a", value: "1", enabled: false },
      ]),
    ).toBe("https://x.com/p");
  });

  it("remove a query antiga da base e regenera dos params", () => {
    expect(
      buildUrl("https://x.com/p?velho=9", [
        { name: "novo", value: "1", enabled: true },
      ]),
    ).toBe("https://x.com/p?novo=1");
  });

  it("base com query antiga e sem params novos -> query some", () => {
    expect(buildUrl("https://x.com/p?velho=9", [])).toBe("https://x.com/p");
  });

  it("preserva o fragmento da base", () => {
    expect(
      buildUrl("https://x.com/p#frag", [
        { name: "a", value: "1", enabled: true },
      ]),
    ).toBe("https://x.com/p?a=1#frag");
  });

  it("preserva fragmento mesmo sem params (sem `?`)", () => {
    expect(buildUrl("https://x.com/p#frag", [])).toBe("https://x.com/p#frag");
  });

  it("base com query antiga E fragmento: troca query, mantem fragmento", () => {
    expect(
      buildUrl("https://x.com/p?velho=9#frag", [
        { name: "a", value: "1", enabled: true },
      ]),
    ).toBe("https://x.com/p?a=1#frag");
  });

  it("multiplos params na ordem", () => {
    expect(
      buildUrl("https://x.com/p", [
        { name: "a", value: "1", enabled: true },
        { name: "b", value: "2", enabled: true },
      ]),
    ).toBe("https://x.com/p?a=1&b=2");
  });
});

// ----------------------------------------------------------------------------
// aplicarParamsNaUrl (wrapper de buildUrl)
// ----------------------------------------------------------------------------
describe("aplicarParamsNaUrl", () => {
  it("delega a buildUrl (tabela -> URL)", () => {
    expect(
      aplicarParamsNaUrl("https://x.com/p", [
        { name: "a", value: "1", enabled: true },
      ]),
    ).toBe("https://x.com/p?a=1");
  });

  it("identico a buildUrl para entradas equivalentes", () => {
    const url = "https://x.com/p?old=1#f";
    const params: ParamRow[] = [{ name: "z", value: "9", enabled: true }];
    expect(aplicarParamsNaUrl(url, params)).toBe(buildUrl(url, params));
  });

  it("adicionar ?a=1&b=2 pela tabela aparece na URL (criterio da feature)", () => {
    expect(
      aplicarParamsNaUrl("https://api.x.com/users", [
        { name: "a", value: "1", enabled: true },
        { name: "b", value: "2", enabled: true },
      ]),
    ).toBe("https://api.x.com/users?a=1&b=2");
  });
});

// ----------------------------------------------------------------------------
// sincronizarUrlParaParams (URL -> tabela, reanexando rascunhos)
// ----------------------------------------------------------------------------
describe("sincronizarUrlParaParams", () => {
  it("sem rascunhos: devolve so os params da URL", () => {
    expect(
      sincronizarUrlParaParams("https://x.com/p?a=1&b=2", []),
    ).toEqual([
      { name: "a", value: "1", enabled: true },
      { name: "b", value: "2", enabled: true },
    ]);
  });

  it("reanexa rascunho desabilitado ao final", () => {
    const atuais: ParamRow[] = [
      { name: "x", value: "9", enabled: false },
    ];
    expect(
      sincronizarUrlParaParams("https://x.com/p?a=1", atuais),
    ).toEqual([
      { name: "a", value: "1", enabled: true },
      { name: "x", value: "9", enabled: false },
    ]);
  });

  it("reanexa rascunho com nome vazio (habilitado) ao final", () => {
    const atuais: ParamRow[] = [{ name: "", value: "", enabled: true }];
    expect(
      sincronizarUrlParaParams("https://x.com/p?a=1", atuais),
    ).toEqual([
      { name: "a", value: "1", enabled: true },
      { name: "", value: "", enabled: true },
    ]);
  });

  it("descarta linhas ativas anteriores (habilitadas+nomeadas) — a URL e a fonte", () => {
    const atuais: ParamRow[] = [
      { name: "antigo", value: "1", enabled: true },
      { name: "rascunho", value: "", enabled: false },
    ];
    expect(
      sincronizarUrlParaParams("https://x.com/p?novo=2", atuais),
    ).toEqual([
      { name: "novo", value: "2", enabled: true },
      { name: "rascunho", value: "", enabled: false },
    ]);
  });

  it("preserva a ordem relativa de multiplos rascunhos", () => {
    const atuais: ParamRow[] = [
      { name: "ativo", value: "1", enabled: true }, // descartado
      { name: "d1", value: "a", enabled: false },
      { name: "", value: "b", enabled: true },
      { name: "d2", value: "c", enabled: false },
    ];
    expect(
      sincronizarUrlParaParams("https://x.com/p?u=1", atuais),
    ).toEqual([
      { name: "u", value: "1", enabled: true },
      { name: "d1", value: "a", enabled: false },
      { name: "", value: "b", enabled: true },
      { name: "d2", value: "c", enabled: false },
    ]);
  });

  it("URL sem query e sem rascunhos -> lista vazia", () => {
    expect(sincronizarUrlParaParams("https://x.com/p", [])).toEqual([]);
  });

  it("URL sem query mas com rascunhos -> so os rascunhos", () => {
    const atuais: ParamRow[] = [{ name: "d", value: "1", enabled: false }];
    expect(sincronizarUrlParaParams("https://x.com/p", atuais)).toEqual([
      { name: "d", value: "1", enabled: false },
    ]);
  });
});

// ----------------------------------------------------------------------------
// keyValueParaRow / rowParaKeyValue (conversao store <-> tabela)
// ----------------------------------------------------------------------------
describe("keyValueParaRow", () => {
  it("copia name/value/enabled e description definida", () => {
    const kv: KeyValue = {
      name: "a",
      value: "1",
      enabled: true,
      description: "desc",
    };
    expect(keyValueParaRow(kv)).toEqual({
      name: "a",
      value: "1",
      enabled: true,
      description: "desc",
    });
  });

  it("description undefined permanece undefined", () => {
    const kv: KeyValue = { name: "a", value: "1", enabled: false };
    const row = keyValueParaRow(kv);
    expect(row).toEqual({
      name: "a",
      value: "1",
      enabled: false,
      description: undefined,
    });
    expect(row.description).toBeUndefined();
  });

  it("preserva enabled:false", () => {
    expect(
      keyValueParaRow({ name: "x", value: "y", enabled: false }).enabled,
    ).toBe(false);
  });
});

describe("rowParaKeyValue", () => {
  it("copia name/value/enabled", () => {
    expect(
      rowParaKeyValue({ name: "a", value: "1", enabled: true }),
    ).toEqual({ name: "a", value: "1", enabled: true });
  });

  it("description nao-vazia e gravada", () => {
    expect(
      rowParaKeyValue({
        name: "a",
        value: "1",
        enabled: true,
        description: "info",
      }),
    ).toEqual({ name: "a", value: "1", enabled: true, description: "info" });
  });

  it("description vazia ('') e OMITIDA", () => {
    const kv = rowParaKeyValue({
      name: "a",
      value: "1",
      enabled: true,
      description: "",
    });
    expect(kv).toEqual({ name: "a", value: "1", enabled: true });
    expect("description" in kv).toBe(false);
  });

  it("description undefined e OMITIDA", () => {
    const kv = rowParaKeyValue({ name: "a", value: "1", enabled: true });
    expect("description" in kv).toBe(false);
  });

  it("preserva enabled:false", () => {
    expect(
      rowParaKeyValue({ name: "a", value: "1", enabled: false }).enabled,
    ).toBe(false);
  });

  it("round-trip kv->row->kv preserva campos (com description)", () => {
    const kv: KeyValue = {
      name: "k",
      value: "v",
      enabled: true,
      description: "d",
    };
    expect(rowParaKeyValue(keyValueParaRow(kv))).toEqual(kv);
  });

  it("round-trip kv->row->kv sem description nao introduz a chave", () => {
    const kv: KeyValue = { name: "k", value: "v", enabled: true };
    const back = rowParaKeyValue(keyValueParaRow(kv));
    expect(back).toEqual(kv);
    expect("description" in back).toBe(false);
  });
});

// ----------------------------------------------------------------------------
// linhaVazia
// ----------------------------------------------------------------------------
describe("linhaVazia", () => {
  it("retorna rascunho habilitado vazio", () => {
    expect(linhaVazia()).toEqual({ name: "", value: "", enabled: true });
  });

  it("retorna nova instancia a cada chamada (sem aliasing)", () => {
    const a = linhaVazia();
    const b = linhaVazia();
    expect(a).not.toBe(b);
    a.name = "mutado";
    expect(b.name).toBe("");
  });
});

// ----------------------------------------------------------------------------
// Round-trips de integracao entre as funcoes puras
// ----------------------------------------------------------------------------
describe("round-trips", () => {
  it("parseQueryString -> buildQueryString preserva pares simples", () => {
    const q = "a=1&b=2&c=3";
    expect(buildQueryString(parseQueryString(q))).toBe(q);
  });

  it("buildUrl -> parseUrlParams recupera os params habilitados", () => {
    const params: ParamRow[] = [
      { name: "a", value: "1", enabled: true },
      { name: "b", value: "2", enabled: true },
    ];
    const url = buildUrl("https://x.com/p", params);
    expect(parseUrlParams(url)).toEqual(params);
  });

  it("buildUrl com fragmento -> parseUrlParams ignora fragmento", () => {
    const params: ParamRow[] = [{ name: "a", value: "1", enabled: true }];
    const url = buildUrl("https://x.com/p#frag", params);
    expect(parseUrlParams(url)).toEqual(params);
  });

  it("valores com caracteres especiais sobrevivem a buildUrl/parseUrlParams", () => {
    const params: ParamRow[] = [
      { name: "q", value: "a&b=c d", enabled: true },
    ];
    const url = buildUrl("https://x.com/p", params);
    expect(parseUrlParams(url)).toEqual(params);
  });
});
