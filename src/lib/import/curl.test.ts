// Testes da logica PURA de src/lib/import/curl.ts (F17).
import { describe, it, expect } from "vitest";
import {
  parseCurl,
  tokenizarShell,
  dividirHeader,
  paramsDaUrl,
  decodificarComponente,
  formDeUrlencoded,
  nomeDeUrl,
} from "./curl";
import { isRequest } from "../types";

function unicoRequest(comando: string) {
  const r = parseCurl(comando);
  if (!r.ok) throw new Error(`esperava ok, veio: ${r.error}`);
  const item = r.collection.items[0];
  if (!item || !isRequest(item)) throw new Error("esperava request");
  return item;
}

describe("tokenizarShell", () => {
  it("separa por espacos", () => {
    expect(tokenizarShell("curl http://x")).toEqual(["curl", "http://x"]);
  });
  it("respeita aspas duplas", () => {
    expect(tokenizarShell('-H "A: B C"')).toEqual(["-H", "A: B C"]);
  });
  it("respeita aspas simples", () => {
    expect(tokenizarShell("-d 'a=1&b=2'")).toEqual(["-d", "a=1&b=2"]);
  });
  it("junta continuacao de linha com barra", () => {
    expect(tokenizarShell("curl \\\n  http://x")).toEqual(["curl", "http://x"]);
  });
  it("escapa char dentro de aspas duplas", () => {
    expect(tokenizarShell('"a\\"b"')).toEqual(['a"b']);
  });
  it("string vazia da lista vazia", () => {
    expect(tokenizarShell("")).toEqual([]);
  });
  it("aspas vazias produzem token vazio", () => {
    expect(tokenizarShell("-d ''")).toEqual(["-d", ""]);
  });
});

describe("dividirHeader", () => {
  it("divide em chave e valor no primeiro :", () => {
    expect(dividirHeader("Authorization: Bearer x:y")).toEqual({
      name: "Authorization",
      value: "Bearer x:y",
      enabled: true,
    });
  });
  it("sem : vira nome com valor vazio", () => {
    expect(dividirHeader("X-Flag")).toEqual({
      name: "X-Flag",
      value: "",
      enabled: true,
    });
  });
  it("nome vazio retorna null", () => {
    expect(dividirHeader(":x")).toBeNull();
    expect(dividirHeader("   ")).toBeNull();
  });
});

describe("paramsDaUrl", () => {
  it("sem query devolve base e lista vazia", () => {
    expect(paramsDaUrl("http://x/y")).toEqual({
      base: "http://x/y",
      params: [],
    });
  });
  it("extrai pares da query", () => {
    const r = paramsDaUrl("http://x?a=1&b=2");
    expect(r.base).toBe("http://x");
    expect(r.params).toEqual([
      { name: "a", value: "1", enabled: true },
      { name: "b", value: "2", enabled: true },
    ]);
  });
  it("decodifica valores e ignora fragmento", () => {
    const r = paramsDaUrl("http://x?q=a%20b#frag");
    expect(r.params[0]).toEqual({ name: "q", value: "a b", enabled: true });
  });
  it("param sem valor", () => {
    const r = paramsDaUrl("http://x?flag");
    expect(r.params).toEqual([{ name: "flag", value: "", enabled: true }]);
  });
});

describe("decodificarComponente", () => {
  it("decodifica + como espaco", () => {
    expect(decodificarComponente("a+b")).toBe("a b");
  });
  it("tolera entrada malformada", () => {
    expect(decodificarComponente("%zz")).toBe("%zz");
  });
});

describe("formDeUrlencoded", () => {
  it("quebra em pares decodificados", () => {
    expect(formDeUrlencoded("a=1&b=hello+world")).toEqual([
      { name: "a", value: "1", enabled: true },
      { name: "b", value: "hello world", enabled: true },
    ]);
  });
});

describe("nomeDeUrl", () => {
  it("usa pathname para URL absoluta", () => {
    expect(nomeDeUrl("http://x/api/users", "GET")).toBe("GET /api/users");
  });
  it("usa host quando path e raiz", () => {
    expect(nomeDeUrl("http://example.com/", "POST")).toBe("POST example.com");
  });
  it("tolera URL com variavel", () => {
    expect(nomeDeUrl("{{base}}/users?x=1", "GET")).toBe("GET {{base}}/users");
  });
});

describe("parseCurl", () => {
  it("erro em comando vazio", () => {
    expect(parseCurl("")).toEqual({ ok: false, error: "Comando cURL vazio." });
    expect(parseCurl("   ").ok).toBe(false);
  });
  it("erro quando nao ha URL", () => {
    const r = parseCurl("curl -X POST -H 'A: B'");
    expect(r.ok).toBe(false);
  });

  it("GET simples", () => {
    const req = unicoRequest("curl http://api/x");
    expect(req.method).toBe("GET");
    expect(req.url).toBe("http://api/x");
  });

  it("aceita comando sem prefixo curl", () => {
    const req = unicoRequest("http://api/x");
    expect(req.url).toBe("http://api/x");
  });

  it("metodo explicito com -X", () => {
    const req = unicoRequest("curl -X delete http://api/x");
    expect(req.method).toBe("DELETE");
  });

  it("data implica POST", () => {
    const req = unicoRequest("curl http://api/x -d 'a=1&b=2'");
    expect(req.method).toBe("POST");
    expect(req.body.mode).toBe("form_urlencoded");
    expect(req.body.form).toEqual([
      { name: "a", value: "1", enabled: true },
      { name: "b", value: "2", enabled: true },
    ]);
  });

  it("data JSON com content-type vira body json", () => {
    const req = unicoRequest(
      `curl http://api/x -H "Content-Type: application/json" -d '{"a":1}'`,
    );
    expect(req.method).toBe("POST");
    expect(req.body.mode).toBe("json");
    expect(req.body.raw).toBe('{"a":1}');
  });

  it("detecta JSON pelo formato mesmo sem content-type", () => {
    const req = unicoRequest(`curl http://api/x -d '{"a":1}'`);
    expect(req.body.mode).toBe("json");
  });

  it("headers viram KeyValue", () => {
    const req = unicoRequest(
      `curl http://api/x -H "Authorization: Bearer tok" -H "X-Y: z"`,
    );
    expect(req.headers).toEqual([
      { name: "Authorization", value: "Bearer tok", enabled: true },
      { name: "X-Y", value: "z", enabled: true },
    ]);
  });

  it("querystring na URL vira params", () => {
    const req = unicoRequest("curl 'http://api/x?a=1&b=2'");
    expect(req.url).toBe("http://api/x");
    expect(req.params).toEqual([
      { name: "a", value: "1", enabled: true },
      { name: "b", value: "2", enabled: true },
    ]);
  });

  it("-u monta basic auth", () => {
    const req = unicoRequest("curl http://api/x -u user:pass");
    expect(req.auth).toEqual({
      mode: "basic",
      username: "user",
      password: "pass",
    });
  });

  it("-u sem senha", () => {
    const req = unicoRequest("curl http://api/x -u user");
    expect(req.auth.mode).toBe("basic");
    expect(req.auth.username).toBe("user");
    expect(req.auth.password).toBe("");
  });

  it("-G manda data como query, sem body", () => {
    const req = unicoRequest("curl -G http://api/x -d a=1 -d b=2");
    expect(req.method).toBe("GET");
    expect(req.body.mode).toBe("none");
    expect(req.params).toEqual([
      { name: "a", value: "1", enabled: true },
      { name: "b", value: "2", enabled: true },
    ]);
  });

  it("--url explicito", () => {
    const req = unicoRequest("curl --url http://api/x -X PUT");
    expect(req.url).toBe("http://api/x");
    expect(req.method).toBe("PUT");
  });

  it("--header=valor (forma colada)", () => {
    const req = unicoRequest("curl http://api/x --header=A:B");
    expect(req.headers[0]).toEqual({ name: "A", value: "B", enabled: true });
  });

  it("ignora flags sem arg (--compressed, -L, -k)", () => {
    const req = unicoRequest("curl --compressed -L -k http://api/x");
    expect(req.url).toBe("http://api/x");
  });

  it("consome arg de -o sem virar URL", () => {
    const req = unicoRequest("curl -o out.txt http://api/x");
    expect(req.url).toBe("http://api/x");
  });

  it("cookies viram header Cookie", () => {
    const req = unicoRequest("curl http://api/x -b 'a=1' -b 'b=2'");
    const cookie = req.headers.find((h) => h.name === "Cookie");
    expect(cookie?.value).toBe("a=1; b=2");
  });

  it("-A define User-Agent", () => {
    const req = unicoRequest("curl http://api/x -A 'meu-agent'");
    expect(req.headers.find((h) => h.name === "User-Agent")?.value).toBe(
      "meu-agent",
    );
  });

  it("--data-urlencode com varios junta com &", () => {
    const req = unicoRequest(
      "curl http://api/x --data-urlencode a=1 --data-urlencode b=2",
    );
    expect(req.body.mode).toBe("form_urlencoded");
  });

  it("nome da colecao deriva da request", () => {
    const r = parseCurl("curl http://api/users");
    expect(r.ok && r.collection.name).toBe("GET /users");
  });

  it("metodo explicito vence a inferencia por corpo", () => {
    // tem -d (inferiria POST) mas -X PUT manda.
    const req = unicoRequest("curl -X PUT http://api/x -d 'a=1'");
    expect(req.method).toBe("PUT");
  });

  it("um unico -d cru NAO e juntado com & (sem concatenacao)", () => {
    // valor unico texto puro -> body text, raw == valor exato.
    const req = unicoRequest(`curl http://api/x -d 'linha unica'`);
    expect(req.body.mode).toBe("text");
    expect(req.body.raw).toBe("linha unica");
  });

  it("varios -d sao juntados com &", () => {
    const req = unicoRequest("curl http://api/x -d a=1 -d b=2");
    expect(req.body.mode).toBe("form_urlencoded");
    expect(req.body.form).toEqual([
      { name: "a", value: "1", enabled: true },
      { name: "b", value: "2", enabled: true },
    ]);
  });

  it("--data-binary entra como corpo", () => {
    const req = unicoRequest(`curl http://api/x --data-binary 'corpo'`);
    expect(req.method).toBe("POST");
    expect(req.body.raw).toBe("corpo");
  });

  it("--json forca body json mesmo sem content-type", () => {
    const req = unicoRequest(`curl http://api/x --json '{"a":1}'`);
    expect(req.body.mode).toBe("json");
    expect(req.method).toBe("POST");
  });

  it("-G com url que ja tem ? usa & como separador", () => {
    const req = unicoRequest("curl -G 'http://api/x?z=0' -d a=1");
    expect(req.method).toBe("GET");
    expect(req.params).toEqual([
      { name: "z", value: "0", enabled: true },
      { name: "a", value: "1", enabled: true },
    ]);
    expect(req.body.mode).toBe("none");
  });

  it("nao duplica Cookie se ja houver header Cookie", () => {
    const req = unicoRequest(
      "curl http://api/x -H 'Cookie: existente=1' -b 'novo=2'",
    );
    const cookies = req.headers.filter((h) => h.name.toLowerCase() === "cookie");
    expect(cookies).toHaveLength(1);
    expect(cookies[0].value).toBe("existente=1");
  });

  it("content-type xml escolhe body xml", () => {
    const req = unicoRequest(
      `curl http://api/x -H 'Content-Type: application/xml' -d '<a/>'`,
    );
    expect(req.body.mode).toBe("xml");
  });

  it("sem corpo e sem -X o metodo e GET", () => {
    const req = unicoRequest("curl http://api/x");
    expect(req.method).toBe("GET");
    expect(req.body.mode).toBe("none");
  });

  it("-e define Referer", () => {
    const req = unicoRequest("curl http://api/x -e 'http://ref'");
    expect(req.headers.find((h) => h.name === "Referer")?.value).toBe(
      "http://ref",
    );
  });
});

describe("tokenizarShell — continuacao CRLF", () => {
  it("junta linha terminada em barra + CRLF", () => {
    expect(tokenizarShell("curl \\\r\n  http://x")).toEqual(["curl", "http://x"]);
  });
});
