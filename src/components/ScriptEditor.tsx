// F12 — Editor de scripts pre-request / post-response.
// Componente FINO: toda a logica de execucao vive em src/lib/scripting.ts
// (alvo de mutation). Aqui so editamos request.scripts.pre / request.scripts.post
// via requestStore.atualizarRequest (patch generico), com CodeMirror (JS).
//
// Duas areas selecionaveis por sub-abas (Pre / Post). A API disponivel ao script
// e documentada num rodape (objeto `ruan`, `req`, `res`, `console.*`).

import { useMemo, useState, type CSSProperties } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { javascript } from "@codemirror/lang-javascript";
import { useRequestStore } from "../store/requestStore";
import type { Scripts } from "../lib/types";

type Aba = "pre" | "post";

const PLACEHOLDER_PRE =
  "// Roda ANTES do envio. `req` e mutavel (method, url, headers, params, body).\n" +
  "// ruan.setVar('token', '123'); ruan.setEnvVar('baseUrl', 'https://api');\n" +
  "// console.log('pre rodou', req.method, req.url);";

const PLACEHOLDER_POST =
  "// Roda DEPOIS da resposta. `res` = { status, statusText, headers, body, timeMs, sizeBytes }.\n" +
  "// const dados = JSON.parse(res.body); ruan.setVar('id', dados.id);\n" +
  "// console.log('status', res.status);";

export function ScriptEditor() {
  const [aba, setAba] = useState<Aba>("pre");
  const scripts = useRequestStore((s) => s.request.scripts);
  const atualizarRequest = useRequestStore((s) => s.atualizarRequest);

  const extensions = useMemo(() => [javascript()], []);

  const patchScripts = (patch: Partial<Scripts>) => {
    atualizarRequest({ scripts: { ...scripts, ...patch } });
  };

  const ativo = aba === "pre" ? scripts.pre : scripts.post;
  const onChange = (valor: string) =>
    patchScripts(aba === "pre" ? { pre: valor } : { post: valor });

  return (
    <div className="script-editor" style={estilos.container}>
      <div style={estilos.subAbas} role="tablist" aria-label="Tipo de script">
        <BotaoAba
          rotulo="Pre-request"
          ativa={aba === "pre"}
          onClick={() => setAba("pre")}
        />
        <BotaoAba
          rotulo="Post-response"
          ativa={aba === "post"}
          onClick={() => setAba("post")}
        />
      </div>

      <div style={estilos.editorWrap}>
        <CodeMirror
          value={ativo}
          onChange={onChange}
          extensions={extensions}
          placeholder={aba === "pre" ? PLACEHOLDER_PRE : PLACEHOLDER_POST}
          theme="dark"
          height="240px"
          basicSetup={{ lineNumbers: true, foldGutter: false }}
          aria-label={
            aba === "pre" ? "Script pre-request" : "Script post-response"
          }
        />
      </div>

      <p style={estilos.ajuda}>
        Disponivel: <code style={estilos.code}>ruan.getVar/setVar</code>,{" "}
        <code style={estilos.code}>ruan.getEnvVar/setEnvVar</code>,{" "}
        <code style={estilos.code}>req</code>
        {aba === "post" && (
          <>
            , <code style={estilos.code}>res</code>
          </>
        )}{" "}
        e <code style={estilos.code}>console.*</code>.
      </p>
    </div>
  );
}

function BotaoAba(props: {
  rotulo: string;
  ativa: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={props.ativa}
      onClick={props.onClick}
      style={{
        ...estilos.botaoAba,
        ...(props.ativa ? estilos.botaoAbaAtiva : {}),
      }}
    >
      {props.rotulo}
    </button>
  );
}

const estilos: Record<string, CSSProperties> = {
  container: {
    display: "flex",
    flexDirection: "column",
    gap: "0.6rem",
    width: "100%",
  },
  subAbas: {
    display: "flex",
    gap: "0.3rem",
  },
  botaoAba: {
    background: "#1e1e1e",
    color: "#9aa0a6",
    border: "1px solid #3a3a3a",
    borderRadius: "4px",
    padding: "0.35rem 0.8rem",
    fontSize: "0.82rem",
    cursor: "pointer",
  },
  botaoAbaAtiva: {
    background: "#2a2a2a",
    color: "#e0e0e0",
    borderColor: "#4a4a4a",
  },
  editorWrap: {
    border: "1px solid #3a3a3a",
    borderRadius: "4px",
    overflow: "hidden",
  },
  ajuda: {
    color: "#9aa0a6",
    fontSize: "0.78rem",
    margin: 0,
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

export default ScriptEditor;
