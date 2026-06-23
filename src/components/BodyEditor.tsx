// BodyEditor (F7): editor de corpo da request em varios modos.
// Componente FINO: toda a logica vive em src/lib/body.ts (alvo de mutation).
// Le/escreve no requestStore via atualizarRequest (patch generico).
//
// Modos:
// - none: sem corpo.
// - json/text/xml/graphql: editor CodeMirror com syntax highlight; JSON tem
//   botao "Formatar".
// - form_urlencoded: tabela key/value.
// - multipart: tabela key/value com opcao de anexar arquivo por linha.
//
// Estilos inline minimos (tema escuro coerente com App.css), igual ao padrao do
// RequestBuilder — a Integracao pode migrar pra classes .app-* se quiser.

import { useMemo, useRef, type ChangeEvent, type CSSProperties } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { json } from "@codemirror/lang-json";
import { xml } from "@codemirror/lang-xml";
import type { Extension } from "@codemirror/state";
import { useRequestStore } from "../store/requestStore";
import type { BodyMode, KeyValue, Body } from "../lib/types";
import {
  BODY_MODES,
  rotuloModo,
  modoUsaRaw,
  modoUsaForm,
  aplicarContentTypeAuto,
  formatarJson,
  ehCampoArquivo,
  caminhoDoCampoArquivo,
  valueDeArquivo,
  nomeDoArquivo,
  novoPar,
} from "../lib/body";

export function BodyEditor() {
  const body = useRequestStore((s) => s.request.body);
  const headers = useRequestStore((s) => s.request.headers);
  const atualizarRequest = useRequestStore((s) => s.atualizarRequest);

  const mode = body.mode;
  const raw = body.raw ?? "";
  const form = useMemo(() => body.form ?? [], [body.form]);

  // Aplica um patch parcial no Body, preservando o resto.
  const patchBody = (patch: Partial<Body>) => {
    atualizarRequest({ body: { ...body, ...patch } });
  };

  const onTrocarModo = (e: ChangeEvent<HTMLSelectElement>) => {
    const novo = e.target.value as BodyMode;
    // Ao trocar o modo, tenta setar o Content-Type automatico sem sobrescrever
    // um header definido manualmente pelo usuario.
    const novosHeaders = aplicarContentTypeAuto(headers, novo);
    atualizarRequest({
      body: { ...body, mode: novo },
      headers: novosHeaders,
    });
  };

  const setRaw = (valor: string) => patchBody({ raw: valor });
  const setForm = (novo: KeyValue[]) => patchBody({ form: novo });

  return (
    <div className="body-editor" style={estilos.container}>
      <div style={estilos.barra}>
        <label style={estilos.label} htmlFor="body-mode">
          Corpo
        </label>
        <select
          id="body-mode"
          aria-label="Modo do corpo"
          value={mode}
          onChange={onTrocarModo}
          style={estilos.select}
        >
          {BODY_MODES.map((m) => (
            <option key={m} value={m}>
              {rotuloModo(m)}
            </option>
          ))}
        </select>

        {mode === "json" && (
          <FormatarJsonBotao raw={raw} onFormatar={setRaw} />
        )}
      </div>

      {mode === "none" && (
        <p style={estilos.vazio}>Esta request nao envia corpo.</p>
      )}

      {modoUsaRaw(mode) && (
        <RawEditor mode={mode} value={raw} onChange={setRaw} />
      )}

      {modoUsaForm(mode) && (
        <TabelaKeyValue
          pares={form}
          arquivos={mode === "multipart"}
          onChange={setForm}
        />
      )}
    </div>
  );
}

// ---- Botao formatar JSON ---------------------------------------------------

function FormatarJsonBotao(props: {
  raw: string;
  onFormatar: (valor: string) => void;
}) {
  const resultado = formatarJson(props.raw);
  const vazio = props.raw.trim().length === 0;
  return (
    <div style={estilos.formatarWrap}>
      <button
        type="button"
        onClick={() => {
          const r = formatarJson(props.raw);
          if (r.ok) props.onFormatar(r.texto);
        }}
        disabled={vazio}
        style={estilos.botaoSec}
      >
        Formatar
      </button>
      {!vazio && !resultado.ok && (
        <span role="alert" style={estilos.jsonErro}>
          JSON invalido: {resultado.erro}
        </span>
      )}
    </div>
  );
}

// ---- Editor de texto cru (CodeMirror) -------------------------------------

function extensoesDe(mode: BodyMode): Extension[] {
  if (mode === "json" || mode === "graphql") return [json()];
  if (mode === "xml") return [xml()];
  return [];
}

function placeholderDe(mode: BodyMode): string {
  switch (mode) {
    case "json":
      return '{\n  "chave": "valor"\n}';
    case "xml":
      return "<root></root>";
    case "graphql":
      return "query {\n  campo\n}";
    default:
      return "";
  }
}

function RawEditor(props: {
  mode: BodyMode;
  value: string;
  onChange: (valor: string) => void;
}) {
  const extensions = useMemo(() => extensoesDe(props.mode), [props.mode]);
  return (
    <div style={estilos.editorWrap}>
      <CodeMirror
        value={props.value}
        onChange={props.onChange}
        extensions={extensions}
        placeholder={placeholderDe(props.mode)}
        theme="dark"
        height="220px"
        basicSetup={{ lineNumbers: true, foldGutter: false }}
        aria-label={`Corpo ${props.mode}`}
      />
    </div>
  );
}

// ---- Tabela key/value (form_urlencoded e multipart) -----------------------

function TabelaKeyValue(props: {
  pares: KeyValue[];
  /** True no modo multipart: cada linha pode anexar um arquivo. */
  arquivos: boolean;
  onChange: (pares: KeyValue[]) => void;
}) {
  const { pares, arquivos, onChange } = props;

  const atualizarLinha = (i: number, patch: Partial<KeyValue>) => {
    const copia = pares.map((p, idx) => (idx === i ? { ...p, ...patch } : p));
    onChange(copia);
  };

  const removerLinha = (i: number) => {
    onChange(pares.filter((_, idx) => idx !== i));
  };

  const adicionarLinha = () => {
    onChange([...pares, novoPar()]);
  };

  return (
    <div style={estilos.tabelaWrap}>
      <table style={estilos.tabela}>
        <thead>
          <tr>
            <th style={estilos.th} />
            <th style={estilos.th}>Chave</th>
            <th style={estilos.th}>Valor</th>
            <th style={estilos.th} />
          </tr>
        </thead>
        <tbody>
          {pares.map((par, i) => (
            <LinhaKeyValue
              key={i}
              par={par}
              arquivos={arquivos}
              onPatch={(patch) => atualizarLinha(i, patch)}
              onRemover={() => removerLinha(i)}
            />
          ))}
        </tbody>
      </table>
      <button type="button" onClick={adicionarLinha} style={estilos.botaoSec}>
        Adicionar campo
      </button>
    </div>
  );
}

function LinhaKeyValue(props: {
  par: KeyValue;
  arquivos: boolean;
  onPatch: (patch: Partial<KeyValue>) => void;
  onRemover: () => void;
}) {
  const { par, arquivos, onPatch, onRemover } = props;
  const inputArquivo = useRef<HTMLInputElement>(null);
  const ehArquivo = arquivos && ehCampoArquivo(par);
  const caminho = caminhoDoCampoArquivo(par);

  const onArquivoEscolhido = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // No Electron/Tauri o File pode expor `path`; senao usa o nome como fallback.
    const caminhoArquivo =
      (file as File & { path?: string }).path ?? file.name;
    onPatch({ value: valueDeArquivo(caminhoArquivo) });
  };

  const alternarArquivo = () => {
    if (ehArquivo) {
      // Volta a ser um campo de texto comum.
      onPatch({ value: "" });
    } else {
      // Marca como arquivo (ainda sem caminho).
      onPatch({ value: valueDeArquivo("") });
    }
  };

  return (
    <tr>
      <td style={estilos.td}>
        <input
          type="checkbox"
          aria-label="Habilitar campo"
          checked={par.enabled}
          onChange={(e) => onPatch({ enabled: e.target.checked })}
        />
      </td>
      <td style={estilos.td}>
        <input
          type="text"
          aria-label="Chave"
          value={par.name}
          placeholder="chave"
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => onPatch({ name: e.target.value })}
          style={estilos.inputCelula}
        />
      </td>
      <td style={estilos.td}>
        {ehArquivo ? (
          <div style={estilos.arquivoCelula}>
            <button
              type="button"
              onClick={() => inputArquivo.current?.click()}
              style={estilos.botaoSec}
            >
              {caminho ? nomeDoArquivo(caminho) : "Escolher arquivo"}
            </button>
            <input
              ref={inputArquivo}
              type="file"
              aria-label="Arquivo"
              onChange={onArquivoEscolhido}
              style={{ display: "none" }}
            />
          </div>
        ) : (
          <input
            type="text"
            aria-label="Valor"
            value={par.value}
            placeholder="valor"
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => onPatch({ value: e.target.value })}
            style={estilos.inputCelula}
          />
        )}
      </td>
      <td style={estilos.td}>
        <div style={estilos.acoes}>
          {arquivos && (
            <button
              type="button"
              onClick={alternarArquivo}
              title={ehArquivo ? "Usar texto" : "Usar arquivo"}
              style={estilos.botaoMini}
            >
              {ehArquivo ? "Texto" : "Arquivo"}
            </button>
          )}
          <button
            type="button"
            onClick={onRemover}
            aria-label="Remover campo"
            title="Remover"
            style={estilos.botaoMini}
          >
            X
          </button>
        </div>
      </td>
    </tr>
  );
}

// ---- Estilos (tema escuro coerente com App.css) ---------------------------

const estilos: Record<string, CSSProperties> = {
  container: {
    display: "flex",
    flexDirection: "column",
    gap: "0.6rem",
    width: "100%",
  },
  barra: {
    display: "flex",
    alignItems: "center",
    gap: "0.6rem",
  },
  label: {
    color: "#9aa0a6",
    fontSize: "0.85rem",
  },
  select: {
    background: "#1e1e1e",
    color: "#e0e0e0",
    border: "1px solid #3a3a3a",
    borderRadius: "4px",
    padding: "0.3rem 0.5rem",
    cursor: "pointer",
  },
  vazio: {
    color: "#9aa0a6",
    fontSize: "0.85rem",
    fontStyle: "italic",
  },
  formatarWrap: {
    display: "flex",
    alignItems: "center",
    gap: "0.6rem",
    marginLeft: "auto",
  },
  jsonErro: {
    color: "#f87171",
    fontSize: "0.8rem",
    fontFamily: "monospace",
  },
  editorWrap: {
    border: "1px solid #3a3a3a",
    borderRadius: "4px",
    overflow: "hidden",
  },
  tabelaWrap: {
    display: "flex",
    flexDirection: "column",
    gap: "0.5rem",
    alignItems: "flex-start",
  },
  tabela: {
    width: "100%",
    borderCollapse: "collapse",
  },
  th: {
    textAlign: "left",
    color: "#9aa0a6",
    fontSize: "0.78rem",
    fontWeight: 600,
    padding: "0.25rem 0.4rem",
    borderBottom: "1px solid #3a3a3a",
  },
  td: {
    padding: "0.2rem 0.4rem",
    verticalAlign: "middle",
  },
  inputCelula: {
    width: "100%",
    background: "#1e1e1e",
    color: "#e0e0e0",
    border: "1px solid #3a3a3a",
    borderRadius: "4px",
    padding: "0.35rem 0.5rem",
    fontFamily: "monospace",
    fontSize: "0.85rem",
  },
  arquivoCelula: {
    display: "flex",
    alignItems: "center",
    gap: "0.4rem",
  },
  acoes: {
    display: "flex",
    gap: "0.3rem",
  },
  botaoSec: {
    background: "#2a2a2a",
    color: "#e0e0e0",
    border: "1px solid #3a3a3a",
    borderRadius: "4px",
    padding: "0.35rem 0.7rem",
    fontSize: "0.82rem",
    cursor: "pointer",
  },
  botaoMini: {
    background: "#2a2a2a",
    color: "#e0e0e0",
    border: "1px solid #3a3a3a",
    borderRadius: "4px",
    padding: "0.25rem 0.5rem",
    fontSize: "0.78rem",
    cursor: "pointer",
  },
};

export default BodyEditor;
