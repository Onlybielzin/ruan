// Testes da logica PURA do viewer de resposta (F8) — src/lib/response.ts.
// Alvo de mutation testing: cobre casos normais, limites e maliciosos.

import { describe, it, expect } from "vitest";
import type { KeyVal } from "./http-types";
import {
  formatarTamanho,
  formatarTempo,
  mimeBase,
  detectarTipoConteudo,
  headerValor,
  contentTypeDeResposta,
  prettyJson,
  classeDeStatus,
  corDeStatus,
  parseSetCookie,
  extrairCookies,
  contarOcorrencias,
  ehBinario,
  type ContentKind,
} from "./response";

/** Helper para montar KeyVal enxuto. */
function kv(name: string, value: string, enabled = true): KeyVal {
  return { name, value, enabled };
}

describe("formatarTamanho", () => {
  it("trata 0, negativos e nao-finito como '0 B'", () => {
    expect(formatarTamanho(0)).toBe("0 B");
    expect(formatarTamanho(-1)).toBe("0 B");
    expect(formatarTamanho(-1024)).toBe("0 B");
    expect(formatarTamanho(NaN)).toBe("0 B");
    expect(formatarTamanho(Infinity)).toBe("0 B");
    expect(formatarTamanho(-Infinity)).toBe("0 B");
  });

  it("bytes inteiros sem casas decimais", () => {
    expect(formatarTamanho(1)).toBe("1 B");
    expect(formatarTamanho(512)).toBe("512 B");
    expect(formatarTamanho(1023)).toBe("1023 B");
  });

  it("limite exato de 1024 vira 1 KB (>= e nao >)", () => {
    expect(formatarTamanho(1024)).toBe("1 KB");
  });

  it("KB com casas decimais sem zeros a direita", () => {
    expect(formatarTamanho(1536)).toBe("1.5 KB");
    expect(formatarTamanho(1126)).toBe("1.1 KB"); // 1.099.. -> 1.1
  });

  it("MB, GB, TB nas potencias de 1024", () => {
    expect(formatarTamanho(1048576)).toBe("1 MB");
    expect(formatarTamanho(1073741824)).toBe("1 GB");
    expect(formatarTamanho(1099511627776)).toBe("1 TB");
  });

  it("nao ultrapassa TB (maior unidade, clamp do indice)", () => {
    // 1024 TB ficaria em TB com valor 1024 (nao existe PB na lista).
    expect(formatarTamanho(1024 * 1099511627776)).toBe("1024 TB");
  });

  it("arredonda para no maximo 2 casas", () => {
    // 1.333... KB -> "1.33 KB"
    expect(formatarTamanho(1365)).toBe("1.33 KB");
  });

  it("bytes nao inteiros < 1024 sao arredondados (round, nao trunc)", () => {
    expect(formatarTamanho(1.4)).toBe("1 B");
    expect(formatarTamanho(1.6)).toBe("2 B");
  });
});

describe("formatarTempo", () => {
  it("negativos e nao-finito => '0 ms'", () => {
    expect(formatarTempo(-1)).toBe("0 ms");
    expect(formatarTempo(NaN)).toBe("0 ms");
    expect(formatarTempo(Infinity)).toBe("0 ms");
  });

  it("zero é '0 ms' (>=0 valido)", () => {
    expect(formatarTempo(0)).toBe("0 ms");
  });

  it("abaixo de 1000ms em ms, arredondado", () => {
    expect(formatarTempo(5)).toBe("5 ms");
    expect(formatarTempo(999)).toBe("999 ms");
    expect(formatarTempo(12.4)).toBe("12 ms");
    expect(formatarTempo(12.6)).toBe("13 ms");
  });

  it("1000ms exato vira segundos (boundary < 1000)", () => {
    expect(formatarTempo(1000)).toBe("1 s");
  });

  it("segundos com ate 2 casas sem zeros a direita", () => {
    expect(formatarTempo(1500)).toBe("1.5 s");
    expect(formatarTempo(2500)).toBe("2.5 s");
    expect(formatarTempo(1234)).toBe("1.23 s");
    expect(formatarTempo(2000)).toBe("2 s");
  });
});

describe("mimeBase", () => {
  it("vazio/null/undefined => ''", () => {
    expect(mimeBase("")).toBe("");
    expect(mimeBase(null)).toBe("");
    expect(mimeBase(undefined)).toBe("");
  });

  it("remove parametros e normaliza caixa/espacos", () => {
    expect(mimeBase("application/json; charset=utf-8")).toBe("application/json");
    expect(mimeBase("  TEXT/HTML ; charset=UTF-8")).toBe("text/html");
    expect(mimeBase("Application/JSON")).toBe("application/json");
  });

  it("sem parametros retorna o mime inteiro", () => {
    expect(mimeBase("application/pdf")).toBe("application/pdf");
  });

  it("apenas parametro (começa com ;) => '' apos trim", () => {
    expect(mimeBase(";charset=utf-8")).toBe("");
  });
});

describe("detectarTipoConteudo", () => {
  it("content-type vazio/ausente => 'text'", () => {
    expect(detectarTipoConteudo("")).toBe("text");
    expect(detectarTipoConteudo(null)).toBe("text");
    expect(detectarTipoConteudo(undefined)).toBe("text");
  });

  it("json e variantes +json", () => {
    expect(detectarTipoConteudo("application/json")).toBe("json");
    expect(detectarTipoConteudo("application/json; charset=utf-8")).toBe("json");
    expect(detectarTipoConteudo("application/vnd.api+json")).toBe("json");
    expect(detectarTipoConteudo("application/ld+json")).toBe("json");
  });

  it("html: text/html e application/xhtml+xml", () => {
    expect(detectarTipoConteudo("text/html")).toBe("html");
    expect(detectarTipoConteudo("text/html; charset=utf-8")).toBe("html");
    // xhtml termina com +xml mas html tem precedencia
    expect(detectarTipoConteudo("application/xhtml+xml")).toBe("html");
  });

  it("xml: application/xml, text/xml e variantes +xml", () => {
    expect(detectarTipoConteudo("application/xml")).toBe("xml");
    expect(detectarTipoConteudo("text/xml")).toBe("xml");
    expect(detectarTipoConteudo("application/rss+xml")).toBe("xml");
    expect(detectarTipoConteudo("image/svg+xml")).toBe("xml");
  });

  it("pdf", () => {
    expect(detectarTipoConteudo("application/pdf")).toBe("pdf");
  });

  it("image/* => image", () => {
    expect(detectarTipoConteudo("image/png")).toBe("image");
    expect(detectarTipoConteudo("image/jpeg")).toBe("image");
    expect(detectarTipoConteudo("image/gif")).toBe("image");
  });

  it("text/* => text", () => {
    expect(detectarTipoConteudo("text/plain")).toBe("text");
    expect(detectarTipoConteudo("text/css")).toBe("text");
    expect(detectarTipoConteudo("text/csv")).toBe("text");
  });

  it("application textuais conhecidos => text", () => {
    expect(detectarTipoConteudo("application/javascript")).toBe("text");
    expect(detectarTipoConteudo("application/ecmascript")).toBe("text");
    expect(detectarTipoConteudo("application/x-www-form-urlencoded")).toBe(
      "text",
    );
    expect(detectarTipoConteudo("application/graphql")).toBe("text");
  });

  it("desconhecido => binary", () => {
    expect(detectarTipoConteudo("application/octet-stream")).toBe("binary");
    expect(detectarTipoConteudo("application/zip")).toBe("binary");
    expect(detectarTipoConteudo("font/woff2")).toBe("binary");
    expect(detectarTipoConteudo("audio/mpeg")).toBe("binary");
  });

  it("precedencia: +json antes de +xml nao se aplica, mas +json ganha de generico", () => {
    // garante que a ordem json->html->xml e respeitada
    expect(detectarTipoConteudo("application/something+json")).toBe("json");
    expect(detectarTipoConteudo("application/something+xml")).toBe("xml");
  });
});

describe("headerValor", () => {
  const headers = [
    kv("Content-Type", "application/json"),
    kv("X-Custom", "primeiro"),
    kv("x-custom", "segundo"),
  ];

  it("match case-insensitive", () => {
    expect(headerValor(headers, "content-type")).toBe("application/json");
    expect(headerValor(headers, "CONTENT-TYPE")).toBe("application/json");
  });

  it("retorna o PRIMEIRO match em duplicados", () => {
    expect(headerValor(headers, "X-Custom")).toBe("primeiro");
  });

  it("undefined quando nao existe", () => {
    expect(headerValor(headers, "authorization")).toBeUndefined();
  });

  it("lista vazia => undefined", () => {
    expect(headerValor([], "content-type")).toBeUndefined();
  });

  it("valor vazio é retornado (nao confundido com ausencia)", () => {
    expect(headerValor([kv("X-Empty", "")], "x-empty")).toBe("");
  });
});

describe("contentTypeDeResposta", () => {
  it("extrai content-type dos headers", () => {
    expect(
      contentTypeDeResposta({
        headers: [kv("Content-Type", "text/html; charset=utf-8")],
      }),
    ).toBe("text/html; charset=utf-8");
  });

  it("undefined se ausente", () => {
    expect(contentTypeDeResposta({ headers: [] })).toBeUndefined();
  });
});

describe("prettyJson", () => {
  it("reindenta JSON valido com 2 espacos por padrao", () => {
    const r = prettyJson('{"a":1,"b":[2,3]}');
    expect(r.ok).toBe(true);
    expect(r.texto).toBe('{\n  "a": 1,\n  "b": [\n    2,\n    3\n  ]\n}');
  });

  it("respeita numero de espacos custom", () => {
    const r = prettyJson('{"a":1}', 4);
    expect(r.ok).toBe(true);
    expect(r.texto).toBe('{\n    "a": 1\n}');
  });

  it("string vazia / so espacos => ok:false e texto original", () => {
    expect(prettyJson("")).toEqual({ ok: false, texto: "" });
    expect(prettyJson("   ")).toEqual({ ok: false, texto: "   " });
    expect(prettyJson("\n\t ")).toEqual({ ok: false, texto: "\n\t " });
  });

  it("JSON invalido => ok:false e texto original inalterado", () => {
    const sujo = "{ nao e json }";
    expect(prettyJson(sujo)).toEqual({ ok: false, texto: sujo });
    expect(prettyJson("{'a':1}")).toEqual({ ok: false, texto: "{'a':1}" });
  });

  it("nunca lanca, mesmo com entrada hostil", () => {
    expect(() => prettyJson("undefined")).not.toThrow();
    expect(() => prettyJson("[1,2,")).not.toThrow();
    expect(prettyJson("[1,2,").ok).toBe(false);
  });

  it("primitivos JSON validos sao reformatados (ok:true)", () => {
    expect(prettyJson("42")).toEqual({ ok: true, texto: "42" });
    expect(prettyJson("true")).toEqual({ ok: true, texto: "true" });
    expect(prettyJson("null")).toEqual({ ok: true, texto: "null" });
    expect(prettyJson('"texto"')).toEqual({ ok: true, texto: '"texto"' });
  });
});

describe("classeDeStatus", () => {
  it("faixas e boundaries", () => {
    expect(classeDeStatus(100)).toBe("1xx");
    expect(classeDeStatus(199)).toBe("1xx");
    expect(classeDeStatus(200)).toBe("2xx");
    expect(classeDeStatus(204)).toBe("2xx");
    expect(classeDeStatus(299)).toBe("2xx");
    expect(classeDeStatus(300)).toBe("3xx");
    expect(classeDeStatus(399)).toBe("3xx");
    expect(classeDeStatus(400)).toBe("4xx");
    expect(classeDeStatus(404)).toBe("4xx");
    expect(classeDeStatus(499)).toBe("4xx");
    expect(classeDeStatus(500)).toBe("5xx");
    expect(classeDeStatus(599)).toBe("5xx");
  });

  it("fora das faixas => unknown", () => {
    expect(classeDeStatus(0)).toBe("unknown");
    expect(classeDeStatus(99)).toBe("unknown");
    expect(classeDeStatus(600)).toBe("unknown");
    expect(classeDeStatus(-200)).toBe("unknown");
  });
});

describe("corDeStatus", () => {
  it("cor por faixa", () => {
    expect(corDeStatus(100)).toBe("#22d3ee");
    expect(corDeStatus(200)).toBe("#22c55e");
    expect(corDeStatus(301)).toBe("#eab308");
    expect(corDeStatus(404)).toBe("#f97316");
    expect(corDeStatus(500)).toBe("#ef4444");
    expect(corDeStatus(0)).toBe("#9ca3af");
    expect(corDeStatus(700)).toBe("#9ca3af");
  });
});

describe("parseSetCookie", () => {
  it("nome=valor simples sem atributos", () => {
    expect(parseSetCookie("sid=abc123")).toEqual({
      name: "sid",
      value: "abc123",
      attributes: [],
    });
  });

  it("com atributos: alguns com = outros sem", () => {
    const r = parseSetCookie(
      "sid=abc; Path=/; HttpOnly; Secure; Max-Age=3600",
    );
    expect(r).toEqual({
      name: "sid",
      value: "abc",
      attributes: [
        { name: "Path", value: "/" },
        { name: "HttpOnly", value: "" },
        { name: "Secure", value: "" },
        { name: "Max-Age", value: "3600" },
      ],
    });
  });

  it("aplica trim em nome, valor e atributos", () => {
    const r = parseSetCookie("  sid = abc ;  Path = /app ");
    expect(r?.name).toBe("sid");
    expect(r?.value).toBe("abc");
    expect(r?.attributes[0]).toEqual({ name: "Path", value: "/app" });
  });

  it("valor vazio é valido (nome= )", () => {
    expect(parseSetCookie("sid=")).toEqual({
      name: "sid",
      value: "",
      attributes: [],
    });
  });

  it("sem '=' no primeiro par => null", () => {
    expect(parseSetCookie("apenasnome")).toBeNull();
    expect(parseSetCookie("HttpOnly; Secure")).toBeNull();
  });

  it("nome vazio (=valor) => null", () => {
    expect(parseSetCookie("=valor")).toBeNull();
    expect(parseSetCookie("  =valor")).toBeNull();
  });

  it("linha vazia => null", () => {
    expect(parseSetCookie("")).toBeNull();
  });

  it("valor com '=' interno preserva tudo apos o primeiro =", () => {
    const r = parseSetCookie("token=a=b=c; Path=/");
    expect(r?.value).toBe("a=b=c");
    expect(r?.attributes[0]).toEqual({ name: "Path", value: "/" });
  });

  it("atributo com '=' interno mantem so o primeiro split", () => {
    const r = parseSetCookie("sid=x; Expires=Wed, 09 Jun=2021");
    expect(r?.attributes[0]).toEqual({
      name: "Expires",
      value: "Wed, 09 Jun=2021",
    });
  });
});

describe("extrairCookies", () => {
  it("extrai apenas headers set-cookie (case-insensitive)", () => {
    const headers = [
      kv("Content-Type", "text/html"),
      kv("Set-Cookie", "a=1; Path=/"),
      kv("set-cookie", "b=2"),
      kv("SET-COOKIE", "c=3"),
    ];
    const cookies = extrairCookies(headers);
    expect(cookies.map((c) => c.name)).toEqual(["a", "b", "c"]);
  });

  it("ignora linhas set-cookie invalidas", () => {
    const headers = [
      kv("Set-Cookie", "valido=1"),
      kv("Set-Cookie", "invalido-sem-igual"),
      kv("Set-Cookie", "=semNome"),
    ];
    const cookies = extrairCookies(headers);
    expect(cookies.map((c) => c.name)).toEqual(["valido"]);
  });

  it("lista vazia => []", () => {
    expect(extrairCookies([])).toEqual([]);
  });

  it("sem nenhum set-cookie => []", () => {
    expect(extrairCookies([kv("X", "y")])).toEqual([]);
  });

  it("preserva ordem original", () => {
    const headers = [
      kv("set-cookie", "z=26"),
      kv("set-cookie", "a=1"),
    ];
    expect(extrairCookies(headers).map((c) => c.name)).toEqual(["z", "a"]);
  });
});

describe("contarOcorrencias", () => {
  it("termo vazio => 0", () => {
    expect(contarOcorrencias("qualquer texto", "")).toBe(0);
  });

  it("conta case-insensitive", () => {
    expect(contarOcorrencias("AbcABCabc", "abc")).toBe(3);
    expect(contarOcorrencias("Hello hello HELLO", "hello")).toBe(3);
  });

  it("sem ocorrencia => 0", () => {
    expect(contarOcorrencias("abcdef", "xyz")).toBe(0);
  });

  it("nao conta sobreposicoes (avanca por comprimento do termo)", () => {
    // "aaaa" com termo "aa" => 2 (nao 3)
    expect(contarOcorrencias("aaaa", "aa")).toBe(2);
    expect(contarOcorrencias("aaaaa", "aa")).toBe(2);
  });

  it("conta ocorrencia unica e adjacentes", () => {
    expect(contarOcorrencias("a", "a")).toBe(1);
    expect(contarOcorrencias("abcabc", "abc")).toBe(2);
  });

  it("texto vazio com termo nao-vazio => 0", () => {
    expect(contarOcorrencias("", "x")).toBe(0);
  });

  it("termo igual ao texto => 1", () => {
    expect(contarOcorrencias("exato", "exato")).toBe(1);
  });

  it("caracteres especiais sao tratados literalmente (nao regex)", () => {
    expect(contarOcorrencias("a.b.c", ".")).toBe(2);
    expect(contarOcorrencias("a+b+c", "+")).toBe(2);
    expect(contarOcorrencias("(x)(y)", "(")).toBe(2);
  });

  it("nao entra em loop com termos repetidos longos", () => {
    const grande = "x".repeat(1000);
    expect(contarOcorrencias(grande, "x")).toBe(1000);
  });
});

describe("ehBinario", () => {
  it("true para image, pdf e binary", () => {
    expect(ehBinario("image")).toBe(true);
    expect(ehBinario("pdf")).toBe(true);
    expect(ehBinario("binary")).toBe(true);
  });

  it("false para json, html, xml, text", () => {
    expect(ehBinario("json")).toBe(false);
    expect(ehBinario("html")).toBe(false);
    expect(ehBinario("xml")).toBe(false);
    expect(ehBinario("text")).toBe(false);
  });

  it("cobre todas as ContentKind", () => {
    const todas: ContentKind[] = [
      "json",
      "html",
      "xml",
      "image",
      "pdf",
      "text",
      "binary",
    ];
    const binarios = todas.filter(ehBinario);
    expect(binarios.sort()).toEqual(["binary", "image", "pdf"]);
  });
});
