#!/usr/bin/env python3
"""Build method-independent SOURCE GT for layout-compare v3."""
from __future__ import annotations
import json, re, subprocess, unicodedata, random
from pathlib import Path
from difflib import SequenceMatcher

ROOT = Path('BENCH_ROOT/layout-compare/corpus-v3')
PDF_DIR = ROOT / 'pdfs-cap'
SRC_DIR = ROOT / 'sources'
OUT = ROOT / 'gt' / 'SOURCE_GT_V3.json'
META = ROOT / 'meta' / 'papers_uniq.tsv'
OLD_GT = Path('BENCH_ROOT/layout-compare/gt/SOURCE_GT.json')
PROGIT_EN = Path('BENCH_ROOT/layout-compare/gt-sources/progit2')
PROGIT_ZH = Path('BENCH_ROOT/layout-compare/gt-sources/progit2-zh')
random.seed(42)

def nfkc(s: str) -> str:
    s = unicodedata.normalize('NFKC', s or '')
    for a, b in [('\u00ad',''),('\ufeff',''),('\u2010','-'),('\u2011','-'),('\u2012','-'),
                 ('\u2013','-'),('\u2014','-'),('\u2018',"'"),('\u2019',"'"),('\u201c','"'),
                 ('\u201d','"'),('ﬁ','fi'),('ﬂ','fl'),('ﬀ','ff')]:
        s = s.replace(a, b)
    return s

def soft(s: str) -> str:
    return re.sub(r'[^a-z0-9\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]+', '', nfkc(s).lower())

def norm_ws(s: str) -> str:
    s = nfkc(s)
    s = re.sub(r'[ \t\f\v]+', ' ', s)
    s = re.sub(r'\s*\n\s*', '\n', s)
    return s.strip()

def pdf_plain(pdf: Path) -> str:
    r = subprocess.run(['pdftotext', '-enc', 'UTF-8', '-nopgbrk', str(pdf), '-'],
                       capture_output=True, text=True, errors='replace')
    return norm_ws(r.stdout or '')

def pdf_lines(pdf: Path) -> list[str]:
    r = subprocess.run(['pdftotext', '-enc', 'UTF-8', '-layout', str(pdf), '-'],
                       capture_output=True, text=True, errors='replace')
    return [norm_ws(l) for l in (r.stdout or '').splitlines() if norm_ws(l)]

def clean_tex_chunk(raw: str) -> str:
    raw = re.sub(r'(?m)^\s*%.*$', '', raw)
    raw = re.sub(r'(?s)\\begin\{(figure|table|equation|align\*?|eqnarray\*?|verbatim|lstlisting|tikzpicture|algorithm\*?|algorithmic)\}.*?\\end\{\1\}', '\n\n', raw)
    raw = re.sub(r'\\(cite|citep|label|ref|pageref|eqref|Cref|cref|footnote|footnotetext)(\[[^\]]*\])?\{[^{}]*\}', ' ', raw)
    raw = re.sub(r'\\(includegraphics|input|include|bibliography|bibliographystyle|addbibresource)(\[[^\]]*\])?\{[^{}]*\}', ' ', raw)
    raw = re.sub(r'\$\$[^$]+\$\$', ' ', raw)
    raw = re.sub(r'\$[^$]{1,120}\$', ' ', raw)
    raw = re.sub(r'\\\[.*?\\\]', ' ', raw, flags=re.S)
    raw = re.sub(r'\\\(.*?\\\)', ' ', raw, flags=re.S)
    # keep section titles as paras
    raw = re.sub(r'\\(section|subsection|subsubsection|paragraph)\*?\{([^{}]*)\}', r'\n\n\2\n\n', raw)
    raw = re.sub(r'\\(textbf|textit|emph|texttt|textsc|mathrm|mathbf|mathit)\{([^{}]*)\}', r'\2', raw)
    raw = re.sub(r'\\[a-zA-Z]+\*?(\[[^\]]*\])?(\{[^{}]*\})*', ' ', raw)
    raw = raw.replace('{', ' ').replace('}', ' ').replace('~', ' ').replace('\\', ' ')
    return raw

def latex_to_paras(src_dir: Path) -> tuple[list[str], list[str], list[str]]:
    texs = sorted(src_dir.rglob('*.tex'))
    if not texs:
        return [], [], []
    # Prefer body section files; also include main after \begin{document}
    bodies = []
    for t in texs:
        if t.stat().st_size > 2_000_000:
            continue
        raw = t.read_text(errors='ignore')
        if re.search(r'\\documentclass', raw[:1000]):
            m = re.search(r'\\begin\{document\}(.*)\\end\{document\}', raw, re.S)
            raw = m.group(1) if m else re.split(r'\\begin\{document\}', raw, maxsplit=1)[-1]
        bodies.append(raw)
    text = clean_tex_chunk('\n\n'.join(bodies))
    # Also try detex on main for extra coverage
    mains = [t for t in texs if re.search(r'\\documentclass', t.read_text(errors='ignore')[:2000])]
    if mains:
        try:
            r = subprocess.run(['detex', '-n', str(mains[0])], capture_output=True, text=True,
                               timeout=15, cwd=str(src_dir), errors='replace')
            if r.stdout and len(r.stdout) > 200:
                text = text + '\n\n' + clean_tex_chunk(r.stdout)
        except Exception:
            pass

    paras_raw = re.split(r'\n\s*\n+', text)
    paras, headings, captions = [], [], []
    seen = set()
    for p in paras_raw:
        p = norm_ws(re.sub(r'\s+', ' ', p))
        ps = soft(p)
        if len(ps) < 40:
            continue
        if ps in seen:
            continue
        if re.search(r'usepackage|documentclass|bibliographystyle|arxiv\.org|creativecommons', p, re.I):
            continue
        seen.add(ps)
        if re.match(r'^(abstract|introduction|related work|conclusion|references|acknowledgements?|experiments?|method|results?)\b', p, re.I) and len(p) < 90:
            headings.append(p); continue
        if re.match(r'^(figure|table|fig\.|tab\.)\s*\d', p, re.I):
            captions.append(p); continue
        paras.append(p)

    # If still few paras (mega-blob), split on sentence boundaries into ~para-sized chunks
    if len(paras) <= 3:
        blob = ' '.join(paras) if paras else norm_ws(re.sub(r'\s+', ' ', text))
        sents = re.split(r'(?<=[.!?])\s+(?=[A-Z])', blob)
        paras = []
        buf = ''
        for s in sents:
            s = norm_ws(s)
            if not s: continue
            if len(soft(buf + ' ' + s)) < 180:
                buf = (buf + ' ' + s).strip()
            else:
                if len(soft(buf)) >= 40:
                    paras.append(buf)
                buf = s
        if len(soft(buf)) >= 40:
            paras.append(buf)
    return paras, headings, captions

def asciidoc_paras(root: Path, max_files=12) -> list[str]:
    files = sorted(root.glob('book/*/ch*.asc')) + sorted(root.glob('*/ch*.asc'))
    if not files:
        files = sorted(root.rglob('*.asc'))[:max_files]
    files = files[:max_files]
    paras, seen = [], set()
    for f in files:
        raw = f.read_text(errors='ignore')
        raw = re.sub(r'(?m)^ifdef::.*?^endif::.*?$', '', raw, flags=re.S)
        raw = re.sub(r'(?m)^\[\[.*?\]\]\s*$', '', raw)
        raw = re.sub(r'\(\(\(.*?\)\)\)', '', raw)
        raw = re.sub(r'(?m)^[=]+\s+', '', raw)
        raw = re.sub(r'`[^`]+`', ' ', raw)
        for p in re.split(r'\n\s*\n+', raw):
            p = norm_ws(re.sub(r'[*_]', '', p))
            ps = soft(p)
            if len(ps) >= 40 and ps not in seen:
                seen.add(ps); paras.append(p)
    return paras

def furniture_from_pdf(pdf: Path) -> list[str]:
    lines = pdf_lines(pdf)
    counts = {}
    for l in lines:
        if 3 <= len(l) <= 60:
            counts[l] = counts.get(l, 0) + 1
    furn = []
    for k, c in counts.items():
        if c < 2: continue
        if re.fullmatch(r'\d{1,4}', k):
            furn.append(k)
        elif re.search(r'(arxiv|proceedings|conference|ieee|acm|cvpr|neurips|nips|iclr|icml|acl|emnlp|copyright|licensed|doi:|vol\.|pp\.)', k, re.I):
            furn.append(k)
        elif len(k) <= 40 and c >= 3:
            furn.append(k)
    return sorted(set(furn))[:40]

def align_paras(paras: list[str], pdf_text: str, min_ratio=0.70) -> tuple[list[dict], float]:
    pdf_s = soft(pdf_text)
    aligned = []
    eligible = 0
    for i, p in enumerate(paras):
        ps = soft(p)
        if len(ps) < 36:
            continue
        eligible += 1
        windows = []
        for off, L in [(0, 60), (0, 100), (len(ps)//5, 60), (len(ps)//3, 60), (len(ps)//2, 60)]:
            w = ps[off:off+L]
            if len(w) >= 30:
                windows.append(w)
        hit = None
        for wi, w in enumerate(windows):
            if w in pdf_s:
                hit = ('soft', 1.0 if wi < 2 else 0.95); break
        if hit is None and windows:
            win = windows[0]
            needle = win[:6]
            best, start, scans = 0.0, 0, 0
            while scans < 30:
                j = pdf_s.find(needle, start)
                if j < 0: break
                r = SequenceMatcher(None, win, pdf_s[j:j+len(win)+8]).ratio()
                best = max(best, r)
                if best >= 0.88: break
                start = j + 1; scans += 1
            if best >= min_ratio:
                hit = ('fuzzy', round(best, 3))
        if hit:
            aligned.append({'i': i, 'text': p, 'method': hit[0], 'score': hit[1]})
    cov = len(aligned) / max(1, eligible)
    return aligned, cov

def is_cjk(s: str) -> bool:
    return bool(re.search(r'[\u3400-\u9fff]', s))

def sample_queries(aligned, pdf_text, pdf_line_list, n_body=16, n_term=6):
    queries, pdf_s = [], soft(pdf_text)
    line_softs = [soft(l) for l in pdf_line_list]
    candidates = []
    for a in aligned:
        t = a['text']
        sents = re.split(r'(?<=[。.!?])\s+', t)
        for s in sents:
            s = norm_ws(s)
            if len(soft(s)) < 20: continue
            if is_cjk(s):
                ss = soft(s)
                raw = re.sub(r'\s+', '', nfkc(s))
                for L in (8, 10, 12):
                    if len(ss) < L: continue
                    for off in range(0, min(24, len(ss)-L+1), 4):
                        frag = ss[off:off+L]
                        idx = soft(raw).find(frag)
                        q = raw[idx:idx+L] if idx >= 0 else frag
                        if soft(q) in pdf_s:
                            candidates.append(('cjk', q))
                    break
            else:
                words = s.split()
                if len(words) >= 5:
                    for start in range(0, min(5, len(words)-4)):
                        frag = ' '.join(words[start:start+5])
                        if soft(frag) in pdf_s:
                            candidates.append(('en', frag))
                        # deliberately include hyphen-join spanning fragments (line-break style)
                        if start + 6 <= len(words):
                            frag2 = ' '.join(words[start:start+6])
                            if soft(frag2) in pdf_s:
                                candidates.append(('en', frag2))

    def cross_flags(q):
        qs = soft(q)
        in_one = any(qs in ls for ls in line_softs if ls)
        cross_line = (not in_one) and (qs in pdf_s)
        half = max(4, len(qs)//2)
        left, right = qs[:half], qs[half:]
        cross_col = False
        if left and right:
            li = [i for i, ls in enumerate(line_softs) if left in ls]
            ri = [i for i, ls in enumerate(line_softs) if right in ls]
            if li and ri and not set(li) & set(ri):
                cross_line = True
                if abs(min(ri) - min(li)) > 2:
                    cross_col = True
        return {'cross_line': cross_line, 'cross_col': cross_col, 'cross_page': False}

    random.shuffle(candidates)
    cross_first = [c for c in candidates if cross_flags(c[1])['cross_line']]
    ordered = cross_first + [c for c in candidates if c not in cross_first]
    seen = set()
    for kind, q in ordered:
        key = soft(q)
        if key in seen or len(key) < 6: continue
        seen.add(key)
        queries.append({'q': q, 'kind': kind, 'src': 'body', **cross_flags(q)})
        if sum(1 for x in queries if x['src']=='body') >= n_body: break

    terms = []
    for a in aligned[:50]:
        t = a['text']
        if is_cjk(t):
            ss = re.sub(r'[^\u3400-\u9fff]', '', nfkc(t))
            for i in range(0, max(0, len(ss)-4), 5):
                term = ss[i:i+4]
                if soft(term) in pdf_s: terms.append(('cjk', term))
        else:
            for m in re.finditer(r'\b[A-Za-z][a-z]+(?:[-\s][A-Za-z][a-z]+){1,2}\b', t):
                term = m.group(0)
                if soft(term) in pdf_s: terms.append(('en', term))
    random.shuffle(terms)
    for kind, q in terms:
        key = soft(q)
        if key in seen: continue
        seen.add(key)
        queries.append({'q': q, 'kind': kind, 'src': 'term', **cross_flags(q)})
        if sum(1 for x in queries if x['src']=='term') >= n_term: break
    return queries

def adjacency_pairs(aligned, n=12):
    pairs = []
    for a in aligned:
        sents = [norm_ws(s) for s in re.split(r'(?<=[。.!?])\s+', a['text']) if len(soft(s)) >= 24]
        for i in range(len(sents)-1):
            pairs.append({'a': sents[i][:180], 'b': sents[i+1][:180]})
            if len(pairs) >= n: return pairs
    for i in range(len(aligned)-1):
        pairs.append({'a': aligned[i]['text'][:180], 'b': aligned[i+1]['text'][:180]})
        if len(pairs) >= n: break
    return pairs[:n]

def load_layout_meta():
    meta = {}
    if META.exists():
        for line in META.read_text().splitlines():
            parts = line.strip().split('\t')
            if len(parts) >= 2:
                meta[parts[0]] = {'cols': parts[1], 'name': parts[2] if len(parts)>2 else ''}
    return meta

def build_doc(stem, paras, heads, caps, pdf, layout, short, source_kind, source_paths, pages, old_furn=None):
    pdf_text = pdf_plain(pdf)
    lines = pdf_lines(pdf)
    aligned, cov = align_paras(paras, pdf_text)
    if len(aligned) < 5:
        aligned, cov = align_paras(paras, pdf_text, min_ratio=0.60)
    furn = furniture_from_pdf(pdf) or (old_furn or [])
    queries = sample_queries(aligned, pdf_text, lines)
    return {
        'id': stem, 'source_kind': source_kind, 'source_paths': source_paths,
        'pdf': str(pdf), 'layout': layout, 'short_name': short,
        'pdf_pages_evaluated': pages,
        'paragraphs_source': len(paras), 'paragraphs_aligned': len(aligned),
        'alignment_coverage': round(cov, 4),
        'paragraphs': [a['text'] for a in aligned],
        'align_meta': [{'i': a['i'], 'method': a['method'], 'score': a['score']} for a in aligned],
        'headings': heads[:20], 'captions': caps[:20], 'furniture': furn,
        'queries': queries, 'adjacency_pairs': adjacency_pairs(aligned),
        'n_cross_line_queries': sum(1 for q in queries if q.get('cross_line')),
        'n_cross_col_queries': sum(1 for q in queries if q.get('cross_col')),
    }

def main():
    layout_meta = load_layout_meta()
    old = json.loads(OLD_GT.read_text()) if OLD_GT.exists() else {'docs': {}}
    docs = {}

    for pdf in sorted(PDF_DIR.glob('*.pdf')):
        stem = pdf.stem
        if stem in ('progit-en', 'progit-zh', 'sample-cjk'):
            continue
        src = SRC_DIR / stem
        paras, heads, caps = latex_to_paras(src) if src.exists() else ([], [], [])
        # Merge old GT paras for attention/lora if present
        old_key = {'1706.03762': 'arxiv-attention', '2106.09685': 'arxiv-lora'}.get(stem)
        if old_key and old_key in old.get('docs', {}):
            for p in old['docs'][old_key].get('paragraphs', []):
                if soft(p) not in {soft(x) for x in paras}:
                    paras.append(p)
        lm = layout_meta.get(stem, {})
        doc = build_doc(stem, paras, heads, caps, pdf, lm.get('cols','unknown'), lm.get('name',''),
                        'arxiv-latex', [str(src)] if src.exists() else [], 6)
        docs[stem] = doc
        print(f"{stem}: src={doc['paragraphs_source']} aligned={doc['paragraphs_aligned']} cov={doc['alignment_coverage']:.2f} q={len(doc['queries'])} xline={doc['n_cross_line_queries']}", flush=True)

    for pid, root in [('progit-en', PROGIT_EN), ('progit-zh', PROGIT_ZH)]:
        pdf = PDF_DIR / f'{pid}.pdf'
        paras = asciidoc_paras(root)
        if pid in old.get('docs', {}):
            for p in old['docs'][pid].get('paragraphs', []):
                if soft(p) not in {soft(x) for x in paras}:
                    paras.append(p)
        doc = build_doc(pid, paras, [], [], pdf, '1col', pid, 'progit-asciidoc', [str(root)], 5,
                        old.get('docs', {}).get(pid, {}).get('furniture'))
        docs[pid] = doc
        print(f"{pid}: aligned={doc['paragraphs_aligned']} cov={doc['alignment_coverage']:.2f} q={len(doc['queries'])}", flush=True)

    # sample-cjk
    pid = 'sample-cjk'
    old_doc = old['docs'][pid]
    pdf = PDF_DIR / f'{pid}.pdf'
    paras = list(old_doc['paragraphs'])
    doc = build_doc(pid, paras, old_doc.get('headings', []), old_doc.get('captions', []),
                    pdf, '1col', pid, 'hand-label-authored', old_doc.get('source_paths', []), 4,
                    old_doc.get('furniture'))
    if doc['paragraphs_aligned'] < 1:
        doc['paragraphs'] = paras
        doc['paragraphs_aligned'] = len(paras)
        doc['alignment_coverage'] = 1.0
        doc['queries'] = old_doc.get('queries', [])
        for q in doc['queries']:
            q.setdefault('cross_line', False); q.setdefault('cross_col', False); q.setdefault('cross_page', False)
        doc['adjacency_pairs'] = old_doc.get('adjacency_pairs', [])
    docs[pid] = doc
    print(f"{pid}: aligned={doc['paragraphs_aligned']} q={len(doc['queries'])}", flush=True)

    kept = {}
    for k, v in docs.items():
        if v['paragraphs_aligned'] >= 2 and len(v['queries']) >= 4:
            kept[k] = v
        else:
            print(f"DROP {k}: aligned={v['paragraphs_aligned']} q={len(v['queries'])}", flush=True)

    report = {
        'meta': {
            'version': 3,
            'methodology': 'Source GT (LaTeX/AsciiDoc/hand) aligned to PDF via soft/fuzzy. Queries never from A/B/C/D. Tokenizer fixed zotlit_cjk bigram-primary. Inference Rust static ort napi.',
            'tokenizer': 'BENCH_ROOT/cjk-recall/dist/fixed/zotlit_cjk_icu.so',
            'pdf_dir': str(PDF_DIR),
            'n_docs': len(kept),
            'n_2col': sum(1 for v in kept.values() if v.get('layout')=='2col'),
            'n_1col': sum(1 for v in kept.values() if v.get('layout')=='1col'),
            'mean_alignment_coverage': round(sum(v['alignment_coverage'] for v in kept.values())/max(1,len(kept)), 4),
            'total_queries': sum(len(v['queries']) for v in kept.values()),
            'total_cross_line': sum(v['n_cross_line_queries'] for v in kept.values()),
        },
        'docs': kept,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(report, ensure_ascii=False, indent=2))
    print('Wrote', OUT, 'docs', len(kept), 'mean_cov', report['meta']['mean_alignment_coverage'],
          'queries', report['meta']['total_queries'], flush=True)

if __name__ == '__main__':
    main()
