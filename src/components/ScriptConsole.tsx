// F12 — Console de scripts: mostra os logs (console.*) e o erro do ULTIMO envio.
// Le scriptLogs / scriptErro do requestStore (preenchidos em `enviar()`).
// Componente FINO de exibicao; nenhuma logica de execucao aqui.

import { type CSSProperties } from "react";
import { useRequestStore } from "../store/requestStore";

/** Classifica uma linha de log pelo prefixo que `criarConsole` adiciona. */
function nivelDaLinha(linha: string): "warn" | "error" | "log" {
  if (linha.startsWith("[error] ")) return "error";
  if (linha.startsWith("[warn] ")) return "warn";
  return "log";
}

export function ScriptConsole() {
  const logs = useRequestStore((s) => s.scriptLogs);
  const erro = useRequestStore((s) => s.scriptErro);

  const vazio = logs.length === 0 && !erro;

  return (
    <div className="script-console" style={estilos.container}>
      {vazio && (
        <p style={estilos.vazio}>
          Sem saida de script. Os logs de <code style={estilos.code}>console.*</code>{" "}
          do ultimo envio aparecem aqui.
        </p>
      )}

      {!vazio && (
        <div style={estilos.painel} role="log" aria-label="Saida dos scripts">
          {logs.map((linha, i) => {
            const nivel = nivelDaLinha(linha);
            return (
              <div key={i} style={{ ...estilos.linha, ...estilos[nivel] }}>
                {linha}
              </div>
            );
          })}
          {erro && (
            <div style={{ ...estilos.linha, ...estilos.erroScript }} role="alert">
              Erro de script: {erro}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const estilos: Record<string, CSSProperties> = {
  container: {
    width: "100%",
  },
  vazio: {
    color: "#9aa0a6",
    fontSize: "0.82rem",
    fontStyle: "italic",
    margin: 0,
  },
  painel: {
    background: "#141414",
    border: "1px solid #3a3a3a",
    borderRadius: "4px",
    padding: "0.5rem 0.6rem",
    maxHeight: "240px",
    overflowY: "auto",
    fontFamily: "monospace",
    fontSize: "0.82rem",
    display: "flex",
    flexDirection: "column",
    gap: "0.1rem",
  },
  linha: {
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    color: "#cdd0d4",
  },
  log: {
    color: "#cdd0d4",
  },
  warn: {
    color: "#e0b341",
  },
  error: {
    color: "#f87171",
  },
  erroScript: {
    color: "#f87171",
    borderTop: "1px solid #3a3a3a",
    marginTop: "0.3rem",
    paddingTop: "0.3rem",
  },
  code: {
    background: "#1e1e1e",
    border: "1px solid #3a3a3a",
    borderRadius: "3px",
    padding: "0.05rem 0.3rem",
    color: "#cdd0d4",
  },
};

export default ScriptConsole;
