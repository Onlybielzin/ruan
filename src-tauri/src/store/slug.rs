// Sanitizacao de nomes de arquivo/diretorio — LOGICA PURA, alvo de mutation testing.
//
// SEGURANCA (critico): o nome de uma request/pasta vem do usuario e NUNCA pode
// escapar do diretorio da colecao. Por isso o slug:
//   - rejeita componentes de path traversal (`..`, `.`);
//   - rejeita separadores de caminho (`/`, `\`) — eles nunca chegam ao resultado;
//   - rejeita caminhos absolutos e drive letters (ex.: `C:`);
//   - rejeita resultados vazios.
// O slug resultante contem apenas [a-z0-9-], entao por construcao e um unico
// componente de path seguro, incapaz de atravessar diretorios.

use crate::store::error::StoreError;

/// Converte um nome arbitrario em um slug seguro de arquivo: minusculas,
/// alfanumerico e hifens. Espacos e simbolos viram hifen; hifens repetidos
/// colapsam; hifens das pontas sao removidos.
///
/// Retorna `StoreError::InvalidName` se o nome resultar em slug vazio
/// (ex.: nome so com simbolos, ou string vazia).
pub fn slugify(name: &str) -> Result<String, StoreError> {
    let s = slug::slugify(name);
    if s.is_empty() {
        return Err(StoreError::InvalidName(name.to_string()));
    }
    Ok(s)
}

/// Valida que um nome e seguro para virar um unico componente de path,
/// SEM transforma-lo. Use quando precisar checar antes de slugificar
/// (ex.: rejeitar explicitamente tentativas de traversal vindas da UI).
///
/// Rejeita: vazio/whitespace, `.`/`..`, qualquer `/` ou `\`, NUL,
/// e caminhos absolutos (comecando com `/`, `\` ou `X:`).
pub fn validar_nome(name: &str) -> Result<(), StoreError> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(StoreError::InvalidName(name.to_string()));
    }
    if trimmed == "." || trimmed == ".." {
        return Err(StoreError::PathTraversal(name.to_string()));
    }
    if name.contains('/') || name.contains('\\') {
        return Err(StoreError::PathTraversal(name.to_string()));
    }
    if name.contains('\0') {
        return Err(StoreError::InvalidName(name.to_string()));
    }
    if eh_absoluto(name) {
        return Err(StoreError::PathTraversal(name.to_string()));
    }
    Ok(())
}

/// Detecta um prefixo de caminho absoluto: `/foo`, `\foo` ou drive letter `C:`.
fn eh_absoluto(name: &str) -> bool {
    let bytes = name.as_bytes();
    if bytes.is_empty() {
        return false;
    }
    if bytes[0] == b'/' || bytes[0] == b'\\' {
        return true;
    }
    // Drive letter estilo Windows: letra seguida de ':'.
    if name.len() >= 2 {
        let first = bytes[0];
        let is_letter = first.is_ascii_alphabetic();
        if is_letter && bytes[1] == b':' {
            return true;
        }
    }
    false
}

/// Garante que `file_name` e seguro: valida E slugifica, devolvendo o slug.
/// Atalho usado pelas funcoes de save_* antes de tocar o disco.
pub fn slug_seguro(name: &str) -> Result<String, StoreError> {
    validar_nome(name)?;
    slugify(name)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::error::StoreError;

    // ---- slugify ----

    #[test]
    fn slugify_basico() {
        assert_eq!(slugify("Listar Usuários!").unwrap(), "listar-usuarios");
    }

    #[test]
    fn slugify_espacos_e_maiusculas() {
        assert_eq!(slugify("  Olá   Mundo  ").unwrap(), "ola-mundo");
    }

    #[test]
    fn slugify_acentos_viram_ascii() {
        assert_eq!(slugify("ÀÉÎÕÜ").unwrap(), "aeiou");
        assert_eq!(slugify("résumé café").unwrap(), "resume-cafe");
    }

    #[test]
    fn slugify_simbolos_viram_hifen_e_colapsam() {
        assert_eq!(slugify("C++ & Go").unwrap(), "c-go");
    }

    #[test]
    fn slugify_hifens_repetidos_colapsam_e_pontas_removidas() {
        assert_eq!(slugify("---a---b---").unwrap(), "a-b");
    }

    #[test]
    fn slugify_numeros_preservados() {
        assert_eq!(slugify("123").unwrap(), "123");
    }

    #[test]
    fn slugify_so_simbolos_vira_erro_invalid_name() {
        // Nada alfanumerico -> slug vazio -> InvalidName (preserva o nome original).
        let e = slugify("!!!").unwrap_err();
        assert!(matches!(e, StoreError::InvalidName(ref n) if n == "!!!"));
    }

    #[test]
    fn slugify_string_vazia_vira_erro_invalid_name() {
        let e = slugify("").unwrap_err();
        assert!(matches!(e, StoreError::InvalidName(ref n) if n.is_empty()));
    }

    #[test]
    fn slugify_so_pontos_vira_erro() {
        // "...." -> slug vazio -> InvalidName.
        assert!(matches!(slugify("...."), Err(StoreError::InvalidName(_))));
    }

    #[test]
    fn slugify_nunca_contem_separadores() {
        // Defesa por construcao: o slug nunca pode conter / ou \.
        let s = slugify("a/b\\c").unwrap();
        assert!(!s.contains('/'));
        assert!(!s.contains('\\'));
        assert_eq!(s, "a-b-c");
    }

    // ---- validar_nome: deve ACEITAR ----

    #[test]
    fn validar_aceita_nomes_normais() {
        for ok in &[
            "Listar Usuarios",
            "login",
            "request 1",
            "Olá Mundo",
            "a.b.json",
            "arquivo.yml",
            "nome-com-hifen",
            "C sharp", // contem 'C' mas nao 'C:'
        ] {
            assert!(validar_nome(ok).is_ok(), "deveria aceitar {ok:?}");
        }
    }

    #[test]
    fn validar_dois_pontos_apos_letra_inicial_e_rejeitado() {
        // CUIDADO: a heuristica de drive letter rejeita QUALQUER letra+':' no
        // inicio (ex.: "a:b"), nao so unidades reais tipo "C:". E uma rejeicao
        // conservadora (seguro por padrao), documentada como comportamento.
        assert!(matches!(validar_nome("a:b"), Err(StoreError::PathTraversal(_))));
    }

    #[test]
    fn validar_aceita_dois_pontos_quando_nao_inicia_com_letra() {
        // ':' na posicao 1 mas o primeiro char nao e letra -> nao e drive -> ok.
        assert!(validar_nome("12:30 cron").is_ok());
    }

    // ---- validar_nome: deve REJEITAR ----

    #[test]
    fn validar_rejeita_vazio_e_whitespace() {
        assert!(matches!(validar_nome(""), Err(StoreError::InvalidName(_))));
        assert!(matches!(validar_nome("   "), Err(StoreError::InvalidName(_))));
        assert!(matches!(validar_nome("\t\n"), Err(StoreError::InvalidName(_))));
    }

    #[test]
    fn validar_rejeita_ponto_e_ponto_ponto() {
        assert!(matches!(validar_nome("."), Err(StoreError::PathTraversal(_))));
        assert!(matches!(validar_nome(".."), Err(StoreError::PathTraversal(_))));
    }

    #[test]
    fn validar_rejeita_ponto_ponto_com_whitespace() {
        // O trim acontece antes da checagem de "." / ".." — entao " .. " tambem cai.
        assert!(matches!(validar_nome("  ..  "), Err(StoreError::PathTraversal(_))));
        assert!(matches!(validar_nome(" . "), Err(StoreError::PathTraversal(_))));
    }

    #[test]
    fn validar_rejeita_barra_e_contrabarra() {
        assert!(matches!(validar_nome("a/b"), Err(StoreError::PathTraversal(_))));
        assert!(matches!(validar_nome("a\\b"), Err(StoreError::PathTraversal(_))));
        assert!(matches!(validar_nome("../etc"), Err(StoreError::PathTraversal(_))));
        assert!(matches!(validar_nome("foo/../bar"), Err(StoreError::PathTraversal(_))));
    }

    #[test]
    fn validar_rejeita_nul() {
        assert!(matches!(validar_nome("a\0b"), Err(StoreError::InvalidName(_))));
    }

    #[test]
    fn validar_rejeita_absolutos_unix() {
        assert!(matches!(validar_nome("/abs"), Err(StoreError::PathTraversal(_))));
        assert!(matches!(validar_nome("/etc/passwd"), Err(StoreError::PathTraversal(_))));
    }

    #[test]
    fn validar_rejeita_absolutos_windows() {
        assert!(matches!(validar_nome("\\abs"), Err(StoreError::PathTraversal(_))));
        assert!(matches!(validar_nome("C:\\x"), Err(StoreError::PathTraversal(_))));
        assert!(matches!(validar_nome("D:foo"), Err(StoreError::PathTraversal(_))));
        assert!(matches!(validar_nome("z:bar"), Err(StoreError::PathTraversal(_))));
    }

    // ---- eh_absoluto (via validar_nome, cobrindo limites) ----

    #[test]
    fn eh_absoluto_letra_sozinha_nao_e_drive() {
        // "C" tem len 1, nao ha ':' depois -> nao e drive letter -> aceito.
        assert!(validar_nome("C").is_ok());
    }

    #[test]
    fn eh_absoluto_dois_pontos_sem_letra_nao_e_drive() {
        // ':' na posicao 1 mas sem letra antes -> nao e drive letter.
        assert!(validar_nome("1:x").is_ok());
        assert!(validar_nome("-:x").is_ok());
    }

    // Testes diretos de `eh_absoluto`. Necessarios porque, via `validar_nome`,
    // os prefixos `/` e `\` ja sao barrados antes (pela checagem de separadores),
    // entao essas ramificacoes so sao exercitadas chamando a fn diretamente.
    // (Mata o mutante `||`->`&&` na linha do prefixo `/`||`\`.)
    #[test]
    fn eh_absoluto_prefixo_barra() {
        assert!(eh_absoluto("/foo"));
    }

    #[test]
    fn eh_absoluto_prefixo_contrabarra() {
        assert!(eh_absoluto("\\foo"));
    }

    #[test]
    fn eh_absoluto_drive_letter() {
        assert!(eh_absoluto("C:\\x"));
        assert!(eh_absoluto("d:"));
    }

    #[test]
    fn eh_absoluto_relativo_e_falso() {
        assert!(!eh_absoluto("foo"));
        assert!(!eh_absoluto(""));
        assert!(!eh_absoluto("a")); // len 1, sem ':'
        assert!(!eh_absoluto("1:x")); // primeiro char nao e letra
        assert!(!eh_absoluto("ab")); // sem ':' nem prefixo
    }

    // ---- slug_seguro: combina validacao + slugificacao ----

    #[test]
    fn slug_seguro_caminho_feliz() {
        assert_eq!(slug_seguro("Listar Usuários").unwrap(), "listar-usuarios");
    }

    #[test]
    fn slug_seguro_rejeita_traversal_antes_de_slugificar() {
        // Importante: maliciosos sao barrados pela validacao, NAO mascarados pelo slug.
        assert!(matches!(slug_seguro(".."), Err(StoreError::PathTraversal(_))));
        assert!(matches!(slug_seguro("a/b"), Err(StoreError::PathTraversal(_))));
        assert!(matches!(slug_seguro("/etc/passwd"), Err(StoreError::PathTraversal(_))));
        assert!(matches!(slug_seguro("C:\\x"), Err(StoreError::PathTraversal(_))));
        assert!(matches!(slug_seguro("a\0b"), Err(StoreError::InvalidName(_))));
    }

    #[test]
    fn slug_seguro_rejeita_nome_que_slugifica_vazio() {
        // Passa na validacao (sem separadores) mas slugifica pra vazio -> InvalidName.
        assert!(matches!(slug_seguro("!!!"), Err(StoreError::InvalidName(_))));
    }
}
