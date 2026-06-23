// F20 — Painel de configuracoes GLOBAIS do app: proxy, SSL verify, timeout,
// tema (claro/escuro) e tamanho da fonte.
//
// Componente FINO: a logica pura (normalizacao/saneamento/composicao) vive em
// `lib/settings.ts` e a persistencia em `settingsStore.ts`. Aqui so renderizamos
// o estado e disparamos as acoes de set. A aplicacao efetiva do tema/fonte no
// root e da Integracao (App.tsx), que observa `settings.theme`/`settings.fontSize`.

import { type CSSProperties } from "react";
import { useSettingsStore } from "../store/settingsStore";
import {
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  TIMEOUT_MAX_MS,
  TIMEOUT_MIN_MS,
} from "../lib/settings";

export function SettingsPanel() {
  const settings = useSettingsStore((s) => s.settings);
  const setProxy = useSettingsStore((s) => s.setProxy);
  const setSslVerify = useSettingsStore((s) => s.setSslVerify);
  const setTimeoutMs = useSettingsStore((s) => s.setTimeoutMs);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const setFontSize = useSettingsStore((s) => s.setFontSize);
  const resetar = useSettingsStore((s) => s.resetar);

  return (
    <div className="settings-panel" style={estilos.container}>
      <h3 style={estilos.titulo}>Configuracoes globais</h3>

      <label style={estilos.campo}>
        <span style={estilos.label}>Proxy</span>
        <input
          type="text"
          value={settings.proxy ?? ""}
          placeholder="http://127.0.0.1:8080 (vazio = sem proxy)"
          onChange={(e) => setProxy(e.target.value)}
          style={estilos.input}
          aria-label="URL do proxy"
        />
      </label>

      <label style={estilos.toggle}>
        <input
          type="checkbox"
          checked={settings.sslVerify}
          onChange={(e) => setSslVerify(e.target.checked)}
          aria-label="Verificar certificado SSL"
        />
        <span>
          Verificar certificado SSL{" "}
          {settings.sslVerify ? "(ligado)" : "(desligado — aceita invalidos)"}
        </span>
      </label>

      <label style={estilos.campo}>
        <span style={estilos.label}>Timeout (ms)</span>
        <input
          type="number"
          min={TIMEOUT_MIN_MS}
          max={TIMEOUT_MAX_MS}
          value={settings.timeoutMs}
          onChange={(e) => setTimeoutMs(Number(e.target.value))}
          style={estilos.input}
          aria-label="Timeout em milissegundos"
        />
      </label>

      <label style={estilos.campo}>
        <span style={estilos.label}>Tema</span>
        <select
          value={settings.theme}
          onChange={(e) => setTheme(e.target.value === "light" ? "light" : "dark")}
          style={estilos.input}
          aria-label="Tema"
        >
          <option value="dark">Escuro</option>
          <option value="light">Claro</option>
        </select>
      </label>

      <label style={estilos.campo}>
        <span style={estilos.label}>Fonte (px)</span>
        <input
          type="number"
          min={FONT_SIZE_MIN}
          max={FONT_SIZE_MAX}
          value={settings.fontSize}
          onChange={(e) => setFontSize(Number(e.target.value))}
          style={estilos.input}
          aria-label="Tamanho da fonte"
        />
      </label>

      <button type="button" onClick={() => resetar()} style={estilos.botao}>
        Restaurar padroes
      </button>
    </div>
  );
}

const estilos: Record<string, CSSProperties> = {
  container: {
    width: "100%",
    display: "flex",
    flexDirection: "column",
    gap: "0.7rem",
  },
  titulo: {
    margin: 0,
    fontSize: "0.95rem",
    color: "#e6e8ea",
  },
  campo: {
    display: "flex",
    flexDirection: "column",
    gap: "0.25rem",
  },
  label: {
    fontSize: "0.8rem",
    color: "#9aa0a6",
  },
  input: {
    padding: "0.35rem 0.5rem",
    fontSize: "0.85rem",
    background: "#1c1f24",
    color: "#e6e8ea",
    border: "1px solid #2b2f36",
    borderRadius: "4px",
  },
  toggle: {
    display: "flex",
    alignItems: "center",
    gap: "0.4rem",
    fontSize: "0.85rem",
    color: "#cdd0d4",
    cursor: "pointer",
  },
  botao: {
    alignSelf: "flex-start",
    padding: "0.35rem 0.7rem",
    fontSize: "0.8rem",
    background: "#2b2f36",
    color: "#e6e8ea",
    border: "1px solid #3a3f47",
    borderRadius: "4px",
    cursor: "pointer",
  },
};
