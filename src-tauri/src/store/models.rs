// Schema serializavel do modelo de dados file-based (espelho em src/lib/types.ts).
// Tudo aqui e POJO puro com serde — sem I/O. As structs sao gravadas/lidas como YAML.
//
// Convencoes de serde:
// - camelCase no disco (combina com o espelho TS e com o estilo Bruno).
// - campos opcionais omitidos quando vazios/None para manter os .yml limpos.

use serde::{Deserialize, Serialize};

/// Par chave/valor usado em headers, params, form data, etc.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyValue {
    pub name: String,
    #[serde(default)]
    pub value: String,
    /// Se desabilitado, o par existe no arquivo mas nao e enviado na request.
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

fn default_true() -> bool {
    true
}

/// Modo do corpo da request. M1 ja define todos os modos; o payload e carregado
/// conforme o modo (campos None nos demais).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BodyMode {
    None,
    Json,
    Text,
    Xml,
    FormUrlencoded,
    Multipart,
    Graphql,
}

impl Default for BodyMode {
    fn default() -> Self {
        BodyMode::None
    }
}

/// Payload do GraphQL (query + variables como string JSON).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct GraphqlBody {
    #[serde(default)]
    pub query: String,
    #[serde(default)]
    pub variables: String,
}

/// Corpo da request. `mode` decide qual campo de payload e relevante.
/// Campos extensiveis: M2+ pode adicionar mais variantes sem quebrar o formato.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Body {
    #[serde(default)]
    pub mode: BodyMode,
    /// Texto cru para os modos json/text/xml.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub raw: Option<String>,
    /// Pares para form_urlencoded e multipart.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub form: Vec<KeyValue>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub graphql: Option<GraphqlBody>,
}

/// Modo de autenticacao. Extensivel: M2 expande oauth2 e afins.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AuthMode {
    None,
    /// Herda a auth definida na pasta/colecao pai.
    Inherit,
    Basic,
    Bearer,
    Apikey,
    Oauth2,
}

impl Default for AuthMode {
    fn default() -> Self {
        AuthMode::None
    }
}

/// Onde uma API key e injetada.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ApiKeyPlacement {
    Header,
    Query,
}

impl Default for ApiKeyPlacement {
    fn default() -> Self {
        ApiKeyPlacement::Header
    }
}

/// Autenticacao da request. So o bloco do `mode` ativo costuma estar preenchido.
/// Estrutura aberta de proposito (M2 expande oauth2).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Auth {
    #[serde(default)]
    pub mode: AuthMode,
    // basic
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub password: Option<String>,
    // bearer
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub token: Option<String>,
    // apikey
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub key: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub placement: Option<ApiKeyPlacement>,
}

/// Scripts pre/pos request (conteudo JS cru; execucao e do M3).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Scripts {
    #[serde(default)]
    pub pre: String,
    #[serde(default)]
    pub post: String,
}

/// Uma request HTTP individual (gravada em `<slug>.yml`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestItem {
    pub name: String,
    /// Ordem de exibicao dentro da pasta/colecao.
    #[serde(default)]
    pub seq: u32,
    #[serde(default = "default_method")]
    pub method: String,
    #[serde(default)]
    pub url: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub headers: Vec<KeyValue>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub params: Vec<KeyValue>,
    #[serde(default)]
    pub body: Body,
    #[serde(default)]
    pub auth: Auth,
    #[serde(default)]
    pub scripts: Scripts,
    /// Conteudo cru dos testes (execucao e do M3).
    #[serde(default)]
    pub tests: String,
    /// Documentacao em markdown.
    #[serde(default)]
    pub docs: String,
}

fn default_method() -> String {
    "GET".to_string()
}

/// Um no da arvore da colecao: ou uma pasta ou uma request.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum TreeItem {
    #[serde(rename = "folder")]
    Folder(Folder),
    #[serde(rename = "request")]
    Request(RequestItem),
}

impl TreeItem {
    /// `seq` do item, para ordenar irmaos.
    pub fn seq(&self) -> u32 {
        match self {
            TreeItem::Folder(f) => f.seq,
            TreeItem::Request(r) => r.seq,
        }
    }

    /// Nome de exibicao do item.
    pub fn name(&self) -> &str {
        match self {
            TreeItem::Folder(f) => &f.name,
            TreeItem::Request(r) => &r.name,
        }
    }
}

/// Uma pasta da colecao (diretorio com `folder.yml`). Contem filhos (`items`).
/// `items` NAO e serializado no `folder.yml` — a arvore vem do filesystem.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Folder {
    pub name: String,
    #[serde(default)]
    pub seq: u32,
    /// Filhos reconstruidos a partir do disco. Vao para o IPC (front precisa da
    /// arvore), mas NUNCA para o folder.yml — o disco usa FolderMeta, nao Folder.
    #[serde(default)]
    pub items: Vec<TreeItem>,
}

/// Config raiz da colecao (gravada em `collection.yml`). `items` vem do disco.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Collection {
    pub name: String,
    #[serde(default = "default_version")]
    pub version: String,
    /// Arvore reconstruida a partir do disco. Vai para o IPC (front precisa da
    /// arvore), mas NUNCA para o collection.yml — o disco usa CollectionMeta.
    #[serde(default)]
    pub items: Vec<TreeItem>,
    /// Variaveis da colecao. Campo aberto para o M2; YAML livre por enquanto.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vars: Option<serde_yaml::Value>,
}

fn default_version() -> String {
    "1".to_string()
}

/// Metadados so do `collection.yml` (sem a arvore), usados ao gravar/parsear o
/// arquivo raiz isoladamente.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectionMeta {
    pub name: String,
    #[serde(default = "default_version")]
    pub version: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vars: Option<serde_yaml::Value>,
}

/// Metadados so do `folder.yml` (sem os filhos).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderMeta {
    pub name: String,
    #[serde(default)]
    pub seq: u32,
}

#[cfg(test)]
mod tests {
    use super::*;

    /// REGRESSAO (tela preta): a `Collection` cruza o IPC como JSON; o campo
    /// `items` DEVE estar presente, senao o front recebe `undefined` e a Sidebar
    /// quebra ao iterar a arvore. Antes havia `skip_serializing` aqui, que
    /// removia `items` tambem do IPC (nao so do disco).
    #[test]
    fn collection_inclui_items_no_ipc_json() {
        let col = Collection {
            name: "Minha API".to_string(),
            version: "1".to_string(),
            items: vec![TreeItem::Folder(Folder {
                name: "auth".to_string(),
                seq: 0,
                items: vec![TreeItem::Folder(Folder {
                    name: "interno".to_string(),
                    seq: 0,
                    items: vec![],
                })],
            })],
            vars: None,
        };

        let v = serde_json::to_value(&col).unwrap();
        // O front depende destas chaves.
        assert!(v.get("items").is_some(), "items ausente no JSON do IPC");
        assert_eq!(v["items"].as_array().unwrap().len(), 1);
        // Arvore aninhada tambem precisa sobreviver ao IPC.
        assert_eq!(v["items"][0]["type"], "folder");
        assert_eq!(v["items"][0]["items"][0]["name"], "interno");
    }

    /// O disco NAO deve receber a arvore: o `collection.yml` usa CollectionMeta,
    /// que nem tem o campo `items`.
    #[test]
    fn collection_meta_nao_tem_items() {
        let meta = CollectionMeta {
            name: "Minha API".to_string(),
            version: "1".to_string(),
            vars: None,
        };
        let y = serde_yaml::to_string(&meta).unwrap();
        assert!(!y.contains("items"), "collection.yml nao deve conter items");
    }
}
