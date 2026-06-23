// Testes de ENDURECIMENTO (mutation-killing) da logica PURA de src/lib/settings.ts
// (F20). Focam em clamp (fronteiras min/max/fallback/NaN), normalizarAppSettings
// (tipos errados -> defaults, SSL opt-in), proxyUtilizavel e efetivas (override
// per-request, defaults de feature, maxRedirects so com followRedirects).
import { describe, it, expect } from "vitest";
import {
  clamp,
  normalizarAppSettings,
  proxyUtilizavel,
  efetivas,
  APP_SETTINGS_PADRAO,
  TIMEOUT_MIN_MS,
  TIMEOUT_MAX_MS,
  MAX_REDIRECTS_MAX,
  FONT_SIZE_MIN,
  FONT_SIZE_MAX,
  type AppSettings,
} from "./settings";

const APP: AppSettings = {
  proxy: "",
  sslVerify: true,
  timeoutMs: 30_000,
  theme: "dark",
  fontSize: 14,
};

// ---- clamp: fronteiras inclusivas, NaN/Infinity -> fallback ------------------
describe("clamp", () => {
  it("dentro do range devolve o valor", () => {
    expect(clamp(5, 0, 10, 99)).toBe(5);
  });
  it("abaixo do min vira min", () => {
    expect(clamp(-1, 0, 10, 99)).toBe(0);
  });
  it("acima do max vira max", () => {
    expect(clamp(11, 0, 10, 99)).toBe(10);
  });
  it("exatamente min/max sao mantidos (fronteira inclusiva)", () => {
    expect(clamp(0, 0, 10, 99)).toBe(0);
    expect(clamp(10, 0, 10, 99)).toBe(10);
  });
  it("NaN -> fallback", () => {
    expect(clamp(NaN, 0, 10, 99)).toBe(99);
  });
  it("Infinity / -Infinity -> fallback (nao finito)", () => {
    expect(clamp(Infinity, 0, 10, 99)).toBe(99);
    expect(clamp(-Infinity, 0, 10, 99)).toBe(99);
  });
});

// ---- normalizarAppSettings: tipos errados, parcial, SSL opt-in --------------
describe("normalizarAppSettings", () => {
  it("null/undefined -> defaults completos", () => {
    expect(normalizarAppSettings(null)).toEqual(APP_SETTINGS_PADRAO);
    expect(normalizarAppSettings(undefined)).toEqual(APP_SETTINGS_PADRAO);
  });
  it("proxy nao-string cai no default", () => {
    expect(normalizarAppSettings({ proxy: 123 as unknown as string }).proxy).toBe(
      APP_SETTINGS_PADRAO.proxy,
    );
  });
  it("proxy string e preservado", () => {
    expect(normalizarAppSettings({ proxy: "http://p:8080" }).proxy).toBe(
      "http://p:8080",
    );
  });
  it("sslVerify so aceita boolean; nao-boolean -> default true", () => {
    expect(normalizarAppSettings({ sslVerify: false }).sslVerify).toBe(false);
    expect(normalizarAppSettings({ sslVerify: true }).sslVerify).toBe(true);
    // valores truthy/falsy nao-boolean NAO desligam o SSL
    expect(
      normalizarAppSettings({ sslVerify: 0 as unknown as boolean }).sslVerify,
    ).toBe(true);
    expect(
      normalizarAppSettings({ sslVerify: "false" as unknown as boolean }).sslVerify,
    ).toBe(true);
  });
  it("timeoutMs nao-numero -> default; numero fora do range -> clamp", () => {
    expect(
      normalizarAppSettings({ timeoutMs: "x" as unknown as number }).timeoutMs,
    ).toBe(APP_SETTINGS_PADRAO.timeoutMs);
    expect(normalizarAppSettings({ timeoutMs: -5 }).timeoutMs).toBe(TIMEOUT_MIN_MS);
    expect(normalizarAppSettings({ timeoutMs: 9_999_999 }).timeoutMs).toBe(
      TIMEOUT_MAX_MS,
    );
  });
  it("theme: so 'light' vira light, qualquer outro vira dark", () => {
    expect(normalizarAppSettings({ theme: "light" }).theme).toBe("light");
    expect(normalizarAppSettings({ theme: "dark" }).theme).toBe("dark");
    expect(
      normalizarAppSettings({ theme: "neon" as unknown as "dark" }).theme,
    ).toBe("dark");
  });
  it("fontSize clamp ao range", () => {
    expect(normalizarAppSettings({ fontSize: 4 }).fontSize).toBe(FONT_SIZE_MIN);
    expect(normalizarAppSettings({ fontSize: 100 }).fontSize).toBe(FONT_SIZE_MAX);
    expect(normalizarAppSettings({ fontSize: 16 }).fontSize).toBe(16);
  });
});

// ---- proxyUtilizavel --------------------------------------------------------
describe("proxyUtilizavel", () => {
  it("undefined / vazio / so-espacos -> false", () => {
    expect(proxyUtilizavel(undefined)).toBe(false);
    expect(proxyUtilizavel("")).toBe(false);
    expect(proxyUtilizavel("   ")).toBe(false);
  });
  it("nao-vazio apos trim -> true", () => {
    expect(proxyUtilizavel("http://p")).toBe(true);
    expect(proxyUtilizavel("  http://p  ")).toBe(true);
  });
});

// ---- efetivas: composicao global x per-request ------------------------------
describe("efetivas", () => {
  it("sem perRequest: defaults de feature + globais", () => {
    const e = efetivas(APP);
    expect(e.sslVerify).toBe(true);
    expect(e.timeoutMs).toBe(30_000);
    expect(e.followRedirects).toBe(true); // FOLLOW_REDIRECTS_PADRAO
    expect(e.encodeUrl).toBe(true); // ENCODE_URL_PADRAO
    expect(e.proxy).toBeUndefined(); // proxy global vazio
    expect(e.maxRedirects).toBeUndefined();
  });
  it("timeout per-request sobrescreve o global", () => {
    expect(efetivas(APP, { timeoutMs: 5000 }).timeoutMs).toBe(5000);
  });
  it("timeout per-request fora do range passa por clamp", () => {
    expect(efetivas(APP, { timeoutMs: -10 }).timeoutMs).toBe(TIMEOUT_MIN_MS);
    expect(efetivas(APP, { timeoutMs: 99_999_999 }).timeoutMs).toBe(TIMEOUT_MAX_MS);
  });
  it("timeout per-request 0 e respeitado (nao cai no global)", () => {
    // garante que a checagem e !== undefined, nao truthy
    expect(efetivas(APP, { timeoutMs: 0 }).timeoutMs).toBe(0);
  });
  it("followRedirects false per-request sobrescreve o default true", () => {
    expect(efetivas(APP, { followRedirects: false }).followRedirects).toBe(false);
  });
  it("encodeUrl false per-request sobrescreve o default true", () => {
    expect(efetivas(APP, { encodeUrl: false }).encodeUrl).toBe(false);
  });
  it("sslVerify vem SEMPRE do global", () => {
    expect(efetivas({ ...APP, sslVerify: false }).sslVerify).toBe(false);
    expect(efetivas({ ...APP, sslVerify: true }).sslVerify).toBe(true);
  });
  it("proxy global nao-vazio e incluido (trim aplicado)", () => {
    expect(efetivas({ ...APP, proxy: "  http://p:8080  " }).proxy).toBe(
      "http://p:8080",
    );
  });
  it("proxy global vazio nao aparece", () => {
    expect("proxy" in efetivas({ ...APP, proxy: "" })).toBe(false);
    expect("proxy" in efetivas({ ...APP, proxy: "   " })).toBe(false);
  });
  it("maxRedirects so aparece quando followRedirects=true", () => {
    // followRedirects default true + maxRedirects definido -> presente, clamp
    const e1 = efetivas(APP, { maxRedirects: 5 });
    expect(e1.maxRedirects).toBe(5);
    // followRedirects false -> maxRedirects suprimido
    const e2 = efetivas(APP, { followRedirects: false, maxRedirects: 5 });
    expect(e2.maxRedirects).toBeUndefined();
  });
  it("maxRedirects passa por clamp ao range", () => {
    expect(efetivas(APP, { maxRedirects: 999 }).maxRedirects).toBe(MAX_REDIRECTS_MAX);
    expect(efetivas(APP, { maxRedirects: -1 }).maxRedirects).toBe(0);
  });
  it("maxRedirects ausente -> undefined mesmo com followRedirects true", () => {
    expect(efetivas(APP, { followRedirects: true }).maxRedirects).toBeUndefined();
  });
  it("perRequest indefinido vs objeto vazio dao o mesmo resultado", () => {
    expect(efetivas(APP, {})).toEqual(efetivas(APP, undefined));
  });
});

// ---- defaults exportados sao os documentados --------------------------------
describe("constantes/defaults", () => {
  it("APP_SETTINGS_PADRAO tem SSL ligado por padrao", () => {
    expect(APP_SETTINGS_PADRAO.sslVerify).toBe(true);
  });
});
