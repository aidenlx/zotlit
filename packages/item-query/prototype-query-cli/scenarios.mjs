// PROTOTYPE — guided walkthroughs for the query CLI prototype page. Domain language, Chinese.
export const SCENARIOS = [
  {
    id: "one-command",
    title: "一条命令，三种数据",
    intro:
      "现在要查条目用 zotlit:item-query，查批注用 zotlit:annotation-query，附件根本查不了。提案里只有一条 zotlit:query，用 from= 选「查什么」，其余参数完全一样。留意三步的参数形状是否一致。",
    steps: [
      {
        label: "查文献（默认 from=items）",
        cmd: `zotlit:query fields=title,date.year limit=5 format=table`,
        watch: "没写 from 就是查文献；默认按修改时间倒序，最多 100 行。",
      },
      {
        label: "查附件（from=attachments）",
        cmd: `zotlit:query from=attachments fields=title,contentType,exists,item.title limit=5 format=table`,
        watch: "附件是新数据集。item.title 顺着「附件 → 父条目」拿到论文标题。",
      },
      {
        label: "查批注（from=annotations）",
        cmd: `zotlit:query from=annotations fields=type,text,pageLabel,item.citationKey limit=5 format=table`,
        watch: "同样的参数名、同样的结果信封。换的只有 from。",
      },
      {
        label: "一次看全部字段（schema）",
        cmd: `zotlit:query-schema`,
        watch:
          "一个 schema 命令列出三种数据的字段和它们之间的关系（relation 列）。",
      },
    ],
  },
  {
    id: "join-pdf",
    title: "像 SQL 一样跨表：没有可用 PDF 的论文",
    intro:
      "研究者常问「哪些论文我其实打不开」：要么没附件，要么 PDF 文件在这台电脑上丢了。这需要从文献走到它的附件再看文件是否存在。看现行写法能走多远。",
    steps: [
      {
        label: "现行：只能问「完全没附件」",
        cmd: `zotlit:item-query filter='!attachments' fields='["title","attachments"]'`,
        watch:
          "现行合同里 attachments 是个布尔值。Lovelace 那篇有一个丢失的扫描件，它被当作「有附件」漏掉了。",
        old: true,
      },
      {
        label: "提案：附件是一个列表，可以 filter",
        cmd: `zotlit:query filter='attachments.filter(value.contentType == "application/pdf" && value.exists).isEmpty()' fields=title,attachments[].path format=table`,
        watch:
          "5 行：含 Lovelace（文件丢失）和周明（只有一个网址链接）。写法和 Obsidian Bases 的 list.filter 一模一样。",
      },
      {
        label: "反过来从附件出发",
        cmd: `zotlit:query from=attachments filter='linkMode == "linked_file" && !exists' fields=title,path,item.title format=table`,
        watch: "同一个问题从另一张表问：哪些链接文件坏了。现行完全问不到。",
      },
    ],
  },
  {
    id: "reading-plan",
    title: "阅读计划：还没做批注的论文",
    intro:
      "评测里最难的一题：列出某标签的论文，包括零批注的，并给每篇的批注数。现行要两次调用再自己合并。",
    steps: [
      {
        label: "现行第 1 步：查论文",
        cmd: `zotlit:item-query libraries=all filter='itemType == "journalArticle" && tags.contains("query-eval")' fields='["title"]' limit=all`,
        watch: "6 篇论文。但不知道每篇有几条批注。",
        old: true,
      },
      {
        label: "现行第 2 步：查批注",
        cmd: `zotlit:annotation-query libraries=all filter='item.itemType == "journalArticle" && item.tags.contains("query-eval")' fields='["item.title"]' limit=all`,
        watch:
          "14 条批注行。接下来得自己按 itemIndexedKey 合并计数，零批注的论文只在第一步里出现。",
        old: true,
      },
      {
        label: "提案：一次调用",
        cmd: `zotlit:query library=all filter='itemType == "journalArticle" && tags.contains("query-eval")' fields=title,annotations.length,annotations[].text limit=all format=table`,
        watch:
          "annotations.length 直接给数量，annotations[].text 像 jq 一样把列表展开取字段。零批注的论文也在。",
      },
    ],
  },
  {
    id: "arg-form",
    title: "参数写法：逗号列表 vs JSON 数组",
    intro:
      "同一个查询，两种写法，结果完全一样。比一比在 shell 里的长度和引号数量。",
    steps: [
      {
        label: "现行：fields 和 sort 是 JSON 数组",
        cmd: `zotlit:item-query filter='date.year >= 2014' fields='["title","date.year","creators[0].fullName"]' sort='[{"field":"date","direction":"desc"},{"field":"title","direction":"asc"}]' limit=5`,
        watch: 'sort 要写 {"field":…,"direction":…}，一不小心就少个引号。',
        old: true,
      },
      {
        label: "提案：逗号列表，- 表示倒序",
        cmd: `zotlit:query filter='date.year >= 2014' fields=title,date.year,creators[0].fullName sort=-date,title limit=5 format=table`,
        watch:
          "sort=-date,title 是 JSON:API / Django 的写法；fields=a,b 是 gh --json 的写法。JSON 数组仍然接受。",
      },
      {
        label: "自定义字段名里有点号时要加引号",
        cmd: `zotlit:query fields='title,custom["review.status"]' limit=5 format=table`,
        watch:
          'custom["…"] 的方括号写法照旧；放进 shell 要用单引号包住整个值，这点和现在一样。',
      },
    ],
  },
  {
    id: "group",
    title: "分组统计：每篇论文几条批注",
    intro:
      "「每年几篇」「每篇几条批注」「附件各类型多少」是研究者最常见的统计问题。Obsidian Bases 有 groupBy，SQL 有 GROUP BY；提案用 group= 表达同一件事。",
    steps: [
      {
        label: "每篇论文的批注数",
        cmd: `zotlit:query from=annotations group=item.citationKey fields=[] limit=all`,
        watch:
          "groups 里每组有 value、count 和该组的行。fields=[] 让行只剩身份。",
      },
      {
        label: "Thesis 收藏夹按年份计数",
        cmd: `zotlit:query filter='collections.within("Thesis")' group=date.year fields=title limit=all`,
        watch: "没有年份的归到 value: null 一组，排在最后。",
      },
      {
        label: "附件按类型计数",
        cmd: `zotlit:query from=attachments group=contentType fields=[] limit=all`,
        watch: "现行根本没有附件数据集，这题问不了。",
      },
    ],
  },
  {
    id: "diagnose",
    title: "写错了怎么办",
    intro:
      "新手最怕的是「没报错但结果为空」。看三种错误各自怎么回报：拼错字段、列表和文本比较、少了括号。",
    steps: [
      {
        label: "拼错字段名",
        cmd: `zotlit:query filter='titel.contains("rules")'`,
        watch:
          "ok:false，diagnostic.suggestions 给出 title，report 里有 ^ 标记位置。",
      },
      {
        label: 'tags == "…"（永远不成立）',
        cmd: `zotlit:query from=annotations filter='tags == "query-annotation-method"'`,
        watch:
          "查询成功但 0 行；warnings 说明列表永远不等于文本，并建议改成 tags.contains(…)。",
      },
      {
        label: "改正后",
        cmd: `zotlit:query from=annotations filter='tags.contains("query-annotation-method")' fields=text,colorName,item.indexedKey format=table`,
        watch: "4 条批注，跨两个图书馆。",
      },
      {
        label: "少了右括号",
        cmd: `zotlit:query filter='title.contains("rules"'`,
        watch: "语法错误指向表达式末尾，expected 列出 )。",
      },
    ],
  },
  {
    id: "query-file",
    title: "保存成查询文件（Bases 的形状）",
    intro:
      "命令行参数适合代理和一次性问题；研究者反复用的查询应该能存成文件，像 Obsidian 的 .base 一样。切到「查询文件」页签，看同一个请求的 YAML 形态。",
    steps: [
      {
        label: "一个常用查询",
        cmd: `zotlit:query filter='collections.within("Thesis") && annotations.filter(value.type == "highlight").isEmpty()' fields=title,date.year sort=-date limit=all format=table`,
        watch:
          "切到「查询文件」页签：filters 的 && 被拆成 and: 列表，和 .base 的写法一致。",
      },
      {
        label: "搜索 + 筛选",
        cmd: `zotlit:query search="attention clinical" filter='!attachments.isEmpty()' fields=title,date.year format=table`,
        watch:
          "search= 用的是 ZotLit 已有的模糊检索（item-lookup）；有 search 时默认按相关度排。",
      },
    ],
  },
];
