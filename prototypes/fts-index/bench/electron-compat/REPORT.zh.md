# ZotLit 原生模块 Electron 兼容性验证报告

**日期**：2026-10-27（Asia/Singapore）  
**环境**：Linux x64；xvfb / headless Electron  
**原则**：原生构建只需覆盖 **ZotLit 所支持的 Obsidian/Electron 版本本身所支持的系统**，不必更旧。

---

## 0. 支持地板（本报告最终目标）

### 0.1 ZotLit → Obsidian → Electron

| 来源 | 值 |
|------|-----|
| `github.com/aidenlx/zotlit` **main** / release **2.1.4** `manifest.json` | **`minAppVersion`: `1.13.4`** |
| 旧分支 `master`（1.x） | `minAppVersion` 1.6.7（已非当前 2.x 产品线） |
| Obsidian **1.13.4** 安装器 changelog | 安装器升至 **Electron v43.1.1** |
| Obsidian **1.14.5**（当前 latest） | 安装器 **Electron 43.8.3**（由 43.7.5 安全升级） |

说明：Obsidian **应用版本**可自动更新，**Electron 随安装器**走；用户可能在 app ≥ 1.13.4 下仍保留更旧安装器。1.13.4 起明确提示需重装以获得 Electron 43；此前 1.12.x 曾回退到 Electron **39.6.0**。本 bench 因此实测 **39 / 43 / 45**，以覆盖「未重装安装器」与「当前/略新」区间。  
**ABI 上** N-API 一份即可；**OS/glibc 地板**按 Electron 39/43 官方平台支持取交集（两者声明一致）。

### 0.2 Electron 官方平台支持（v39.6.0 / v43.x 相同表述）

摘自 Electron README：

| 平台 | 最低要求 | 架构预编译 |
|------|----------|------------|
| **macOS** | **Monterey (12)+** | x64 + arm64（Apple Silicon） |
| **Windows** | **Windows 10+** | x64、arm64；**ia32 仍提供至 Electron 43 系列（之后 EOL）** |
| **Linux** | 预编译在 **Ubuntu 22.04** 上构建；**验证**可运行于 Ubuntu **18.04+**、Fedora **32+**、Debian **10+** | x64、arm64；**armv7l 至 Electron 43 系列（之后 EOL）** |

Electron **构建 sysroot**（`script/sysroots.json`，v43.8.3）：**Debian bullseye** → glibc **2.31**。  
对本机下载的 Electron 二进制 `objdump -T`：`electron` 本体 GLIBC 上限 **2.25**（其余配套 .so 多为 2.16–2.17）。

对应发行版 glibc：

| 发行版 | glibc |
|--------|-------|
| Ubuntu 18.04（Electron 验证下限） | 2.27 |
| **Debian 10**（Electron 验证下限） | **2.28** |
| Debian 11 bullseye（Electron **构建** sysroot） | 2.31 |
| Ubuntu 22.04（Electron 构建主机） | 2.35 |

### 0.3 原生制品采用的地板

| 项目 | 选择 | 理由 |
|------|------|------|
| **Linux glibc** | **`≤ 2.28`** | 对齐 Electron「验证可跑 Debian 10」；不必追 2.27（Ubuntu 18.04）除非另有需求 |
| **工具链** | `cargo zigbuild --target x86_64-unknown-linux-gnu.2.28` + 静态 libstdc++ + `__isoc23_*` shim | 压低符号版本；规避 Electron 侧无 libstdc++ |
| **macOS deployment target** | **12.0**（Monterey） | 对齐 Electron 39/43 |
| **Windows** | Win10+；**`/MT` 静态 CRT** | 对齐 Electron；免 VC++ 红配电 |
| **架构（插件发布）** | **linux-x64、linux-arm64、win32-x64、win32-arm64、darwin-x64、darwin-arm64**（或 darwin universal2） | ia32 / armv7l 仅 Electron 43 仍有预编译且将 EOL，ZotLit 可不提供 |

---

## 1. 制品与 Electron 矩阵（实测）

| 制品 | 路径 | GLIBC max | NEEDED（节选） |
|------|------|-----------|----------------|
| ORT N-API（地板构建） | `addons/ort_infer_glibc228.node`（亦复制为 `ort_infer.linux-x64-gnu.node`） | **2.28** | libm, libpthread, libc, libdl（**无 libstdc++ / libgcc_s**） |
| FTS5 CJK ICU | `addons/zotlit_cjk_icu_glibc228.so`（亦复制为 `zotlit_cjk_icu.so`） | **2.28** | libpthread, libc, libdl |
| 对照 better-sqlite3 | `addons/better_sqlite3.node` | — | Node modules **115** 预编译 |

实测 Electron：

| 标签 | Electron | Node | modules | 角色 |
|------|----------|------|---------|------|
| e39 | 39.6.0 | 22.22 | 140 | 旧安装器可能残留 |
| e43 | **43.8.3** | 24.22 | 148 | **当前 Obsidian 1.14.5** |
| e45 | 45.0.0 | 24.22 | 150 | 略新 |

上下文：main / renderer（`nodeIntegration` + `contextIsolation: false`）/ utilityProcess / `ELECTRON_RUN_AS_NODE` child。

### 1.1 N-API 跨版本（无需 electron-rebuild）

地板构建的 `.node` 在 **e39/e43/e45 × 四上下文** 全部 `require` + repair 推理成功。  
Node 预编译 better-sqlite3 全部 **NODE_MODULE_VERSION 不匹配**（对照）。

> **相对 better-sqlite3「按 Electron 出包」**：N-API 目标是 **一份跨 Electron**；静态化解决的是 **动态库/CRT**，不是 ABI 矩阵。

### 1.2 node:sqlite + FTS

三版 Electron 均有 `node:sqlite`；`allowExtension` + `loadExtension(zotlit_cjk_icu*.so)` + CJK/日文查询全部成功。默认禁止扩展时正确报错。

### 1.3 零拷贝

Electron 全部拒绝 `napi_create_external_arraybuffer`（status **22**）；JS Buffer → native 正常（~0.2 ms/1MB）。宿主 Node 20 上 external AB 可用。

### 1.4 ORT worker / 同进程

同进程仅允许一个 ORT Environment（含 worker_threads）；隔离用 utilityProcess/child。

---

## 2. 地板重建方法（已落地）

### 2.1 ORT 插件

问题：pyke `download-binaries` 的 `libonnxruntime.a` 在较新 glibc 上编译，对象内含 **`__isoc23_strto*`（GLIBC_2.38）**；主机直链还会带出 **GLIBC_2.34** 的 `pthread_*`/`dl*`（符号并入 libc 后的新版本）。

做法：

1. `cargo zigbuild -p ort_infer_napi --release --target x86_64-unknown-linux-gnu.2.28`
2. `ORT_STATIC_LIBSTDCXX=1`，`ORT_CXX_STDLIB=`（空），`build.rs` whole-archive 主机 `libstdc++.a` + `-Wl,-u` 拉住 RTTI
3. 预编译 `crates/glibc_compat/isoc23_shim.c`（zig `-target x86_64-linux-gnu.2.28`）提供 `__isoc23_*`，满足 ORT .a 的未定义引用
4. ort 特征：`default-features = false` + `std,ndarray,download-binaries,api-31,tls-rustls`（避免 zig 交叉时 openssl 头路径问题）
5. **勿**把 `-Wl,--exclude-libs` 放进 zig 链接（lld 不支持）；主机 g++ 链接时仍可用

结果：`objdump -T` → **GLIBC_max = 2.28**；Electron 39/43/45 加载推理 OK。

若将来 pyke 提供 manylinux/旧 glibc 的 ORT 静态库，可去掉 shim，改为直接链官方旧库。

### 2.2 FTS5 `.so`

```bash
cd zotlit-fts-prototype/crates/zotlit-fts-ext
RUSTFLAGS='-C link-arg=-static-libgcc' \
  cargo zigbuild --release --no-default-features \
  --target x86_64-unknown-linux-gnu.2.28
```

ICU-only（`--no-default-features`）；GLIBC_max **2.28**；Electron 内 CJK FTS 查询 OK。

---

## 3. 最终目标矩阵（发布用）

| OS | 最低版本 | Arch | 工具链 / 标志 | 备注 |
|----|----------|------|----------------|------|
| **Linux** | glibc **2.28**（Debian 10 / 对齐 Electron 验证下限；构建参考 bullseye 2.31 sysroot） | **x64**, **arm64** | `cargo zigbuild --target {arch}-unknown-linux-gnu.2.28`；静态 libstdc++；`-fvisibility=hidden` / `--exclude-libs`（仅 GNU ld）；`isoc23` shim 直至 ORT 预编译降地板 | 不强制 armv7l |
| **macOS** | **12.0 Monterey** | **x64**, **arm64**（或 universal2） | `MACOSX_DEPLOYMENT_TARGET=12.0`；静态链 ORT；codesign；notarize 可选；注意 quarantine | 对齐 Electron 39/43 |
| **Windows** | **Windows 10** | **x64**, **arm64** | MSVC **`/MT`**（静态 CRT）；静态 ORT；N-API `.node` | ia32 可选，Electron 43 后 EOL |
| **Obsidian 应用** | **≥ 1.13.4**（ZotLit `minAppVersion`） | — | 安装器建议 Electron **≥ 43.1.1**；N-API 仍兼容 39 | 文档中提示更新安装器 |
| **Electron 测试覆盖** | 39.x / 43.x /（可选）45.x | — | 无需 per-version rebuild | 一份 N-API 二进制 |

**分发**：社区插件本体走 Obsidian 通道；原生资产按 `platform-arch` 按需下载（hash 校验）。不必按 Electron 小版本拆包。

---

## 4. 结果矩阵摘要

对地板构建制品 × e39/e43/e45 × {main, renderer, utility, child}：

| 测试项 | 结果 |
|--------|------|
| ort_infer（glibc228） | 全部 OK |
| FTS CJK loadExtension | 全部 OK |
| better-sqlite3 Node 预编译 | 全部 MISMATCH（对照） |
| external ArrayBuffer | 全部 DENIED (22) |
| JS Buffer → native | 全部 OK |
| ORT 同进程二次 init | 失败（设计约束） |

---

## 5. 建议

1. CI 默认用 **glibc 2.28 zig 目标** 出 Linux 资产；保留 shim 直到上游 ORT 静态库降版本。  
2. 文档写明：支持 Obsidian ≥ 1.13.4；Linux ≥ Debian 10 / Ubuntu 18.04+（与 Electron 一致）；建议安装器 Electron ≥ 43。  
3. ORT 进程内单例；大图勿依赖 external AB。  
4. Win `/MT`、macOS deployment 12.0、按 arch 下载。

---

## 6. 产物路径

```text
BENCH_ROOT/electron-compat/
  addons/ort_infer_glibc228.node      # 地板 ORT（推荐发布）
  addons/zotlit_cjk_icu_glibc228.so   # 地板 FTS
  ort_infer.linux-x64-gnu.node        # 同上副本（harness 默认）
  zotlit_cjk_icu.so
  crates/glibc_compat/isoc23_shim.c
  results/e{39,43,45}.json
  REPORT.zh.md  SUMMARY.zh.md
```

未修改 `BENCH_ROOT/layout-compare`；未推送/发布任何内容。
