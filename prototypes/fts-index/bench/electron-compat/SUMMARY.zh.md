# ZotLit × Electron 兼容性 — 摘要（含支持地板）

**地板**
- ZotLit 2.1.4 `minAppVersion` = **Obsidian 1.13.4** → 安装器 **Electron 43.1.1**；当前 1.14.5 = **Electron 43.8.3**。可能残留安装器 Electron **39**。
- Electron 39/43 官方：macOS **12+**，Windows **10+**，Linux 验证 **Debian 10+ / Ubuntu 18.04+**（构建 sysroot = Debian bullseye **glibc 2.31**）。
- 原生制品对齐 **glibc ≤ 2.28**（Debian 10），无需更旧。

**已重建并验证**
- ORT N-API：`cargo zigbuild …gnu.2.28` + 静态 libstdc++ + `__isoc23` shim → **GLIBC_max=2.28**，无 libstdc++ NEEDED；Electron 39/43/45 × main/renderer/utility/child 推理全绿。
- FTS ICU `.so`：同目标 **GLIBC_max=2.28**；`node:sqlite` loadExtension + CJK 查询全绿。
- N-API 一份跨 Electron；better-sqlite3 式按版本出包不必要。external AB 在 Electron 不可用。

**发布矩阵**：Linux glibc2.28 x64/arm64（zig）；macOS 12 x64/arm64；Win10+ x64/arm64 `/MT`。详见 `REPORT.zh.md`。
