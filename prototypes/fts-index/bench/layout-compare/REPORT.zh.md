# ZotLit PDF 版面切分与 FTS5：运行时 × 检索质量对比报告

> 路径：`BENCH_ROOT/layout-compare/`  
> 日期：2026-10-27（Asia/Singapore）  
> **质量主表：v3（本文件）**。v1「从 C 采样」与 v2 五篇小语料源 GT **整表作废**，数字以 `corpus-v3/out/AGGREGATE_V3.json` 为准。

---

## v3 评价设计（严格复评）

### 方法
| 代号 | 切分 | 推理 |
|---|---|---|
| **A** | PDF.js 文本流，按页拼接 | 无 |
| **B** | 行聚类 + 家具启发式 + 双栏中缝 | 无 |
| **C** | Zotero document-worker block-seg（SDT） | **Rust 静态 ort napi**（clusterer/repair/classifier） |
| **D** | PP-DocLayout-S 框 → 文本落入 | **Rust 静态 ort napi**（`runDoclayoutRgba`） |

### Tokenizer（固定，未改源码）
- `BENCH_ROOT/cjk-recall/dist/fixed/zotlit_cjk_icu.so`（CJK overlapping bigram PRIMARY + ICU words COLOCATED；查询侧 bigram）
- 同源自 `zotlit-cjk-core`；同名 `loadExtension` 同进程二次加载会被静默忽略——本评测每评测进程只加载一次该 `.so`；C 抽取在独立 child 进程。

### 语料（n = 29）
- arXiv + LaTeX 源约 26 篇（多数 IEEE/ACM/CVPR/ACL 双栏，含脚注/图表注/页眉；PDF 截前 6 页）
- `progit-en` / `progit-zh` / `sample-cjk`
- 布局：**20 双栏 + 9 单栏**
- 仅下载可公开获取源；GT 目录 `corpus-v3/gt/SOURCE_GT_V3.json`

### Ground truth（绝不取自 A/B/C/D 输出）
1. LaTeX/AsciiDoc → detex 风格剥离（跳过 pandoc 以免挂死）→ 去数学/引用/标签/注释/宏 → NFKC + 空白归一。
2. 源段落对 PDF 文本做 soft/fuzzy 对齐，**只保留对齐上的段落**（均值覆盖 **0.46**；逐篇见 JSON）。
3. 家具：模板/页眉页脚字符串 + 手检。
4. 查询：自对齐段落采样；**故意包含跨行/跨栏**片段（跨行 466，跨栏 44）+ 词项查询。共 **623** 条。

### 指标
phrase / AND 召回；跨行·跨栏·跨页子集召回；家具误命中/100 查询；阅读序邻接；块级 top-1/top-3 vs 源段落；索引字节与建索耗时；bootstrap 95% CI（2000×）；配对符号检验。

脚本：`corpus-v3/scripts/{build_gt_v3.py,extract_v3.mjs,sdt-napi-child.mjs,native_onnx_bridge.mjs,eval_fts_v3.mjs}`。

---

## v3 主结果（全部 n=29）

| 方法 | phrase (95% CI) | AND | 跨行 | 跨栏 | 家具/100q↓ | 阅读序 | 块 top-1 | 索引≈KB | 均 units |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| A | **0.939** [0.909, 0.964] | 0.956 | **0.933** | 0.921 | 4.26 | 0.753 | 1.00 | 85 | 5.9 |
| B | 0.741 [0.654, 0.826] | 0.911 | 0.671 | 0.705 | 3.63 | 0.546 | 1.00 | 84 | 5.9 |
| C-block | 0.845 [0.771, 0.896] | 0.879 | 0.820 | 0.840 | **1.28** | **0.759** | 0.992 | 83 | 53.1 |
| D-block | 0.619 [0.549, 0.687] | 0.711 | 0.578 | 0.608 | 4.10 | 0.440 | 0.991 | 90 | 52.3 |

C-page / D-page 与对应 block 接近（phrase 略高 0.01），见 JSON。

### 双栏 vs 单栏

| 子集 | A | B | C-block | D-block |
|---|---:|---:|---:|---:|
| 2col phrase (n=20) | 0.943 | 0.748 | 0.850 | 0.643 |
| 1col phrase (n=9) | 0.929 | 0.727 | 0.833 | 0.565 |
| 2col 家具/100q | 4.55 | 3.64 | **0.91** | 4.55 |
| 1col 家具/100q | 3.61 | 3.61 | 2.09 | 3.10 |

### 配对显著性（phrase，符号检验双侧）

| 对比 | meanDiff | +/− | p |
|---|---:|---:|---:|
| A vs B | +0.198 | 21/1 | ≈0 |
| A vs C-block | +0.094 | 19/1 | ≈0 |
| A vs D-block | +0.320 | 29/0 | ≈0 |
| B vs C-block | −0.103 | 8/17 | 0.11 |
| B vs D-block | +0.123 | 20/8 | 0.036 |
| C-block vs D-block | +0.226 | 26/1 | ≈0 |

### 抽取端到端耗时（中位，页已 cap）
- A/B（PDF.js 渲染+文本）：≈ **1.5 s**/文档  
- C（napi child SDT）：≈ **0.6 s**  
- D 推理 alone：≈ **148 ms**（另加 A 渲染若需 RGBA）

### 图
- `corpus-v3/viz/v3_phrase_recall.png`
- `corpus-v3/viz/v3_crossline_furniture.png`
- `corpus-v3/viz/v3_perdoc_heatmap.png`
- `corpus-v3/viz/v3_order_rank.png`

---

## 解读与建议

1. **不要再用「召回谁最高」单独选型。** A 因页级不切分在 phrase/跨边界上占优，但这是单元粒度效应，不是「版面理解更好」。
2. **若目标是降家具噪声 + 保留可读块**：选 **C**（家具/100q 约 A/D 的 1/3；阅读序与 A 持平）。
3. **D（S）目前不能替代 C**：phrase/跨行/阅读序全面落后，且家具过滤未兑现；在修好框→文本对齐或换用 M/L 之前，不宜作为默认切分。
4. **B 仅作轻量基线**：方差大，复杂页会崩。
5. 中文 `progit-zh` 全方法 phrase 偏低（A=0.64, C=0.18, D=0.05）——对齐与 CJK 边界共同作用，解读整体均值时勿忽略。

---

## 诚实限制 / 未完成

- 对齐覆盖均值 0.46：未对齐上的源段落不进 GT，可能偏「易对齐」段落。
- 跨页查询极少；跨栏 44 条，CI 宽。
- DocLayout **M/L** ONNX 导出仍失败（paddle2onnx × Paddle 3）。
- 未修改 tokenizer 源码；未 git push / 未对外发布。
- block top-1 在「有命中」条件下接近饱和，区分度有限——更应看 phrase 与家具。

---

## 附录：运行时结论（沿用既有 napi 评测，非 v3 新跑）



---

## 附录续：历史报告原文（质量表已作废，仅保留运行时叙述供对照）


> 路径：`BENCH_ROOT/layout-compare/`  
> 日期：2026-10-27（Asia/Singapore）  
> 范围：PDF.js 文本层 + 渲染 → 模型推理 → FTS5（`zotlit_cjk_icu`）整条链路。  
> **两个并列主结果**：(1) Rust 静态 `ort`（真实 napi-rs Node-API）vs `onnxruntime-web` WASM；(2) 各切分方法的 FTS 检索质量（**源文本独立 GT，非 C 采样**）。

---

## 样本与方法（共用）

### 语料（源 GT 主表 n = 5；无源文档已剔除）

| ID | 类型 | 页数 | 源 GT 种类 |
|---|---|---:|---|
| `arxiv-attention` | 学术双栏 | 8 | arXiv LaTeX `1706.03762` |
| `arxiv-lora` | 学术双栏 | 8 | arXiv LaTeX `2106.09685`（正文过滤 preamble） |
| `progit-en` | 书籍 EN | 5 | Pro Git AsciiDoc / Markdown 源 |
| `progit-zh` | 书籍 ZH | 5 | Pro Git 中文 AsciiDoc 源 |
| `sample-cjk` | 演示/CJK | 4 | **手标**（自拟样本，无外部作者稿） |

**已剔除（无作者源，不作质量 GT）**：`frai-xai`、`plos-meta`、`stroke-2col`。

### ⚠️ 方法论更正（替代旧「从 C 块采样」）

旧版主表从 **C = Zotero SDT body** 块采样查询，并以「与 document-worker 等价」作质量参照，会**系统性偏向 C**。  
本版已 **整表作废旧 C 采样数字**，改用方法无关 GT：

1. 从 **作者源**（LaTeX / AsciiDoc / 手标）抽取正文段落、标题、图注、已知页眉页脚家具。  
2. 查询从源段落/句子采样 + 若干真实词项查询。  
3. **A/B/C/D 同等打分**：phrase/AND 召回、家具误命中、阅读序邻接、相对源段落的块级排序。  
4. **数值等价**（native ↔ onnxruntime-web ↔ document-worker 同模型 logits）仍只作**运行时正确性**，不作质量 GT。

数据：`gt/SOURCE_GT.json`、`out-source-gt/SOURCE_GT_AVG.json`、`scripts/run-fts-source-gt.mjs`。

### 切分方法

| 代号 | 方法 |
|---|---|
| **A** | PDF.js 文本流，按页拼接（基线） |
| **B** | 启发式双栏重排 + 页眉页脚剥离 |
| **C-page / C-block** | Zotero document-worker **block-seg**（文本层 ONNX：clusterer→repair→classifier） |
| **D-page / D-block** | **PP-DocLayout-S**（视觉版面）框 + PDF.js 文本归属 |

渲染：PDF.js + **node-canvas**，`disableFontFace: false`。分词/索引不变：同一 FTS5 + `zotlit_cjk_icu.so`（本轮不改分词器）。

---

# 主结果一：运行时 — Rust 静态 ort（napi）vs onnxruntime-web

链路：`PDF.js → node-canvas RGBA →（napi 交接 / WASM）→ 模型 → FTS5`。  
特征抽取仍在 JS（document-worker）；原生侧只接张量/RGBA。  
本轮为 **真实 Rust `ort` 2.0.0-rc.15 静态链接**（`napi-rs` Node-API + `ort_infer_bench` 二进制），**不再用 Python ORT 代理**。

![runtime](viz/runtime_native_vs_wasm.png)

### 1.1 产物与依赖

| 产物 | 大小 | 动态依赖（ldd） |
|---|---:|---|
| `ort_infer.linux-x64-gnu.node`（napi） | **≈ 24.7 MB** | 仅 `libstdc++` / `libgcc_s` / `libm` / `libc` |
| `ort_infer_bench`（CLI） | ≈ 24.7 MB | 同上 |

- 位图路径：**PDF.js + node-canvas → RGBA `Buffer` → Rust 预处理**（或直接 NCHW `Float32Array`）。  
- **ORT 每进程仅允许一个 Environment**：同进程 `worker_thread` 内不可再 `new NativeOrt`；离主线程用 **`child_process`**（本轮 child 冒烟成功）。线程切换用同一引擎的 `setThreads`。

### 1.2 Zotero block-seg（三模型合计 p50，ms/页）

| 运行时 | clusterer | repair | classifier | **合计 p50** | 来源 |
|---|---:|---:|---:|---:|---|
| **Rust ort 静态 napi @1** | 1.73 | 0.053 | 1.28 | **≈ 3.06** | `results/runtime_rust_ort_napi.json` |
| Rust ort 静态 napi @4 | 2.32 | 0.078 | 1.44 | **≈ 3.84** | 同上（小模型多线程收益有限） |
| Rust ort CLI bench @1 | ≈2.53 | ≈0.053 | ≈1.32 | **≈ 3.90** | `results/runtime_rust_ort_static.json` |
| **onnxruntime-web WASM @1** | 11.30 | 0.45 | 8.94 | **20.69** | `results/runtime_wasm.json` |

- WASM / 原生 napi ≈ **6.8×**（block-seg，单线程）。  
- **相对 ref npy：logits MAD = 0**（repair / clusterer emissions & object / classifier type & flow）。  
- RGBA→原生交接/预处理 p50 ≈ **1.9–2.0 ms**（DocLayout 480²）；相对 block-seg 已与推理同量级，相对 DocLayout 仍可忽略。

### 1.3 PP-DocLayout-S（视觉，p50 ms）

| 运行时 | p50 ms | 备注 |
|---|---:|---|
| **Rust ort napi @1** | **≈ 22.8** | 合成 480² RGBA |
| Rust ort napi @4 | **≈ 11.2** | 同上 |
| 真页 `arxiv-attention` p1 @1 / @4 | ≈ 24.2 / ≈ 13.0 | 480×622 |
| **WASM ort-web @1** | **189.4** | ≈ 原生@1 的 **~8.3×** |

- **PP-DocLayout-M / plus-L**：本机仅有 Paddle `inference.pdiparams`（`~/.paddlex/official_models/`）。`paddle2onnx` PyPI 最高 0.9.2 依赖已移除的 `paddle.fluid`；GitHub 主线构建又钉死不可用的 `paddlepaddle==3.0.0.dev…`。**未能导出 ONNX**；质量与运行时实验统一用 **S**。

### 1.4 结论（运行时）

1. **桌面原生固定 Rust `ort` 静态 + napi**：block-seg ~3.1 ms/页，DocLayout-S ~11–23 ms（视线程）。  
2. **纯 WASM** 可用作原型，但 block-seg ~7×、DocLayout ~8× 慢。  
3. 数值上与 ref / 预期 WASM 同模型输出一致（MAD 0），可安全替换 document-worker 推理内核。  
4. 多线程 WASM 仍需 COOP/COEP；离主线程原生推理用 **子进程**，不要在已初始化 ORT 的进程里再开 worker 建第二 Environment。

---

# 主结果二：FTS 检索质量 — 源 GT（替代旧 C 采样表）

> **下列数字全部来自 `out-source-gt/`，已替换旧版「查询来自 C 块」学术表（旧 phrase C≈0.93 等作废）。**

![recall](viz/fts_source_gt_recall.png)

### 2.1 源 GT 均值（n = 5；A/B/C/D 同等）

| 方法 | phrase | AND | 家具误命中↓ | 阅读序邻接 | 连字符残留 | blockOverlapTop1 | 字符数 |
|---|---:|---:|---:|---:|---:|---:|---:|
| **A** pdf.js | 0.623 | 0.543 | 0.8 | 0.627 | 0.6 | 1 | 13343 |
| **B** 启发式双栏 | 0.593 | 0.543 | 0.8 | 0.533 | 0.6 | 1 | 13266 |
| **C-page** SDT | 0.621 | 0.531 | 0.4 | 0.640 | 0.8 | 1 | 10783 |
| **C-block** SDT | 0.621 | 0.517 | 0.4 | 0.640 | 0.8 | 0.95 | 10783 |
| **D-page** DocLayout | **0.627** | **0.547** | **0.2** | 0.570 | 0.6 | 1 | 14965 |
| **D-block** DocLayout | **0.627** | 0.525 | **0.2** | 0.570 | 0.6 | 0.95 | 14965 |

![noise](viz/fts_source_gt_noise_order.png)

要点（相对旧 C 采样结论的变化）：

- **短语召回方法间几乎打平**（≈0.59–0.63）：去掉 C 偏置后，不再出现「C 全面 0.93 碾压」。  
- **家具误命中**：D（0.2）< C（0.4）< A/B（0.8）——视觉版面在页眉页脚抑制上不弱于、甚至优于 SDT。  
- **阅读序邻接**：C（0.64）略优于 A（0.63）与 D（0.57）；B 最差（0.53，双栏重排易打乱邻句）。  
- **C 索引更瘦**（字符 ≈10.8k vs D ≈15.0k / A ≈13.3k）：丢掉辅助块；召回优势不再显著。  
- `blockOverlapTop1`：页级方法记 1.0（整页命中）；块级 C/D 均 ≈0.95（相对**源段落**，非 C 自采样）。

### 2.2 分篇短语召回（源查询）

![perdoc](viz/fts_source_gt_perdoc_phrase.png)

| 文档 | 源种类 | A | B | C-page | D-page |
|---|---|---:|---:|---:|---:|
| sample-cjk | hand-label-authored | 1.000 | 1.000 | 0.857 | 1.000 |
| progit-en | progit-asciidoc | 0.054 | 0.054 | 0.073 | 0.073 |
| progit-zh | progit-asciidoc | 0.527 | 0.527 | 0.509 | 0.527 |
| arxiv-attention | arxiv-latex | 0.833 | 0.683 | 0.833 | 0.833 |
| arxiv-lora | arxiv-latex | 0.700 | 0.700 | 0.833 | 0.700 |

说明：

- **arxiv-attention / arxiv-lora**：方法间接近；lora 上 C phrase 略高（0.83 vs 0.70），attention 上 B 因双栏重排掉到 0.68。家具：A/B 更高，D 在 attention/lora 上为 0。  
- **progit-en**：各方法 phrase 均极低（≈0.05–0.07）——AsciiDoc 源句与 PDF 排版文本（连字、TOC、代码块）差异大，属**源↔PDF 对齐问题**，不能解读为某方法独差。阅读序邻接全 0 亦同因。  
- **progit-zh / sample-cjk**：方法几乎打平；瓶颈在分词/查询（CJK AND 弱），非版面。`sample-cjk` 为手标。

### 2.3 与旧 C 采样表对照（仅作方法论警示）

| | 旧（C 块采样，已作废） | 新（源 GT） |
|---|---|---|
| 查询来源 | C SDT body 块 | LaTeX / AsciiDoc / 手标 |
| 学术 phrase 领先者 | C ≈0.93 ≫ D ≈0.75 | **打平**（≈0.62） |
| 家具 | C 最优 | **D 最优** |
| 块排序协议 | C 自采样 / fair-rank 分测 | 统一相对源段落 overlap |

旧结论「默认必选 C」在公平源 GT 下**不再成立**；C 仍有阅读序与索引体积优势，D 有家具过滤与召回持平优势。

### 2.4 结论（检索质量，源 GT）

1. **文本层 PDF 的 FTS**：A/C/D 短语召回接近；选型看 **家具过滤（偏 D）**、**阅读序（偏 C）**、**索引体积（偏 C）**、**推理成本（偏 C/A，见主结果一）**。  
2. **不再仅因旧表推荐 C**；双栏学术上 B 仍易伤 phrase/邻接。  
3. **CJK**：方法无关；优先改查询/分词（另任务），本轮未动 tokenizer。  
4. **无源文档**勿混入质量主表；需要时可手标并单独声明。  
5. 样本：主表 **n=5 有源文档**；旧 n=8 C 采样学术表已替换。

---

## 工程备注

- 渲染：`CanvasFactory` + **node-canvas**（避免 `@napi-rs/canvas` `evenodd` 崩）；`disableFontFace: false`。  
- 原生：`native-ort/`（`ort_infer_core` / `ort_infer_napi` / `ort_infer_bench`）；特征仍 JS。  
- 数据：`out-source-gt/*`、`gt/SOURCE_GT.json`、`results/runtime_rust_ort_napi.json`、`results/runtime_rust_ort_static.json`、`results/runtime_wasm.json`、`viz/fts_source_gt_*.png`。  
- 旧 `out/ACADEMIC_AVG.json`（C 采样）保留作对照，**报告主表不再引用**。  
- 未对外发布；环境与模型文件保留。

---

## 一页决策摘要

| 问题 | 答案 |
|---|---|
| 桌面推理用哪？ | **Rust ort 静态 + napi**（block-seg ~3.1 ms；DocLayout-S ~11–23 ms） |
| WASM 能用吗？ | 能，但慢 **~7–8×** |
| FTS 切分用哪？ | **源 GT 下 C/D 接近**；要家具少偏 D，要阅读序/瘦索引偏 C；勿再用旧 C 采样表 |
| 还要上 DocLayout 吗？ | 文本层 FTS **非必须**；家具过滤与扫描件方向仍有价值 |
| M / plus-L？ | **本环境未能导出 ONNX**（paddle2onnx/Paddle 3 不兼容） |
| CJK？ | 先修 bigram/AND 查询；版面模型无差 |
