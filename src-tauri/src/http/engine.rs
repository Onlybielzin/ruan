// Engine de envio HTTP (F4). Monta uma reqwest::Request a partir do RequestData
// e dispara, devolvendo ResponseData. Sem panic: toda falha vira HttpError.
//
// Logica PURA testavel (montagem de URL com params, content-type default por
// modo de body) vive em funcoes livres aqui; o disparo async fica em `send`.

use std::sync::Arc;
use std::time::{Duration, Instant};

use percent_encoding::{utf8_percent_encode, AsciiSet, NON_ALPHANUMERIC};
use reqwest::cookie::Jar;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue, CONTENT_TYPE};
use reqwest::redirect::Policy;
use reqwest::{Client, Method, Proxy, Url};

use crate::http::types::{
    HttpError, KeyVal, RequestBody, RequestData, RequestSettings, ResponseData,
};

// Conjunto de caracteres a NAO escapar em application/x-www-form-urlencoded.
// Espaco vira '+' (tratado a parte). Mantemos os "safe" do formato: -_.*
const FORM_SAFE: &AsciiSet = &NON_ALPHANUMERIC
    .remove(b'-')
    .remove(b'_')
    .remove(b'.')
    .remove(b'*');

/// Codifica um valor para form_urlencoded (espaco -> '+', resto percent-encoded).
/// LOGICA PURA.
pub fn form_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for ch in s.chars() {
        if ch == ' ' {
            out.push('+');
        } else {
            let mut buf = [0u8; 4];
            let encoded = ch.encode_utf8(&mut buf);
            out.push_str(&utf8_percent_encode(encoded, FORM_SAFE).to_string());
        }
    }
    out
}

/// Timeout padrao quando o RequestData nao especifica um.
pub const DEFAULT_TIMEOUT_MS: u64 = 30_000;

/// Resolve o timeout efetivo em ms a partir do RequestData (F20). Precedencia:
///   settings.timeout_ms  >  timeout_ms (campo legado)  >  DEFAULT_TIMEOUT_MS.
/// LOGICA PURA.
pub fn resolver_timeout_ms(req: &RequestData) -> u64 {
    req.settings
        .as_ref()
        .and_then(|s| s.timeout_ms)
        .or(req.timeout_ms)
        .unwrap_or(DEFAULT_TIMEOUT_MS)
}

/// Resolve a politica de redirect (F20) a partir das settings opcionais. LOGICA
/// PURA (so monta a Policy do reqwest, sem I/O).
///   None / follow_redirects ausente => default (segue, ate 10 — comportamento legado).
///   follow_redirects = false         => Policy::none() (nao segue 3xx).
///   follow_redirects = true          => limited(max_redirects) ou default se ausente.
pub fn resolver_redirect_policy(settings: Option<&RequestSettings>) -> Policy {
    match settings.and_then(|s| s.follow_redirects) {
        Some(false) => Policy::none(),
        Some(true) => match settings.and_then(|s| s.max_redirects) {
            Some(n) => Policy::limited(n as usize),
            None => Policy::default(),
        },
        None => Policy::default(),
    }
}

/// True se a engine deve aceitar certificados invalidos (SSL verify OFF). LOGICA
/// PURA. So quando `ssl_verify == Some(false)`; ausente/Some(true) => verifica.
pub fn aceitar_cert_invalido(settings: Option<&RequestSettings>) -> bool {
    matches!(settings.and_then(|s| s.ssl_verify), Some(false))
}

/// Extrai a URL de proxy utilizavel das settings (trim, ignora vazio). LOGICA
/// PURA. None => sem proxy.
pub fn proxy_url(settings: Option<&RequestSettings>) -> Option<String> {
    let raw = settings.and_then(|s| s.proxy.as_deref())?;
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

/// Monta a URL final aplicando os query params habilitados por cima da URL base.
/// LOGICA PURA: nao toca a rede. Preserva params que ja venham na URL string e
/// concatena os de `params` (so os enabled). Retorna InvalidUrl se a base nao
/// parsear.
///
/// Deduplicacao (Integracao F4+F5): o editor de params (F5) escreve a query
/// JUNTO na string da URL E mantem o array `params` em paralelo. Para nao
/// duplicar (`?a=1&a=1`), nao reanexamos um par `name=value` que JA esta
/// presente, identico, na query da base. Pares diferentes (mesmo nome, valor
/// novo) e pares repetidos vindos so do array (base sem query) continuam sendo
/// adicionados normalmente.
pub fn montar_url(base: &str, params: &[KeyVal]) -> Result<Url, HttpError> {
    let base = base.trim();
    if base.is_empty() {
        return Err(HttpError::InvalidUrl("URL vazia".to_string()));
    }
    let mut url = Url::parse(base).map_err(|e| HttpError::InvalidUrl(e.to_string()))?;
    // So aceitamos http/https — evita file://, data:, etc.
    match url.scheme() {
        "http" | "https" => {}
        outro => {
            return Err(HttpError::InvalidUrl(format!(
                "scheme nao suportado: {outro}"
            )))
        }
    }
    // Pares (name,value) ja presentes na query da base — usados para evitar
    // duplicacao quando o array `params` repete o que a URL ja carrega.
    let existentes: Vec<(String, String)> = url
        .query_pairs()
        .map(|(k, v)| (k.into_owned(), v.into_owned()))
        .collect();
    {
        let mut qp = url.query_pairs_mut();
        for p in params {
            if p.enabled
                && !p.name.is_empty()
                && !existentes
                    .iter()
                    .any(|(k, v)| k == &p.name && v == &p.value)
            {
                qp.append_pair(&p.name, &p.value);
            }
        }
    }
    // Limpa "?" pendurado caso nenhum par tenha sido adicionado e a base nao
    // tivesse query — query_pairs_mut pode deixar string vazia.
    if url.query() == Some("") {
        url.set_query(None);
    }
    Ok(url)
}

/// Resolve o Method HTTP a partir da string (case-insensitive). LOGICA PURA.
pub fn resolver_method(method: &str) -> Result<Method, HttpError> {
    let m = method.trim().to_uppercase();
    if m.is_empty() {
        return Ok(Method::GET);
    }
    Method::from_bytes(m.as_bytes()).map_err(|_| HttpError::InvalidMethod(method.to_string()))
}

/// Content-Type default para um modo de body, quando o usuario nao definiu um
/// header Content-Type explicito. LOGICA PURA. Retorna None pros modos que nao
/// carregam corpo ou que nao tem default obvio.
pub fn content_type_default(mode: &str) -> Option<&'static str> {
    match mode {
        "json" | "graphql" => Some("application/json"),
        "text" => Some("text/plain"),
        "xml" => Some("application/xml"),
        "form_urlencoded" => Some("application/x-www-form-urlencoded"),
        _ => None,
    }
}

/// True se a lista de headers ja contem (case-insensitive) o header `name`.
/// LOGICA PURA.
pub fn tem_header(headers: &[KeyVal], name: &str) -> bool {
    headers
        .iter()
        .any(|h| h.enabled && h.name.eq_ignore_ascii_case(name))
}

/// Monta o HeaderMap a partir dos pares habilitados. LOGICA (sem rede), mas
/// retorna InvalidHeader pra nome/valor invalidos.
pub fn montar_headers(headers: &[KeyVal]) -> Result<HeaderMap, HttpError> {
    let mut map = HeaderMap::new();
    for h in headers {
        if !h.enabled || h.name.is_empty() {
            continue;
        }
        let name = HeaderName::from_bytes(h.name.as_bytes())
            .map_err(|_| HttpError::InvalidHeader(h.name.clone()))?;
        let value = HeaderValue::from_str(&h.value)
            .map_err(|_| HttpError::InvalidHeader(h.name.clone()))?;
        map.append(name, value);
    }
    Ok(map)
}

/// Resultado da montagem do corpo: bytes opcionais + content-type a aplicar se
/// nao houver um header explicito.
struct CorpoMontado {
    bytes: Option<Vec<u8>>,
    content_type: Option<&'static str>,
}

/// Monta o corpo conforme o modo. LOGICA PURA. Para form_urlencoded, serializa
/// os pares habilitados. Para raw (json/text/xml/graphql), usa o texto cru.
fn montar_corpo(body: &RequestBody) -> CorpoMontado {
    match body.mode.as_str() {
        "form_urlencoded" => {
            let encoded = body
                .form
                .iter()
                .filter(|p| p.enabled && !p.name.is_empty())
                .map(|p| format!("{}={}", form_encode(&p.name), form_encode(&p.value)))
                .collect::<Vec<_>>()
                .join("&");
            CorpoMontado {
                bytes: Some(encoded.into_bytes()),
                content_type: content_type_default("form_urlencoded"),
            }
        }
        "none" | "" => CorpoMontado {
            bytes: None,
            content_type: None,
        },
        modo => {
            // json/text/xml/graphql (e qualquer outro): manda o raw como esta.
            let raw = body.raw.clone().unwrap_or_default();
            if raw.is_empty() {
                CorpoMontado {
                    bytes: None,
                    content_type: content_type_default(modo),
                }
            } else {
                CorpoMontado {
                    bytes: Some(raw.into_bytes()),
                    content_type: content_type_default(modo),
                }
            }
        }
    }
}

/// Dispara a request e devolve a resposta estruturada. ASYNC, faz I/O de rede.
/// Nunca paniqueia: erros de rede/timeout/URL viram HttpError.
///
/// Compat F4: assinatura original (sem cookie jar). Delega para `send_com_jar`
/// com `None` — cada envio cria um Client sem cookie store compartilhado.
pub async fn send(req: RequestData) -> Result<ResponseData, HttpError> {
    send_com_jar(req, None).await
}

/// Igual a `send`, mas opcionalmente injeta um cookie jar compartilhado (F14).
/// Quando `jar` e `Some`, o Client reusa esse store: Set-Cookie das respostas
/// passa a ser reenviado nas proximas requests do mesmo dominio. `None` mantem
/// o comportamento sem sessao (compat F4). ASYNC, faz I/O de rede; sem panic.
pub async fn send_com_jar(
    req: RequestData,
    jar: Option<Arc<Jar>>,
) -> Result<ResponseData, HttpError> {
    let method = resolver_method(&req.method)?;
    let url = montar_url(&req.url, &req.params)?;
    let mut headers = montar_headers(&req.headers)?;

    let corpo = montar_corpo(&req.body);
    // So aplica content-type default se o usuario nao definiu um explicito.
    if let Some(ct) = corpo.content_type {
        if !tem_header(&req.headers, "content-type") {
            if let Ok(value) = HeaderValue::from_str(ct) {
                headers.insert(CONTENT_TYPE, value);
            }
        }
    }

    // F20: timeout/redirect/proxy/SSL efetivos vem de req.settings (composto no
    // front). Sem settings => comportamento legado (default).
    let settings = req.settings.as_ref();
    let timeout = Duration::from_millis(resolver_timeout_ms(&req));

    let mut builder = Client::builder()
        .timeout(timeout)
        .redirect(resolver_redirect_policy(settings));
    // SSL verify OFF: aceita certificados invalidos (so quando explicitado).
    if aceitar_cert_invalido(settings) {
        builder = builder.danger_accept_invalid_certs(true);
    }
    // Proxy (F20): aplica quando ha URL utilizavel; URL invalida vira Build error.
    if let Some(p) = proxy_url(settings) {
        let proxy = Proxy::all(&p).map_err(|e| HttpError::Build(e.to_string()))?;
        builder = builder.proxy(proxy);
    }
    // F14: cookie store compartilhado quando o jar esta presente (toggle ON).
    if let Some(jar) = jar {
        builder = builder.cookie_provider(jar);
    }
    let client = builder
        .build()
        .map_err(|e| HttpError::Build(e.to_string()))?;

    let mut builder = client.request(method, url).headers(headers);
    if let Some(bytes) = corpo.bytes {
        builder = builder.body(bytes);
    }

    let started = Instant::now();
    let resp = builder.send().await?;

    let status = resp.status();
    let status_u16 = status.as_u16();
    let status_text = status
        .canonical_reason()
        .unwrap_or("")
        .to_string();

    let resp_headers = extrair_headers(resp.headers());

    let bytes = resp.bytes().await.map_err(|e| HttpError::Body(e.to_string()))?;
    let size_bytes = bytes.len() as u64;
    let time_ms = started.elapsed().as_millis() as u64;

    let (body_str, lossy) = decodificar_corpo(&bytes);

    Ok(ResponseData {
        status: status_u16,
        status_text,
        headers: resp_headers,
        body: body_str,
        body_truncated_lossy: lossy,
        time_ms,
        size_bytes,
    })
}

/// Converte HeaderMap da resposta em lista de KeyVal (preserva duplicados).
/// LOGICA quase pura (recebe HeaderMap do reqwest).
fn extrair_headers(map: &HeaderMap) -> Vec<KeyVal> {
    let mut out = Vec::with_capacity(map.len());
    for (name, value) in map.iter() {
        out.push(KeyVal {
            name: name.as_str().to_string(),
            value: value.to_str().unwrap_or("").to_string(),
            enabled: true,
        });
    }
    out
}

/// Decodifica bytes -> String. Tenta UTF-8 estrito; se falhar, faz lossy e marca.
/// LOGICA PURA.
pub fn decodificar_corpo(bytes: &[u8]) -> (String, bool) {
    match std::str::from_utf8(bytes) {
        Ok(s) => (s.to_string(), false),
        Err(_) => (String::from_utf8_lossy(bytes).into_owned(), true),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn kv(name: &str, value: &str, enabled: bool) -> KeyVal {
        KeyVal {
            name: name.to_string(),
            value: value.to_string(),
            enabled,
        }
    }

    // ---- form_encode ----------------------------------------------------

    #[test]
    fn form_encode_espaco_vira_mais() {
        assert_eq!(form_encode("a b"), "a+b");
    }

    #[test]
    fn form_encode_multiplos_espacos() {
        assert_eq!(form_encode("a b c"), "a+b+c");
    }

    #[test]
    fn form_encode_safe_chars_passam_cruas() {
        // -_.* sao "safe" no formato e nao devem ser escapados.
        assert_eq!(form_encode("-_.*"), "-_.*");
    }

    #[test]
    fn form_encode_alfanumerico_intacto() {
        assert_eq!(form_encode("Abc123"), "Abc123");
    }

    #[test]
    fn form_encode_caracteres_reservados_sao_percent() {
        assert_eq!(form_encode("a&b=c"), "a%26b%3Dc");
    }

    #[test]
    fn form_encode_mais_literal_e_escapado() {
        // '+' literal NAO e safe -> deve virar %2B (senao ambiguo com espaco).
        assert_eq!(form_encode("a+b"), "a%2Bb");
    }

    #[test]
    fn form_encode_unicode_em_utf8_percent() {
        // 'á' = 0xC3 0xA1
        assert_eq!(form_encode("á"), "%C3%A1");
    }

    #[test]
    fn form_encode_emoji_multibyte() {
        // controle de seguranca: nao paniqueia com multibyte (4 bytes)
        let out = form_encode("\u{1F600}");
        assert_eq!(out, "%F0%9F%98%80");
    }

    #[test]
    fn form_encode_vazio() {
        assert_eq!(form_encode(""), "");
    }

    #[test]
    fn form_encode_so_espaco() {
        assert_eq!(form_encode(" "), "+");
    }

    // ---- montar_url -----------------------------------------------------

    #[test]
    fn montar_url_vazia_erro() {
        let e = montar_url("", &[]).unwrap_err();
        assert_eq!(e.kind(), "invalidUrl");
    }

    #[test]
    fn montar_url_so_espacos_erro() {
        let e = montar_url("   ", &[]).unwrap_err();
        assert_eq!(e.kind(), "invalidUrl");
    }

    #[test]
    fn montar_url_trim_aplicado() {
        let u = montar_url("  https://x.test/a  ", &[]).unwrap();
        assert_eq!(u.as_str(), "https://x.test/a");
    }

    #[test]
    fn montar_url_scheme_file_rejeitado() {
        let e = montar_url("file:///etc/passwd", &[]).unwrap_err();
        assert_eq!(e.kind(), "invalidUrl");
    }

    #[test]
    fn montar_url_scheme_data_rejeitado() {
        let e = montar_url("data:text/plain,oi", &[]).unwrap_err();
        assert_eq!(e.kind(), "invalidUrl");
    }

    #[test]
    fn montar_url_scheme_ftp_rejeitado() {
        let e = montar_url("ftp://x.test/a", &[]).unwrap_err();
        assert_eq!(e.kind(), "invalidUrl");
    }

    #[test]
    fn montar_url_http_aceito() {
        let u = montar_url("http://x.test/", &[]).unwrap();
        assert_eq!(u.scheme(), "http");
    }

    #[test]
    fn montar_url_https_aceito() {
        let u = montar_url("https://x.test/", &[]).unwrap();
        assert_eq!(u.scheme(), "https");
    }

    #[test]
    fn montar_url_url_invalida_erro() {
        let e = montar_url("nao eh url", &[]).unwrap_err();
        assert_eq!(e.kind(), "invalidUrl");
    }

    #[test]
    fn montar_url_anexa_params_habilitados() {
        let u = montar_url(
            "https://x.test/",
            &[kv("a", "1", true), kv("b", "2", true)],
        )
        .unwrap();
        assert_eq!(u.query(), Some("a=1&b=2"));
    }

    #[test]
    fn montar_url_ignora_param_desabilitado() {
        let u = montar_url(
            "https://x.test/",
            &[kv("a", "1", true), kv("oculto", "x", false)],
        )
        .unwrap();
        assert_eq!(u.query(), Some("a=1"));
    }

    #[test]
    fn montar_url_ignora_param_nome_vazio() {
        let u = montar_url("https://x.test/", &[kv("", "x", true)]).unwrap();
        assert_eq!(u.query(), None);
    }

    #[test]
    fn montar_url_sem_params_nao_deixa_interrogacao() {
        let u = montar_url("https://x.test/path", &[]).unwrap();
        assert_eq!(u.query(), None);
        assert!(!u.as_str().ends_with('?'));
    }

    #[test]
    fn montar_url_preserva_query_existente_e_anexa() {
        let u = montar_url("https://x.test/?ja=1", &[kv("novo", "2", true)]).unwrap();
        let q = u.query().unwrap();
        assert!(q.contains("ja=1"));
        assert!(q.contains("novo=2"));
    }

    #[test]
    fn montar_url_valor_de_param_e_percent_encoded() {
        let u = montar_url("https://x.test/", &[kv("q", "a b&c", true)]).unwrap();
        // espaco e & no valor devem ser encodados pelo url crate
        let q = u.query().unwrap();
        assert!(q.starts_with("q="));
        assert!(!q.contains("a b&c"));
    }

    #[test]
    fn montar_url_nao_duplica_par_ja_na_query() {
        // F5 escreve a query na URL E mantem o array params em paralelo: o par
        // identico nao deve ser reanexado (evita ?a=1&a=1).
        let u = montar_url("https://x.test/?a=1", &[kv("a", "1", true)]).unwrap();
        assert_eq!(u.query(), Some("a=1"));
    }

    #[test]
    fn montar_url_dedup_multiplos_pares_da_f5() {
        // URL ja carrega a=1&b=2 (embutidos pela F5) e o array repete os mesmos:
        // resultado deve permanecer a=1&b=2, sem duplicar nenhum.
        let u = montar_url(
            "https://x.test/?a=1&b=2",
            &[kv("a", "1", true), kv("b", "2", true)],
        )
        .unwrap();
        assert_eq!(u.query(), Some("a=1&b=2"));
    }

    #[test]
    fn montar_url_anexa_par_com_mesmo_nome_valor_diferente() {
        // Mesmo nome mas valor novo NAO e considerado duplicado: deve anexar.
        let u = montar_url("https://x.test/?a=1", &[kv("a", "2", true)]).unwrap();
        assert_eq!(u.query(), Some("a=1&a=2"));
    }

    #[test]
    fn montar_url_mantem_param_repetido() {
        let u = montar_url(
            "https://x.test/",
            &[kv("k", "1", true), kv("k", "2", true)],
        )
        .unwrap();
        assert_eq!(u.query(), Some("k=1&k=2"));
    }

    // ---- resolver_method ------------------------------------------------

    #[test]
    fn resolver_method_vazio_vira_get() {
        assert_eq!(resolver_method("").unwrap(), Method::GET);
    }

    #[test]
    fn resolver_method_so_espacos_vira_get() {
        assert_eq!(resolver_method("   ").unwrap(), Method::GET);
    }

    #[test]
    fn resolver_method_minusculo_normaliza() {
        assert_eq!(resolver_method("post").unwrap(), Method::POST);
    }

    #[test]
    fn resolver_method_misto_normaliza() {
        assert_eq!(resolver_method("PaTcH").unwrap(), Method::PATCH);
    }

    #[test]
    fn resolver_method_com_espacos_em_volta() {
        assert_eq!(resolver_method("  delete  ").unwrap(), Method::DELETE);
    }

    #[test]
    fn resolver_method_todos_padrao() {
        for m in ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] {
            assert_eq!(resolver_method(m).unwrap().as_str(), m);
        }
    }

    #[test]
    fn resolver_method_metodo_custom_valido_aceito() {
        // token HTTP valido mas nao-padrao deve passar (uppercased)
        assert_eq!(resolver_method("purge").unwrap().as_str(), "PURGE");
    }

    #[test]
    fn resolver_method_com_caractere_invalido_erro() {
        let e = resolver_method("GE T").unwrap_err();
        assert_eq!(e.kind(), "invalidMethod");
    }

    #[test]
    fn resolver_method_com_separador_invalido_erro() {
        // '(' e separador, invalido em token de metodo
        let e = resolver_method("GET(").unwrap_err();
        assert_eq!(e.kind(), "invalidMethod");
    }

    // ---- content_type_default -------------------------------------------

    #[test]
    fn content_type_json() {
        assert_eq!(content_type_default("json"), Some("application/json"));
    }

    #[test]
    fn content_type_graphql_e_json() {
        assert_eq!(content_type_default("graphql"), Some("application/json"));
    }

    #[test]
    fn content_type_text() {
        assert_eq!(content_type_default("text"), Some("text/plain"));
    }

    #[test]
    fn content_type_xml() {
        assert_eq!(content_type_default("xml"), Some("application/xml"));
    }

    #[test]
    fn content_type_form() {
        assert_eq!(
            content_type_default("form_urlencoded"),
            Some("application/x-www-form-urlencoded")
        );
    }

    #[test]
    fn content_type_none_sem_default() {
        assert_eq!(content_type_default("none"), None);
    }

    #[test]
    fn content_type_vazio_sem_default() {
        assert_eq!(content_type_default(""), None);
    }

    #[test]
    fn content_type_desconhecido_sem_default() {
        assert_eq!(content_type_default("multipart"), None);
        assert_eq!(content_type_default("qualquer"), None);
    }

    #[test]
    fn content_type_case_sensitive() {
        // os modos vem snake_case do store; "JSON" maiusculo nao casa
        assert_eq!(content_type_default("JSON"), None);
    }

    // ---- tem_header -----------------------------------------------------

    #[test]
    fn tem_header_case_insensitive() {
        let hs = [kv("Content-Type", "application/json", true)];
        assert!(tem_header(&hs, "content-type"));
        assert!(tem_header(&hs, "CONTENT-TYPE"));
    }

    #[test]
    fn tem_header_ausente() {
        let hs = [kv("Accept", "*/*", true)];
        assert!(!tem_header(&hs, "content-type"));
    }

    #[test]
    fn tem_header_ignora_desabilitado() {
        let hs = [kv("Content-Type", "x", false)];
        assert!(!tem_header(&hs, "content-type"));
    }

    #[test]
    fn tem_header_lista_vazia() {
        assert!(!tem_header(&[], "content-type"));
    }

    #[test]
    fn tem_header_um_habilitado_entre_desabilitados() {
        let hs = [
            kv("Content-Type", "a", false),
            kv("content-type", "b", true),
        ];
        assert!(tem_header(&hs, "Content-Type"));
    }

    // ---- montar_headers -------------------------------------------------

    #[test]
    fn montar_headers_basico() {
        let map = montar_headers(&[kv("Accept", "application/json", true)]).unwrap();
        assert_eq!(map.get("accept").unwrap(), "application/json");
    }

    #[test]
    fn montar_headers_ignora_desabilitado() {
        let map = montar_headers(&[kv("X-Secret", "tok", false)]).unwrap();
        assert!(map.get("x-secret").is_none());
    }

    #[test]
    fn montar_headers_ignora_nome_vazio() {
        let map = montar_headers(&[kv("", "v", true)]).unwrap();
        assert!(map.is_empty());
    }

    #[test]
    fn montar_headers_duplicados_preservados() {
        let map = montar_headers(&[
            kv("X-Multi", "a", true),
            kv("X-Multi", "b", true),
        ])
        .unwrap();
        let vals: Vec<_> = map.get_all("x-multi").iter().collect();
        assert_eq!(vals.len(), 2);
    }

    #[test]
    fn montar_headers_nome_com_espaco_erro() {
        let e = montar_headers(&[kv("Bad Header", "v", true)]).unwrap_err();
        assert_eq!(e.kind(), "invalidHeader");
    }

    #[test]
    fn montar_headers_crlf_no_valor_erro() {
        // defesa contra header injection / CRLF splitting
        let e = montar_headers(&[kv("X-Inj", "a\r\nEvil: 1", true)]).unwrap_err();
        assert_eq!(e.kind(), "invalidHeader");
    }

    #[test]
    fn montar_headers_newline_no_nome_erro() {
        let e = montar_headers(&[kv("X\nBad", "v", true)]).unwrap_err();
        assert_eq!(e.kind(), "invalidHeader");
    }

    #[test]
    fn montar_headers_valor_vazio_ok() {
        let map = montar_headers(&[kv("X-Empty", "", true)]).unwrap();
        assert_eq!(map.get("x-empty").unwrap(), "");
    }

    #[test]
    fn montar_headers_lista_vazia_mapa_vazio() {
        assert!(montar_headers(&[]).unwrap().is_empty());
    }

    // ---- montar_corpo ---------------------------------------------------

    fn body(mode: &str, raw: Option<&str>, form: Vec<KeyVal>) -> RequestBody {
        RequestBody {
            mode: mode.to_string(),
            raw: raw.map(|s| s.to_string()),
            form,
        }
    }

    #[test]
    fn montar_corpo_none_sem_bytes_sem_ct() {
        let c = montar_corpo(&body("none", None, vec![]));
        assert!(c.bytes.is_none());
        assert!(c.content_type.is_none());
    }

    #[test]
    fn montar_corpo_mode_vazio_sem_bytes() {
        let c = montar_corpo(&body("", None, vec![]));
        assert!(c.bytes.is_none());
        assert!(c.content_type.is_none());
    }

    #[test]
    fn montar_corpo_json_raw() {
        let c = montar_corpo(&body("json", Some("{\"a\":1}"), vec![]));
        assert_eq!(c.bytes.unwrap(), b"{\"a\":1}");
        assert_eq!(c.content_type, Some("application/json"));
    }

    #[test]
    fn montar_corpo_json_raw_vazio_sem_bytes_mas_com_ct() {
        // raw vazio: nao manda corpo, mas mantem o content-type default
        let c = montar_corpo(&body("json", Some(""), vec![]));
        assert!(c.bytes.is_none());
        assert_eq!(c.content_type, Some("application/json"));
    }

    #[test]
    fn montar_corpo_json_raw_none_sem_bytes() {
        let c = montar_corpo(&body("json", None, vec![]));
        assert!(c.bytes.is_none());
        assert_eq!(c.content_type, Some("application/json"));
    }

    #[test]
    fn montar_corpo_text() {
        let c = montar_corpo(&body("text", Some("ola"), vec![]));
        assert_eq!(c.bytes.unwrap(), b"ola");
        assert_eq!(c.content_type, Some("text/plain"));
    }

    #[test]
    fn montar_corpo_xml() {
        let c = montar_corpo(&body("xml", Some("<a/>"), vec![]));
        assert_eq!(c.bytes.unwrap(), b"<a/>");
        assert_eq!(c.content_type, Some("application/xml"));
    }

    #[test]
    fn montar_corpo_form_serializa_pares() {
        let c = montar_corpo(&body(
            "form_urlencoded",
            None,
            vec![kv("a", "1", true), kv("b", "2", true)],
        ));
        assert_eq!(c.bytes.unwrap(), b"a=1&b=2");
        assert_eq!(c.content_type, Some("application/x-www-form-urlencoded"));
    }

    #[test]
    fn montar_corpo_form_ignora_desabilitado() {
        let c = montar_corpo(&body(
            "form_urlencoded",
            None,
            vec![kv("a", "1", true), kv("off", "x", false)],
        ));
        assert_eq!(c.bytes.unwrap(), b"a=1");
    }

    #[test]
    fn montar_corpo_form_ignora_nome_vazio() {
        let c = montar_corpo(&body(
            "form_urlencoded",
            None,
            vec![kv("", "x", true), kv("a", "1", true)],
        ));
        assert_eq!(c.bytes.unwrap(), b"a=1");
    }

    #[test]
    fn montar_corpo_form_encoda_valores() {
        let c = montar_corpo(&body(
            "form_urlencoded",
            None,
            vec![kv("q", "a b", true)],
        ));
        assert_eq!(c.bytes.unwrap(), b"q=a+b");
    }

    #[test]
    fn montar_corpo_form_vazio_vira_string_vazia() {
        let c = montar_corpo(&body("form_urlencoded", None, vec![]));
        assert_eq!(c.bytes.unwrap(), b"");
        assert_eq!(c.content_type, Some("application/x-www-form-urlencoded"));
    }

    #[test]
    fn montar_corpo_graphql_usa_raw_e_ct_json() {
        let c = montar_corpo(&body("graphql", Some("{q}"), vec![]));
        assert_eq!(c.bytes.unwrap(), b"{q}");
        assert_eq!(c.content_type, Some("application/json"));
    }

    #[test]
    fn montar_corpo_modo_desconhecido_usa_raw_sem_ct() {
        let c = montar_corpo(&body("zzz", Some("dados"), vec![]));
        assert_eq!(c.bytes.unwrap(), b"dados");
        assert!(c.content_type.is_none());
    }

    // ---- decodificar_corpo ----------------------------------------------

    #[test]
    fn decodificar_utf8_valido_nao_lossy() {
        let (s, lossy) = decodificar_corpo("olá mundo".as_bytes());
        assert_eq!(s, "olá mundo");
        assert!(!lossy);
    }

    #[test]
    fn decodificar_vazio() {
        let (s, lossy) = decodificar_corpo(&[]);
        assert_eq!(s, "");
        assert!(!lossy);
    }

    #[test]
    fn decodificar_bytes_invalidos_lossy() {
        // 0xFF nao e UTF-8 valido -> lossy true, sem panic
        let (s, lossy) = decodificar_corpo(&[0xFF, 0xFE, 0x00]);
        assert!(lossy);
        assert!(s.contains('\u{FFFD}'));
    }

    #[test]
    fn decodificar_ascii_puro() {
        let (s, lossy) = decodificar_corpo(b"hello");
        assert_eq!(s, "hello");
        assert!(!lossy);
    }

    #[test]
    fn decodificar_utf8_truncado_e_lossy() {
        // primeiro byte de 'á' (0xC3) sem continuacao -> invalido
        let (_, lossy) = decodificar_corpo(&[0xC3]);
        assert!(lossy);
    }

    // ---- HttpError::kind discriminantes ---------------------------------

    #[test]
    fn httperror_kind_discriminantes_estaveis() {
        assert_eq!(HttpError::InvalidUrl("x".into()).kind(), "invalidUrl");
        assert_eq!(HttpError::InvalidMethod("x".into()).kind(), "invalidMethod");
        assert_eq!(HttpError::InvalidHeader("x".into()).kind(), "invalidHeader");
        assert_eq!(HttpError::Build("x".into()).kind(), "build");
        assert_eq!(HttpError::Timeout.kind(), "timeout");
        assert_eq!(HttpError::Connect("x".into()).kind(), "connect");
        assert_eq!(HttpError::Body("x".into()).kind(), "body");
        assert_eq!(HttpError::Network("x".into()).kind(), "network");
    }

    #[test]
    fn httperror_serializa_kind_e_message() {
        let e = HttpError::InvalidUrl("URL vazia".to_string());
        let json = serde_json::to_value(&e).unwrap();
        assert_eq!(json["kind"], "invalidUrl");
        assert!(json["message"].as_str().unwrap().contains("URL vazia"));
    }

    // ---- extrair_headers ------------------------------------------------

    #[test]
    fn extrair_headers_preserva_nome_valor_e_enabled() {
        let mut map = HeaderMap::new();
        map.insert(
            HeaderName::from_static("content-type"),
            HeaderValue::from_static("application/json"),
        );
        let out = extrair_headers(&map);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].name, "content-type");
        assert_eq!(out[0].value, "application/json");
        // Todo header extraido vem habilitado (mata o mutante extrair->vec![]
        // e protege o campo enabled).
        assert!(out[0].enabled);
    }

    #[test]
    fn extrair_headers_preserva_duplicados() {
        let mut map = HeaderMap::new();
        map.append(
            HeaderName::from_static("set-cookie"),
            HeaderValue::from_static("a=1"),
        );
        map.append(
            HeaderName::from_static("set-cookie"),
            HeaderValue::from_static("b=2"),
        );
        let out = extrair_headers(&map);
        assert_eq!(out.len(), 2);
        let valores: Vec<&str> = out.iter().map(|kv| kv.value.as_str()).collect();
        assert!(valores.contains(&"a=1"));
        assert!(valores.contains(&"b=2"));
    }

    #[test]
    fn extrair_headers_vazio_devolve_lista_vazia() {
        let map = HeaderMap::new();
        assert!(extrair_headers(&map).is_empty());
    }

    // ---- serde defaults de RequestData/KeyVal ---------------------------

    #[test]
    fn requestdata_method_default_e_get() {
        // JSON sem `method`: default_method() deve preencher "GET".
        let req: RequestData = serde_json::from_str(r#"{"url":"https://x.test/"}"#).unwrap();
        assert_eq!(req.method, "GET");
    }

    #[test]
    fn keyval_enabled_default_e_true() {
        // JSON sem `enabled`: default_true() deve preencher true.
        let kv: KeyVal = serde_json::from_str(r#"{"name":"a","value":"1"}"#).unwrap();
        assert!(kv.enabled);
    }

    // ---- F20: resolver_timeout_ms ---------------------------------------

    fn req_base() -> RequestData {
        RequestData {
            method: "GET".to_string(),
            url: "https://x.test/".to_string(),
            headers: vec![],
            params: vec![],
            body: RequestBody::default(),
            timeout_ms: None,
            settings: None,
        }
    }

    fn settings_vazio() -> RequestSettings {
        RequestSettings::default()
    }

    #[test]
    fn timeout_sem_nada_usa_default() {
        assert_eq!(resolver_timeout_ms(&req_base()), DEFAULT_TIMEOUT_MS);
    }

    #[test]
    fn timeout_campo_legado_quando_sem_settings() {
        let mut r = req_base();
        r.timeout_ms = Some(1234);
        assert_eq!(resolver_timeout_ms(&r), 1234);
    }

    #[test]
    fn timeout_settings_tem_precedencia_sobre_legado() {
        let mut r = req_base();
        r.timeout_ms = Some(1234);
        r.settings = Some(RequestSettings {
            timeout_ms: Some(5000),
            ..settings_vazio()
        });
        assert_eq!(resolver_timeout_ms(&r), 5000);
    }

    #[test]
    fn timeout_settings_sem_timeout_cai_no_legado() {
        let mut r = req_base();
        r.timeout_ms = Some(777);
        r.settings = Some(settings_vazio());
        assert_eq!(resolver_timeout_ms(&r), 777);
    }

    #[test]
    fn timeout_settings_sem_timeout_e_sem_legado_usa_default() {
        let mut r = req_base();
        r.settings = Some(settings_vazio());
        assert_eq!(resolver_timeout_ms(&r), DEFAULT_TIMEOUT_MS);
    }

    // ---- F20: resolver_redirect_policy ----------------------------------
    // Policy nao expoe introspeccao publica; comparamos via Debug string que e
    // estavel o suficiente para distinguir none/limited/default.

    fn policy_dbg(p: Policy) -> String {
        format!("{p:?}")
    }

    #[test]
    fn redirect_sem_settings_e_default() {
        assert_eq!(
            policy_dbg(resolver_redirect_policy(None)),
            policy_dbg(Policy::default())
        );
    }

    #[test]
    fn redirect_follow_ausente_e_default() {
        let s = settings_vazio();
        assert_eq!(
            policy_dbg(resolver_redirect_policy(Some(&s))),
            policy_dbg(Policy::default())
        );
    }

    #[test]
    fn redirect_follow_false_e_none() {
        let s = RequestSettings {
            follow_redirects: Some(false),
            ..settings_vazio()
        };
        assert_eq!(
            policy_dbg(resolver_redirect_policy(Some(&s))),
            policy_dbg(Policy::none())
        );
    }

    #[test]
    fn redirect_follow_true_sem_max_e_default() {
        let s = RequestSettings {
            follow_redirects: Some(true),
            ..settings_vazio()
        };
        assert_eq!(
            policy_dbg(resolver_redirect_policy(Some(&s))),
            policy_dbg(Policy::default())
        );
    }

    #[test]
    fn redirect_follow_true_com_max_e_limited() {
        let s = RequestSettings {
            follow_redirects: Some(true),
            max_redirects: Some(3),
            ..settings_vazio()
        };
        assert_eq!(
            policy_dbg(resolver_redirect_policy(Some(&s))),
            policy_dbg(Policy::limited(3))
        );
    }

    #[test]
    fn redirect_max_ignorado_quando_follow_false() {
        // max_redirects nao deve transformar a policy em limited se follow=false.
        let s = RequestSettings {
            follow_redirects: Some(false),
            max_redirects: Some(9),
            ..settings_vazio()
        };
        assert_eq!(
            policy_dbg(resolver_redirect_policy(Some(&s))),
            policy_dbg(Policy::none())
        );
    }

    // ---- F20: aceitar_cert_invalido -------------------------------------

    #[test]
    fn cert_sem_settings_verifica() {
        assert!(!aceitar_cert_invalido(None));
    }

    #[test]
    fn cert_ssl_verify_ausente_verifica() {
        let s = settings_vazio();
        assert!(!aceitar_cert_invalido(Some(&s)));
    }

    #[test]
    fn cert_ssl_verify_true_verifica() {
        let s = RequestSettings {
            ssl_verify: Some(true),
            ..settings_vazio()
        };
        assert!(!aceitar_cert_invalido(Some(&s)));
    }

    #[test]
    fn cert_ssl_verify_false_aceita_invalido() {
        let s = RequestSettings {
            ssl_verify: Some(false),
            ..settings_vazio()
        };
        assert!(aceitar_cert_invalido(Some(&s)));
    }

    // ---- F20: proxy_url -------------------------------------------------

    #[test]
    fn proxy_sem_settings_none() {
        assert_eq!(proxy_url(None), None);
    }

    #[test]
    fn proxy_ausente_none() {
        let s = settings_vazio();
        assert_eq!(proxy_url(Some(&s)), None);
    }

    #[test]
    fn proxy_vazio_none() {
        let s = RequestSettings {
            proxy: Some("".to_string()),
            ..settings_vazio()
        };
        assert_eq!(proxy_url(Some(&s)), None);
    }

    #[test]
    fn proxy_so_espacos_none() {
        let s = RequestSettings {
            proxy: Some("   ".to_string()),
            ..settings_vazio()
        };
        assert_eq!(proxy_url(Some(&s)), None);
    }

    #[test]
    fn proxy_valido_trim() {
        let s = RequestSettings {
            proxy: Some("  http://127.0.0.1:8080  ".to_string()),
            ..settings_vazio()
        };
        assert_eq!(proxy_url(Some(&s)), Some("http://127.0.0.1:8080".to_string()));
    }

    // ---- F20: serde retrocompat do RequestData --------------------------

    #[test]
    fn requestdata_sem_settings_desserializa() {
        // JSON legado (sem `settings`): default => None, sem quebrar.
        let req: RequestData = serde_json::from_str(r#"{"url":"https://x.test/"}"#).unwrap();
        assert!(req.settings.is_none());
    }

    #[test]
    fn requestdata_com_settings_desserializa_camelcase() {
        let json = r#"{"url":"https://x.test/","settings":{"sslVerify":false,"timeoutMs":1000,"followRedirects":false,"maxRedirects":2,"proxy":"http://p:1","encodeUrl":true}}"#;
        let req: RequestData = serde_json::from_str(json).unwrap();
        let s = req.settings.unwrap();
        assert_eq!(s.ssl_verify, Some(false));
        assert_eq!(s.timeout_ms, Some(1000));
        assert_eq!(s.follow_redirects, Some(false));
        assert_eq!(s.max_redirects, Some(2));
        assert_eq!(s.proxy.as_deref(), Some("http://p:1"));
        assert_eq!(s.encode_url, Some(true));
    }

    #[test]
    fn requestsettings_parcial_desserializa() {
        // So um campo presente: o resto cai em None (todos opcionais).
        let s: RequestSettings = serde_json::from_str(r#"{"timeoutMs":500}"#).unwrap();
        assert_eq!(s.timeout_ms, Some(500));
        assert!(s.ssl_verify.is_none());
        assert!(s.follow_redirects.is_none());
    }
}
