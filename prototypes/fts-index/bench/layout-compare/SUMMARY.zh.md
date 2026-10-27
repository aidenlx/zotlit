# 摘要（v3 源 GT 严格复评，取代 v1/v2 质量表）

> 日期：2026-10-27（Asia/Singapore）  
> 数据：`corpus-v3/out/AGGREGATE_V3.json`、`corpus-v3/viz/v3_*.png`  
> **本摘要的 FTS 质量数字全部来自 v3；旧 C 采样与 v2 小语料表作废。**

## 运行时（未改）
- Rust `ort` 静态 napi（~24.7 MB，ldd 无 libonnxruntime.so）：block-seg p50 ≈ **3.1 ms**，DocLayout-S ≈ **23 ms@1 / 11 ms@4**；相对 ref **MAD=0**；WASM 约慢 7–8×。
- 同进程不可二次 `Ort::Environment`；C 用独立 child（`--import pdfjs-setup` + nativeONNXRun）。

## FTS 质量 v3（固定 CJK tokenizer，n=29，623 查询）
| 方法 | phrase | 跨行 | 家具/100q↓ | 阅读序 | 块 top-1 |
|---|---:|---:|---:|---:|---:|
| **A** pdf.js 页 | **0.94** [0.91–0.96] | **0.93** | 4.3 | 0.75 | 1.00 |
| **B** 启发式双栏 | 0.74 [0.65–0.83] | 0.67 | 3.6 | 0.55 | 1.00 |
| **C** SDT-napi 块 | 0.84 [0.77–0.90] | 0.82 | **1.3** | **0.76** | 0.99 |
| **D** DocLayout-S 块 | 0.62 [0.55–0.69] | 0.58 | 4.1 | 0.44 | 0.99 |

配对符号检验（phrase）：A≻C≻B≻D（A vs 其余 p≈0；C vs D p≈0；B vs C p=0.11 未显著）。

## 怎么读
- **A 召回最高**：页级不切分，跨行/跨栏短语天然完整；但家具误命中高。
- **C 最均衡**：家具过滤明显最好，阅读序与 A 持平，phrase 仅低于 A ~9pp；双栏子集同样成立。
- **D 全面落后**：S 模型框→文本分配漏字/切碎短语；家具剔除弱于 C。M/L 导出仍失败，不可外推到更大 DocLayout。
- **B 不稳定**：部分单栏/复杂页启发式翻车（phrase 可低至 0.18）。

## 诚实限制
- 源↔PDF 对齐覆盖均值仅 **~0.46**（LaTeX 宏/公式剥离后模糊对齐）；只保留对齐上的段落作 GT。
- 查询含故意跨行/跨栏片段；跨页样本少。
- 固定 tokenizer（CJK bigram PRIMARY + ICU COLOCATED）；**未**改分词源码。
- progit-zh phrase 全方法偏低（中文源↔PDF 对齐与分词边界）。
- 未推送、未发帖。

## 未完成
- PP-DocLayout-M / plus-L ONNX 仍因 paddle2onnx×Paddle3 导出失败。
