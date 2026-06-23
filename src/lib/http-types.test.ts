// Testes da logica PURA de src/lib/http-types.ts (F4).
// Foco em matar mutantes: projecao de campos, mapeamento de body, type guard
// de HttpError, normalizacao de mensagem de erro, e a tabela de metodos.
import { describe, it, expect } from "vitest";
import {
  HTTP_METHODS,
  paraKeyVal,
  requestDataDeItem,
  bodyParaRequestBody,
  isHttpError,
  mensagemDeErro,
  type HttpError,
} from "./http-types";
import { novaRequest } from "./types";
import type { KeyValue, RequestItem, BodyMode } from "./types";

function kv(
  name: string,
  value: string,
  enabled = true,
  description?: string,
): KeyValue {
  return { name, value, enabled, description };
}

describe("HTTP_METHODS", () => {
  it("contem exatamente os 7 metodos esperados, nesta ordem", () => {
    expect([...HTTP_METHODS]).toEqual([
      "GET",
      "POST",
      "PUT",
      "PATCH",
      "DELETE",
      "HEAD",
      "OPTIONS",
    ]);
  });

  it("GET e o primeiro (default no builder)", () => {
    expect(HTTP_METHODS[0]).toBe("GET");
  });

  it("nao contem TRACE/CONNECT nem strings vazias", () => {
    expect(HTTP_METHODS).not.toContain("TRACE");
    expect(HTTP_METHODS).not.toContain("CONNECT");
    expect(HTTP_METHODS).not.toContain("");
  });
});

describe("paraKeyVal", () => {
  it("projeta name/value/enabled e descarta description", () => {
    const r = paraKeyVal(kv("Authorization", "Bearer x", true, "nota"));
    expect(r).toEqual({ name: "Authorization", value: "Bearer x", enabled: true });
    expect(r).not.toHaveProperty("description");
  });

  it("preserva enabled=false (nao force true)", () => {
    expect(paraKeyVal(kv("X", "1", false)).enabled).toBe(false);
  });

  it("preserva enabled=true", () => {
    expect(paraKeyVal(kv("X", "1", true)).enabled).toBe(true);
  });

  it("preserva name e value vazios sem mexer", () => {
    expect(paraKeyVal(kv("", ""))).toEqual({ name: "", value: "", enabled: true });
  });

  it("nao usa name no lugar de value nem vice-versa", () => {
    const r = paraKeyVal(kv("chave", "valor"));
    expect(r.name).toBe("chave");
    expect(r.value).toBe("valor");
  });
});

describe("bodyParaRequestBody", () => {
  it("mode none: form vira [] e raw passa adiante (undefined)", () => {
    const b = bodyParaRequestBody("none", undefined, undefined);
    expect(b).toEqual({ mode: "none", raw: undefined, form: [] });
  });

  it("preserva o mode literal (json)", () => {
    expect(bodyParaRequestBody("json", "{}", undefined).mode).toBe("json");
  });

  it("preserva o mode literal (form_urlencoded)", () => {
    expect(bodyParaRequestBody("form_urlencoded", undefined, []).mode).toBe(
      "form_urlencoded",
    );
  });

  it("passa o raw cru sem alterar (json)", () => {
    expect(bodyParaRequestBody("json", '{"a":1}', undefined).raw).toBe('{"a":1}');
  });

  it("raw vazio continua sendo string vazia (nao vira undefined)", () => {
    const b = bodyParaRequestBody("text", "", undefined);
    expect(b.raw).toBe("");
  });

  it("form ausente (undefined) vira array vazio, nao undefined", () => {
    const b = bodyParaRequestBody("form_urlencoded", undefined, undefined);
    expect(Array.isArray(b.form)).toBe(true);
    expect(b.form).toEqual([]);
  });

  it("mapeia cada par do form via paraKeyVal (descarta description)", () => {
    const b = bodyParaRequestBody("form_urlencoded", undefined, [
      kv("a", "1", true, "desc"),
      kv("b", "2", false),
    ]);
    expect(b.form).toEqual([
      { name: "a", value: "1", enabled: true },
      { name: "b", value: "2", enabled: false },
    ]);
  });

  it("preserva ordem dos pares do form", () => {
    const b = bodyParaRequestBody("form_urlencoded", undefined, [
      kv("primeiro", "1"),
      kv("segundo", "2"),
      kv("terceiro", "3"),
    ]);
    expect(b.form.map((f) => f.name)).toEqual([
      "primeiro",
      "segundo",
      "terceiro",
    ]);
  });

  it("mantem chaves repetidas no form (nao deduplica)", () => {
    const b = bodyParaRequestBody("form_urlencoded", undefined, [
      kv("k", "1"),
      kv("k", "2"),
    ]);
    expect(b.form).toHaveLength(2);
    expect(b.form.map((f) => f.value)).toEqual(["1", "2"]);
  });

  it("mode arbitrario (graphql) e preservado", () => {
    expect(bodyParaRequestBody("graphql" as BodyMode, "q", undefined).mode).toBe(
      "graphql",
    );
  });
});

describe("requestDataDeItem", () => {
  function item(over: Partial<RequestItem> = {}): RequestItem {
    return { ...novaRequest("r"), ...over };
  }

  it("projeta uma request GET vazia padrao", () => {
    const r = requestDataDeItem(item());
    expect(r).toEqual({
      method: "GET",
      url: "",
      headers: [],
      params: [],
      body: { mode: "none", raw: undefined, form: [] },
    });
  });

  it("nao inclui timeoutMs (fica para o default do Rust)", () => {
    const r = requestDataDeItem(item());
    expect(r).not.toHaveProperty("timeoutMs");
  });

  it("method vazio vira GET", () => {
    expect(requestDataDeItem(item({ method: "" })).method).toBe("GET");
  });

  it("preserva method nao-vazio sem uppercase (POST)", () => {
    expect(requestDataDeItem(item({ method: "POST" })).method).toBe("POST");
  });

  it("preserva method minusculo como veio (delega normalizacao ao Rust)", () => {
    expect(requestDataDeItem(item({ method: "post" })).method).toBe("post");
  });

  it("copia a url literalmente", () => {
    const r = requestDataDeItem(item({ url: "https://x.test/a?b=1" }));
    expect(r.url).toBe("https://x.test/a?b=1");
  });

  it("mapeia headers e params (mantendo enabled=false)", () => {
    const r = requestDataDeItem(
      item({
        headers: [kv("H", "v", true, "d"), kv("H2", "v2", false)],
        params: [kv("p", "1", false)],
      }),
    );
    expect(r.headers).toEqual([
      { name: "H", value: "v", enabled: true },
      { name: "H2", value: "v2", enabled: false },
    ]);
    expect(r.params).toEqual([{ name: "p", value: "1", enabled: false }]);
  });

  it("preserva ordem de headers", () => {
    const r = requestDataDeItem(
      item({ headers: [kv("a", "1"), kv("b", "2"), kv("c", "3")] }),
    );
    expect(r.headers.map((h) => h.name)).toEqual(["a", "b", "c"]);
  });

  it("mapeia body json com raw", () => {
    const r = requestDataDeItem(
      item({ body: { mode: "json", raw: '{"k":1}' } }),
    );
    expect(r.body).toEqual({ mode: "json", raw: '{"k":1}', form: [] });
  });

  it("mapeia body form_urlencoded com pares", () => {
    const r = requestDataDeItem(
      item({ body: { mode: "form_urlencoded", form: [kv("a", "1")] } }),
    );
    expect(r.body.mode).toBe("form_urlencoded");
    expect(r.body.form).toEqual([{ name: "a", value: "1", enabled: true }]);
  });

  it("nao muta o RequestItem de origem (headers e copia rasa nova)", () => {
    const it0 = item({ headers: [kv("a", "1")] });
    const r = requestDataDeItem(it0);
    expect(r.headers).not.toBe(it0.headers);
  });
});

describe("isHttpError", () => {
  it("true para objeto {kind, message:string}", () => {
    const e: HttpError = { kind: "timeout", message: "x" };
    expect(isHttpError(e)).toBe(true);
  });

  it("true mesmo com kind desconhecido desde que tenha message string", () => {
    expect(isHttpError({ kind: "qualquer", message: "m" })).toBe(true);
  });

  it("false quando message nao e string", () => {
    expect(isHttpError({ kind: "timeout", message: 123 })).toBe(false);
  });

  it("false quando falta kind", () => {
    expect(isHttpError({ message: "m" })).toBe(false);
  });

  it("false quando falta message", () => {
    expect(isHttpError({ kind: "timeout" })).toBe(false);
  });

  it("false para null", () => {
    expect(isHttpError(null)).toBe(false);
  });

  it("false para undefined", () => {
    expect(isHttpError(undefined)).toBe(false);
  });

  it("false para string", () => {
    expect(isHttpError("timeout")).toBe(false);
  });

  it("false para number", () => {
    expect(isHttpError(42)).toBe(false);
  });

  it("false para Error puro (sem kind)", () => {
    expect(isHttpError(new Error("boom"))).toBe(false);
  });

  it("false para array", () => {
    expect(isHttpError(["kind", "message"])).toBe(false);
  });
});

describe("mensagemDeErro", () => {
  it("extrai message de um HttpError", () => {
    const e: HttpError = { kind: "invalidUrl", message: "URL vazia" };
    expect(mensagemDeErro(e)).toBe("URL vazia");
  });

  it("HttpError tem prioridade sobre o ramo string", () => {
    // objeto valido -> usa message, nao o String(e)
    expect(mensagemDeErro({ kind: "x", message: "msg" })).toBe("msg");
  });

  it("retorna a propria string quando o erro e string", () => {
    expect(mensagemDeErro("erro cru")).toBe("erro cru");
  });

  it("extrai message de Error nativo (sem kind)", () => {
    expect(mensagemDeErro(new Error("falhou"))).toBe("falhou");
  });

  it("subclasse de Error tambem usa .message", () => {
    class MeuErro extends Error {}
    expect(mensagemDeErro(new MeuErro("custom"))).toBe("custom");
  });

  it("fallback para String() em objeto sem forma de erro", () => {
    expect(mensagemDeErro({ foo: 1 })).toBe("[object Object]");
  });

  it("fallback para String() em number", () => {
    expect(mensagemDeErro(404)).toBe("404");
  });

  it("fallback para String() em null", () => {
    expect(mensagemDeErro(null)).toBe("null");
  });

  it("fallback para String() em undefined", () => {
    expect(mensagemDeErro(undefined)).toBe("undefined");
  });

  it("string vazia continua string vazia (nao cai no fallback)", () => {
    expect(mensagemDeErro("")).toBe("");
  });
});
