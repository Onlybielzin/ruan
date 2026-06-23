// ResponseViewer (F8): exibe a ResponseData do requestStore de forma util.
// Status + tempo + tamanho no topo; abas Body / Headers / Cookies. No Body ha
// sub-modos pretty / raw / preview (HTML/imagem/PDF) e busca dentro do texto.
// Componente FINO: toda logica de formatacao/deteccao vem de src/lib/response.ts.
// Estilos inline (tema escuro), coerente com RequestBuilder; a Integracao pode
// migrar para classes .app-* se quiser.

import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { json } from "@codemirror/lang-json";
import { xml } from "@codemirror/lang-xml";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { useRequestStore } from "../store/requestStore";
import type { ContentKind } from "../lib/response";
import {
  classeDeStatus,
  contarOcorrencias,
  contentTypeDeResposta,
  corDeStatus,
  detectarTipoConteudo,
  ehBinario,
  extrairCookies,
  formatarTamanho,
  formatarTempo,
  mimeBase,
  prettyJson,
} from "../lib/response";

type Aba = "body" | "headers" | "cookies";
type ModoBody = "pretty" | "raw" | "preview";

export function ResponseViewer() {
  const response = useRequestStore((s) => s.response);
  const loading = useRequestStore((s) => s.loading);

  const [aba, setAba] = useState<Aba>("body");
  const [modo, setModo] = useState<ModoBody>("pretty");
  const [busca, setBusca] = useState("");

  if (loading && response === null) {
    return (
      <div className="response-viewer" style={estilos.vazio}>
        Enviando...
      </div>
    );
  }

  if (response === null) {
    return (
      <div className="response-viewer" style={estilos.vazio}>
        Nenhuma resposta ainda. Envie uma request para ver o resultado.
      </div>
    );
  }

  const contentType = contentTypeDeResposta(response);
  const kind = detectarTipoConteudo(contentType);
  const cookies = extrairCookies(response.headers);

  return (
    <div className="response-viewer" style={estilos.container}>
      <BarraStatus
        status={response.status}
        statusText={response.statusText}
        timeMs={response.timeMs}
        sizeBytes={response.sizeBytes}
      />

      <div className="response-abas" style={estilos.abas} role="tablist">
        <BotaoAba ativo={aba === "body"} onClick={() => setAba("body")}>
          Body
        </BotaoAba>
        <BotaoAba ativo={aba === "headers"} onClick={() => setAba("headers")}>
          Headers ({response.headers.length})
        </BotaoAba>
        <BotaoAba ativo={aba === "cookies"} onClick={() => setAba("cookies")}>
          Cookies ({cookies.length})
        </BotaoAba>
      </div>

      <div className="response-conteudo" style={estilos.conteudo}>
        {aba === "body" && (
          <BodyView
            body={response.body}
            kind={kind}
            contentType={contentType}
            truncadoLossy={response.bodyTruncatedLossy}
            modo={modo}
            setModo={setModo}
            busca={busca}
            setBusca={setBusca}
          />
        )}
        {aba === "headers" && <TabelaKV itens={response.headers} vazio="Sem headers." />}
        {aba === "cookies" && <CookiesView cookies={cookies} />}
      </div>
    </div>
  );
}

function BarraStatus(props: {
  status: number;
  statusText: string;
  timeMs: number;
  sizeBytes: number;
}) {
  const cor = corDeStatus(props.status);
  const classe = classeDeStatus(props.status);
  return (
    <div className="response-status" style={estilos.barraStatus}>
      <span
        style={{ ...estilos.statusBadge, color: cor, borderColor: cor }}
        title={`Faixa ${classe}`}
      >
        {props.status} {props.statusText}
      </span>
      <span style={estilos.metrica} title="Tempo de resposta">
        {formatarTempo(props.timeMs)}
      </span>
      <span style={estilos.metrica} title="Tamanho do corpo">
        {formatarTamanho(props.sizeBytes)}
      </span>
    </div>
  );
}

function BodyView(props: {
  body: string;
  kind: ContentKind;
  contentType: string | undefined;
  truncadoLossy: boolean;
  modo: ModoBody;
  setModo: (m: ModoBody) => void;
  busca: string;
  setBusca: (s: string) => void;
}) {
  const { body, kind, modo, setModo, busca, setBusca } = props;

  // Pretty so faz sentido para JSON; demais textos caem no raw.
  const pretty = useMemo(() => {
    if (kind === "json") return prettyJson(body);
    return { ok: false, texto: body };
  }, [body, kind]);

  const podePreview = kind === "html" || ehBinario(kind);
  const textoExibido = modo === "pretty" && pretty.ok ? pretty.texto : body;
  const ocorrencias =
    busca.length > 0 ? contarOcorrencias(textoExibido, busca) : 0;

  return (
    <div style={estilos.bodyWrap}>
      <div style={estilos.bodyToolbar}>
        <BotaoModo ativo={modo === "pretty"} onClick={() => setModo("pretty")}>
          Pretty
        </BotaoModo>
        <BotaoModo ativo={modo === "raw"} onClick={() => setModo("raw")}>
          Raw
        </BotaoModo>
        {podePreview && (
          <BotaoModo
            ativo={modo === "preview"}
            onClick={() => setModo("preview")}
          >
            Preview
          </BotaoModo>
        )}
        <div style={estilos.buscaWrap}>
          <input
            type="search"
            aria-label="Buscar no corpo"
            placeholder="Buscar..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            spellCheck={false}
            style={estilos.buscaInput}
          />
          {busca.length > 0 && (
            <span style={estilos.buscaInfo}>{ocorrencias} ocorrencia(s)</span>
          )}
        </div>
      </div>

      {modo === "preview" ? (
        <PreviewBinario
          body={body}
          kind={kind}
          contentType={props.contentType}
          truncadoLossy={props.truncadoLossy}
        />
      ) : (
        <EditorTexto texto={textoExibido} kind={kind} busca={busca} />
      )}
    </div>
  );
}

/** Editor read-only com syntax highlight por content-type + resaltar busca. */
function EditorTexto(props: { texto: string; kind: ContentKind; busca: string }) {
  const extensoes = useMemo<Extension[]>(() => {
    const base: Extension[] = [EditorView.lineWrapping, EditorView.editable.of(false)];
    const lang = extensaoLinguagem(props.kind);
    if (lang) base.push(lang);
    return base;
  }, [props.kind]);

  if (props.texto.length === 0) {
    return <div style={estilos.vazioInterno}>Corpo vazio.</div>;
  }

  return (
    <CodeMirror
      value={props.texto}
      extensions={extensoes}
      editable={false}
      readOnly
      theme="dark"
      basicSetup={{
        lineNumbers: true,
        highlightActiveLine: false,
        foldGutter: true,
        searchKeymap: true,
      }}
      style={estilos.editor}
    />
  );
}

/** Renderiza imagem/PDF/HTML como preview. Para binario depende de data URI. */
function PreviewBinario(props: {
  body: string;
  kind: ContentKind;
  contentType: string | undefined;
  truncadoLossy: boolean;
}) {
  if (props.kind === "html") {
    return (
      <iframe
        title="Preview HTML"
        sandbox=""
        srcDoc={props.body}
        style={estilos.iframe}
      />
    );
  }

  // Imagem/PDF: o body chega como string. Se foi decodificado lossy nao da pra
  // reconstruir os bytes; avisamos. Caso o body ja seja um data URI, usamos.
  if (props.truncadoLossy && !props.body.startsWith("data:")) {
    return (
      <div style={estilos.vazioInterno}>
        Conteudo binario ({mimeBase(props.contentType) || props.kind}) nao pode
        ser pre-visualizado: o corpo foi recebido como texto e os bytes
        originais nao estao disponiveis.
      </div>
    );
  }

  const src = props.body.startsWith("data:")
    ? props.body
    : `data:${mimeBase(props.contentType) || "application/octet-stream"};base64,${props.body}`;

  if (props.kind === "image") {
    return <img src={src} alt="Preview da resposta" style={estilos.img} />;
  }
  if (props.kind === "pdf") {
    return <iframe title="Preview PDF" src={src} style={estilos.iframe} />;
  }
  return (
    <div style={estilos.vazioInterno}>
      Conteudo binario ({mimeBase(props.contentType) || "desconhecido"}) sem
      preview disponivel.
    </div>
  );
}

function CookiesView(props: {
  cookies: ReturnType<typeof extrairCookies>;
}) {
  if (props.cookies.length === 0) {
    return <div style={estilos.vazioInterno}>Nenhum cookie nesta resposta.</div>;
  }
  return (
    <table style={estilos.tabela}>
      <thead>
        <tr>
          <th style={estilos.th}>Nome</th>
          <th style={estilos.th}>Valor</th>
          <th style={estilos.th}>Atributos</th>
        </tr>
      </thead>
      <tbody>
        {props.cookies.map((c, i) => (
          <tr key={`${c.name}-${i}`}>
            <td style={estilos.tdNome}>{c.name}</td>
            <td style={estilos.td}>{c.value}</td>
            <td style={estilos.td}>
              {c.attributes
                .map((a) => (a.value ? `${a.name}=${a.value}` : a.name))
                .join("; ")}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TabelaKV(props: {
  itens: { name: string; value: string }[];
  vazio: string;
}) {
  if (props.itens.length === 0) {
    return <div style={estilos.vazioInterno}>{props.vazio}</div>;
  }
  return (
    <table style={estilos.tabela}>
      <thead>
        <tr>
          <th style={estilos.th}>Nome</th>
          <th style={estilos.th}>Valor</th>
        </tr>
      </thead>
      <tbody>
        {props.itens.map((kv, i) => (
          <tr key={`${kv.name}-${i}`}>
            <td style={estilos.tdNome}>{kv.name}</td>
            <td style={estilos.td}>{kv.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function BotaoAba(props: {
  ativo: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={props.ativo}
      onClick={props.onClick}
      style={{ ...estilos.botaoAba, ...(props.ativo ? estilos.abaAtiva : {}) }}
    >
      {props.children}
    </button>
  );
}

function BotaoModo(props: {
  ativo: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={props.ativo}
      onClick={props.onClick}
      style={{ ...estilos.botaoModo, ...(props.ativo ? estilos.modoAtivo : {}) }}
    >
      {props.children}
    </button>
  );
}

/** Mapeia ContentKind -> extensao de linguagem do CodeMirror (ou null). */
function extensaoLinguagem(kind: ContentKind): Extension | null {
  switch (kind) {
    case "json":
      return json();
    case "xml":
      return xml();
    case "html":
      return html();
    default:
      return null;
  }
}

// HTML e marcacao similar a XML; reusamos lang-xml para highlight basico de HTML
// (evita uma dependencia extra de lang-html, que nao esta no package.json).
function html(): Extension {
  return xml();
}

const estilos: Record<string, CSSProperties> = {
  container: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    minHeight: 0,
    gap: "0.5rem",
  },
  vazio: {
    color: "#9ca3af",
    fontStyle: "italic",
    padding: "1rem",
    fontSize: "0.9rem",
  },
  vazioInterno: {
    color: "#9ca3af",
    fontStyle: "italic",
    padding: "0.75rem",
    fontSize: "0.85rem",
  },
  barraStatus: {
    display: "flex",
    alignItems: "center",
    gap: "1rem",
    padding: "0.4rem 0.2rem",
    borderBottom: "1px solid #2a2a2a",
  },
  statusBadge: {
    fontWeight: 700,
    fontFamily: "monospace",
    border: "1px solid",
    borderRadius: "4px",
    padding: "0.15rem 0.5rem",
    fontSize: "0.85rem",
  },
  metrica: {
    color: "#cbd5e1",
    fontFamily: "monospace",
    fontSize: "0.85rem",
  },
  abas: {
    display: "flex",
    gap: "0.25rem",
    borderBottom: "1px solid #2a2a2a",
  },
  botaoAba: {
    background: "transparent",
    color: "#9ca3af",
    border: "none",
    borderBottom: "2px solid transparent",
    padding: "0.4rem 0.8rem",
    cursor: "pointer",
    fontSize: "0.85rem",
  },
  abaAtiva: {
    color: "#e0e0e0",
    borderBottom: "2px solid #3b82f6",
    fontWeight: 600,
  },
  conteudo: {
    flex: 1,
    minHeight: 0,
    overflow: "auto",
  },
  bodyWrap: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    minHeight: 0,
    gap: "0.5rem",
  },
  bodyToolbar: {
    display: "flex",
    alignItems: "center",
    gap: "0.4rem",
  },
  botaoModo: {
    background: "#1e1e1e",
    color: "#cbd5e1",
    border: "1px solid #3a3a3a",
    borderRadius: "4px",
    padding: "0.25rem 0.6rem",
    cursor: "pointer",
    fontSize: "0.8rem",
  },
  modoAtivo: {
    background: "#3b82f6",
    color: "#fff",
    borderColor: "#3b82f6",
    fontWeight: 600,
  },
  buscaWrap: {
    marginLeft: "auto",
    display: "flex",
    alignItems: "center",
    gap: "0.4rem",
  },
  buscaInput: {
    background: "#1e1e1e",
    color: "#e0e0e0",
    border: "1px solid #3a3a3a",
    borderRadius: "4px",
    padding: "0.25rem 0.5rem",
    fontFamily: "monospace",
    fontSize: "0.8rem",
  },
  buscaInfo: {
    color: "#9ca3af",
    fontSize: "0.75rem",
    whiteSpace: "nowrap",
  },
  editor: {
    fontSize: "0.85rem",
    height: "100%",
  },
  iframe: {
    width: "100%",
    height: "100%",
    minHeight: "300px",
    border: "1px solid #2a2a2a",
    borderRadius: "4px",
    background: "#fff",
  },
  img: {
    maxWidth: "100%",
    maxHeight: "100%",
    objectFit: "contain",
  },
  tabela: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: "0.82rem",
    fontFamily: "monospace",
  },
  th: {
    textAlign: "left",
    color: "#9ca3af",
    fontWeight: 600,
    padding: "0.3rem 0.5rem",
    borderBottom: "1px solid #2a2a2a",
    position: "sticky",
    top: 0,
    background: "#161616",
  },
  td: {
    color: "#e0e0e0",
    padding: "0.3rem 0.5rem",
    borderBottom: "1px solid #222",
    verticalAlign: "top",
    wordBreak: "break-all",
  },
  tdNome: {
    color: "#93c5fd",
    padding: "0.3rem 0.5rem",
    borderBottom: "1px solid #222",
    verticalAlign: "top",
    whiteSpace: "nowrap",
  },
};

export default ResponseViewer;
