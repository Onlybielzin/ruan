// F20 — Configuracoes globais (app) e por-request (LOGICA PURA, alvo de mutation).
//
// Duas camadas de config:
//   AppSettings     -> globais do app (persistidas no localStorage do webview).
//   RequestSettings -> overrides por request (gravados no RequestItem.settings).
//
// `efetivas(app, perRequest)` compoe a config final de ENVIO: per-request
// sobrescreve o global campo a campo. O resultado (EffectiveSettings) e o que
// vai no RequestData.settings para o Rust aplicar (timeout/redirects/proxy/ssl).
//
// Sem I/O aqui: so transformacao de dados. O store (settingsStore) cuida de
// persistir e a engine Rust de aplicar.

/** Tema visual do app. */
export type Theme = "dark" | "light";

/** Configuracoes globais do app. */
export interface AppSettings {
  /** URL do proxy (ex: http://127.0.0.1:8080). Vazio/undefined => sem proxy. */
  proxy?: string;
  /** Verificar certificado SSL. false => aceita certificados invalidos. */
  sslVerify: boolean;
  /** Timeout padrao de envio em ms. */
  timeoutMs: number;
  /** Tema claro/escuro. */
  theme: Theme;
  /** Tamanho da fonte base (px). */
  fontSize: number;
}

/** Overrides por request (todos opcionais; ausentes => herda do global). */
export interface RequestSettings {
  /** Percent-encode automatico da URL/params. */
  encodeUrl?: boolean;
  /** Seguir redirects (3xx). */
  followRedirects?: boolean;
  /** Maximo de redirects a seguir (so vale se followRedirects). */
  maxRedirects?: number;
  /** Timeout em ms (sobrescreve o global). */
  timeoutMs?: number;
}

/**
 * Config efetiva do envio: resultado de `efetivas`. E o shape espelhado no
 * RequestData.settings (camelCase) que o Rust consome. Todos os campos que a
 * engine pode aplicar ficam resolvidos aqui (sem opcionais ambiguos, exceto
 * proxy/maxRedirects que sao genuinamente opcionais).
 */
export interface EffectiveSettings {
  /** Proxy resolvido (so presente se nao-vazio). */
  proxy?: string;
  /** Verificar SSL. */
  sslVerify: boolean;
  /** Timeout final em ms. */
  timeoutMs: number;
  /** Seguir redirects. */
  followRedirects: boolean;
  /** Limite de redirects (so presente se followRedirects). */
  maxRedirects?: number;
  /** Percent-encode automatico da URL. */
  encodeUrl: boolean;
}

/** Limites de saneamento (defesa contra valores absurdos vindos da UI). */
export const TIMEOUT_MIN_MS = 0;
export const TIMEOUT_MAX_MS = 3_600_000; // 1h
export const MAX_REDIRECTS_MIN = 0;
export const MAX_REDIRECTS_MAX = 50;
export const FONT_SIZE_MIN = 8;
export const FONT_SIZE_MAX = 32;

/** Defaults globais do app (estado inicial / fallback ao ler storage corrompido). */
export const APP_SETTINGS_PADRAO: AppSettings = {
  proxy: "",
  sslVerify: true,
  timeoutMs: 30_000,
  theme: "dark",
  fontSize: 14,
};

/** Defaults efetivos quando nem global nem per-request definem um campo. */
export const FOLLOW_REDIRECTS_PADRAO = true;
export const ENCODE_URL_PADRAO = true;

/** Limita `n` ao intervalo [min, max]. Nao-finito => `fallback`. LOGICA PURA. */
export function clamp(n: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

/**
 * Normaliza AppSettings cru (ex: vindo do localStorage, possivelmente parcial ou
 * com tipos errados) para um AppSettings completo e saneado. LOGICA PURA.
 */
export function normalizarAppSettings(
  raw: Partial<AppSettings> | null | undefined,
): AppSettings {
  const r = raw ?? {};
  const proxy = typeof r.proxy === "string" ? r.proxy : APP_SETTINGS_PADRAO.proxy;
  return {
    proxy,
    sslVerify:
      typeof r.sslVerify === "boolean" ? r.sslVerify : APP_SETTINGS_PADRAO.sslVerify,
    timeoutMs: clamp(
      typeof r.timeoutMs === "number" ? r.timeoutMs : APP_SETTINGS_PADRAO.timeoutMs,
      TIMEOUT_MIN_MS,
      TIMEOUT_MAX_MS,
      APP_SETTINGS_PADRAO.timeoutMs,
    ),
    theme: r.theme === "light" ? "light" : "dark",
    fontSize: clamp(
      typeof r.fontSize === "number" ? r.fontSize : APP_SETTINGS_PADRAO.fontSize,
      FONT_SIZE_MIN,
      FONT_SIZE_MAX,
      APP_SETTINGS_PADRAO.fontSize,
    ),
  };
}

/** True se a string de proxy e utilizavel (nao vazia depois de trim). LOGICA PURA. */
export function proxyUtilizavel(proxy: string | undefined): boolean {
  return typeof proxy === "string" && proxy.trim().length > 0;
}

/**
 * Compoe a config EFETIVA de envio: per-request sobrescreve o global campo a
 * campo. Campos ausentes no per-request caem no global (ou no default da feature
 * quando o global tambem nao cobre: followRedirects/encodeUrl). LOGICA PURA.
 *
 * Saneamento: timeout e maxRedirects passam por clamp; proxy vazio vira ausente;
 * maxRedirects so aparece quando followRedirects=true.
 */
export function efetivas(
  app: AppSettings,
  perRequest?: RequestSettings,
): EffectiveSettings {
  const pr = perRequest ?? {};

  const timeoutBruto = pr.timeoutMs !== undefined ? pr.timeoutMs : app.timeoutMs;
  const timeoutMs = clamp(
    timeoutBruto,
    TIMEOUT_MIN_MS,
    TIMEOUT_MAX_MS,
    APP_SETTINGS_PADRAO.timeoutMs,
  );

  const followRedirects =
    pr.followRedirects !== undefined ? pr.followRedirects : FOLLOW_REDIRECTS_PADRAO;

  const encodeUrl = pr.encodeUrl !== undefined ? pr.encodeUrl : ENCODE_URL_PADRAO;

  const out: EffectiveSettings = {
    sslVerify: app.sslVerify,
    timeoutMs,
    followRedirects,
    encodeUrl,
  };

  if (proxyUtilizavel(app.proxy)) {
    out.proxy = app.proxy!.trim();
  }

  // maxRedirects so faz sentido quando vamos seguir redirects.
  if (followRedirects && pr.maxRedirects !== undefined) {
    out.maxRedirects = clamp(
      pr.maxRedirects,
      MAX_REDIRECTS_MIN,
      MAX_REDIRECTS_MAX,
      MAX_REDIRECTS_MAX,
    );
  }

  return out;
}
