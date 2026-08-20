zotlit-prefs-pane-label = ZotLit
zotlit-prefs-notify-section = Obsidian 通知
zotlit-prefs-notify-enable =
    .label = 启用
zotlit-prefs-notify-url = 通知 URL

zotlit-prefs-database-section = 数据库
zotlit-prefs-wal-checkpoint =
    .label = 为 Obsidian 保持数据库文件最新
zotlit-prefs-wal-checkpoint-description = 将预写日志中的最新更改写入主数据库文件，使 ZotLit 读取到最新数据。

zotlit-prefs-logging-section = 日志
zotlit-prefs-logging-level = 控制台日志级别
zotlit-prefs-log-level-trace =
    .label = Trace
zotlit-prefs-log-level-debug =
    .label = Debug
zotlit-prefs-log-level-info =
    .label = Info
zotlit-prefs-log-level-warning =
    .label = Warning
zotlit-prefs-log-level-error =
    .label = Error
zotlit-prefs-log-level-fatal =
    .label = Fatal

zotlit-menu-item-open =
    .label = 在 Obsidian 中打开文献笔记
zotlit-menu-submenu =
    .label = ZotLit
zotlit-menu-item-update =
    .label = 创建或更新文献笔记
zotlit-menu-item-update-metadata =
    .label = 更新文献笔记元数据
zotlit-menu-item-import-child-notes =
    .label = 导入子笔记
zotlit-menu-item-import-notes =
    .label = 导入所选笔记
zotlit-menu-item-explore =
    .label = 探索模板数据
zotlit-menu-collection-update-all =
    .label = 创建或更新文献笔记
zotlit-menu-collection-import-all-notes =
    .label = 导入子笔记与独立笔记
zotlit-menu-item-copy-key =
    .label = { $kind ->
        [attachment] 复制附件标识符
        [childNote] 复制子笔记标识符
        [note] 复制笔记标识符
        [item] 复制条目标识符
       *[mixed] 复制所选标识符
    }
zotlit-menu-reader-annot-explore = 在 Obsidian 中探索标注
zotlit-menu-reader-annot-copy-key = 复制标注标识符
zotlit-menu-reader-page-open = 在 Obsidian 中打开文献笔记

zotlit-batch-update-server-needed-title = 无法在 Obsidian 中更新文献笔记
zotlit-batch-update-server-needed-message = 所选条目过多，无法通过链接发送。请在 Obsidian 设置中启用 ZotLit 服务器，或减少所选条目后重试。
zotlit-batch-update-sending-title = 正在请求 Obsidian 更新文献笔记…
zotlit-batch-update-failed-title = 无法连接到 Obsidian
zotlit-batch-update-failed-message = 请确认 Obsidian 正在运行且已启用 ZotLit 服务器，然后重试。
zotlit-batch-update-sent-title = 请在 Obsidian 中继续
zotlit-batch-update-sent-message = 已请求 Obsidian 更新 { $count } 条文献笔记。请切换到 Obsidian 继续。

zotlit-protocol-incompatible-title = 需要更新
zotlit-protocol-incompatible-message = ZotLit Obsidian 插件版本不兼容。请将 Zotero 和 Obsidian 插件都更新到匹配的版本后重试。

zotlit-batch-import-sending-title = 正在请求 Obsidian 导入笔记…
zotlit-batch-import-failed-title = 无法连接到 Obsidian
zotlit-batch-import-failed-message = 请确认 Obsidian 正在运行且已启用 ZotLit 服务器，然后重试。
zotlit-batch-import-sent-title = 请在 Obsidian 中继续
zotlit-batch-import-sent-message = 已请求 Obsidian 导入 { $count } 条笔记。请切换到 Obsidian 继续。

zotlit-column-obsidian-note = 文献笔记
zotlit-menu-tools-refresh-note-status =
    .label = ZotLit：刷新文献笔记状态
zotlit-note-status-refreshing-title = 正在刷新文献笔记状态…
zotlit-note-status-refreshed-title = 文献笔记状态已刷新
zotlit-note-status-refreshed-message = { $count } 个条目在 Obsidian 中有文献笔记。
zotlit-note-status-refresh-failed-title = 无法刷新文献笔记状态
zotlit-note-status-refresh-failed-message = 请确认 Obsidian 正在运行且已启用 ZotLit 服务器，然后重试。

zotlit-database-status =
    .tooltiptext = 数据库状态
zotlit-database-status-working = 正在为 Obsidian 将更改写入数据库文件。
zotlit-database-status-automatic-off = 已关闭自动写入数据库文件。您仍可手动写入更改。
zotlit-database-status-no-wal = 此数据库未使用预写日志。更改已直接写入数据库文件。
zotlit-database-status-failed = 上次尝试将更改写入数据库文件时失败。
zotlit-database-status-never-written = 尚未写入任何更改。
zotlit-database-status-last-written = 上次写入时间：{ $time }。
zotlit-database-status-last-attempt = 上次尝试时间：{ $time }。
zotlit-database-status-write-now = 立即将更改写入数据库文件
zotlit-database-status-guide = 修复陈旧数据…
zotlit-database-write-running-title = 正在将更改写入数据库文件…
zotlit-database-write-done-title = 数据库文件已更新
zotlit-database-write-done-message = Obsidian 现在可以读取最新更改。
zotlit-database-write-in-use-title = 数据库文件正在使用中
zotlit-database-write-in-use-message = 请稍候片刻，然后重试。
zotlit-database-write-failed-title = 无法将更改写入数据库文件
zotlit-database-write-failed-message = 请收集 <a href="{ $debugLogsUrl }" tooltiptext="{ $debugLogsUrl }">Zotero 调试日志</a>，然后报告此问题。
