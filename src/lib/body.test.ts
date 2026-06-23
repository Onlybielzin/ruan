// F7 — Testes da logica PURA do editor de body multi-modo (alvo de mutation
// testing). Foco em body.ts: ordem dos modos, rotulos, classificacao raw/form,
// Content-Type por modo, deteccao/aplicacao de Content-Type manual (case
// insensitive, so habilitado), formatacao/validacao de JSON e os helpers de
// campo de arquivo multipart (prefixo sentinela, basename). Casos normais,
// limites e maliciosos. Sem React, sem IPC.

import { describe, it, expect } from "vitest";
import type { BodyMode, KeyValue } from "./types";
import {
  BODY_MODES,
  rotuloModo,
  modoUsaRaw,
  modoUsaForm,
  contentTypeDeModo,
  indiceContentType,
  temContentTypeManual,
  aplicarContentTypeAuto,
  formatarJson,
  jsonValido,
  MULTIPART_FILE_PREFIX,
  ehCampoArquivo,
  caminhoDoCampoArquivo,
  valueDeArquivo,
  nomeDoArquivo,
  novoPar,
} from "./body";

// Helper para montar KeyValue de forma concisa.
function kv(
  name: string,
  value: string,
  enabled = true,
): KeyValue {
  return { name, value, enabled };
}

// Todos os modos do tipo BodyMode (fonte de verdade independente de BODY_MODES,
// para detectar se BODY_MODES perdeu/ganhou um modo).
const TODOS_MODOS: BodyMode[] = [
  "none",
  "json",
  "text",
  "xml",
  "form_urlencoded",
  "multipart",
  "graphql",
];

describe("BODY_MODES", () => {
  it("tem exatamente os 7 modos na ordem de exibicao esperada", () => {
    expect(BODY_MODES).toEqual([
      "none",
      "json",
      "text",
      "xml",
      "form_urlencoded",
      "multipart",
      "graphql",
    ]);
  });

  it("comeca em none e termina em graphql", () => {
    expect(BODY_MODES[0]).toBe("none");
    expect(BODY_MODES[BODY_MODES.length - 1]).toBe("graphql");
  });

  it("nao tem modos duplicados", () => {
    expect(new Set(BODY_MODES).size).toBe(BODY_MODES.length);
  });

  it("cobre todos os BodyMode do tipo (nenhum modo faltando)", () => {
    expect([...BODY_MODES].sort()).toEqual([...TODOS_MODOS].sort());
  });
});

describe("rotuloModo", () => {
  it("mapeia cada modo para o rotulo exato", () => {
    expect(rotuloModo("none")).toBe("Nenhum");
    expect(rotuloModo("json")).toBe("JSON");
    expect(rotuloModo("text")).toBe("Text");
    expect(rotuloModo("xml")).toBe("XML");
    expect(rotuloModo("form_urlencoded")).toBe("Form URL Encoded");
    expect(rotuloModo("multipart")).toBe("Multipart Form");
    expect(rotuloModo("graphql")).toBe("GraphQL");
  });

  it("devolve rotulo nao-vazio para todo modo conhecido", () => {
    for (const m of TODOS_MODOS) {
      expect(rotuloModo(m).length).toBeGreaterThan(0);
    }
  });

  it("rotulos sao distintos entre si (nenhuma colisao)", () => {
    const rotulos = TODOS_MODOS.map(rotuloModo);
    expect(new Set(rotulos).size).toBe(rotulos.length);
  });

  it("fallback devolve o proprio valor para modo desconhecido", () => {
    expect(rotuloModo("desconhecido" as BodyMode)).toBe("desconhecido");
  });
});

describe("modoUsaRaw", () => {
  it("e true exatamente para json, text, xml e graphql", () => {
    expect(modoUsaRaw("json")).toBe(true);
    expect(modoUsaRaw("text")).toBe(true);
    expect(modoUsaRaw("xml")).toBe(true);
    expect(modoUsaRaw("graphql")).toBe(true);
  });

  it("e false para none, form_urlencoded e multipart", () => {
    expect(modoUsaRaw("none")).toBe(false);
    expect(modoUsaRaw("form_urlencoded")).toBe(false);
    expect(modoUsaRaw("multipart")).toBe(false);
  });

  it("particiona os modos: raw e form sao mutuamente exclusivos", () => {
    for (const m of TODOS_MODOS) {
      expect(modoUsaRaw(m) && modoUsaForm(m)).toBe(false);
    }
  });

  it("conta exatamente 4 modos raw entre todos os modos", () => {
    expect(TODOS_MODOS.filter(modoUsaRaw)).toHaveLength(4);
  });
});

describe("modoUsaForm", () => {
  it("e true exatamente para form_urlencoded e multipart", () => {
    expect(modoUsaForm("form_urlencoded")).toBe(true);
    expect(modoUsaForm("multipart")).toBe(true);
  });

  it("e false para none, json, text, xml e graphql", () => {
    expect(modoUsaForm("none")).toBe(false);
    expect(modoUsaForm("json")).toBe(false);
    expect(modoUsaForm("text")).toBe(false);
    expect(modoUsaForm("xml")).toBe(false);
    expect(modoUsaForm("graphql")).toBe(false);
  });

  it("conta exatamente 2 modos form entre todos os modos", () => {
    expect(TODOS_MODOS.filter(modoUsaForm)).toHaveLength(2);
  });

  it("none nao usa nem raw nem form", () => {
    expect(modoUsaRaw("none")).toBe(false);
    expect(modoUsaForm("none")).toBe(false);
  });
});

describe("contentTypeDeModo", () => {
  it("json e graphql -> application/json", () => {
    expect(contentTypeDeModo("json")).toBe("application/json");
    expect(contentTypeDeModo("graphql")).toBe("application/json");
  });

  it("xml -> application/xml", () => {
    expect(contentTypeDeModo("xml")).toBe("application/xml");
  });

  it("text -> text/plain", () => {
    expect(contentTypeDeModo("text")).toBe("text/plain");
  });

  it("form_urlencoded -> application/x-www-form-urlencoded", () => {
    expect(contentTypeDeModo("form_urlencoded")).toBe(
      "application/x-www-form-urlencoded",
    );
  });

  it("none -> null (sem corpo)", () => {
    expect(contentTypeDeModo("none")).toBeNull();
  });

  it("multipart -> null (boundary gerado no envio)", () => {
    expect(contentTypeDeModo("multipart")).toBeNull();
  });

  it("modo desconhecido cai no default -> null", () => {
    expect(contentTypeDeModo("xyz" as BodyMode)).toBeNull();
  });

  it("todo modo que usa raw tem Content-Type nao-nulo", () => {
    for (const m of TODOS_MODOS) {
      if (modoUsaRaw(m)) {
        expect(contentTypeDeModo(m)).not.toBeNull();
      }
    }
  });
});

describe("indiceContentType", () => {
  it("devolve -1 em lista vazia", () => {
    expect(indiceContentType([])).toBe(-1);
  });

  it("devolve -1 quando nao ha Content-Type", () => {
    expect(indiceContentType([kv("Accept", "x"), kv("Host", "y")])).toBe(-1);
  });

  it("encontra Content-Type exato", () => {
    expect(indiceContentType([kv("Content-Type", "application/json")])).toBe(0);
  });

  it("e case-insensitive no nome do header", () => {
    expect(indiceContentType([kv("content-type", "x")])).toBe(0);
    expect(indiceContentType([kv("CONTENT-TYPE", "x")])).toBe(0);
    expect(indiceContentType([kv("Content-type", "x")])).toBe(0);
  });

  it("ignora espacos em volta do nome (trim)", () => {
    expect(indiceContentType([kv("  Content-Type  ", "x")])).toBe(0);
  });

  it("devolve o primeiro header Content-Type habilitado", () => {
    const headers = [
      kv("Accept", "a"),
      kv("Content-Type", "application/json"),
      kv("Content-Type", "text/plain"),
    ];
    expect(indiceContentType(headers)).toBe(1);
  });

  it("pula Content-Type desabilitado e acha o proximo habilitado", () => {
    const headers = [
      kv("Content-Type", "application/json", false),
      kv("Content-Type", "text/plain", true),
    ];
    expect(indiceContentType(headers)).toBe(1);
  });

  it("devolve -1 se o unico Content-Type esta desabilitado", () => {
    expect(indiceContentType([kv("Content-Type", "x", false)])).toBe(-1);
  });

  it("nao casa nome parcial tipo X-Content-Type", () => {
    expect(indiceContentType([kv("X-Content-Type", "x")])).toBe(-1);
    expect(indiceContentType([kv("Content-Type-Options", "x")])).toBe(-1);
  });

  it("nome so com espacos nao casa", () => {
    expect(indiceContentType([kv("   ", "x")])).toBe(-1);
  });
});

describe("temContentTypeManual", () => {
  it("false em lista vazia", () => {
    expect(temContentTypeManual([])).toBe(false);
  });

  it("true quando ha Content-Type habilitado", () => {
    expect(temContentTypeManual([kv("Content-Type", "x")])).toBe(true);
  });

  it("false quando o Content-Type esta desabilitado", () => {
    expect(temContentTypeManual([kv("Content-Type", "x", false)])).toBe(false);
  });

  it("true para variacao de caixa", () => {
    expect(temContentTypeManual([kv("CoNtEnT-TyPe", "x")])).toBe(true);
  });
});

describe("aplicarContentTypeAuto", () => {
  it("adiciona Content-Type do modo quando nao ha um manual", () => {
    const out = aplicarContentTypeAuto([], "json");
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      name: "Content-Type",
      value: "application/json",
      enabled: true,
    });
  });

  it("usa o Content-Type correto por modo", () => {
    expect(aplicarContentTypeAuto([], "xml").pop()?.value).toBe(
      "application/xml",
    );
    expect(aplicarContentTypeAuto([], "text").pop()?.value).toBe("text/plain");
    expect(aplicarContentTypeAuto([], "graphql").pop()?.value).toBe(
      "application/json",
    );
    expect(aplicarContentTypeAuto([], "form_urlencoded").pop()?.value).toBe(
      "application/x-www-form-urlencoded",
    );
  });

  it("NAO sobrescreve um Content-Type manual existente", () => {
    const headers = [kv("Content-Type", "application/custom")];
    const out = aplicarContentTypeAuto(headers, "json");
    expect(out).toHaveLength(1);
    expect(out[0].value).toBe("application/custom");
  });

  it("NAO sobrescreve manual mesmo com caixa diferente", () => {
    const headers = [kv("content-type", "application/custom")];
    const out = aplicarContentTypeAuto(headers, "json");
    expect(out).toHaveLength(1);
    expect(out[0].value).toBe("application/custom");
  });

  it("adiciona se o unico Content-Type existente esta desabilitado", () => {
    const headers = [kv("Content-Type", "application/old", false)];
    const out = aplicarContentTypeAuto(headers, "json");
    expect(out).toHaveLength(2);
    expect(out[1].value).toBe("application/json");
  });

  it("NAO adiciona nada para modo none (CT nulo)", () => {
    const headers = [kv("Accept", "x")];
    const out = aplicarContentTypeAuto(headers, "none");
    expect(out).toEqual(headers);
    expect(out).toHaveLength(1);
  });

  it("NAO adiciona nada para modo multipart (CT nulo, boundary no envio)", () => {
    const out = aplicarContentTypeAuto([], "multipart");
    expect(out).toEqual([]);
  });

  it("preserva os headers existentes ao adicionar (append no fim)", () => {
    const headers = [kv("Accept", "a"), kv("Host", "h")];
    const out = aplicarContentTypeAuto(headers, "json");
    expect(out).toHaveLength(3);
    expect(out[0].name).toBe("Accept");
    expect(out[1].name).toBe("Host");
    expect(out[2].name).toBe("Content-Type");
  });

  it("NAO muta o array de entrada (imutavel)", () => {
    const headers = [kv("Accept", "a")];
    const copia = headers.map((h) => ({ ...h }));
    aplicarContentTypeAuto(headers, "json");
    expect(headers).toEqual(copia);
    expect(headers).toHaveLength(1);
  });

  it("NAO muta os objetos KeyValue de entrada (clona cada um)", () => {
    const original = kv("Accept", "a");
    const headers = [original];
    const out = aplicarContentTypeAuto(headers, "json");
    out[0].value = "alterado";
    expect(original.value).toBe("a");
  });
});

describe("formatarJson", () => {
  it("formata objeto valido com indentacao default de 2 espacos", () => {
    const r = formatarJson('{"a":1,"b":[2,3]}');
    expect(r.ok).toBe(true);
    expect(r.erro).toBe("");
    expect(r.texto).toBe('{\n  "a": 1,\n  "b": [\n    2,\n    3\n  ]\n}');
  });

  it("respeita o argumento de espacos", () => {
    const r = formatarJson('{"a":1}', 4);
    expect(r.ok).toBe(true);
    expect(r.texto).toBe('{\n    "a": 1\n}');
  });

  it("texto vazio e valido-vazio (ok, texto vazio)", () => {
    const r = formatarJson("");
    expect(r.ok).toBe(true);
    expect(r.texto).toBe("");
    expect(r.erro).toBe("");
  });

  it("texto so com whitespace e valido-vazio", () => {
    const r = formatarJson("   \n\t  ");
    expect(r.ok).toBe(true);
    expect(r.texto).toBe("");
    expect(r.erro).toBe("");
  });

  it("JSON invalido: ok=false, texto original intacto, erro preenchido", () => {
    const entrada = "{ nao e json }";
    const r = formatarJson(entrada);
    expect(r.ok).toBe(false);
    expect(r.texto).toBe(entrada);
    expect(r.erro.length).toBeGreaterThan(0);
  });

  it("formata valores primitivos JSON (numero, string, bool, null)", () => {
    expect(formatarJson("42").texto).toBe("42");
    expect(formatarJson('"oi"').texto).toBe('"oi"');
    expect(formatarJson("true").texto).toBe("true");
    expect(formatarJson("null").texto).toBe("null");
  });

  it("array vazio e objeto vazio sao validos", () => {
    expect(formatarJson("[]").ok).toBe(true);
    expect(formatarJson("{}").ok).toBe(true);
  });

  it("JSON com unicode/escape e preservado e revalidado", () => {
    const r = formatarJson('{"nome":"\\u00e9 acentuado \\n"}');
    expect(r.ok).toBe(true);
    expect(JSON.parse(r.texto)).toEqual({ nome: "é acentuado \n" });
  });

  it("trailing comma e invalido", () => {
    const r = formatarJson('{"a":1,}');
    expect(r.ok).toBe(false);
    expect(r.texto).toBe('{"a":1,}');
  });

  it("nao trata 'undefined' como valido", () => {
    expect(formatarJson("undefined").ok).toBe(false);
  });

  it("normaliza espacamento ja existente (re-indenta)", () => {
    const r = formatarJson('{ "a" :    1 }');
    expect(r.ok).toBe(true);
    expect(r.texto).toBe('{\n  "a": 1\n}');
  });
});

describe("jsonValido", () => {
  it("true para JSON valido", () => {
    expect(jsonValido('{"a":1}')).toBe(true);
  });

  it("true para vazio/whitespace", () => {
    expect(jsonValido("")).toBe(true);
    expect(jsonValido("   ")).toBe(true);
  });

  it("false para JSON invalido", () => {
    expect(jsonValido("{")).toBe(false);
    expect(jsonValido("nope")).toBe(false);
  });
});

describe("MULTIPART_FILE_PREFIX e helpers de arquivo", () => {
  it("o prefixo sentinela e exatamente @file:", () => {
    expect(MULTIPART_FILE_PREFIX).toBe("@file:");
  });

  describe("valueDeArquivo / caminhoDoCampoArquivo (round-trip)", () => {
    it("valueDeArquivo prefixa o caminho", () => {
      expect(valueDeArquivo("/etc/hosts")).toBe("@file:/etc/hosts");
    });

    it("round-trip preserva o caminho", () => {
      const caminhos = [
        "/home/u/a.txt",
        "C:\\temp\\b.bin",
        "",
        "com espacos/arq final.png",
        "@file:literal",
      ];
      for (const c of caminhos) {
        const par = kv("campo", valueDeArquivo(c));
        expect(ehCampoArquivo(par)).toBe(true);
        expect(caminhoDoCampoArquivo(par)).toBe(c);
      }
    });

    it("valueDeArquivo de caminho vazio e so o prefixo (marca arquivo sem caminho)", () => {
      expect(valueDeArquivo("")).toBe("@file:");
      expect(ehCampoArquivo({ name: "", value: "@file:", enabled: true })).toBe(
        true,
      );
      expect(caminhoDoCampoArquivo({ name: "", value: "@file:", enabled: true })).toBe(
        "",
      );
    });
  });

  describe("ehCampoArquivo", () => {
    it("true quando value comeca com o prefixo", () => {
      expect(ehCampoArquivo(kv("f", "@file:/x"))).toBe(true);
    });

    it("true para o prefixo cru sem caminho", () => {
      expect(ehCampoArquivo(kv("f", "@file:"))).toBe(true);
    });

    it("false para texto comum", () => {
      expect(ehCampoArquivo(kv("f", "valor normal"))).toBe(false);
      expect(ehCampoArquivo(kv("f", ""))).toBe(false);
    });

    it("false quando o prefixo aparece no meio (so casa no inicio)", () => {
      expect(ehCampoArquivo(kv("f", "x@file:/y"))).toBe(false);
      expect(ehCampoArquivo(kv("f", " @file:/y"))).toBe(false);
    });

    it("false para prefixo parcial", () => {
      expect(ehCampoArquivo(kv("f", "@file"))).toBe(false);
      expect(ehCampoArquivo(kv("f", "@fil:"))).toBe(false);
    });

    it("classifica texto malicioso @file:/etc/passwd como arquivo (sentinela e literal)", () => {
      // Documenta o achado MEDIO: um texto digitado com o prefixo VIRA arquivo.
      expect(ehCampoArquivo(kv("campo", "@file:/etc/passwd"))).toBe(true);
      expect(caminhoDoCampoArquivo(kv("campo", "@file:/etc/passwd"))).toBe(
        "/etc/passwd",
      );
    });
  });

  describe("caminhoDoCampoArquivo", () => {
    it("remove o prefixo", () => {
      expect(caminhoDoCampoArquivo(kv("f", "@file:/a/b.txt"))).toBe("/a/b.txt");
    });

    it("devolve string vazia se nao for arquivo", () => {
      expect(caminhoDoCampoArquivo(kv("f", "texto"))).toBe("");
      expect(caminhoDoCampoArquivo(kv("f", ""))).toBe("");
    });

    it("preserva : extra no caminho (so o primeiro prefixo e removido)", () => {
      expect(caminhoDoCampoArquivo(kv("f", "@file:C:\\x"))).toBe("C:\\x");
    });
  });
});

describe("nomeDoArquivo (basename)", () => {
  it("caminho vazio -> string vazia", () => {
    expect(nomeDoArquivo("")).toBe("");
  });

  it("basename de caminho unix", () => {
    expect(nomeDoArquivo("/home/user/foto.png")).toBe("foto.png");
  });

  it("basename de caminho windows (backslash)", () => {
    expect(nomeDoArquivo("C:\\Users\\u\\doc.pdf")).toBe("doc.pdf");
  });

  it("basename de caminho misto / e backslash", () => {
    expect(nomeDoArquivo("/a\\b/c\\final.bin")).toBe("final.bin");
  });

  it("nome sem separador devolve ele mesmo", () => {
    expect(nomeDoArquivo("arquivo.txt")).toBe("arquivo.txt");
  });

  it("caminho terminado em separador devolve string vazia (sem basename)", () => {
    expect(nomeDoArquivo("/a/b/")).toBe("");
    expect(nomeDoArquivo("C:\\a\\")).toBe("");
  });

  it("preserva espacos e pontos no nome final", () => {
    expect(nomeDoArquivo("/dir/meu arquivo.final.tar.gz")).toBe(
      "meu arquivo.final.tar.gz",
    );
  });

  it("lida com nome contendo path-traversal textual (so pega o ultimo segmento)", () => {
    expect(nomeDoArquivo("/safe/../../etc/passwd")).toBe("passwd");
  });

  it("caminho que e so um separador -> vazio", () => {
    expect(nomeDoArquivo("/")).toBe("");
    expect(nomeDoArquivo("\\")).toBe("");
  });
});

describe("novoPar", () => {
  it("cria par vazio habilitado", () => {
    expect(novoPar()).toEqual({ name: "", value: "", enabled: true });
  });

  it("retorna uma nova instancia a cada chamada (sem estado compartilhado)", () => {
    const a = novoPar();
    const b = novoPar();
    expect(a).not.toBe(b);
    a.name = "x";
    expect(b.name).toBe("");
  });

  it("um par novo nao e classificado como arquivo", () => {
    expect(ehCampoArquivo(novoPar())).toBe(false);
  });
});
