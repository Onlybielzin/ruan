// F14 — Painel de cookies: ver cookies guardados (agrupados por dominio),
// filtrar por dominio, limpar e ligar/desligar o cookie jar.
//
// Componente FINO: toda a logica pura (filtro/agrupamento) vive em
// cookiesStore.ts (alvo de testes). Aqui so renderiza o estado do store e
// dispara acoes.

import { useEffect, type CSSProperties } from "react";
import {
  useCookiesStore,
  filtrarCookies,
  agruparPorDominio,
} from "../store/cookiesStore";

export function CookiesPanel() {
  const cookies = useCookiesStore((s) => s.cookies);
  const enabled = useCookiesStore((s) => s.enabled);
  const loading = useCookiesStore((s) => s.loading);
  const error = useCookiesStore((s) => s.error);
  const filtro = useCookiesStore((s) => s.filtro);
  const setFiltro = useCookiesStore((s) => s.setFiltro);
  const recarregar = useCookiesStore((s) => s.recarregar);
  const setEnabled = useCookiesStore((s) => s.setEnabled);
  const carregarEnabled = useCookiesStore((s) => s.carregarEnabled);
  const limpar = useCookiesStore((s) => s.limpar);

  // Na montagem: sincroniza o toggle com o backend e lista os cookies vistos.
  useEffect(() => {
    void carregarEnabled();
    void recarregar();
  }, [carregarEnabled, recarregar]);

  const visiveis = filtrarCookies(cookies, filtro);
  const grupos = agruparPorDominio(visiveis);

  return (
    <div className="cookies-panel" style={estilos.container}>
      <div style={estilos.barra}>
        <label style={estilos.toggle}>
          <input
            type="checkbox"
            checked={enabled}
            disabled={loading}
            onChange={(e) => void setEnabled(e.target.checked)}
            aria-label="Ligar/desligar cookie jar"
          />
          <span>Cookie jar {enabled ? "ligado" : "desligado"}</span>
        </label>

        <input
          type="text"
          value={filtro}
          placeholder="Filtrar por dominio"
          onChange={(e) => setFiltro(e.target.value)}
          style={estilos.filtro}
          aria-label="Filtrar cookies por dominio"
        />

        <button
          type="button"
          onClick={() => void recarregar()}
          disabled={loading}
          style={estilos.botao}
        >
          Atualizar
        </button>

        <button
          type="button"
          onClick={() => void limpar()}
          disabled={loading || cookies.length === 0}
          style={{ ...estilos.botao, ...estilos.botaoPerigo }}
          title="Limpa TODOS os cookies (o jar nao remove por dominio)"
        >
          Limpar tudo
        </button>
      </div>

      {error && (
        <p style={estilos.erro} role="alert">
          {error}
        </p>
      )}

      {!enabled && (
        <p style={estilos.aviso}>
          O jar esta desligado: novas requests nao guardam nem enviam cookies.
        </p>
      )}

      {visiveis.length === 0 && !error && (
        <p style={estilos.vazio}>
          Nenhum cookie guardado{filtro.trim() ? " para este filtro" : ""}.
        </p>
      )}

      {grupos.map((grupo) => (
        <div key={grupo.dominio} style={estilos.grupo}>
          <div style={estilos.grupoCabecalho}>
            <span style={estilos.dominio}>{grupo.dominio}</span>
            <button
              type="button"
              onClick={() => void limpar(grupo.dominio)}
              disabled={loading}
              style={estilos.linkPerigo}
              title="Limita do Jar: limpa todos os cookies, nao so deste dominio"
            >
              Limpar
            </button>
          </div>
          <table style={estilos.tabela}>
            <thead>
              <tr>
                <th style={estilos.th}>Nome</th>
                <th style={estilos.th}>Valor</th>
                <th style={estilos.th}>Path</th>
                <th style={estilos.th}>Secure</th>
              </tr>
            </thead>
            <tbody>
              {grupo.cookies.map((c, i) => (
                <tr key={`${c.nome}-${i}`}>
                  <td style={estilos.td}>{c.nome}</td>
                  <td style={{ ...estilos.td, ...estilos.tdValor }}>{c.valor}</td>
                  <td style={estilos.td}>{c.path}</td>
                  <td style={estilos.td}>{c.secure ? "sim" : "nao"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

const estilos: Record<string, CSSProperties> = {
  container: {
    width: "100%",
    display: "flex",
    flexDirection: "column",
    gap: "0.6rem",
  },
  barra: {
    display: "flex",
    alignItems: "center",
    gap: "0.6rem",
    flexWrap: "wrap",
  },
  toggle: {
    display: "flex",
    alignItems: "center",
    gap: "0.35rem",
    fontSize: "0.85rem",
    color: "#cdd0d4",
    cursor: "pointer",
  },
  filtro: {
    flex: "1 1 160px",
    minWidth: "120px",
    background: "#141414",
    border: "1px solid #3a3a3a",
    borderRadius: "4px",
    color: "#cdd0d4",
    padding: "0.3rem 0.5rem",
    fontSize: "0.85rem",
  },
  botao: {
    background: "#1e1e1e",
    border: "1px solid #3a3a3a",
    borderRadius: "4px",
    color: "#cdd0d4",
    padding: "0.3rem 0.7rem",
    fontSize: "0.82rem",
    cursor: "pointer",
  },
  botaoPerigo: {
    borderColor: "#7a3030",
    color: "#f3a3a3",
  },
  linkPerigo: {
    background: "transparent",
    border: "none",
    color: "#f3a3a3",
    fontSize: "0.78rem",
    cursor: "pointer",
    padding: 0,
  },
  erro: {
    color: "#f87171",
    fontSize: "0.82rem",
    margin: 0,
  },
  aviso: {
    color: "#e0b341",
    fontSize: "0.82rem",
    margin: 0,
  },
  vazio: {
    color: "#9aa0a6",
    fontSize: "0.82rem",
    fontStyle: "italic",
    margin: 0,
  },
  grupo: {
    border: "1px solid #3a3a3a",
    borderRadius: "4px",
    overflow: "hidden",
  },
  grupoCabecalho: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    background: "#1a1a1a",
    padding: "0.35rem 0.6rem",
  },
  dominio: {
    fontFamily: "monospace",
    fontSize: "0.82rem",
    color: "#cdd0d4",
  },
  tabela: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: "0.8rem",
  },
  th: {
    textAlign: "left",
    color: "#9aa0a6",
    fontWeight: 500,
    padding: "0.3rem 0.6rem",
    borderBottom: "1px solid #2a2a2a",
  },
  td: {
    color: "#cdd0d4",
    padding: "0.3rem 0.6rem",
    borderBottom: "1px solid #222",
    fontFamily: "monospace",
    verticalAlign: "top",
  },
  tdValor: {
    wordBreak: "break-all",
    maxWidth: "280px",
  },
};

export default CookiesPanel;
