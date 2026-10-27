# ZotLit 静态推理可行性报告（类 whisper.cpp）

日期：2026-10-27（Asia/Singapore）  
目标：评估能否把 Zotero document-worker 的 block-seg ONNX（及可选 OCR）编成**单文件、无 Python / 无散落 onnxruntime .so / 无 PyTorch** 的原生产物，类似 whisper.cpp。

工作目录：`BENCH_ROOT/static-infer/`  
脚本：`scripts/gen_ref.py`、`scripts/preprocess_onnx_for_tract.py`、`scripts/run_all.sh`  
基准机：Linux x86_64，单线程 CPU；输入为「页等价」合成特征（clusterer T=64/O=8，classifier N=48，repair G=32）。

---

## 1. 结论（先看）

| 选项 | block-seg 能否跑 | OCR 能否跑 | 剥离后体积 | 页等价延迟（中位） | `ldd` 依赖 | vs ORT max\|Δ\| | 许可证 |
|------|------------------|------------|------------|-------------------|------------|-----------------|--------|
| **(e) 基线 onnxruntime-web WASM** | ✅（现网） | 可另接 | WASM **13 MB** + 模型 ~9 MB | clusterer **1.65 ms** / repair **0.05 ms** / classifier **1.26 ms**（Python ORT 1.31 同输入；WASM 未在本机重测，量级同） | 无原生 so（跑在 Electron/WASM） | 参考真值 | MIT（ORT）+ **AGPL-3.0（权重）** |
| **(a) tract（纯 Rust）** | ✅（需改写 ONNX：INT64 Clip→Min/Max、Range 折叠） | ❌（Conv 动态维） | CLI **15 MB** | 19.0 / 0.09 / 5.9 ms | **仅** libgcc_s, libm, libc | ~1e-5 / 0 / ~2e-5 | Apache-2.0 / MIT（tract） |
| **(b) ort + 静态 libonnxruntime.a** | ✅ 全通 | ✅（v5/v6 ONNX） | CLI **24 MB**（链接自 107 MB `.a`） | 1.94 / 0.04 / 1.16 ms；OCR det v5 **40 ms**；rec v5 **18.5 ms**；v6 tiny det/rec **8.2 / 3.0 ms** | libstdc++, libgcc_s, libm, libc | **0** | MIT（ort/ORT） |
| **(c) ncnn / MNN** | 未实测（无现成 block-seg ncnn 图；需重导出） | 有社区 PaddleOCR ncnn 口，未编 | 典型静态数 MB～十余 MB | — | 通常仅 libc++/libc | — | Apache-2.0（ncnn/MNN） |
| **(d) candle-onnx** | 未跑通（API/`protoc` 后仍需改 `read_file`+`simple_eval`；LayerNorm 等算子覆盖未知） | — | — | — | — | — | MIT / Apache-2.0 |
| ggml 转换 | 无现成 ONNX→ggml 针对这些 Transformer/CRF 风格小模型的路径；不建议投入 | — | — | — | — | — | — |

**推荐（见 §6）**：单独做 **Rust Node-API / cdylib**，默认用 **`ort` 静态链接**拿满精度与 OCR；block-seg 权重**运行时从 Zotero 已装的 document-worker 读**，避免再分发 AGPL 权重。若极度在意「零 libstdc++、更小」，可对 block-seg 走 **tract + 固定 ONNX 改写**，OCR 另开可选 Apache 路径或仍用 ort。

---

## 2. 模型与基线

### 2.1 Block-seg（document-worker，AGPL-3.0）

| 文件 | 大小 | 输入（本 bench） | 输出 |
|------|------|------------------|------|
| `clusterer/model.onnx` | 4.2 MB | `line_features[1,64,22]` + pad，`object_features[1,8,22]` + pad | `emissions[1,64,18]`，`object_rule_logits` |
| `clusterer/repair.onnx` | 350 KB | `features[32,219]` | `logits[32]` |
| `classifier/model.onnx` | 4.2 MB | regular/rich/hash/char slots + pad，N=48 | `type_logits[1,48,7]`，`flow_logits[1,48,3]` |

算子含 LayerNormalization、Erf、Clip、Range 等。Zotero 现网：`onnxruntime-web` WASM worker。

### 2.2 OCR（可选，Apache-2.0，RapidOCR / Paddle 导出）

| 模型 | 大小 | ort 中位延迟 |
|------|------|--------------|
| ch_PP-OCRv5_det_mobile | 4.6 MB | 40.3 ms（合成 1×3×H×W 页图量级） |
| ch_PP-OCRv5_rec_mobile | 16 MB | 18.5 ms（1×3×48×320） |
| PP-OCRv6_det_tiny | 1.8 MB | 8.2 ms |
| PP-OCRv6_rec_tiny | 4.3 MB | 3.0 ms |

### 2.3 基线 ORT（Python `onnxruntime` 1.31.1，CPU，1 thread）

见 `ref/ort_baseline.json`：clusterer **1.65 ms**，repair **0.054 ms**，classifier **1.26 ms**。

WASM 资产：`ort-wasm-simd-threaded.wasm` **13 MB**（另有 jsep 26 MB 变体）。`pdf-worker/build` 合计约 **25 MB**。

---

## 3. 各方案实测

### 3.1 tract（纯 Rust）— `tract-bench/`

- **依赖足迹**：`ldd` → `libgcc_s.so.1`, `libm.so.6`, `libc.so.6`（**无 libstdc++、无 ORT .so**）。最接近 whisper.cpp「自包含」观感。
- **体积**：release + strip **15 MB**（未嵌入权重；权重外置）。
- **正确性**（相对 `ref/*.npy`）：

| 模型 | ok | max abs diff | 中位 ms |
|------|----|--------------|---------|
| repair | ✅ | **0** | 0.093 |
| clusterer（`*.fixed.onnx`） | ✅ | emissions **1.2e-5**，object **4.8e-7** | 19.0 |
| classifier（`*.fixed.onnx`） | ✅ | type **2.1e-5**，flow **1.6e-5** | 5.86 |
| OCR det v5 | ❌ | — | ConvHir 动态维分析失败 |

- **必做预处理**（`scripts/preprocess_onnx_for_tract.py`）：
  1. INT64 上的 `Clip` → `Max` + `Min`；
  2. 去掉非法的 Clip `min`/`max` attribute；
  3. 将用于 `arange(0,N)` 的动态 `Range` **折叠为 Constant**（本 bench：clusterer T=64，classifier N=48）。  
  → **动态变长页**需按最大 T/N 导出或改模型；这是 tract 路径的主要工程税。
- **许可**：tract Apache-2.0/MIT；不解决 AGPL 权重问题。

### 3.2 ort 静态链接 — `ort-bench/`（`ort` 2.0.0-rc.15 + pyke `libonnxruntime.a`）

- **体积**：静态库 **107 MB** → 链接进 CLI 后 strip **24 MB**。
- **`ldd`**：`libstdc++.so.6`, `libgcc_s`, `libm`, `libc`（无独立 `libonnxruntime.so`）。
- **正确性**：block-seg 三项 **max abs diff = 0**；OCR ONNX 可加载运行。
- **延迟**：clusterer 1.94 / repair 0.038 / classifier 1.16 ms（与 Python 基线同量级）；OCR 见上表。
- **跨平台**：pyke 提供 linux/mac/windows × x64/arm64 预编译静态库；Node addon 可用 `ort` 的 `load-dynamic` 或纯静态 cdylib。Windows 仍可能带上 MSVC 运行库。
- **许可**：ORT / `ort` crate 为 MIT；同样不覆盖 AGPL 权重。

### 3.3 ncnn / MNN（简评，未深编）

- block-seg 无现成 ncnn param/bin；要从 ONNX 再转，LayerNorm/自定义头可能要补算子。
- PaddleOCR 生态有 ncnn 移植，适合**仅 OCR** 的极小包，但与 Zotero 现网 ONNX 权重不共用。
- 静态 C++ 可做到很小，但维护两套管线成本高于 `ort` 静态。

### 3.4 candle / burn

- 安装 `protobuf-compiler` 后 `candle-onnx 0.8.4` 可编过依赖，但示例 API 已改为 `read_file` + `eval::simple_eval`；未在时限内完成与 LayerNormalization 的端到端比对。
- **结论**：对「快速验证」不划算；不作为主候选。

### 3.5 ggml 风格

- 无成熟 ONNX→ggml 针对该小模型族的工具链；不建议投入。

---

## 4. PDF 文本提取（静态，简测）

| 方案 | 体积量级 | 许可 | 备注 |
|------|----------|------|------|
| **pdfium**（`pdfium-binaries` linux-x64） | `libpdfium.so` **5.6 MB**（整包解压 ~8.8 MB；官方多为 **动态** so，静态 `.a` 需自编 Chromium 树，体积显著更大） | BSD 风格（pdfium） | `pdfium-render` 可绑；与「单静态二进制」有张力 |
| **MuPDF**（Debian `libmupdf-dev` 1.25） | Installed-Size 约 **2.3 MB** | **AGPL-3.0** | 与 document-worker 同属 AGPL 家族，合入需整体 AGPL 合规 |
| **维持 pdf.js / document-worker（JS）** | `pdf-worker/build` ~**25 MB**（含 WASM ORT） | 现网路径 | 零原生依赖；与 Electron 已对齐 |

**建议**：全文索引若只需文本层，优先继续 JS pdf.js / document-worker；若上原生，优先 **动态 pdfium 5.6 MB** 或接受 AGPL 的 MuPDF，不要为「静态 pdfium」单独扛 Chromium 构建，除非产品强制单文件。

---

## 5. 阻塞与坑

1. **系统 rustc 1.85 过旧** → 需 rustup stable（本机 1.99.1）编 `ort`/新 edition。
2. **`ort` 链接**：缺 `pkg-config`/`libssl-dev`/`g++` 会分别在 openssl 与 libstdc++ 处失败。
3. **tract**：原生 ONNX 因 INT64 `Clip` 与动态 `Range` 无法直接 `analyse`；改写后精度可接受（~1e-5），但 **变长序列要固定上界或多次导出**。
4. **tract + OCR**：即便喂具体 shape，det 图上 Conv 动态维仍失败 → OCR 不要指望 tract。
5. **candle**：缺 `protoc`；API 变更；算子覆盖未验证。
6. **ModelScope / PaddleX 缓存**：目录 listing 常为 0 字节占位，直链 ONNX 可下；`~/.paddlex` 多为 Paddle 格式而非 ONNX。
7. **AGPL**：document-worker 与其权重 AGPL-3.0；把权重打进闭源/不同许可的插件分发有合规风险。

---

## 6. 设计推荐

### 6.1 首选架构

```
┌─────────────────────────────────────────────┐
│  Obsidian / ZotLit（Electron 37 / Node）    │
│    └─ Node-API addon 或独立 cdylib           │
│         ├─ ort 静态链接（~24 MB 量级产物）   │
│         ├─ 可选：与 FTS5 tokenizer 同仓库    │
│         │     但建议进程/插件边界分离         │
│         └─ 权重加载：                         │
│              • block-seg：读 Zotero 安装树    │
│                里 document-worker 的 .onnx   │
│                （不二次分发 AGPL 权重）       │
│              • OCR：可选捆绑 RapidOCR ONNX   │
│                （Apache-2.0）或用户自备       │
└─────────────────────────────────────────────┘
```

- **为何 ort 静态而非 tract 做默认**：零改图、diff=0、OCR 同引擎、延迟与现网一致；代价是 +libstdc++ 与 ~24 MB（仍远小于「整份 Python+torch」，且无散落 `.so` 搜索路径问题）。
- **tract 作可选后端**：仅 block-seg、可接受 ONNX 改写与固定 max-T 时，换 15 MB、无 libstdc++ 的更「whisper.cpp」形态。
- **不要**把 AGPL 权重嵌进要 redistributable 的 ZotLit 二进制；运行时定位 Zotero 资源更干净。若必须内嵌，插件许可需按 AGPL 处理并提供对应源码义务说明。
- **FTS5 扩展**：现有 `BENCH_ROOT/zotlit-fts-addon/`（ICU4X + 可选 jieba）可同仓，但推理与分词生命周期不同，**合并成一个 .so 可以，默认建议两个 artifact**，避免 SQLite 扩展加载拖进 ORT。

### 6.2 和「不要一堆依赖」的对齐度

| 诉求 | ort 静态 | tract |
|------|----------|-------|
| 无 Python / 无 PyTorch | ✅ | ✅ |
| 无随包 `libonnxruntime.so` | ✅（链进二进制） | ✅ |
| 仅 libc 系 | ⚠️ 多 libstdc++ | ✅ |
| 开箱跑 Zotero 原版 ONNX | ✅ | ❌ 需改写 |
| OCR 同栈 | ✅ | ❌ |

**一句话**：可以做到接近 whisper.cpp 的「一个原生文件」；工程上 **`ort` 静态链接是最稳的 whisper.cpp 替代方案**，tract 是更纯 Rust、更挑模型的进阶选项。权重与 AGPL 用「读 Zotero 已有文件」拆开。

---

## 7. 复现

```bash
source BENCH_ROOT/static-infer/.venv/bin/activate
source "$HOME/.cargo/env"
bash BENCH_ROOT/static-infer/scripts/run_all.sh
# 结果 JSON：results/{ort,tract,ocr_extra}.json ；参考输出：ref/
```

环境备注：默认系统 Node 20；可用 `npx -y node@24`。本 bench 为独立 Rust CLI，不依赖 Obsidian。


---

## 8. 补充：以「PP-OCR 的引擎」做静态运行时（不做 OCR）

解读 Aiden「我们不需要 OCR，用 ppocr 的引擎」：丢弃文字识别路径；评估 **PaddleOCR 部署用的推理引擎**，用来跑：

1. Zotero block-seg ONNX（clusterer / repair / classifier）
2. 可选视觉版面：**PP-DocLayout-S / plus-L**（仅 layout，不做 rec）

目标平台：**CPU-only**。延迟报告 **1 线程与 4 线程**。

### 8.1 paddleocr-js 实际用的引擎（关键结论）

本地 `PADDLEOCR_ROOT/paddleocr-js/packages/core/package.json`：

- 依赖：`onnxruntime-web ^1.22.0` + `@techstark/opencv-js`
- **不是** Paddle Lite / paddle.js
- 与 Zotero document-worker **同一类运行时（ORT WASM）**

因此「跟 PP-OCR 前端部署对齐」≈ 继续走 **ONNX Runtime**（原生静态链 ort / 或现有 WASM），而不是换到 Lite。

### 8.2 Paddle Lite（v2.14-rc，2024-07-19）

| 项 | 实测 |
|----|------|
| 预编译 light 静态库 `.a` | **94 MB** |
| light 共享库 `.so` | **18 MB** |
| 另需 MKLML | `libmklml_*.so` **~126 MB** + `libiomp5.so` **2.1 MB**（x86 包） |
| 最小 CLI 静态链接后 strip | **18 MB**，`ldd` 仍要 **libiomp5 + libstdc++ + libc…**（非纯 libc） |
| 最小 CLI 动态链接 strip | **108 KB** + 运行时 so |
| 许可 | Apache-2.0 |
| 维护 | 最新 GitHub release 仍是 **v2.14-rc（2024-07）**；相对 ORT/Paddle3 偏旧 |
| 平台 | Android/iOS 主场；Linux x86 有包；macOS/Windows 历史有预编译，**Apple Silicon 非一等公民** |

**block-seg 转换链路（失败）**：

1. `X2Paddle` + 现网 ONNX：`repair.onnx` 可转，但 Paddle 3.2 导出的是 **`model.json`（PIR）**，不是经典 `pdmodel`。
2. `paddle_lite_opt`：**明确拒绝** PIR/`model.json`（需 `__model__` / `model.pdmodel` 等旧格式）。
3. `clusterer.onnx` / `classifier.onnx`：X2Paddle 直接报 **`LayerNormalization` 不支持**（opset 17 亦超出其官方 7–15 声明）。

→ **无法在本环境把 block-seg 跑进 Paddle Lite**；亦无 max-abs-diff / Lite 延迟数字。

**PP-DocLayout-S × Lite**：官方权重为 Paddle3 `inference.json`+`pdiparams`，同样不被 Lite opt 接受；未得到 `.nb`。

### 8.3 Paddle Inference（服务端 C++ / Python，CPU）

| 项 | 数据 |
|----|------|
| 本机 `paddle` 包（含 `libpaddle.so`） | 目录 **~700 MB**；`libpaddle.so` **244 MB** |
| 预编译 `paddle_inference.tgz` | 量级通常 **数百 MB～1GB+**（CPU+MKL/oneDNN），远大于 ort 静态 24 MB / tract 15 MB |
| DocLayout-S（PIR，CPU，本机） | **1 线程 25.4 ms** / **4 线程 12.3 ms**（480×480） |
| DocLayout plus-L | 本 bench 用 480 输入 shape 不匹配失败（模型期望更大特征图）；权重 alone **~123 MB** |
| 依赖 | oneDNN/MKL、libstdc++ 等，**不可能** whisper.cpp 式「单文件几 MB」 |
| 许可 | Apache-2.0 |

对 Obsidian 插件：**体积与依赖均不合格** 作为默认嵌入运行时。

### 8.4 FastDeploy

旧 CV 向 FastDeploy 已弱化；GitHub `PaddlePaddle/FastDeploy` 近况转向 **LLM/VLM** 部署工具箱，且内部仍包装 Paddle Inference / ORT 等，**不提供比 ort 静态更小的独立路径**。

### 8.5 CPU 延迟对比（本机，页等价；ORT 1.31.1）

| 工作负载 | 1 线程中位 | 4 线程中位 | 1000 页估时（串行） |
|----------|------------|------------|---------------------|
| block-seg 合计（clus+repair+clf） | **3.10 ms** | **2.50 ms** | **~3.1 s** / **~2.5 s** |
| PP-DocLayout-S 推理（480²，ORT） | **23.4 ms** | **14.7 ms** | **~23 s** / **~15 s** |
| PP-DocLayout-S（Paddle Inference） | **25.4 ms** | **12.3 ms** | ~25 s / ~12 s |
| 页面光栅 pdftoppm @72 DPI | **70 ms** | — | 渲染常成瓶颈 |
| DocLayout-S + 渲染@72 | **~93 ms** | **~85 ms** | **~1.6 / 1.4 min** |

说明：block-seg 模型很小，4 线程收益有限（~20%）；DocLayout 卷积更大，4 线程约 **1.6×**。1000 页库若**仅文本层 block-seg**，秒级；若走扫描件 layout，主要成本在 **渲染 + DocLayout**。

数据文件：`results/cpu_threads_latency.json`、`results/paddle_infer_doclayout.json`、`results/paddle_lite_footprint.json`。

### 8.6 与先前 ort / tract 对照后的修订推荐

| 引擎 | block-seg | DocLayout-S | strip 体积级 | 依赖 | 维护 | 适合 ZotLit？ |
|------|----------|--------------|--------------|------|------|----------------|
| **ort 静态**（先前） | ✅ diff=0 | ✅（ONNX） | **~24 MB** | libstdc++ 等 | 活跃 | **是（默认）** |
| **tract**（先前） | ✅ 需改图 | ❌ | **~15 MB** | 近纯 libc | 活跃 | 可选纯 Rust |
| **onnxruntime-web**（Zotero / paddleocr-js） | ✅ | ✅ | WASM **13 MB** | 无原生 so | 活跃 | 已在用 |
| **Paddle Lite** | ❌ 转换链断 | ❌ PIR | 静态 CLI 18 MB **+ iomp5**；`.a` 94 MB | iomp5/MKL 重 | **停在 2.14-rc** | **否** |
| **Paddle Inference** | 需再转 paddle | ✅（S） | **百 MB～GB** | 重 | 活跃 | **否（插件内嵌）** |

**推荐（修订）**：

1. **不要**为「跟 PP-OCR 同源」去绑 Paddle Lite / Paddle Inference——PP-OCR 自己的 JS SDK 已经选了 **ORT**。
2. 继续 **`ort` 静态链接的 Rust/Node addon** 跑 block-seg；权重仍建议运行时读 Zotero document-worker（AGPL）。
3. 需要扫描页 layout 时，加载 **PP-DocLayout-S ONNX（~4.7 MB，Apache-2.0）** 同一 ort 引擎；默认 1 线程即可，库批量可开 4 线程。
4. tract 仍可作为「更小、无 libstdc++」的 block-seg 备选，但不覆盖 DocLayout。

