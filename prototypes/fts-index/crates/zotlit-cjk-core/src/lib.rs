//! Shared tokenization for ZotLit FTS5 (`zotlit_cjk`).
//!
//! **ICU4X `WordSegmenter::new_auto` is the base** for every script (Latin,
//! CJK, Thai/Khmer/Myanmar, …). Optional Cargo feature `jieba` adds a Chinese
//! enhancer on pure-Han runs (unless kana/Hangul context routes to ICU).
//!
//! Tokenizer args (space-separated FTS5 barewords after the name; FTS5
//! rejects `=` / `.` inside the tokenize= string, so use barewords):
//! - `jieba` | `zh_jieba` — Chinese enhancer (requires `jieba` feature)
//! - `icu` | `zh_icu` — Chinese via ICU + Han bigrams
//! - `ja` / `ko` — force JA/KO path
//! - no args — Auto routing + default zh mode (jieba if built-in, else icu)
//! Conceptual choice is still "zh ∈ {jieba, icu}".
//!
//! Index extras: jieba DAG colocated (when jieba), Han/kana/Hangul bigrams
//! colocated, KO particle-stem colocated. Query: primaries (+ KO stem
//! colocated; ambiguous short-Han dual emit under jieba Auto).

use icu_segmenter::options::WordBreakInvariantOptions;
use icu_segmenter::WordSegmenter;
use std::sync::Arc;

pub const FTS5_TOKEN_COLOCATED: i32 = 1;
pub const FTS5_TOKENIZE_QUERY: i32 = 0x0001;
pub const FTS5_TOKENIZE_PREFIX: i32 = 0x0002;
pub const FTS5_TOKENIZE_DOCUMENT: i32 = 0x0004;
pub const FTS5_TOKENIZE_AUX: i32 = 0x0008;

/// Whether the binary was compiled with the jieba enhancer.
pub const HAS_JIEBA: bool = cfg!(feature = "jieba");

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ZhMode {
    /// Pure-Han runs use ICU word breaks + Han bigram colocated.
    Icu,
    /// Pure-Han runs use jieba cut / cut_all (requires `jieba` feature).
    Jieba,
}

impl ZhMode {
    pub fn parse(s: &str) -> Option<Self> {
        match s.trim().to_ascii_lowercase().as_str() {
            "icu" | "segmenter" | "intl" => Some(ZhMode::Icu),
            "jieba" | "enhanced" => Some(ZhMode::Jieba),
            _ => None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ForceLang {
    Ja,
    Ko,
}

/// Per-table tokenizer options parsed from FTS5 args.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TokOpts {
    pub zh: ZhMode,
    pub force: Option<ForceLang>,
}

impl Default for TokOpts {
    fn default() -> Self {
        Self {
            zh: if HAS_JIEBA { ZhMode::Jieba } else { ZhMode::Icu },
            force: None,
        }
    }
}

impl TokOpts {
    /// Parse FTS5 tokenizer argument list (each element one bareword/string).
    /// Returns Err with a stable English message on unsupported combos.
    pub fn parse_args(args: &[&str]) -> Result<Self, String> {
        let mut opts = TokOpts::default();
        for raw in args {
            let s = raw.trim();
            if s.is_empty() {
                continue;
            }
            let lower = s.to_ascii_lowercase();
            if let Some(rest) = lower.strip_prefix("zh=") {
                let mode = ZhMode::parse(rest)
                    .ok_or_else(|| format!("unknown zh mode '{rest}', expected jieba|icu"))?;
                if mode == ZhMode::Jieba && !HAS_JIEBA {
                    return Err(
                        "zh=jieba requested but this binary was built without jieba (ICU-only)"
                            .into(),
                    );
                }
                opts.zh = mode;
                continue;
            }
            match lower.as_str() {
                "jieba" | "zh_jieba" | "enhanced" => {
                    if !HAS_JIEBA {
                        return Err(
                            "jieba requested but this binary was built without jieba (ICU-only)"
                                .into(),
                        );
                    }
                    opts.zh = ZhMode::Jieba;
                }
                "icu" | "zh_icu" | "segmenter" => opts.zh = ZhMode::Icu,
                "ja" | "jp" | "japanese" => opts.force = Some(ForceLang::Ja),
                "ko" | "kr" | "korean" => opts.force = Some(ForceLang::Ko),
                "auto" | "zh" | "zh-cn" | "zh-tw" | "chinese" => {
                    opts.force = None;
                }
                other => {
                    // Accept zh=jieba form if somehow quoted through; else error
                    if let Some(rest) = other.strip_prefix("zh=") {
                        let mode = ZhMode::parse(rest).ok_or_else(|| {
                            format!("unknown zh mode '{rest}', expected jieba|icu")
                        })?;
                        if mode == ZhMode::Jieba && !HAS_JIEBA {
                            return Err(
                                "zh=jieba requested but this binary was built without jieba"
                                    .into(),
                            );
                        }
                        opts.zh = mode;
                        continue;
                    }
                    return Err(format!(
                        "unknown tokenizer arg '{other}' (want jieba|zh_jieba|icu|zh_icu|ja|ko|auto)"
                    ));
                }
            }
        }
        Ok(opts)
    }

    pub fn label(self) -> String {
        let zh = match self.zh {
            ZhMode::Icu => "icu",
            ZhMode::Jieba => "jieba",
        };
        match self.force {
            None => format!("zh={zh}"),
            Some(ForceLang::Ja) => format!("zh={zh},force=ja"),
            Some(ForceLang::Ko) => format!("zh={zh},force=ko"),
        }
    }
}

#[derive(Clone, Debug)]
pub struct EmitToken {
    pub text: String,
    pub start: i32,
    pub end: i32,
    /// 0 = primary, FTS5_TOKEN_COLOCATED = synonym at same position
    pub flags: i32,
}

pub struct CjkEngine {
    #[cfg(feature = "jieba")]
    jieba: parking_lot::RwLock<jieba_rs::Jieba>,
}

impl Default for CjkEngine {
    fn default() -> Self {
        Self {
            #[cfg(feature = "jieba")]
            jieba: parking_lot::RwLock::new(jieba_rs::Jieba::new()),
        }
    }
}

impl CjkEngine {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn add_word(&self, word: &str, freq: Option<usize>) {
        #[cfg(feature = "jieba")]
        {
            self.jieba.write().add_word(word, freq, None);
        }
        #[cfg(not(feature = "jieba"))]
        {
            let _ = (word, freq);
        }
    }

    pub fn build_id(&self) -> &'static str {
        if HAS_JIEBA {
            "icu+jieba"
        } else {
            "icu"
        }
    }

    /// Back-compat: default opts.
    pub fn tokenize(&self, text: &str, is_query: bool, oov_bigram: bool) -> Vec<EmitToken> {
        self.tokenize_opts(text, is_query, oov_bigram, TokOpts::default())
    }

    pub fn tokenize_opts(
        &self,
        text: &str,
        is_query: bool,
        oov_bigram: bool,
        opts: TokOpts,
    ) -> Vec<EmitToken> {
        if text.is_empty() {
            return Vec::new();
        }
        #[cfg(feature = "jieba")]
        {
            let jieba = self.jieba.read();
            emit_routed_jieba(&jieba, text, is_query, oov_bigram, opts)
        }
        #[cfg(not(feature = "jieba"))]
        {
            let _ = self;
            emit_routed_icu(text, is_query, oov_bigram, opts)
        }
    }
}

fn is_han(c: char) -> bool {
    matches!(c, '\u{4E00}'..='\u{9FFF}' | '\u{3400}'..='\u{4DBF}' | '\u{F900}'..='\u{FAFF}')
}
fn is_hiragana(c: char) -> bool {
    matches!(c, '\u{3040}'..='\u{309F}')
}
fn is_katakana(c: char) -> bool {
    matches!(c, '\u{30A0}'..='\u{30FF}' | '\u{FF66}'..='\u{FF9D}')
}
fn is_kana(c: char) -> bool {
    is_hiragana(c) || is_katakana(c)
}
fn is_hangul(c: char) -> bool {
    matches!(
        c,
        '\u{AC00}'..='\u{D7AF}' | '\u{1100}'..='\u{11FF}' | '\u{3130}'..='\u{318F}'
    )
}
fn is_cjk_ja_glue(c: char) -> bool {
    matches!(c, 'ー' | '･' | '・' | '々' | 'ゝ' | 'ゞ' | 'ヽ' | 'ヾ')
}
fn han_len(s: &str) -> usize {
    s.chars().count()
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ScriptKind {
    ZhHan,
    Ja,
    Ko,
    Other,
}

fn script_runs(text: &str) -> Vec<(usize, usize, ScriptKind)> {
    let chars: Vec<(usize, char)> = text.char_indices().collect();
    let mut out = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        let (byte_i, ch) = chars[i];
        if is_hangul(ch) {
            i += 1;
            while i < chars.len() && is_hangul(chars[i].1) {
                i += 1;
            }
            let end = if i < chars.len() {
                chars[i].0
            } else {
                text.len()
            };
            out.push((byte_i, end, ScriptKind::Ko));
        } else if is_han(ch) || is_kana(ch) || is_cjk_ja_glue(ch) {
            let start = byte_i;
            let mut has_kana = is_kana(ch);
            i += 1;
            while i < chars.len() {
                let c = chars[i].1;
                if is_han(c) || is_kana(c) || is_cjk_ja_glue(c) {
                    if is_kana(c) {
                        has_kana = true;
                    }
                    i += 1;
                } else {
                    break;
                }
            }
            let end = if i < chars.len() {
                chars[i].0
            } else {
                text.len()
            };
            out.push((
                start,
                end,
                if has_kana {
                    ScriptKind::Ja
                } else {
                    ScriptKind::ZhHan
                },
            ));
        } else {
            i += 1;
            while i < chars.len() {
                let c = chars[i].1;
                if is_hangul(c) || is_han(c) || is_kana(c) || is_cjk_ja_glue(c) {
                    break;
                }
                i += 1;
            }
            let end = if i < chars.len() {
                chars[i].0
            } else {
                text.len()
            };
            out.push((byte_i, end, ScriptKind::Other));
        }
    }
    out
}

fn floor_char_boundary(text: &str, mut i: usize) -> usize {
    if i >= text.len() {
        return text.len();
    }
    while i > 0 && !text.is_char_boundary(i) {
        i -= 1;
    }
    i
}
fn ceil_char_boundary(text: &str, mut i: usize) -> usize {
    if i >= text.len() {
        return text.len();
    }
    while i < text.len() && !text.is_char_boundary(i) {
        i += 1;
    }
    i
}
fn nearby_has_kana(text: &str, start: usize, end: usize, window: usize) -> bool {
    let from = floor_char_boundary(text, start.saturating_sub(window));
    let to = ceil_char_boundary(text, (end + window).min(text.len()));
    text[from..to].chars().any(is_kana)
}

fn icu_segments(text: &str) -> Vec<(usize, usize)> {
    let seg = WordSegmenter::new_auto(WordBreakInvariantOptions::default());
    let mut out = Vec::new();
    let mut prev = 0usize;
    for brk in seg.segment_str(text) {
        if brk > prev {
            let piece = &text[prev..brk];
            if piece.chars().any(|c| !c.is_whitespace() && !is_punct_like(c)) {
                out.push((prev, brk));
            }
        }
        prev = brk;
    }
    out
}

fn is_punct_like(c: char) -> bool {
    c.is_ascii_punctuation()
        || matches!(
            c,
            '、' | '。'
                | '，'
                | '．'
                | '！'
                | '？'
                | '「'
                | '」'
                | '『'
                | '』'
                | '（'
                | '）'
                | '：'
                | '；'
                | '…'
                | '—'
                | '–'
        )
}

/// Lowercase; strip common combining marks after a tiny NFD-ish pass for Latin.
fn fold_latin_token(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        // Skip combining diacritical marks (Mn) so café → cafe when decomposed.
        if matches!(c, '\u{0300}'..='\u{036F}') {
            continue;
        }
        for lc in c.to_lowercase() {
            if matches!(lc, '\u{0300}'..='\u{036F}') {
                continue;
            }
            if lc == 'ß' {
                out.push('s');
                out.push('s');
                continue;
            }
            out.push(match lc {
                'à' | 'á' | 'â' | 'ã' | 'ä' | 'å' => 'a',
                'è' | 'é' | 'ê' | 'ë' => 'e',
                'ì' | 'í' | 'î' | 'ï' => 'i',
                'ò' | 'ó' | 'ô' | 'õ' | 'ö' => 'o',
                'ù' | 'ú' | 'û' | 'ü' => 'u',
                'ý' | 'ÿ' => 'y',
                'ñ' => 'n',
                'ç' => 'c',
                other => other,
            });
        }
    }
    out
}


fn resolve_run_kind(kind: ScriptKind, text: &str, start: usize, end: usize, page_has_kana: bool, opts: TokOpts) -> ScriptKind {
    let mut kind = kind;
    match opts.force {
        Some(ForceLang::Ja) => {
            if matches!(kind, ScriptKind::ZhHan | ScriptKind::Ja) {
                kind = ScriptKind::Ja;
            }
        }
        Some(ForceLang::Ko) => {
            if matches!(kind, ScriptKind::ZhHan | ScriptKind::Ja | ScriptKind::Ko) {
                kind = ScriptKind::Ko;
            }
        }
        None => {
            if kind == ScriptKind::ZhHan
                && (nearby_has_kana(text, start, end, 48)
                    || (page_has_kana && han_len(&text[start..end]) <= 8))
            {
                kind = ScriptKind::Ja;
            }
        }
    }
    kind
}

fn emit_routed_icu(
    text: &str,
    is_query: bool,
    _oov_bigram: bool,
    opts: TokOpts,
) -> Vec<EmitToken> {
    let mut out = Vec::new();
    let page_has_kana = text.chars().any(is_kana);
    for (start, end, kind) in script_runs(text) {
        let kind = resolve_run_kind(kind, text, start, end, page_has_kana, opts);
        let run = &text[start..end];
        match kind {
            ScriptKind::ZhHan => emit_icu_cjk(&mut out, run, start, is_query, true),
            ScriptKind::Ja => emit_ja(&mut out, run, start, is_query),
            ScriptKind::Ko => {
                if matches!(opts.force, Some(ForceLang::Ko)) && run.chars().any(is_han) {
                    emit_icu_cjk(&mut out, run, start, is_query, true);
                } else {
                    emit_ko(&mut out, run, start, is_query);
                }
            }
            ScriptKind::Other => emit_other(&mut out, run, start, is_query),
        }
    }
    out
}

#[cfg(feature = "jieba")]
fn emit_routed_jieba(
    jieba: &jieba_rs::Jieba,
    text: &str,
    is_query: bool,
    oov_bigram: bool,
    opts: TokOpts,
) -> Vec<EmitToken> {
    let mut out = Vec::new();
    let page_has_kana = text.chars().any(is_kana);
    let use_jieba = opts.zh == ZhMode::Jieba;
    for (start, end, kind) in script_runs(text) {
        let kind = resolve_run_kind(kind, text, start, end, page_has_kana, opts);
        let run = &text[start..end];
        match kind {
            ScriptKind::ZhHan => {
                if use_jieba {
                    if is_query {
                        emit_zh_query(&mut out, jieba, run, start, opts);
                    } else {
                        emit_han_index(&mut out, jieba, run, start, oov_bigram);
                    }
                } else {
                    emit_icu_cjk(&mut out, run, start, is_query, true);
                }
            }
            ScriptKind::Ja => emit_ja(&mut out, run, start, is_query),
            ScriptKind::Ko => {
                if matches!(opts.force, Some(ForceLang::Ko)) && run.chars().any(is_han) {
                    emit_icu_cjk(&mut out, run, start, is_query, true);
                } else {
                    emit_ko(&mut out, run, start, is_query);
                }
            }
            ScriptKind::Other => emit_other(&mut out, run, start, is_query),
        }
    }
    out
}


/// ICU word breaks as primary; optional Han/kana bigram colocated on index.
fn emit_icu_cjk(
    out: &mut Vec<EmitToken>,
    run: &str,
    base: usize,
    is_query: bool,
    han_bigrams: bool,
) {
    let segs = icu_segments(run);
    if segs.is_empty() {
        let t = run.trim();
        if !t.is_empty() {
            out.push(EmitToken {
                text: t.to_string(),
                start: base as i32,
                end: (base + run.len()) as i32,
                flags: 0,
            });
        }
    } else {
        for (s, e) in &segs {
            let w = run[*s..*e].trim();
            if w.is_empty() {
                continue;
            }
            out.push(EmitToken {
                text: w.to_string(),
                start: (base + *s) as i32,
                end: (base + *e) as i32,
                flags: 0,
            });
        }
    }
    if !is_query && han_bigrams {
        emit_cjk_run_bigrams(out, run, base);
    }
}

fn emit_ja(out: &mut Vec<EmitToken>, run: &str, base: usize, is_query: bool) {
    emit_icu_cjk(out, run, base, is_query, true);
}

fn emit_other(out: &mut Vec<EmitToken>, run: &str, base: usize, _is_query: bool) {
    // ICU base for Latin / Thai / numbers / mixed ASCII
    for (s, e) in icu_segments(run) {
        let w = run[s..e].trim();
        if w.is_empty() {
            continue;
        }
        // Skip pure punctuation leftovers
        if w.chars().all(is_punct_like) {
            continue;
        }
        let text = if w.is_ascii() {
            w.to_ascii_lowercase()
        } else if w.chars().any(|c| c.is_ascii_alphabetic() || c.is_alphabetic())
            && !w.chars().any(|c| is_han(c) || is_kana(c) || is_hangul(c))
        {
            fold_latin_token(w)
        } else {
            w.to_string()
        };
        if text.is_empty() {
            continue;
        }
        out.push(EmitToken {
            text,
            start: (base + s) as i32,
            end: (base + e) as i32,
            flags: 0,
        });
    }
}

fn emit_cjk_run_bigrams(out: &mut Vec<EmitToken>, run: &str, base: usize) {
    let chars: Vec<(usize, char)> = run
        .char_indices()
        .filter(|(_, c)| is_han(*c) || is_kana(*c) || is_hangul(*c) || is_cjk_ja_glue(*c))
        .collect();
    for i in 0..chars.len().saturating_sub(1) {
        let (b0, c0) = chars[i];
        let (_b1, c1) = chars[i + 1];
        let end = chars[i + 1].0 + c1.len_utf8();
        let gram: String = [c0, c1].iter().collect();
        out.push(EmitToken {
            text: gram,
            start: (base + b0) as i32,
            end: (base + end) as i32,
            flags: FTS5_TOKEN_COLOCATED,
        });
    }
}

fn emit_char_bigrams(out: &mut Vec<EmitToken>, w: &str, abs_start: usize, flags: i32) {
    let chars: Vec<char> = w.chars().collect();
    let mut off = 0usize;
    for i in 0..chars.len().saturating_sub(1) {
        let b0 = chars[i].len_utf8();
        let b1 = chars[i + 1].len_utf8();
        let gram: String = chars[i..i + 2].iter().collect();
        let g_start = abs_start + off;
        out.push(EmitToken {
            text: gram,
            start: g_start as i32,
            end: (g_start + b0 + b1) as i32,
            flags,
        });
        off += b0;
    }
}

#[cfg(feature = "jieba")]
fn emit_zh_query(
    out: &mut Vec<EmitToken>,
    jieba: &jieba_rs::Jieba,
    run: &str,
    base: usize,
    opts: TokOpts,
) {
    let cuts: Vec<_> = jieba
        .cut(run, true)
        .into_iter()
        .filter(|t| !t.word.trim().is_empty())
        .collect();
    let multi: Vec<_> = cuts.iter().filter(|t| han_len(t.word.trim()) >= 2).collect();
    if multi.is_empty() {
        out.push(EmitToken {
            text: run.to_string(),
            start: base as i32,
            end: (base + run.len()) as i32,
            flags: 0,
        });
    } else {
        for t in &multi {
            let w = t.word.trim();
            out.push(EmitToken {
                text: w.to_string(),
                start: (base + t.byte_start) as i32,
                end: (base + t.byte_end) as i32,
                flags: 0,
            });
        }
    }
    // Ambiguous Auto: also hang ICU segments as colocated for JA-indexed Han
    if opts.force.is_none() && run.chars().all(is_han) {
        let existing: std::collections::HashSet<String> =
            out.iter().map(|t| t.text.clone()).collect();
        for (s, e) in icu_segments(run) {
            let w = run[s..e].trim();
            if w.is_empty() || existing.contains(w) {
                continue;
            }
            out.push(EmitToken {
                text: w.to_string(),
                start: (base + s) as i32,
                end: (base + e) as i32,
                flags: FTS5_TOKEN_COLOCATED,
            });
        }
        if han_len(run) <= 6
            && !multi.is_empty()
            && !(multi.len() == 1 && multi[0].word.trim() == run)
        {
            out.push(EmitToken {
                text: run.to_string(),
                start: base as i32,
                end: (base + run.len()) as i32,
                flags: FTS5_TOKEN_COLOCATED,
            });
        }
    }
}

#[cfg(feature = "jieba")]
fn emit_han_index(
    out: &mut Vec<EmitToken>,
    jieba: &jieba_rs::Jieba,
    run: &str,
    base: usize,
    oov_bigram: bool,
) {
    let primaries: Vec<_> = jieba.cut(run, true).into_iter().collect();
    let all: Vec<_> = jieba
        .cut_all(run)
        .into_iter()
        .filter(|t| han_len(t.word) >= 2)
        .collect();
    let dict_spans: std::collections::HashSet<(usize, usize)> =
        all.iter().map(|t| (t.byte_start, t.byte_end)).collect();

    for p in &primaries {
        let w = p.word.trim();
        if w.is_empty() {
            continue;
        }
        let p_start = base + p.byte_start;
        let p_end = base + p.byte_end;
        out.push(EmitToken {
            text: w.to_string(),
            start: p_start as i32,
            end: p_end as i32,
            flags: 0,
        });
        for sub in &all {
            if sub.byte_start >= p.byte_start
                && sub.byte_start < p.byte_end
                && !(sub.byte_start == p.byte_start && sub.byte_end == p.byte_end)
            {
                let sw = sub.word.trim();
                if sw.is_empty() || sw == w {
                    continue;
                }
                out.push(EmitToken {
                    text: sw.to_string(),
                    start: (base + sub.byte_start) as i32,
                    end: (base + sub.byte_end) as i32,
                    flags: FTS5_TOKEN_COLOCATED,
                });
            }
        }
        if oov_bigram && !dict_spans.contains(&(p.byte_start, p.byte_end)) && han_len(w) >= 2 {
            emit_char_bigrams(out, w, p_start, FTS5_TOKEN_COLOCATED);
        }
    }
}

const KO_PARTICLES: &[&str] = &[
    "에서는", "에서도", "으로는", "으로도", "에서의", "습니다", "입니다", "에서", "으로",
    "부터", "까지", "에게", "한테", "처럼", "보다", "이나", "하는", "하면", "해서", "하며",
    "하여", "했다", "했습니다", "의", "을", "를", "이", "가", "은", "는", "도", "만", "로",
    "과", "와", "에",
];

fn emit_ko(out: &mut Vec<EmitToken>, run: &str, base: usize, is_query: bool) {
    let segs = icu_segments(run);
    let pieces: Vec<(usize, usize)> = if segs.is_empty() {
        vec![(0, run.len())]
    } else {
        segs
    };
    for (s, e) in pieces {
        let w = run[s..e].trim();
        if w.is_empty() || !w.chars().any(is_hangul) {
            continue;
        }
        out.push(EmitToken {
            text: w.to_string(),
            start: (base + s) as i32,
            end: (base + e) as i32,
            flags: 0,
        });
        if let Some(stem) = strip_ko_particle(w) {
            let stem_bytes = stem.len();
            out.push(EmitToken {
                text: stem.to_string(),
                start: (base + s) as i32,
                end: (base + s + stem_bytes) as i32,
                flags: FTS5_TOKEN_COLOCATED,
            });
        }
        if !is_query {
            emit_char_bigrams(out, w, base + s, FTS5_TOKEN_COLOCATED);
        }
    }
}

fn strip_ko_particle(w: &str) -> Option<&str> {
    let mut best_particle_len = 0usize;
    let mut result: Option<&str> = None;
    for p in KO_PARTICLES {
        if p.len() > best_particle_len && w.len() > p.len() && w.ends_with(p) {
            let stem = &w[..w.len() - p.len()];
            if stem.chars().filter(|c| is_hangul(*c)).count() >= 2 {
                best_particle_len = p.len();
                result = Some(stem);
            }
        }
    }
    result
}

pub fn global_engine() -> &'static Arc<CjkEngine> {
    use std::sync::OnceLock;
    static ENGINE: OnceLock<Arc<CjkEngine>> = OnceLock::new();
    ENGINE.get_or_init(|| Arc::new(CjkEngine::new()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opts_parse_zh() {
        assert_eq!(
            TokOpts::parse_args(&["zh=icu"]).unwrap().zh,
            ZhMode::Icu
        );
        let d = TokOpts::default();
        if HAS_JIEBA {
            assert_eq!(d.zh, ZhMode::Jieba);
            assert_eq!(
                TokOpts::parse_args(&["zh=jieba"]).unwrap().zh,
                ZhMode::Jieba
            );
        } else {
            assert_eq!(d.zh, ZhMode::Icu);
            assert!(TokOpts::parse_args(&["zh=jieba"]).is_err());
        }
    }

    #[test]
    fn latin_icu_breaks() {
        let e = CjkEngine::new();
        let opts = TokOpts {
            zh: ZhMode::Icu,
            force: None,
        };
        let toks = e.tokenize_opts("pre-commit on git-scm.com v2.4.0 C++", false, true, opts);
        let p: Vec<_> = toks
            .iter()
            .filter(|t| t.flags == 0)
            .map(|t| t.text.as_str())
            .collect();
        println!("latin primary={p:?}");
        assert!(p.iter().any(|t| t.contains("pre") || *t == "pre-commit" || *t == "commit"), "{p:?}");
        assert!(p.iter().any(|t| t.contains("git") || t.contains("scm")), "{p:?}");
    }

    #[test]
    fn thai_icu_smoke() {
        let e = CjkEngine::new();
        let opts = TokOpts {
            zh: ZhMode::Icu,
            force: None,
        };
        // "ภาษาไทย" = Thai language
        let toks = e.tokenize_opts("ภาษาไทย", false, true, opts);
        let p: Vec<_> = toks.iter().filter(|t| t.flags == 0).map(|t| t.text.clone()).collect();
        println!("thai={p:?}");
        assert!(!p.is_empty());
    }

    #[test]
    fn kana_routes_to_icu_not_jieba() {
        let e = CjkEngine::new();
        let toks = e.tokenize("バージョン管理", false, true);
        let primary: Vec<_> = toks
            .iter()
            .filter(|t| t.flags == 0)
            .map(|t| t.text.clone())
            .collect();
        assert!(
            primary.iter().any(|t| t == "バージョン"),
            "got {primary:?}"
        );
    }

    #[test]
    fn hangul_particle_stem() {
        let e = CjkEngine::new();
        let toks = e.tokenize("저장소에서", false, true);
        let texts: Vec<_> = toks.iter().map(|t| t.text.as_str()).collect();
        assert!(
            texts.iter().any(|t| *t == "저장소"),
            "missing stem in {texts:?}"
        );
    }

    #[cfg(feature = "jieba")]
    #[test]
    fn jieba_index_emits_control() {
        let e = CjkEngine::new();
        let toks = e.tokenize("版本控制系统", false, true);
        assert!(toks.iter().any(|t| t.text == "控制"));
        let q = e.tokenize("版本控制系统", true, true);
        let primary: Vec<_> = q.iter().filter(|t| t.flags == 0).map(|t| t.text.as_str()).collect();
        assert_eq!(primary, vec!["版本", "控制系统"]);
    }

    #[test]
    fn icu_zh_emits_bigrams() {
        let e = CjkEngine::new();
        let opts = TokOpts {
            zh: ZhMode::Icu,
            force: None,
        };
        let toks = e.tokenize_opts("版本控制系统", false, true, opts);
        let primary: Vec<_> = toks
            .iter()
            .filter(|t| t.flags == 0)
            .map(|t| t.text.clone())
            .collect();
        let colo: Vec<_> = toks
            .iter()
            .filter(|t| t.flags == FTS5_TOKEN_COLOCATED)
            .map(|t| t.text.clone())
            .collect();
        println!("icu zh primary={primary:?} colo_sample={:?}", &colo[..colo.len().min(6)]);
        assert!(!primary.is_empty());
        assert!(colo.iter().any(|t| t.chars().count() == 2), "expected Han bigrams");
    }
}
