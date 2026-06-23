// Testes da logica pura do historico de execucoes (F16).
// Alvo de mutation: src/lib/historico.ts

import { describe, it, expect } from "vitest";
import {
  LIMITE_HISTORICO,
  montarEntry,
  montarEntryErro,
  adicionarEntry,
  limitar,
  serializarHistorico,
  parsearHistorico,
  normalizarEntry,
  type HistoricoEntry,
} from "./historico";
import type { RequestItem } from "./types";
import type { ResponseData } from "./http-types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function req(over: Partial<RequestItem> = {}): RequestItem {
  return {
    name: "r",
    seq: 0,
    method: "GET",
    url: "http://x",
    headers: [],
    params: [],
    body: { mode: "none" },
    auth: { mode: "none" },
    scripts: { pre: "", post: "" },
    tests: "",
    docs: "",
    ...over,
  };
}

function res(over: Partial<ResponseData> = {}): ResponseData {
  return {
    status: 200,
    statusText: "OK",
    headers: [],
    body: "",
    bodyTruncatedLossy: false,
    timeMs: 12,
    sizeBytes: 34,
    ...over,
  };
}

function entry(over: Partial<HistoricoEntry> = {}): HistoricoEntry {
  return {
    id: "id",
    method: "GET",
    url: "http://x",
    status: 200,
    timeMs: 1,
    sizeBytes: 2,
    timestampMs: 1000,
    requestSnapshot: req(),
    ...over,
  };
}

// ---------------------------------------------------------------------------
// LIMITE_HISTORICO
// ---------------------------------------------------------------------------

describe("LIMITE_HISTORICO", () => {
  it("vale 200", () => {
    expect(LIMITE_HISTORICO).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// montarEntry
// ---------------------------------------------------------------------------

describe("montarEntry", () => {
  it("copia id, timestamp, method, url e os campos da resposta", () => {
    const r = req({ method: "POST", url: "http://api/u" });
    const resp = res({ status: 201, timeMs: 99, sizeBytes: 512 });
    const e = montarEntry("abc", 5000, r, resp);
    expect(e).toEqual({
      id: "abc",
      method: "POST",
      url: "http://api/u",
      status: 201,
      timeMs: 99,
      sizeBytes: 512,
      timestampMs: 5000,
      requestSnapshot: r,
    });
  });

  it("usa a mesma referencia da request como requestSnapshot", () => {
    const r = req();
    const e = montarEntry("id", 1, r, res());
    expect(e.requestSnapshot).toBe(r);
  });

  it("method vazio cai para GET", () => {
    const e = montarEntry("id", 1, req({ method: "" }), res());
    expect(e.method).toBe("GET");
  });

  it("preserva method nao-vazio (nao forca GET)", () => {
    const e = montarEntry("id", 1, req({ method: "DELETE" }), res());
    expect(e.method).toBe("DELETE");
  });

  it("status 0 da resposta e preservado (nao vira null)", () => {
    const e = montarEntry("id", 1, req(), res({ status: 0 }));
    expect(e.status).toBe(0);
  });

  it("timeMs e sizeBytes 0 sao preservados", () => {
    const e = montarEntry("id", 1, req(), res({ timeMs: 0, sizeBytes: 0 }));
    expect(e.timeMs).toBe(0);
    expect(e.sizeBytes).toBe(0);
  });

  it("preserva a url exatamente (inclusive vazia)", () => {
    const e = montarEntry("id", 1, req({ url: "" }), res());
    expect(e.url).toBe("");
  });
});

// ---------------------------------------------------------------------------
// montarEntryErro
// ---------------------------------------------------------------------------

describe("montarEntryErro", () => {
  it("zera status/timeMs/sizeBytes para null e mantem id/ts/method/url", () => {
    const r = req({ method: "PUT", url: "http://api/e" });
    const e = montarEntryErro("err1", 7000, r);
    expect(e).toEqual({
      id: "err1",
      method: "PUT",
      url: "http://api/e",
      status: null,
      timeMs: null,
      sizeBytes: null,
      timestampMs: 7000,
      requestSnapshot: r,
    });
  });

  it("method vazio cai para GET", () => {
    const e = montarEntryErro("id", 1, req({ method: "" }));
    expect(e.method).toBe("GET");
  });

  it("preserva method nao-vazio", () => {
    const e = montarEntryErro("id", 1, req({ method: "PATCH" }));
    expect(e.method).toBe("PATCH");
  });

  it("guarda a mesma referencia da request", () => {
    const r = req();
    expect(montarEntryErro("id", 1, r).requestSnapshot).toBe(r);
  });
});

// ---------------------------------------------------------------------------
// adicionarEntry
// ---------------------------------------------------------------------------

describe("adicionarEntry", () => {
  it("acrescenta a nova entrada NO TOPO (mais recente primeiro)", () => {
    const a = entry({ id: "a" });
    const b = entry({ id: "b" });
    const novo = adicionarEntry([a], b);
    expect(novo.map((e) => e.id)).toEqual(["b", "a"]);
  });

  it("nao muta a lista original", () => {
    const a = entry({ id: "a" });
    const lista = [a];
    const novo = adicionarEntry(lista, entry({ id: "b" }));
    expect(lista).toEqual([a]);
    expect(lista.length).toBe(1);
    expect(novo).not.toBe(lista);
  });

  it("corta para o limite mantendo as mais recentes (topo)", () => {
    const base = [entry({ id: "x" }), entry({ id: "y" })];
    const novo = adicionarEntry(base, entry({ id: "novo" }), 2);
    expect(novo.map((e) => e.id)).toEqual(["novo", "x"]);
    expect(novo.length).toBe(2);
  });

  it("usa LIMITE_HISTORICO por default", () => {
    const lista: HistoricoEntry[] = Array.from({ length: 200 }, (_, i) =>
      entry({ id: `e${i}` }),
    );
    const novo = adicionarEntry(lista, entry({ id: "novo" }));
    expect(novo.length).toBe(200);
    expect(novo[0].id).toBe("novo");
    // a mais antiga (e199) foi descartada
    expect(novo.some((e) => e.id === "e199")).toBe(false);
  });

  it("lista vazia + entry -> lista com 1", () => {
    const novo = adicionarEntry([], entry({ id: "so" }));
    expect(novo.map((e) => e.id)).toEqual(["so"]);
  });
});

// ---------------------------------------------------------------------------
// limitar
// ---------------------------------------------------------------------------

describe("limitar", () => {
  it("limite <= 0 retorna lista vazia", () => {
    expect(limitar([entry()], 0)).toEqual([]);
    expect(limitar([entry()], -5)).toEqual([]);
  });

  it("mantem todas quando length < limite (e devolve copia)", () => {
    const lista = [entry({ id: "a" }), entry({ id: "b" })];
    const out = limitar(lista, 5);
    expect(out.map((e) => e.id)).toEqual(["a", "b"]);
    expect(out).not.toBe(lista);
  });

  it("length exatamente == limite nao corta (devolve copia)", () => {
    const lista = [entry({ id: "a" }), entry({ id: "b" })];
    const out = limitar(lista, 2);
    expect(out.map((e) => e.id)).toEqual(["a", "b"]);
    expect(out).not.toBe(lista);
    expect(out.length).toBe(2);
  });

  it("corta para o limite mantendo o prefixo (mais recentes)", () => {
    const lista = ["a", "b", "c", "d", "e"].map((id) => entry({ id }));
    const out = limitar(lista, 3);
    expect(out.map((e) => e.id)).toEqual(["a", "b", "c"]);
  });

  it("default LIMITE_HISTORICO corta em 200", () => {
    const lista = Array.from({ length: 250 }, (_, i) => entry({ id: `e${i}` }));
    const out = limitar(lista);
    expect(out.length).toBe(200);
    expect(out[0].id).toBe("e0");
    expect(out[199].id).toBe("e199");
  });

  it("lista vazia continua vazia", () => {
    expect(limitar([], 10)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// serializarHistorico
// ---------------------------------------------------------------------------

describe("serializarHistorico", () => {
  it("produz JSON que round-trippa de volta para as entradas", () => {
    const lista = [entry({ id: "a" }), entry({ id: "b" })];
    const json = serializarHistorico(lista);
    expect(JSON.parse(json)).toEqual(lista);
  });

  it("lista vazia vira '[]'", () => {
    expect(serializarHistorico([])).toBe("[]");
  });

  it("o resultado e uma string", () => {
    expect(typeof serializarHistorico([entry()])).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// parsearHistorico
// ---------------------------------------------------------------------------

describe("parsearHistorico", () => {
  it("null/undefined -> []", () => {
    expect(parsearHistorico(null)).toEqual([]);
    expect(parsearHistorico(undefined)).toEqual([]);
  });

  it("string vazia ou so espacos -> []", () => {
    expect(parsearHistorico("")).toEqual([]);
    expect(parsearHistorico("   ")).toEqual([]);
    expect(parsearHistorico("\n\t ")).toEqual([]);
  });

  it("nao-string (numero) -> []", () => {
    // @ts-expect-error testando entrada fora do contrato
    expect(parsearHistorico(123)).toEqual([]);
  });

  it("JSON invalido -> []", () => {
    expect(parsearHistorico("{nao json")).toEqual([]);
    expect(parsearHistorico("[1,2,")).toEqual([]);
  });

  it("raiz que nao e array -> []", () => {
    expect(parsearHistorico("null")).toEqual([]);
    expect(parsearHistorico("42")).toEqual([]);
    expect(parsearHistorico('{"id":"a"}')).toEqual([]);
    expect(parsearHistorico('"texto"')).toEqual([]);
  });

  it("array vazio -> []", () => {
    expect(parsearHistorico("[]")).toEqual([]);
  });

  it("descarta entradas malformadas e mantem as validas, na ordem", () => {
    const e1 = entry({ id: "a", timestampMs: 100 });
    const e2 = entry({ id: "b", timestampMs: 200 });
    const json = JSON.stringify([e1, { lixo: true }, null, 7, e2]);
    const out = parsearHistorico(json);
    expect(out.map((e) => e.id)).toEqual(["a", "b"]);
  });

  it("aplica o limite (mantendo o prefixo)", () => {
    const arr = ["a", "b", "c", "d"].map((id) =>
      entry({ id, timestampMs: 1 }),
    );
    const out = parsearHistorico(JSON.stringify(arr), 2);
    expect(out.map((e) => e.id)).toEqual(["a", "b"]);
  });

  it("usa LIMITE_HISTORICO por default", () => {
    const arr = Array.from({ length: 250 }, (_, i) =>
      entry({ id: `e${i}`, timestampMs: i }),
    );
    const out = parsearHistorico(JSON.stringify(arr));
    expect(out.length).toBe(200);
    expect(out[0].id).toBe("e0");
  });

  it("round-trip: serializar depois parsear devolve as mesmas entradas", () => {
    const lista = [entry({ id: "a" }), entry({ id: "b" })];
    const out = parsearHistorico(serializarHistorico(lista));
    expect(out).toEqual(lista);
  });

  it("NUNCA lanca, mesmo com lixo agressivo", () => {
    expect(() => parsearHistorico(" ")).not.toThrow();
    expect(() => parsearHistorico("[{}]")).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// normalizarEntry
// ---------------------------------------------------------------------------

describe("normalizarEntry", () => {
  it("entrada valida completa passa intacta", () => {
    const bruto = {
      id: "a",
      method: "POST",
      url: "http://x",
      status: 200,
      timeMs: 10,
      sizeBytes: 20,
      timestampMs: 1234,
      requestSnapshot: req({ method: "POST" }),
    };
    const e = normalizarEntry(bruto);
    expect(e).not.toBeNull();
    expect(e!.id).toBe("a");
    expect(e!.method).toBe("POST");
    expect(e!.url).toBe("http://x");
    expect(e!.status).toBe(200);
    expect(e!.timeMs).toBe(10);
    expect(e!.sizeBytes).toBe(20);
    expect(e!.timestampMs).toBe(1234);
  });

  it("nao-objeto -> null", () => {
    expect(normalizarEntry(null)).toBeNull();
    expect(normalizarEntry(undefined)).toBeNull();
    expect(normalizarEntry("x")).toBeNull();
    expect(normalizarEntry(42)).toBeNull();
    expect(normalizarEntry(true)).toBeNull();
  });

  it("id ausente, nao-string ou vazio -> null", () => {
    expect(normalizarEntry({ method: "GET", url: "u", timestampMs: 1 })).toBeNull();
    expect(
      normalizarEntry({ id: 5, method: "GET", url: "u", timestampMs: 1 }),
    ).toBeNull();
    expect(
      normalizarEntry({ id: "", method: "GET", url: "u", timestampMs: 1 }),
    ).toBeNull();
  });

  it("method nao-string -> null", () => {
    expect(
      normalizarEntry({ id: "a", method: 1, url: "u", timestampMs: 1 }),
    ).toBeNull();
    expect(
      normalizarEntry({ id: "a", url: "u", timestampMs: 1 }),
    ).toBeNull();
  });

  it("method vazio (string) e ACEITO (so precisa ser string)", () => {
    const e = normalizarEntry({ id: "a", method: "", url: "u", timestampMs: 1 });
    expect(e).not.toBeNull();
    expect(e!.method).toBe("");
  });

  it("url nao-string -> null", () => {
    expect(
      normalizarEntry({ id: "a", method: "GET", url: 9, timestampMs: 1 }),
    ).toBeNull();
    expect(
      normalizarEntry({ id: "a", method: "GET", timestampMs: 1 }),
    ).toBeNull();
  });

  it("timestampMs ausente, nao-numero ou nao-finito -> null", () => {
    expect(normalizarEntry({ id: "a", method: "GET", url: "u" })).toBeNull();
    expect(
      normalizarEntry({ id: "a", method: "GET", url: "u", timestampMs: "1" }),
    ).toBeNull();
    expect(
      normalizarEntry({ id: "a", method: "GET", url: "u", timestampMs: NaN }),
    ).toBeNull();
    expect(
      normalizarEntry({
        id: "a",
        method: "GET",
        url: "u",
        timestampMs: Infinity,
      }),
    ).toBeNull();
  });

  it("timestampMs == 0 e ACEITO (finito)", () => {
    const e = normalizarEntry({ id: "a", method: "GET", url: "u", timestampMs: 0 });
    expect(e).not.toBeNull();
    expect(e!.timestampMs).toBe(0);
  });

  it("campos numericos ausentes/invalidos viram null", () => {
    const e = normalizarEntry({
      id: "a",
      method: "GET",
      url: "u",
      timestampMs: 1,
    });
    expect(e!.status).toBeNull();
    expect(e!.timeMs).toBeNull();
    expect(e!.sizeBytes).toBeNull();
  });

  it("status/timeMs/sizeBytes nao-finitos viram null", () => {
    const e = normalizarEntry({
      id: "a",
      method: "GET",
      url: "u",
      timestampMs: 1,
      status: NaN,
      timeMs: Infinity,
      sizeBytes: "20",
    });
    expect(e!.status).toBeNull();
    expect(e!.timeMs).toBeNull();
    expect(e!.sizeBytes).toBeNull();
  });

  it("status/timeMs/sizeBytes == 0 sao preservados (nao viram null)", () => {
    const e = normalizarEntry({
      id: "a",
      method: "GET",
      url: "u",
      timestampMs: 1,
      status: 0,
      timeMs: 0,
      sizeBytes: 0,
    });
    expect(e!.status).toBe(0);
    expect(e!.timeMs).toBe(0);
    expect(e!.sizeBytes).toBe(0);
  });

  it("requestSnapshot objeto e mantido (mesma referencia)", () => {
    const snap = req({ method: "PUT", url: "http://snap" });
    const e = normalizarEntry({
      id: "a",
      method: "GET",
      url: "u",
      timestampMs: 1,
      requestSnapshot: snap,
    });
    expect(e!.requestSnapshot).toBe(snap);
  });

  it("requestSnapshot ausente vira snapshot minimo a partir de method/url", () => {
    const e = normalizarEntry({
      id: "a",
      method: "DELETE",
      url: "http://min",
      timestampMs: 1,
    });
    const snap = e!.requestSnapshot;
    expect(snap.method).toBe("DELETE");
    expect(snap.url).toBe("http://min");
    expect(snap.name).toBe("");
    expect(snap.seq).toBe(0);
    expect(snap.headers).toEqual([]);
    expect(snap.params).toEqual([]);
    expect(snap.body).toEqual({ mode: "none" });
    expect(snap.auth).toEqual({ mode: "none" });
    expect(snap.scripts).toEqual({ pre: "", post: "" });
    expect(snap.tests).toBe("");
    expect(snap.docs).toBe("");
  });

  it("snapshot minimo: method vazio cai para GET na request gerada", () => {
    const e = normalizarEntry({
      id: "a",
      method: "",
      url: "http://min",
      timestampMs: 1,
    });
    expect(e!.method).toBe(""); // entry guarda o original
    expect(e!.requestSnapshot.method).toBe("GET"); // mas o snapshot cai pra GET
  });

  it("requestSnapshot nao-objeto (string/numero/null) vira snapshot minimo", () => {
    for (const ruim of ["x", 5, null, true]) {
      const e = normalizarEntry({
        id: "a",
        method: "GET",
        url: "http://min",
        timestampMs: 1,
        requestSnapshot: ruim,
      });
      expect(e!.requestSnapshot.url).toBe("http://min");
      expect(e!.requestSnapshot.body).toEqual({ mode: "none" });
    }
  });
});
