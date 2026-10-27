# ZotLit PDF FTS：方案 A / C 原型评估报告

## 背景与目标

ZotLit PDF 全文检索（#1799）仅桌面端。此前 JS 侧 `cut_for_index`（DAG 词典词 ∪ 最大概率切分 ∪ OOV 汉字 bigram）已能改善 jieba `cut` 吞掉子词、`cut_for_search` 跨边界不足、HMM 粘连等问题；日韩仍建议走 `Intl.Segmenter`。本次等权评估两条原生路径，把「索引期扩召回、查询期保持短语」下沉到 FTS5 自定义分词器 `zotlit_cjk`：

- **方案 A**：单一 napi addon，静态捆绑带 FTS5 的 SQLite（rusqlite `bundled`）+ jieba-rs，自管专用 FTS 库。
- **方案 C**：Rust `cdylib` loadable extension，经宿主 `sqlite3_api_routines` 注册进 Obsidian / Electron 的 `node:sqlite`。

（用户已确认 Obsidian `node:sqlite` 具备 FTS5；Electron 验证重点放在 `allowExtension` / `loadExtension` 与分词器可用性。）

## 分词语义（A/C 共用 `zotlit-cjk-core`）

- **索引**：对汉字 run 做 `cut` 作为主键（primary）；`cut_all` 中长度 ≥2 且落在 primary 字节区间内的词典子串以 `FTS5_TOKEN_COLOCATED` 挂到同位；对不在 DAG 中的 OOV primary 再补汉字 bigram（同为 colocated）。
- **查询**（`FTS5_TOKENIZE_QUERY`）：仅 `cut`，保证 `"版本 控制系统"` 短语与 `版本 AND 控制系统` 语义清晰；子词召回依赖索引期 colocated（如查「控制」可命中「控制系统」）。
- 非汉字：ASCII 字母数字小写后作为 primary；纯标点跳过。

## 实现与体积

原型目录：`/workspace/bench/zotlit-fts-addon/`。

| 产物 | 大小 | 说明 |
|------|------|------|
| `dist/zotlit_cjk.so`（C，jieba+ICU） | **5.58 MiB** | 不链接 libsqlite3；`jk-icu` 默认开启；导出 `sqlite3_zotlitcjk_init` / `sqlite3_extension_init`；jieba-only 探针约 3.04 MiB |
| `dist/zotlit_fts.node`（A） | **4.14 MiB** | 内嵌 SQLite 3.46.0 + FTS5 + jieba 词典 |

工作区把 A 与 C 拆开编译：C 单独 crate + `libsqlite3-sys` 的 `loadable_extension`+`bundled_bindings`，避免与 A 的 `bundled` 特性在 Cargo 层合并冲突。

## Electron 37.6.0 / Node 实测（核心结论）

**方案 C（Electron 主进程 `node:sqlite`）— PASS**

- `new DatabaseSync(':memory:', { allowExtension: true })` 可开扩展；默认关闭时 `loadExtension` 报错 `extension loading is not allowed`。
- `db.loadExtension('/…/zotlit_cjk.so')` 成功（Electron 内 SQLite **3.50.4**，FTS5 虚表可用——与 Obsidian 结论一致，一行确认即可）。
- `tokenize='zotlit_cjk'` 下短语、AND、colocated 子词（「控制」）均命中预期文档。

**方案 A（同 Electron 加载 napi）— PASS**

- `.node` 可直接 `require`（本机 Node 24 / Electron 37 的 N-API 均能加载本次构建）。
- 自带 SQLite 3.46.0，`ENABLE_FTS5`；`FtsDb.open` 内通过 `SELECT fts5(?1)` + `sqlite3_bind_pointer(..., "fts5_api_ptr")` 注册分词器；短语与子词查询正常。

Node 24 上 A/C 行为与 Electron 一致。

## 与 JS 基线对照（progit-zh 前 200 页，15 个中文查询）

以「页面子串包含查询词」为相关集，查询侧统一为 jieba `cut` 的 AND：

| 引擎 | 索引耗时 | macro Recall | macro Precision | macro F1 |
|------|----------|--------------|-----------------|----------|
| native C / A（`zotlit_cjk`） | ~147–157 ms | **0.98** | 0.99 | **0.98** |
| JS `cut_for_index` → unicode61 | ~114 ms | **0.98** | 0.99 | **0.98** |
| JS `Intl` + 全串 bigram → unicode61 | ~128 ms | **0.80** | 0.99 | **0.79** |

解读：

- **Native 与 `cut_for_index` 召回同级**：colocated 把「控制⊂控制系统」「版本控制」等子词问题消化在索引期，查询仍可用干净的 cut/AND/短语；不再依赖 JS 侧先切成空格再塞 unicode61。
- **Intl+bigram 在复合词 AND 上更弱**（如「版本控制」「分布式」Recall=0），因 Segmenter 切出的词与 bigram 集合对多词 AND 不友好；它在「快进」等单上略高，说明 HMM/词典边界仍有个别漏网，可用领域词表（`add_word`）补。
- 冷启动（新进程，含 jieba 词典加载）：C ≈ **82–100 ms**，A ≈ **83–130 ms**，量级相当；词典初始化是大头，与是否捆绑 SQLite 关系不大。

## 打包与 Managed Binary

- **A**：按 napi-rs 多平台 `.node`（win/mac/linux × arch）发布；Obsidian 插件主进程 `require`；CI 用 `napi build --platform`。体积约 4 MiB/平台，升级 SQLite/jieba 需重编。与现有 ZotLit Managed Binary（`.wasm`）模式类似，但是 **native**，需按 Electron/Obsidian ABI 矩阵出包（本次验证 Node 24 与 Electron 37 可共用同一 linux-x64 构建，正式发布仍建议 `--target` 对齐）。
- **C**：只发 `zotlit_cjk.{dll,dylib,so}`；运行时 `allowExtension: true` + `loadExtension(path)`。更贴 `node:sqlite`，**不**再复制一份 SQLite；但必须保证宿主启用扩展加载（Electron/Obsidian 策略、代码签名、路径沙箱）。Windows 还需注意入口名 `sqlite3_zotlitcjk_init`。体积约 5.6 MiB/平台（含 ICU JA/KO；jieba-only 约 3 MiB）。
- 二者皆含完整 jieba 默认词典；领域词可通过后续 API（A 已有 `add_word`）或扩展侧导出函数注入。

## 风险与取舍

| | 方案 A | 方案 C |
|--|--------|--------|
| 与 `node:sqlite` 同库 | 否（独立 FTS DB，需同步/路由） | **是** |
| 宿主策略依赖 | 低（纯 napi） | **高**（`allowExtension`、签名、路径） |
| 体积 | 略大（含 SQLite） | 略小 |
| 多实例/版本 | 自带版本锁定 | 跟随 Obsidian SQLite |
| Electron 37.6 实测 | 可用 | **allowExtension + tokenizer 可用** |

**建议**：若产品接受「PDF FTS 独立库文件」，A 运维边界更清晰、不受宿主禁用扩展影响；若希望直接写进现有 `node:sqlite` 库、少一份 DB，选 C，并在插件启动时显式 `allowExtension` + 校验 `loadExtension` 失败时的降级（回退 JS `cut_for_index`）。召回质量上 A≡C≡`cut_for_index`，显著优于裸 Intl+bigram。



## 日韩分词：ICU4X `icu_segmenter` vs Lindera（方案 C 扩展内）

目标：在扩展内完成 JA/KO（不再依赖 JS `Intl.Segmenter`），与既有 jieba 中文路径共存；评估质量、体积、初始化与路由交互。语料：progit-ja 447 页、progit-ko 441 页 + 手工查询；中文 zh15 回归；Electron **37.6.0** `loadExtension` PASS。

### 1. ICU4X `icu_segmenter`（推荐默认）

实现：`WordSegmenter::new_auto`（`compiled_data`），索引期 primary = ICU 词，再挂 **字 bigram（COLOCATED）**；韩语额外挂 **助词剥离词干（COLOCATED）**（如 `저장소에서` → stem `저장소`）。查询期只发 primary（助词 stem 亦为 COLOCATED，避免二次 primary 把短语变成 AND 失败）。

| 对照 | JA hand R/P | JA all R | KO hand R/P | KO all R | 索引耗时 / 体积 |
|------|-------------|----------|-------------|----------|-----------------|
| **ext-icu（本扩展）** | **0.948 / 0.982** | 0.860 | **0.994 / 0.684** | 0.980 | JA 173 ms / 2.2 MiB；KO 74 ms / 1.4 MiB |
| JS Intl | 0.996 / 0.775 | 0.803 | 0.458 / 0.998 | 0.661 | 略快、索引更瘦 |
| Intl+bigram | 0.999 / 0.944 | 0.882 | 0.794 / 0.991 | 0.934 | — |
| bigram-only | 1 / 0.943 | 1 | 1 / 0.901 | 1 | 最快，无词法 |

要点：

- **质量 vs Intl**：日语 ICU≈Intl 内容词切分；手测略低召回（片假名偶发边界，如「ブランチ」「コミット」~0.94），但精度明显高于裸 Intl（0.98 vs 0.78）。韩语裸 Intl 把助词粘在词上，查询「저장소」打不中「저장소에서」→ recall 崩到 ~0.46；扩展侧 stem colocated 后 hand R≈**0.99**，代价是助词查询精度下降（命中同词干多文档）——对 FTS 可接受。
- **体积（LTO + strip + opt-level 3；`#[used]` 防词典被 GC）**：

| 探针 / 产物 | .so |
|-------------|-----|
| jieba-only | 3.04 MiB |
| ICU auto-only | 2.53 MiB |
| ICU dictionary-segmenter-only | 3.20 MiB |
| jieba + ICU auto（贴近正式扩展） | 5.31–**5.58 MiB** |
| jieba + ICU dict | 5.99 MiB |

结论：**`compiled_data` / `new_auto` 比单独拉 CJ dictionary 更小**；相对 jieba-only **+≈2.5 MiB**。未再压 `opt-z`（曾把词典裁掉导致 271 KiB + panic）。自定义 blob / 精简「仅 CJ 词典」路径未带来小于 auto 的收益，故正式扩展保持 `new_auto` + 默认 `compiled_data`。
- **初始化 / 速度**：冷进程 `loadExtension` ≈ **105 ms**（jieba 词典为主，ICU `compiled_data` 增量不明显）；建表+插入一句混合 CJK ≈1 ms；查询亚毫秒。447 页日语索引 ~170 ms，与 Intl+bigram 同量级；韩语 441 页 ~74 ms（Hangul 脚本更短、助词规则廉价）。吞吐足够桌面 PDF 页级索引，无需把分词推回渲染进程。
- **中文回归**：zh15 micro-recall **1.0**；混合页「バージョン / 版本 / 控制 / 저장소」命中，Hangul「관리」未命中因夹具页无该韩文（非中文回归）。

### 2. Lindera 体积与质量（可选，非默认）

同口径 cdylib 探针（LTO+strip+`opt-z`；lindera 6.2 `embed-*`，词典已是嵌入压缩二进制，**无单独 uncompressed 特性可对比——下列即生产路径**）：

| 词典 | .so |
|------|-----|
| IPADIC（ja） | **45.9 MiB** |
| UniDic（ja） | **190.7 MiB** |
| ko-dic | **82.2 MiB** |
| IPADIC + ko-dic | **127.6 MiB** |

相对 jieba+ICU（5.6 MiB）：仅 IPADIC 就 **×8+**，双词典 **×20+**。

质量抽样：IPADIC 形态切分干净（`バージョン/管理/システム/を/コミット/する`），日语短语/助词边界优于纯 ICU，对召回增益有限（ICU+bigram 已高）；若产品强依赖「助词可丢、词干可搜」的形态分析，IPADIC 的增益主要在**可解释切分与下游高亮**，而非 FTS recall 数字。**ko-dic 对技术外来语过度切分**（`저장소`→`저/장소`，`커밋`→`커/밋`），相对 ICU **质量变差**，不建议为韩语引入。压缩：lindera 6.2 仅提供 `embed-*`，无公开「关闭压缩」开关，上表即嵌入压缩后体积；若改外置词典加载，扩展 .so 可变小但需另发词典文件并处理首次解压/mmap，桌面插件路径更复杂，本次未采用。

### 3. jieba × ICU / Lindera 路由与数据重叠

**路由（`tokenize=zotlit_cjk` 参数 `auto|zh|ja|ko`）**：

1. Hangul run → KO（ICU 或 Lindera）
2. 含假名，或 Auto 下汉字 run 附近 ±48 字节有假名，或「页内曾见假名且短汉字 ≤8」→ JA
3. 其余汉字 → ZH/jieba
4. 强制 `ja`/`ko`/`zh` 覆盖 Auto

**日文中的汉字**：与假名同页时走 JA/ICU（例：「自分自身による**変更**」整段 ICU；查询「変更」在 jieba 全单字 OOV 时改为 **整 run 一个 primary**，避免 `変+更` 短语打不中 ICU 索引的「変更」）。  
**短歧义汉字查询**：Auto 下 jieba multi 词之外，再挂 ICU 切分与整串 **COLOCATED**，兼顾中文短语与可能的日文整词索引。  
**混合页 / 短查询**：脚本 run 级切换；短无假名汉字默认真 jieba，靠「页级假名提示」纠偏。

**ICU 作中文 colocated 附加**：Auto 索引汉字在 jieba primary/`cut_all` 之后调用 `emit_icu_as_colocated`。与 jieba 词表大量重合则跳过；对边界不同的切分可多挂同位置同义词。实测 **zh15 已满召回**，ICU 附加对中文增益边际，主要价值在 **歧义短查询 ↔ 日文整词** 互通，而非抬中文 recall。

**词典是否重复**：jieba 默认词典与 ICU4X word-break `compiled_data` **完全独立、不可共享**；体积近似相加（3.0+2.5≈5.5）。Lindera 词典亦独立，且大一个数量级。Lindera 的 `embed-jieba` 与本扩展 jieba-rs **再叠一层中文词典，应避免**。

### 4. 简要：JS 预分词 / 纯 bigram

- **JS Intl 预切再 unicode61**：不改扩展时仍可用；KO 无 stem 时召回差，需自补助词规则或 bigram。
- **纯 bigram**：召回天花板高、索引胖、无词法，适合兜底而非默认。

### 建议（更新）

（已被下文「架构重定」覆盖）曾建议 方案 C + jieba(ZH) + ICU auto(JA/KO) + colocated bigram + KO stem；`CREATE` 时可用 `tokenize='zotlit_cjk' 'ja'` 等强制语言。仅在有明确体积预算且极需日语形态精度时再考虑 **Lindera IPADIC**；**不要**默认捆绑 ko-dic / UniDic。扩展加载失败时降级 JS `cut_for_index`（中）+ Intl（日）/自研 stem（韩）。

### 新增 / 变更文件（本轮）

- `crates/zotlit-cjk-core/`（`Lang`、脚本 run、`emit_ja/ko/zh`、ICU colocated、KO particle、查询 OOV 整 run）
- `crates/zotlit-fts-ext/`（`jk-icu`、`rusqlite_extension_init2`、`KEEP_ENGINE`）
- `scripts/bench-jk.mjs`、`dist/bench-jk.json`、`dist/jk-sizes.json`
- `size-probes/{icu,lindera,baseline,bigram}/`；`/tmp/size-*` 体积探针产物
- 语料与查询：`jk-corpus`（progit-ja/ko 页 + `queries.json`）
- Electron：`dist/test-ext-electron.json`（37.6.0 PASS）

## 测试环境摘要

- Node v24.22.1（sqlite 3.53.4）；Electron **37.6.0**（Node 22.19.0，sqlite 3.50.4）
- 产物与 JSON：`dist/test-*-{node,electron}.json`、`dist/bench-recall.json`、`dist/bench-jk.json`、`dist/jk-sizes.json`、`dist/sizes.json`、`dist/bench-cold.json`
- 双变体：`zotlit_cjk_icu.so` = **2,710,656 B（2.59 MiB）**；`zotlit_cjk_icu_jieba.so` = **5,868,944 B（5.60 MiB）**；Electron 两变体 `loadExtension` PASS；详见下文架构重定
- 未发帖、未改上游仓库。


## 架构重定：ICU 为全语言底座，jieba 为可选中文增强

### 设计变更

此前默认「jieba 管中文、ICU 管日韩」。现改为：**ICU4X `icu_segmenter`（`WordSegmenter::new_auto`）是所有语言的底座**——拉丁（小写 + 常见变音折叠）、CJK、泰/高棉/老挝/缅甸等均走 ICU；**jieba 仅作编译期可选的中文增强**。韩语助词词干与汉字/假名/Hangul bigram 仍以 `FTS5_TOKEN_COLOCATED` 挂接，作通用召回助推。放弃「`langs=zh` 跳过路由」方案；路由仍为 Hangul→KO、假名邻域（含短汉字歧义）→JA、其余汉字→ZH（jieba 开启且选中时走词典，否则 ICU+Han bigram）。

Cargo feature `jieba` 产出两变体（各自独立 `CARGO_TARGET_DIR`，避免产物串味；同进程勿连续加载两个同名入口的 .so）：

| 变体 | 产物 | strip 后大小 |
|------|------|-------------|
| ICU-only（`--no-default-features`） | `dist/zotlit_cjk_icu.so` | **2.59 MiB**（2,710,656 B） |
| ICU + jieba（default） | `dist/zotlit_cjk_icu_jieba.so` / `zotlit_cjk.so` | **5.60 MiB**（5,868,944 B） |

相对 ICU-only，jieba 词典约 **+3.01 MiB**。运行时 tokenize 参数仅允许 FTS5 裸词：`jieba`/`zh_jieba`、`icu`/`zh_icu`、`ja`/`ko`（`zh=jieba` 会触发 tokenize directive 解析错误）。ICU-only 在请求 jieba 时明确报错；全量二进制可用 `icu` 关掉中文增强，默认等同 `jieba`。

### 中文质量：ICU-only（+Han bigram）vs ICU+jieba

语料 progit-zh 前 500 页；zh15 手测 + 300 条随机汉字串；相关集 = 页内子串包含查询词。各变体在**独立子进程**加载。

| 配置 | 索引耗时 | 索引体积 | zh15 AND R/P | zh15 短语 R | s300 AND R/P |
|------|----------|----------|--------------|-------------|--------------|
| ICU-only | ~99 ms | 2144 KiB | **0.9929 / 0.9993** | 0.9929 | **0.919 / 0.9965** |
| full + `jieba`（默认） | ~138 ms | 1584 KiB | **0.9987 / 0.9004** | 0.9987 | **0.9882 / 0.2087** |
| full + `icu` | ~222 ms | 2144 KiB | 同 ICU-only | 同左 | 同左 |

解读：jieba 在采样查询上抬高约 **7 pp** 召回，索引更瘦（词典词取代密集 bigram）；但对**未加引号的多字查询**，jieba 切成多 token 后变成 AND，相对「子串相关」精度骤降（s300 P≈0.21）。ICU+Han bigram 精度极高、手测召回已够用。是否值得常驻 +3 MiB，取决于产品是否要词典级中文切分与更高采样召回——**建议默认发 ICU-only；增强中文作为用户显式开关**，打开后再下发 ICU+jieba。

### 英文 / 泰文快检；日语回归

英文样例 `pre-commit`、`git-scm.com`、`C++`、`v2.4.0`、`café`：ICU 得 `pre`+`commit`、`git`、`scm.com`、`c`、`v2.4.0`、`cafe`（保留版本号整串、折叠变音）；unicode61 则把 `v2.4.0` 拆成 `v2`/`4`/`0`，域名更碎。泰文一句经 `new_auto` 切出合理词块（`ภาษา`/`ไทย`/`ประเทศ` 等），验证 LSTM/词典路径可用。日语 hand（全量二进制默认）AND R≈**0.9645** / P=1，与先前 ICU JA 路径一致，未因中文路径切换而回退。

### Electron 37.6 与 Managed Binary

两变体均在 Electron **37.6.0**（主进程 Node 22.19、sqlite **3.50.4**）经 `allowExtension: true` + `loadExtension` **PASS**：ICU-only 正确拒 `jieba`；ICU+jieba 默认可命中「控制」，且 `icu`/`jieba` 参数均可建表。

Managed Binary（对齐现有 `chinese-segmenter` / managed-binary 同意下载模式）：**默认下发 ICU-only**；仅当用户开启「增强中文分词」时再下载 ICU+jieba 变体，避免为多数用户常驻 +3 MiB 词典。

### 建议（本轮，覆盖上文默认）

方案 C：**ICU 全语言底座 + KO stem / CJK bigram colocated**；jieba 为可选中文增强（Cargo feature + 运行时 `jieba`/`icu`）。默认二进制偏 ICU-only；增强包按需。Lindera 仍不推荐默认。扩展加载失败时降级 JS `cut_for_index`（中）+ Intl（日）/自研 stem（韩）。

### 本轮新增 / 变更文件

- `crates/zotlit-cjk-core/`（`TokOpts`/`ZhMode`/`HAS_JIEBA`、ICU 底座、可选 jieba 路径、拉丁折叠、泰文冒烟）
- `crates/zotlit-fts-ext/`（feature `jieba`、`TokOpts::parse_args`、`zotlit_cjk_caps`）
- `dist/zotlit_cjk_icu.so`、`dist/zotlit_cjk_icu_jieba.so`、`dist/zotlit_cjk.so`
- `scripts/bench-icu-vs-jieba.mjs`、`dist/bench-icu-vs-jieba.json`
- `scripts/electron-both-variants.mjs`、`dist/test-ext-electron-{icu,jieba}.json`

未发帖、未改上游仓库。
