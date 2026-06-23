// F20 — Configuracoes POR-REQUEST: encodeUrl, followRedirects, maxRedirects e
// timeout. Editam `request.settings` (RequestSettings) via `atualizarRequest`
// do requestStore. Campos ausentes => herdam do global na composicao do envio
// (`efetivas(appSettings, request.settings)` em requestStore.enviar).
//
// Componente FINO: a logica de composicao/saneamento vive em `lib/settings.ts`.
// Aqui so projetamos o patch parcial no store. Um campo "herdar" (undefined) e
// distinto de um valor explicito — por isso os toggles tem 3 estados (herdar/
// ligado/desligado) via <select>, nao checkbox.

import { type CSSProperties } from "react";
import { useRequestStore } from "../store/requestStore";
import type { RequestSettings as RequestSettingsT } from "../lib/settings";
import { MAX_REDIRECTS_MAX, MAX_REDIRECTS_MIN } from "../lib/settings";

/** "herdar" => remove o campo (undefined); "true"/"false" => valor explicito. */
function triEstadoValor(v: boolean | undefined): "herdar" | "true" | "false" {
  if (v === undefined) return "herdar";
  return v ? "true" : "false";
}

function triEstadoParaBool(v: string): boolean | undefined {
  if (v === "true") return true;
  if (v === "false") return false;
  return undefined;
}

export function RequestSettings() {
  const settings = useRequestStore((s) => s.request.settings);
  const atualizarRequest = useRequestStore((s) => s.atualizarRequest);

  const s = settings ?? {};

  // Patch parcial nas settings da request. Remove chaves setadas a undefined
  // para manter o objeto enxuto (campo ausente = herdar do global).
  function patch(p: Partial<RequestSettingsT>) {
    const proximo: RequestSettingsT = { ...s, ...p };
    for (const k of Object.keys(proximo) as (keyof RequestSettingsT)[]) {
      if (proximo[k] === undefined) delete proximo[k];
    }
    atualizarRequest({ settings: proximo });
  }

  return (
    <div className="request-settings" style={estilos.container}>
      <p style={estilos.dica}>
        Campos em "herdar" usam a configuracao global. Valores aqui sobrescrevem.
      </p>

      <label style={estilos.campo}>
        <span style={estilos.label}>Encode da URL</span>
        <select
          value={triEstadoValor(s.encodeUrl)}
          onChange={(e) => patch({ encodeUrl: triEstadoParaBool(e.target.value) })}
          style={estilos.input}
          aria-label="Encode automatico da URL"
        >
          <option value="herdar">Herdar</option>
          <option value="true">Ligado</option>
          <option value="false">Desligado</option>
        </select>
      </label>

      <label style={estilos.campo}>
        <span style={estilos.label}>Seguir redirects</span>
        <select
          value={triEstadoValor(s.followRedirects)}
          onChange={(e) =>
            patch({ followRedirects: triEstadoParaBool(e.target.value) })
          }
          style={estilos.input}
          aria-label="Seguir redirects"
        >
          <option value="herdar">Herdar</option>
          <option value="true">Ligado</option>
          <option value="false">Desligado</option>
        </select>
      </label>

      <label style={estilos.campo}>
        <span style={estilos.label}>Max redirects</span>
        <input
          type="number"
          min={MAX_REDIRECTS_MIN}
          max={MAX_REDIRECTS_MAX}
          value={s.maxRedirects ?? ""}
          placeholder="herdar"
          onChange={(e) =>
            patch({
              maxRedirects:
                e.target.value === "" ? undefined : Number(e.target.value),
            })
          }
          style={estilos.input}
          aria-label="Maximo de redirects"
        />
      </label>

      <label style={estilos.campo}>
        <span style={estilos.label}>Timeout (ms)</span>
        <input
          type="number"
          min={0}
          value={s.timeoutMs ?? ""}
          placeholder="herdar"
          onChange={(e) =>
            patch({
              timeoutMs: e.target.value === "" ? undefined : Number(e.target.value),
            })
          }
          style={estilos.input}
          aria-label="Timeout por request em milissegundos"
        />
      </label>
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
  dica: {
    margin: 0,
    fontSize: "0.78rem",
    color: "#9aa0a6",
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
};
