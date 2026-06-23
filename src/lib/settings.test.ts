import { describe, it, expect } from "vitest";
import {
  type AppSettings,
  type RequestSettings,
  APP_SETTINGS_PADRAO,
  ENCODE_URL_PADRAO,
  FOLLOW_REDIRECTS_PADRAO,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  MAX_REDIRECTS_MAX,
  TIMEOUT_MAX_MS,
  clamp,
  efetivas,
  normalizarAppSettings,
  proxyUtilizavel,
} from "./settings";

const app = (over: Partial<AppSettings> = {}): AppSettings => ({
  ...APP_SETTINGS_PADRAO,
  ...over,
});

describe("clamp", () => {
  it("retorna o valor dentro do intervalo", () => {
    expect(clamp(5, 0, 10, 99)).toBe(5);
  });
  it("limita ao minimo", () => {
    expect(clamp(-3, 0, 10, 99)).toBe(0);
  });
  it("limita ao maximo", () => {
    expect(clamp(50, 0, 10, 99)).toBe(10);
  });
  it("respeita as bordas inclusivas", () => {
    expect(clamp(0, 0, 10, 99)).toBe(0);
    expect(clamp(10, 0, 10, 99)).toBe(10);
  });
  it("nao-finito vira fallback", () => {
    expect(clamp(NaN, 0, 10, 99)).toBe(99);
    expect(clamp(Infinity, 0, 10, 99)).toBe(99);
    expect(clamp(-Infinity, 0, 10, 99)).toBe(99);
  });
  it("logo abaixo/acima das bordas (estrito < e >)", () => {
    expect(clamp(-1, 0, 10, 99)).toBe(0); // n < min
    expect(clamp(11, 0, 10, 99)).toBe(10); // n > max
    expect(clamp(1, 0, 10, 99)).toBe(1); // dentro, sem tocar borda
    expect(clamp(9, 0, 10, 99)).toBe(9);
  });
  it("borda exata nao e fallback (fallback so para nao-finito)", () => {
    // Garante que o fallback nao e usado em valores finitos validos.
    expect(clamp(0, 0, 10, 99)).not.toBe(99);
    expect(clamp(10, 0, 10, 99)).not.toBe(99);
  });
});

describe("proxyUtilizavel", () => {
  it("vazio/undefined => false", () => {
    expect(proxyUtilizavel(undefined)).toBe(false);
    expect(proxyUtilizavel("")).toBe(false);
    expect(proxyUtilizavel("   ")).toBe(false);
  });
  it("nao-vazio => true", () => {
    expect(proxyUtilizavel("http://p:1")).toBe(true);
    expect(proxyUtilizavel("  http://p:1 ")).toBe(true);
  });
});

describe("normalizarAppSettings", () => {
  it("null/undefined => defaults", () => {
    expect(normalizarAppSettings(null)).toEqual(APP_SETTINGS_PADRAO);
    expect(normalizarAppSettings(undefined)).toEqual(APP_SETTINGS_PADRAO);
  });
  it("preenche campos ausentes com default", () => {
    expect(normalizarAppSettings({ theme: "light" })).toEqual({
      ...APP_SETTINGS_PADRAO,
      theme: "light",
    });
  });
  it("theme invalido cai em dark", () => {
    expect(normalizarAppSettings({ theme: "xpto" as never }).theme).toBe("dark");
  });
  it("theme light preservado", () => {
    expect(normalizarAppSettings({ theme: "light" }).theme).toBe("light");
  });
  it("sslVerify nao-boolean cai no default", () => {
    expect(normalizarAppSettings({ sslVerify: "sim" as never }).sslVerify).toBe(
      APP_SETTINGS_PADRAO.sslVerify,
    );
  });
  it("sslVerify false preservado", () => {
    expect(normalizarAppSettings({ sslVerify: false }).sslVerify).toBe(false);
  });
  it("timeout fora do limite e clampado", () => {
    expect(normalizarAppSettings({ timeoutMs: -10 }).timeoutMs).toBe(0);
    expect(normalizarAppSettings({ timeoutMs: TIMEOUT_MAX_MS + 1 }).timeoutMs).toBe(
      TIMEOUT_MAX_MS,
    );
  });
  it("timeout nao-numero cai no default", () => {
    expect(normalizarAppSettings({ timeoutMs: "x" as never }).timeoutMs).toBe(
      APP_SETTINGS_PADRAO.timeoutMs,
    );
  });
  it("fontSize clampado nas bordas", () => {
    expect(normalizarAppSettings({ fontSize: 2 }).fontSize).toBe(FONT_SIZE_MIN);
    expect(normalizarAppSettings({ fontSize: 999 }).fontSize).toBe(FONT_SIZE_MAX);
  });
  it("proxy nao-string cai no default", () => {
    expect(normalizarAppSettings({ proxy: 123 as never }).proxy).toBe(
      APP_SETTINGS_PADRAO.proxy,
    );
  });
  it("proxy string preservado (mesmo com espacos)", () => {
    expect(normalizarAppSettings({ proxy: "  http://p:1 " }).proxy).toBe(
      "  http://p:1 ",
    );
  });
});

describe("efetivas", () => {
  it("sem per-request usa defaults da feature p/ follow e encode", () => {
    const e = efetivas(app());
    expect(e.followRedirects).toBe(FOLLOW_REDIRECTS_PADRAO);
    expect(e.encodeUrl).toBe(ENCODE_URL_PADRAO);
  });
  it("timeout do global quando per-request nao define", () => {
    expect(efetivas(app({ timeoutMs: 1234 })).timeoutMs).toBe(1234);
  });
  it("timeout per-request sobrescreve o global", () => {
    expect(efetivas(app({ timeoutMs: 1234 }), { timeoutMs: 99 }).timeoutMs).toBe(99);
  });
  it("timeout per-request = 0 sobrescreve (nao cai no global)", () => {
    expect(efetivas(app({ timeoutMs: 1234 }), { timeoutMs: 0 }).timeoutMs).toBe(0);
  });
  it("timeout per-request fora do limite e clampado", () => {
    expect(efetivas(app(), { timeoutMs: TIMEOUT_MAX_MS + 5 }).timeoutMs).toBe(
      TIMEOUT_MAX_MS,
    );
  });
  it("sslVerify vem do global", () => {
    expect(efetivas(app({ sslVerify: false })).sslVerify).toBe(false);
    expect(efetivas(app({ sslVerify: true })).sslVerify).toBe(true);
  });
  it("proxy ausente quando global vazio", () => {
    expect(efetivas(app({ proxy: "" })).proxy).toBeUndefined();
    expect(efetivas(app({ proxy: "   " })).proxy).toBeUndefined();
  });
  it("proxy presente e trimado quando global tem valor", () => {
    expect(efetivas(app({ proxy: "  http://p:1 " })).proxy).toBe("http://p:1");
  });
  it("followRedirects per-request sobrescreve o default", () => {
    expect(efetivas(app(), { followRedirects: false }).followRedirects).toBe(false);
  });
  it("encodeUrl per-request sobrescreve o default", () => {
    expect(efetivas(app(), { encodeUrl: false }).encodeUrl).toBe(false);
  });
  it("maxRedirects so aparece quando followRedirects=true", () => {
    const semFollow: RequestSettings = {
      followRedirects: false,
      maxRedirects: 5,
    };
    expect(efetivas(app(), semFollow).maxRedirects).toBeUndefined();
  });
  it("maxRedirects aparece e e clampado com follow=true", () => {
    const e = efetivas(app(), {
      followRedirects: true,
      maxRedirects: MAX_REDIRECTS_MAX + 10,
    });
    expect(e.maxRedirects).toBe(MAX_REDIRECTS_MAX);
  });
  it("maxRedirects nao aparece se follow herdar default true mas o campo ausente", () => {
    // follow default = true, mas sem maxRedirects definido => campo ausente
    expect(efetivas(app(), {}).maxRedirects).toBeUndefined();
  });
  it("maxRedirects aparece quando follow herda default true e max definido", () => {
    expect(efetivas(app(), { maxRedirects: 4 }).maxRedirects).toBe(4);
  });
  it("maxRedirects negativo e clampado para o minimo (0)", () => {
    expect(
      efetivas(app(), { followRedirects: true, maxRedirects: -5 }).maxRedirects,
    ).toBe(0);
  });
  it("maxRedirects = 0 e preservado (limite explicito de zero redirects)", () => {
    expect(
      efetivas(app(), { followRedirects: true, maxRedirects: 0 }).maxRedirects,
    ).toBe(0);
  });
  it("proxy do global e trimado para o valor exato (sem espacos)", () => {
    expect(efetivas(app({ proxy: "  http://p:8080  " })).proxy).toBe(
      "http://p:8080",
    );
  });
  it("timeout: usa o global EXATO quando per-request ausente (nao o default da feature)", () => {
    // app.timeoutMs=7777; se o codigo trocasse por APP_SETTINGS_PADRAO, falharia.
    expect(efetivas(app({ timeoutMs: 7777 })).timeoutMs).toBe(7777);
  });
  it("encodeUrl/followRedirects refletem os defaults nominais", () => {
    const e = efetivas(app());
    expect(e.encodeUrl).toBe(true);
    expect(e.followRedirects).toBe(true);
  });
  it("perRequest undefined e {} sao equivalentes", () => {
    expect(efetivas(app())).toEqual(efetivas(app(), {}));
  });
});
