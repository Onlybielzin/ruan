// F18 — Painel de geracao de codigo: mostra a request atual como snippet em
// cURL, fetch, axios ou Python requests, com botoes de copiar.
//
// Componente FINO: toda a logica de geracao vive em lib/codegen.ts (alvo de
// mutation). Aqui so escolhe a linguagem, projeta a request via requestDataDeItem
// e copia para a area de transferencia.

import { useState, type CSSProperties } from "react";
import { useRequestStore } from "../store/requestStore";
import { requestDataDeItem } from "../lib/http-types";
import {
  gerar,
  copiarComoCurl,
  LINGUAGENS,
  ROTULO_LINGUAGEM,
  type Linguagem,
} from "../lib/codegen";

/** Copia texto para a area de transferencia, com fallback se a API faltar. */
async function copiarTexto(texto: string): Promise<boolean> {
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(texto);
      return true;
    }
  } catch {
    // cai no retorno false abaixo
  }
  return false;
}

export function CodeGenPanel() {
  const request = useRequestStore((s) => s.request);
  const [linguagem, setLinguagem] = useState<Linguagem>("curl");
  const [copiado, setCopiado] = useState<string | null>(null);

  const req = requestDataDeItem(request);
  const snippet = gerar(linguagem, req);

  async function copiar(texto: string, marca: string) {
    const ok = await copiarTexto(texto);
    setCopiado(ok ? marca : `${marca}-erro`);
    window.setTimeout(() => setCopiado(null), 1500);
  }

  return (
    <div className="codegen-panel" style={estilos.container}>
      <div style={estilos.barra}>
        <label style={estilos.label}>
          <span style={estilos.labelTexto}>Linguagem</span>
          <select
            value={linguagem}
            onChange={(e) => setLinguagem(e.target.value as Linguagem)}
            style={estilos.select}
            aria-label="Linguagem do snippet"
          >
            {LINGUAGENS.map((l) => (
              <option key={l} value={l}>
                {ROTULO_LINGUAGEM[l]}
              </option>
            ))}
          </select>
        </label>

        <div style={estilos.botoes}>
          <button
            type="button"
            onClick={() => void copiar(snippet, "snippet")}
            style={estilos.botao}
          >
            {copiado === "snippet" ? "Copiado" : "Copiar"}
          </button>
          <button
            type="button"
            onClick={() => void copiar(copiarComoCurl(req), "curl")}
            style={estilos.botao}
            title="Copia a request como comando cURL"
          >
            {copiado === "curl" ? "Copiado" : "Copy as cURL"}
          </button>
        </div>
      </div>

      {copiado?.endsWith("-erro") && (
        <p style={estilos.erro} role="alert">
          Nao foi possivel copiar para a area de transferencia.
        </p>
      )}

      <pre style={estilos.snippet} aria-label="Snippet gerado">
        <code>{snippet}</code>
      </pre>
    </div>
  );
}

const estilos: Record<string, CSSProperties> = {
  container: {
    width: "100%",
    display: "flex",
    flexDirection: "column",
    gap: "0.5rem",
  },
  barra: {
    display: "flex",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: "0.75rem",
    flexWrap: "wrap",
  },
  label: {
    display: "flex",
    flexDirection: "column",
    gap: "0.25rem",
  },
  labelTexto: {
    color: "#9aa0a6",
    fontSize: "0.75rem",
  },
  select: {
    background: "#1a1a1a",
    color: "#cdd0d4",
    border: "1px solid #3a3a3a",
    borderRadius: "4px",
    padding: "0.35rem 0.5rem",
    fontSize: "0.82rem",
  },
  botoes: {
    display: "flex",
    gap: "0.5rem",
  },
  botao: {
    background: "#2a2a2a",
    color: "#cdd0d4",
    border: "1px solid #3a3a3a",
    borderRadius: "4px",
    padding: "0.35rem 0.7rem",
    fontSize: "0.82rem",
    cursor: "pointer",
  },
  erro: {
    color: "#f28b82",
    fontSize: "0.8rem",
    margin: 0,
  },
  snippet: {
    background: "#101010",
    color: "#cdd0d4",
    border: "1px solid #2a2a2a",
    borderRadius: "4px",
    padding: "0.7rem",
    margin: 0,
    fontFamily: "monospace",
    fontSize: "0.8rem",
    lineHeight: 1.5,
    whiteSpace: "pre",
    overflowX: "auto",
  },
};

export default CodeGenPanel;
