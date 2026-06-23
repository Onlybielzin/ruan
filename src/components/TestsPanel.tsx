// F13 — Painel de testes/assertions. Componente FINO: toda a logica de execucao
// (test/expect/matchers) vive em src/lib/assertions.ts (alvo de mutation).
//
// Aqui edita-se `request.tests` (CodeMirror, JS) via requestStore.atualizarRequest
// (patch generico) e, sempre que chega uma NOVA resposta (requestStore.response),
// um useEffect roda `rodarTestes(tests, res, ruan)` e mostra "X passed, Y failed"
// + a lista. Este painel NAO edita o requestStore (apenas le response/tests).
//
// O `ruan` aqui e somente-LEITURA (get*) ligado ao environment/runtime da colecao
// ativa; os set* sao no-op no preview de testes (variaveis sao escritas pelos
// scripts pre/post no pipeline de envio, nao por este painel).

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { javascript } from "@codemirror/lang-javascript";
import { useRequestStore } from "../store/requestStore";
import { useEnvStore } from "../store/envStore";
import { useCollectionsStore } from "../store/collectionsStore";
import { rodarTestes, resumir, type ResultadoTeste } from "../lib/assertions";
import type { RuanApi } from "../lib/scripting";

const PLACEHOLDER_TESTS =
  "// Roda apos cada resposta. `res` = { status, statusText, headers, body, timeMs, sizeBytes }.\n" +
  "// test('status 200', () => { expect(res.status).toBe(200); });\n" +
  "// test('tem id', () => { expect(JSON.parse(res.body)).toHaveProperty('id'); });";

/** Monta um `ruan` somente-leitura para o preview de testes da colecao ativa. */
function ruanLeitura(path: string | null): RuanApi {
  if (path === null) {
    return {
      getVar: () => undefined,
      setVar: () => {},
      getEnvVar: () => undefined,
      setEnvVar: () => {},
    };
  }
  const env = useEnvStore.getState();
  return {
    getVar: (nome) => env.getRuntimeVar(path, String(nome)),
    setVar: () => {},
    getEnvVar: (nome) => env.getEnvVarAtiva(path, String(nome)),
    setEnvVar: () => {},
  };
}

export function TestsPanel() {
  const tests = useRequestStore((s) => s.request.tests);
  const response = useRequestStore((s) => s.response);
  const atualizarRequest = useRequestStore((s) => s.atualizarRequest);
  const activePath = useCollectionsStore((s) => s.activePath);

  const [resultados, setResultados] = useState<ResultadoTeste[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  // null = ainda nao rodou (nenhuma resposta desde que abriu / trocou request).
  const [rodou, setRodou] = useState(false);

  const extensions = useMemo(() => [javascript()], []);

  // Reage a uma NOVA resposta: roda os testes do request atual contra ela.
  // Depende tambem de `tests` e `activePath` para reexecutar se o usuario editar
  // os testes com uma resposta ja na tela. NAO escreve no requestStore.
  useEffect(() => {
    if (response === null) {
      setResultados([]);
      setLogs([]);
      setRodou(false);
      return;
    }
    const ruan = ruanLeitura(activePath);
    const { resultados: r, logs: l } = rodarTestes(tests, response, ruan);
    setResultados(r);
    setLogs(l);
    setRodou(true);
  }, [response, tests, activePath]);

  const resumo = resumir(resultados);

  return (
    <div className="tests-panel" style={estilos.container}>
      <div style={estilos.editorWrap}>
        <CodeMirror
          value={tests}
          onChange={(valor) => atualizarRequest({ tests: valor })}
          extensions={extensions}
          placeholder={PLACEHOLDER_TESTS}
          theme="dark"
          height="200px"
          basicSetup={{ lineNumbers: true, foldGutter: false }}
          aria-label="Codigo dos testes"
        />
      </div>

      <div style={estilos.resultado} aria-live="polite">
        {!rodou && (
          <p style={estilos.vazio}>
            Os resultados aparecem aqui apos enviar a request. Use{" "}
            <code style={estilos.code}>test(nome, fn)</code> e{" "}
            <code style={estilos.code}>expect(valor)</code>.
          </p>
        )}

        {rodou && resultados.length === 0 && (
          <p style={estilos.vazio}>
            Nenhum <code style={estilos.code}>test(...)</code> definido.
          </p>
        )}

        {rodou && resultados.length > 0 && (
          <>
            <div style={estilos.placar}>
              <span style={estilos.placarPass}>{resumo.passaram} passed</span>
              {", "}
              <span
                style={
                  resumo.falharam > 0
                    ? estilos.placarFail
                    : estilos.placarFailZero
                }
              >
                {resumo.falharam} failed
              </span>
            </div>
            <ul style={estilos.lista}>
              {resultados.map((r, i) => (
                <li
                  key={i}
                  style={{
                    ...estilos.item,
                    ...(r.passou ? estilos.itemPass : estilos.itemFail),
                  }}
                >
                  <span style={estilos.icone} aria-hidden>
                    {r.passou ? "PASS" : "FAIL"}
                  </span>
                  <span style={estilos.nome}>{r.nome || "(sem nome)"}</span>
                  {!r.passou && r.erro && (
                    <span style={estilos.erro}> — {r.erro}</span>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}

        {logs.length > 0 && (
          <div style={estilos.logs} role="log" aria-label="Saida dos testes">
            {logs.map((linha, i) => (
              <div key={i} style={estilos.logLinha}>
                {linha}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const estilos: Record<string, CSSProperties> = {
  container: {
    display: "flex",
    flexDirection: "column",
    gap: "0.6rem",
    width: "100%",
  },
  editorWrap: {
    border: "1px solid #3a3a3a",
    borderRadius: "4px",
    overflow: "hidden",
  },
  resultado: {
    display: "flex",
    flexDirection: "column",
    gap: "0.4rem",
  },
  vazio: {
    color: "#9aa0a6",
    fontSize: "0.82rem",
    fontStyle: "italic",
    margin: 0,
  },
  placar: {
    fontSize: "0.85rem",
    fontWeight: 600,
    color: "#cdd0d4",
  },
  placarPass: {
    color: "#4ade80",
  },
  placarFail: {
    color: "#f87171",
  },
  placarFailZero: {
    color: "#9aa0a6",
  },
  lista: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: "0.2rem",
  },
  item: {
    fontSize: "0.82rem",
    fontFamily: "monospace",
    display: "flex",
    alignItems: "baseline",
    gap: "0.4rem",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  },
  itemPass: {
    color: "#cdd0d4",
  },
  itemFail: {
    color: "#f3b0b0",
  },
  icone: {
    fontSize: "0.7rem",
    fontWeight: 700,
    flexShrink: 0,
  },
  nome: {
    color: "inherit",
  },
  erro: {
    color: "#f87171",
  },
  logs: {
    background: "#141414",
    border: "1px solid #3a3a3a",
    borderRadius: "4px",
    padding: "0.4rem 0.6rem",
    maxHeight: "160px",
    overflowY: "auto",
    fontFamily: "monospace",
    fontSize: "0.8rem",
    color: "#cdd0d4",
    display: "flex",
    flexDirection: "column",
    gap: "0.1rem",
  },
  logLinha: {
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  },
  code: {
    background: "#1e1e1e",
    border: "1px solid #3a3a3a",
    borderRadius: "3px",
    padding: "0.05rem 0.3rem",
    fontFamily: "monospace",
    color: "#cdd0d4",
  },
};

export default TestsPanel;
