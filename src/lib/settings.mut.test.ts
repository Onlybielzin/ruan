// F20 — Settings: testes SUPLEMENTARES para matar mutantes que sobrevivem.
// Foco: shape EXATO do EffectiveSettings, precedencia campo-a-campo, e o
// fallback do clamp em maxRedirects (MAX, nao MIN) para nao-finito.
// LOGICA PURA (settings.ts e o alvo).

import { describe, it, expect } from "vitest";
import {
  type AppSettings,
  APP_SETTINGS_PADRAO,
  MAX_REDIRECTS_MAX,
  TIMEOUT_MAX_MS,
  TIMEOUT_MIN_MS,
  clamp,
  efetivas,
  normalizarAppSettings,
} from "./settings";

const app = (over: Partial<AppSettings> = {}): AppSettings => ({
  ...APP_SETTINGS_PADRAO,
  ...over,
});

describe("efetivas — shape exato do resultado", () => {
  it("sem proxy e sem maxRedirects: chaves opcionais AUSENTES (nao undefined explicito)", () => {
    const e = efetivas(app({ proxy: "" }), {});
    expect(e).toEqual({
      sslVerify: true,
      timeoutMs: 30_000,
      followRedirects: true,
      encodeUrl: true,
    });
    expect("proxy" in e).toBe(false);
    expect("maxRedirects" in e).toBe(false);
  });

  it("com proxy e maxRedirects: shape completo", () => {
    const e = efetivas(app({ proxy: "http://p:9", sslVerify: false }), {
      followRedirects: true,
      maxRedirects: 7,
      encodeUrl: false,
      timeoutMs: 500,
    });
    expect(e).toEqual({
      proxy: "http://p:9",
      sslVerify: false,
      timeoutMs: 500,
      followRedirects: true,
      maxRedirects: 7,
      encodeUrl: false,
    });
  });
});

describe("efetivas — sslVerify e timeout vem do APP, redirects/encode do per-request", () => {
  it("sslVerify ignora qualquer coisa no per-request (so app o define)", () => {
    // RequestSettings nem tem ssl; garante que o valor vem de app.sslVerify.
    expect(efetivas(app({ sslVerify: false })).sslVerify).toBe(false);
    expect(efetivas(app({ sslVerify: true })).sslVerify).toBe(true);
  });
  it("proxy so vem do app, nunca do per-request", () => {
    // per-request nao tem proxy; mesmo passando 'proxy' espurio, fica do app.
    const e = efetivas(app({ proxy: "http://app:1" }), {
      // @ts-expect-error campo inexistente em RequestSettings de proposito
      proxy: "http://evil:2",
    });
    expect(e.proxy).toBe("http://app:1");
  });
});

describe("efetivas — maxRedirects: fallback do clamp e MAX", () => {
  it("maxRedirects nao-finito (NaN) cai no fallback MAX_REDIRECTS_MAX", () => {
    const e = efetivas(app(), {
      followRedirects: true,
      maxRedirects: NaN,
    });
    expect(e.maxRedirects).toBe(MAX_REDIRECTS_MAX);
  });
  it("maxRedirects acima do MAX e clampado para MAX", () => {
    const e = efetivas(app(), {
      followRedirects: true,
      maxRedirects: 9999,
    });
    expect(e.maxRedirects).toBe(MAX_REDIRECTS_MAX);
  });
});

describe("efetivas — timeout clamp para o intervalo certo", () => {
  it("timeout per-request abaixo do MIN vai pro MIN (0)", () => {
    expect(efetivas(app(), { timeoutMs: -100 }).timeoutMs).toBe(TIMEOUT_MIN_MS);
  });
  it("timeout NaN per-request cai no fallback do default", () => {
    expect(efetivas(app({ timeoutMs: 12345 }), { timeoutMs: NaN }).timeoutMs).toBe(
      APP_SETTINGS_PADRAO.timeoutMs,
    );
  });
});

describe("clamp — fallback so para nao-finito, nunca para finito valido", () => {
  it("valor finito no meio retorna ele mesmo (nao min, max nem fallback)", () => {
    expect(clamp(42, 0, 100, 7)).toBe(42);
  });
  it("min e max sao bordas inclusivas, nao fallback", () => {
    expect(clamp(0, 0, 100, 7)).toBe(0);
    expect(clamp(100, 0, 100, 7)).toBe(100);
  });
});

describe("normalizarAppSettings — proxy preservado literal e timeout MAX", () => {
  it("proxy com espacos NAO e trimado na normalizacao (so na efetivas)", () => {
    expect(normalizarAppSettings({ proxy: "  http://p " }).proxy).toBe("  http://p ");
  });
  it("timeout exatamente no MAX e mantido (borda inclusiva)", () => {
    expect(normalizarAppSettings({ timeoutMs: TIMEOUT_MAX_MS }).timeoutMs).toBe(
      TIMEOUT_MAX_MS,
    );
  });
});
