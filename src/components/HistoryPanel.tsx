// F16 — Painel de Historico de execucoes.
//
// Lista as execucoes em ordem cronologica (mais recente primeiro): method, url,
// status, tempo e timestamp. Clicar numa entrada RESTAURA a request no builder
// (via requestStore.setRequest, a unica leitura/escrita que fazemos no
// requestStore). Botao "Limpar" esvazia o historico.
//
// Registro de novas execucoes: este painel REAGE as responses/erros do
// requestStore (useEffect) e chama `historyStore.registrar`. NAO editamos o
// requestStore — apenas o observamos. A deduplicacao usa o numero de envios
// concluidos (carimbo monotonico): cada envio que termina (com response OU erro)
// muda o estado do requestStore, e registramos uma vez por mudanca.

import { useEffect, useRef, type CSSProperties } from "react";
import { useRequestStore } from "../store/requestStore";
import { useHistoryStore } from "../store/historyStore";
import { montarEntry, montarEntryErro } from "../lib/historico";
import type { HistoricoEntry } from "../lib/historico";

/** Gera um id unico para uma nova entrada (fora da logica pura, aqui pode usar Date/random). */
function novoId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Formata um timestamp (ms) numa hora local curta. */
export function formatarTimestamp(ms: number): string {
  try {
    return new Date(ms).toLocaleTimeString();
  } catch {
    return "";
  }
}

/** Formata o tempo de resposta (ms -> "123 ms" ou "—" se null). */
export function formatarTempo(ms: number | null): string {
  if (ms === null) return "—";
  return `${ms} ms`;
}

/** Cor do status: 2xx verde, 3xx azul, 4xx/5xx vermelho, null (erro) cinza. */
export function corStatus(status: number | null): string {
  if (status === null) return "#9aa0a6";
  if (status >= 200 && status < 300) return "#4ade80";
  if (status >= 300 && status < 400) return "#60a5fa";
  return "#f87171";
}

/** Rotulo do status (numero ou "ERRO" quando o envio falhou). */
export function rotuloStatus(status: number | null): string {
  return status === null ? "ERRO" : String(status);
}

export function HistoryPanel() {
  const entries = useHistoryStore((s) => s.entries);
  const registrar = useHistoryStore((s) => s.registrar);
  const carregar = useHistoryStore((s) => s.carregar);
  const limpar = useHistoryStore((s) => s.limpar);

  const setRequest = useRequestStore((s) => s.setRequest);
  const loading = useRequestStore((s) => s.loading);

  // Carrega o historico persistido uma vez, na montagem.
  useEffect(() => {
    void carregar();
  }, [carregar]);

  // Registra UMA entrada por envio concluido. Observa a transicao de `loading`
  // de true->false: quando um envio termina, ha exatamente um resultado novo
  // (response OU error). Guardamos o loading anterior num ref para detectar a
  // borda de descida e nao re-registrar em renders subsequentes.
  const loadingAnterior = useRef(loading);
  useEffect(() => {
    const terminou = loadingAnterior.current && !loading;
    loadingAnterior.current = loading;
    if (!terminou) return;

    // Le o estado FRESCO no momento da borda (o requestStore pode nao ter
    // limpado `response` num envio que falhou apos um que deu certo; por isso
    // `error` MANDA na classificacao sucesso/falha).
    const st = useRequestStore.getState();
    const req = st.request;
    const ts = Date.now();
    const id = novoId();
    const entry: HistoricoEntry =
      st.error === null && st.response !== null
        ? montarEntry(id, ts, req, st.response)
        : montarEntryErro(id, ts, req);
    registrar(entry);
    // `error`/`response` sao lidos via getState no momento da borda; depender de
    // `loading` basta (a borda de descida so dispara uma vez por envio).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  return (
    <div className="history-panel" style={estilos.container}>
      <div style={estilos.header}>
        <span style={estilos.titulo}>Historico</span>
        <button
          type="button"
          style={estilos.botaoLimpar}
          onClick={() => void limpar()}
          disabled={entries.length === 0}
          aria-label="Limpar historico"
        >
          Limpar
        </button>
      </div>

      {entries.length === 0 && (
        <p style={estilos.vazio}>
          Nenhuma execucao ainda. As requests enviadas aparecem aqui.
        </p>
      )}

      <ul style={estilos.lista} aria-label="Execucoes recentes">
        {entries.map((e) => (
          <li key={e.id}>
            <button
              type="button"
              style={estilos.item}
              onClick={() => setRequest(e.requestSnapshot)}
              title={`Restaurar: ${e.method} ${e.url}`}
            >
              <span style={{ ...estilos.method }}>{e.method}</span>
              <span style={estilos.url}>{e.url || "(sem url)"}</span>
              <span style={{ ...estilos.status, color: corStatus(e.status) }}>
                {rotuloStatus(e.status)}
              </span>
              <span style={estilos.tempo}>{formatarTempo(e.timeMs)}</span>
              <span style={estilos.ts}>{formatarTimestamp(e.timestampMs)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

const estilos: Record<string, CSSProperties> = {
  container: {
    width: "100%",
    display: "flex",
    flexDirection: "column",
    gap: "0.4rem",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  titulo: {
    fontSize: "0.85rem",
    fontWeight: 600,
    color: "#cdd0d4",
  },
  botaoLimpar: {
    background: "transparent",
    border: "1px solid #3a3a3a",
    borderRadius: "4px",
    color: "#cdd0d4",
    fontSize: "0.78rem",
    padding: "0.15rem 0.5rem",
    cursor: "pointer",
  },
  vazio: {
    color: "#9aa0a6",
    fontSize: "0.82rem",
    fontStyle: "italic",
    margin: 0,
  },
  lista: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: "0.15rem",
    maxHeight: "320px",
    overflowY: "auto",
  },
  item: {
    width: "100%",
    display: "grid",
    gridTemplateColumns: "auto 1fr auto auto auto",
    alignItems: "center",
    gap: "0.5rem",
    background: "#141414",
    border: "1px solid #2a2a2a",
    borderRadius: "4px",
    padding: "0.3rem 0.5rem",
    cursor: "pointer",
    textAlign: "left",
    fontSize: "0.8rem",
    color: "#cdd0d4",
  },
  method: {
    fontFamily: "monospace",
    fontWeight: 600,
    color: "#e0b341",
    minWidth: "3.5rem",
  },
  url: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: "#cdd0d4",
  },
  status: {
    fontFamily: "monospace",
    fontWeight: 600,
  },
  tempo: {
    fontFamily: "monospace",
    color: "#9aa0a6",
  },
  ts: {
    color: "#9aa0a6",
    fontSize: "0.74rem",
  },
};

export default HistoryPanel;
