# ZotLit CJK 检索召回诊断与修复报告

日期：2026-10-27（Asia/Singapore）  
目录：`BENCH_ROOT/cjk-recall/`  
约束：查询采样**不**来自 SDT / 任何版面抽取方法的输出；以 **源文本**（progit2-zh/ja AsciiDoc、中日维基等）为方法无关 ground truth，再对 **PDF 抽取页文本**建的 FTS 索引测召回。

---

## 1. 结论（先看）

| 配置 | ZH 手写词 phrase | ZH 术语 phrase | ZH 随机汉字子串 phrase | ZH andBi（前 3 bigram AND） | 伪命中率 | 词表规模 |
|------|-----------------:|---------------:|----------------------:|---------------------------:|---------:|---------:|
| baseline-icu | 0.980 | 0.947 | **0.437** | **0.033** | 0.025 | 33425 |
| baseline-jieba | 0.991 | 0.988 | 0.918 | 0.426 | **0.425** | 11605 |
| **fixed-icu** | **0.996** | **1.000** | **1.000** | **1.000** | **0** | 32744 |
| **fixed-jieba** | **0.996** | **1.000** | **1.000** | **1.000** | **0** | 33574 |
| FTS5 trigram 参考 | 0.412 | 0.412 | 1.000 | 0 | 0 | 110024 |

日文（progit-ja PDF 索引 ← ja 源采样）：

| 配置 | JA hand | JA term | JA substr |
|------|--------:|--------:|----------:|
| baseline-icu | 0.982 | 0.966 | **0.368** |
| **fixed-icu** | **1.000** | **1.000** | **1.000** |
| trigram | 0.818 | 0.425 | 1.000 |

**根因**：索引里已有 colocated 汉字 bigram，但 **查询路径用 ICU/jieba 切词**，像「本控」会被拆成「本」+「控」，永远匹配不到索引中的 `本控`；layout-compare 里 AND≈0.06 不是 harness 写错，而是同一不对称。

**修复**：CJK（Han/假名/谚文）**重叠字 bigram 作 PRIMARY（顺序位置）**，ICU/jieba 词作 **COLOCATED**；查询同样发 bigram primary。短文档探针与全量 PDF 评测均恢复子串/短语/andBi。

**推荐**：默认 **ICU-base + bigram-primary**（`fixed-icu`）；jieba 作可选增强（体积约 +3 MiB，本评测召回与 ICU 持平，无额外收益）。不要用裸 trigram 做主分词（双字词/短术语召回差，词表约 3×）。

---

## 2. 方法

### 2.1 Ground truth 与索引（方法无关）

- **查询来源（源文本）**
  - `corpus/progit-zh-source-paras.txt`（progit2-zh AsciiDoc，2304 行）
  - `corpus/progit-ja-source-paras.txt`（progit-ja，2429 行）
  - `corpus/extra/zhwiki-*.txt`、`jawiki-*.txt`、`zh-lunyu.txt`（维基/文言补充）
- **查询类型**
  - `zh-hand` / `ja-hand`：手写真实用户词（版本控制、暂存区、コミット…）
  - `zh-term` / `ja-term`：从源段落抽的多字术语/短语
  - `cjk-substr` / `ja-substr`：源文本中随机连续汉字/假名子串（模拟划词搜索）
- **索引语料（PDF 抽取）**
  - ZH：`BENCH_ROOT/progit-zh.clean.json`（501 页）
  - JA：`BENCH_ROOT/jk-corpus/progit-ja.pages.json`（447 页）
- **GT 定义**：查询字符串若在某 PDF 页 `String.includes` 为真，则该页为相关页；只对「源查询 ∩ PDF 页文本非空」的查询计召回（源有、PDF 无的记 `skippedNoGt`，不进召回分母）。
- **指标**：按查询宏平均的 phrase / bare / andBi 召回；phrase 精度；伪命中率（源有、PDF 无的随机串不应命中）。
- **进程隔离**：同一进程内第二次 `loadExtension` 同名 `zotlit_cjk` 会被 SQLite 忽略，导致 baseline/fixed 结果完全相同；评测脚本对每个 `.so` 起独立 Node 进程（见 `scripts/eval-cjk-recall.mjs`）。

### 2.2 对比配置

| 名称 | 产物 | 语义 |
|------|------|------|
| baseline-icu | `dist/baseline/zotlit_cjk_icu.so` | 旧：ICU 词 primary + bigram colocated；查询仅 ICU 词 |
| baseline-jieba | `dist/baseline/zotlit_cjk_icu_jieba.so` | 旧：jieba 词 primary + 子词/bigram colo |
| fixed-icu | `dist/fixed/zotlit_cjk_icu.so` | 新：重叠 bigram primary + ICU 词 colo |
| fixed-jieba | `dist/fixed/zotlit_cjk_icu_jieba.so` | 新：重叠 bigram primary + jieba 词 colo |
| trigram | SQLite 内置 | `tokenize='trigram'`（默认 min 3 字符） |

源码：`PROTOTYPE_ROOT/crates/zotlit-cjk-core/src/lib.rs`  
快照：`fixes/lib.rs.orig`（修前）、`fixes/lib.rs.fixed`（修后）。

---

## 3. 诊断

### 3.1 现象复现（短文档）

文档：`版本控制系统是软件工程的基础工具，广泛用于分布式协作。`

| 查询 | baseline phrase | fixed phrase | 分类 |
|------|:---------------:|:------------:|------|
| 版本控制 | ✓ | ✓ | 整词边界对齐 |
| **本控制系统** | ✗ | ✓ | 跨词/词中子串 |
| **件工程的** | ✗ | ✓ | 词中子串 |
| 软件工程 | ✓/视切分 | ✓ | 整词 |

baseline 词表里**有** `本控`，但 `MATCH '"本控制系统"'` / `MATCH '本控'` 仍失败：查询把「本控」拆开，phrase 要的是 primary 序列，colo bigram 无法被「拆开后的单字序列」命中；对 `"本控" AND "控制" AND "制系"`，每个带引号 bigram 在查询侧仍被拆成两字，AND harness 同样全军覆没（andBi≈0.03）。

### 3.2 与 layout-compare 数字对齐

此前 layout CJK phrase≈0.54–0.56、AND≈0.06–0.12，相对手工 ~0.99。本评测 baseline-icu 在**源采样随机子串**上 phrase=0.437、andBi=0.033，同属「查询切词 ↔ 索引 colo bigram」不对称；不是 PDF 版面或 AND harness 单独的问题。

### 3.3 baseline-jieba 的假象

子串 phrase 升到 0.918，但 **falseHitRate=0.425**（过召回），精度代理差；词表更小（11605）因 jieba 粗粒度 primary，随机子串仍大量失败。不适合作为「只靠 jieba 搜索模式」的假修。

### 3.4 trigram 参考

子串 1.0，但手写/术语仅 ~0.41：内置 trigram 默认忽略长度 &lt;3 的 token，「版本」「Git」等双字符/短词直接消失；词表 110024（约 3.4× fixed-icu）。可作召回上界参考，不宜作默认分词器。

### 3.5 fixed 残留失败

`fixed-icu` 唯一记入 failures 的是拉丁词 **「Git」**（phraseR=0.924 / 395 页 GT）：部分 PDF 页含 `Git` 子串但 FTS 未命中（大小写/抽取噪声），与 CJK 无关；CJK hand/term/substr 在 PDF 有 GT 的集合上 phrase/bare/andBi 均为 1.0（hand 宏平均 0.996 仅被 Git 拉低）。

---

## 4. 修复设计

```
索引（CJK run）：
  对 run 内字符做重叠 bigram → PRIMARY，位置 0,1,2,… 连续
  ICU（或 jieba）词，若起始字节落在某 bigram 起点 → COLOCATED
  单字 run → 单字 primary

查询（CJK run）：
  同样发重叠 bigram PRIMARY（+ 可选词 colo）
  → phrase "本控制系统" ≡ 本控 → 控制 → 制系 → 系统（连续位置）
  → 与文档 bigram 链对齐；andBi 的每个 "本控" 也是单 token，不再被拆开
```

实现要点：`emit_cjk_bigram_primaries`；jieba 路径索引/查询均改走 bigram-primary。单元测试：`query_midword_bigrams`、`icu_zh_emits_bigrams` 等 8/8 通过。

**注意**：FTS5 文档称「重叠字节区间的多个非 COLOCATED token」对 phrase 行为未定义；实践中按**回调顺序**分配 position，重叠 bigram primary 在本评测中 phrase 行为正确。若上游 SQLite 日后收紧校验，可改为「非重叠 unigram primary + bigram colo」并在查询层强制 AND-of-bigrams（应用层改写），语义等价于当前 andBi=1.0。

---

## 5. 完整数字

### 5.1 中文（源查询 → PDF 索引）

见 §1 表。补充：

| 配置 | indexMs | tokSampleMs（30 页×5） | .so 体积 |
|------|--------:|----------------------:|---------:|
| baseline-icu | 132 | 7.5 | 2.59 MiB |
| baseline-jieba | 74 | 5.2 | 5.60 MiB |
| fixed-icu | 107 | 7.5 | 2.62 MiB |
| fixed-jieba | 114 | 6.8 | 5.63 MiB |
| trigram | 119 | — | （内置） |

### 5.2 日文

见 §1。fixed 后 hand/term/substr 均为 1.0；假名与汉字同一 bigram-primary 路径。

### 5.3 Wiki 自索引 sanity（源=索引，fixed-icu）

- cjk-substr n=60：phrase/bare/andBi = 1.0，prec=1.0  
- zh-hand n=16：全部 1.0  
- falseHitRate=0，terms=6799  

说明：在「查询与文档同一套源文本」时修复无退化；PDF 评测的残差主要来自抽取噪声（如 Git）与 skippedNoGt。

---

## 6. 方案取舍与推荐

| 方案 | 子串召回 | 短词/术语 | 伪命中 | 体积/词表 | 建议 |
|------|:--------:|:---------:|:------:|:---------:|------|
| 旧 ICU（词 primary + bi colo） | 差 | 尚可 | 低 | 中 | 弃用 |
| 旧 jieba | 中 | 好 | **高** | 词典大、词表小 | 弃用为默认 |
| **ICU + bigram primary（本修）** | **优** | **优** | **无** | 中 | **默认** |
| jieba + bigram primary | 优 | 优 | 无 | +3 MiB | 可选增强（中文专名） |
| FTS5 trigram | 优（≥3） | 差 | 无 | 词表大 | 仅参考/兜底 |

**产品建议**

1. **默认**：`tokenize='zotlit_cjk'` / ICU-only 构建（`fixed-icu`），bigram-primary 语义写入 `zotlit-cjk-core`。  
2. **可选**：带 `jieba` feature 的构建，FTS 参数 `jieba`；用于想叠加词典专名的用户，非召回刚需。  
3. **查询层**：应用可继续发 phrase；若需兼容旧索引，可对 CJK 查询改写为 overlapping-bigram AND（与 andBi=1.0 一致）。  
4. **不要**把 layout-compare 的「前 3 bigram AND」当成唯一查询形态——在 fixed 分词器下，完整 phrase 已足够且更精确。  
5. **评测**：比较多个 `.so` 必须进程隔离，否则结果会虚假地完全相同。

---

## 7. 产物与复现

```
bench/cjk-recall/
  REPORT.zh.md          # 本报告
  scripts/eval-cjk-recall.mjs
  dist/baseline/*.so    # 修前
  dist/fixed/*.so       # 修后（由 crates/zotlit-fts-ext 编译）
  fixes/lib.rs.orig | lib.rs.fixed
  corpus/               # 源文本 GT
  out/results.json      # 全量指标
  out/diagnostics.json  # 短文档探针
  out/eval.log
```

复现：

```bash
cd PROTOTYPE_ROOT/crates/zotlit-fts-ext
cargo build --release --no-default-features   # ICU
cargo build --release --features jieba        # jieba（注意 default 含 jieba）
cp target/release/libzotlit_cjk.so BENCH_ROOT/cjk-recall/dist/fixed/...

cd BENCH_ROOT/cjk-recall
npx -y node@24 scripts/eval-cjk-recall.mjs
```

未推送、未发帖；未修改 `BENCH_ROOT/layout-compare`。
