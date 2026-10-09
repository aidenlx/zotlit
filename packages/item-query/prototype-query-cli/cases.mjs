// PROTOTYPE — research questions used to evaluate the two CLI shapes on the same data.
// `persona` cases mirror skills/zotlit-query/evals/cases.json; `extra` cases are cross-entity
// questions academics ask that the evals do not cover.
// old: the commands contract 2 needs; `null` = cannot be asked. client: work left to the caller.

const q = (s) => s.replaceAll(/`/g, "'");
export const CASES = [
  // ----- persona cases (the 15 published evals) -----
  {
    id: "include",
    group: "persona",
    question:
      "系统综述：所有图书馆里，标签 query-eval、review.status 为 include 的期刊论文。要标题、年份、第一作者。",
    new: [
      q(
        `zotlit:query library=all filter='itemType == "journalArticle" && tags.contains("query-eval") && custom["review.status"] == "include"' fields=title,date.year,creators[0].fullName limit=all`,
      ),
    ],
    old: [
      q(
        `zotlit:item-query libraries=all filter='itemType == "journalArticle" && tags.contains("query-eval") && custom["review.status"] == "include"' fields='["title","date.year","creators[0].fullName"]' limit=all`,
      ),
    ],
    client: "两边都要自己数「没有年份」的行",
  },
  {
    id: "export",
    group: "persona",
    question:
      "导出所有图书馆里标签 query-eval 的期刊论文到文件：标题、年份、作者、review.status、摘要。",
    new: [
      q(
        `zotlit:query library=all filter='itemType == "journalArticle" && tags.contains("query-eval")' fields='title,date.year,creators,custom["review.status"],abstractNote' limit=all output=/tmp/export.json`,
      ),
    ],
    old: [
      q(
        `zotlit:item-query libraries=all filter='itemType == "journalArticle" && tags.contains("query-eval")' fields='["title","date.year","creators","custom[\\"review.status\\"]","abstractNote"]' limit=all output=/tmp/export.json`,
      ),
    ],
    client: null,
  },
  {
    id: "edge",
    group: "persona",
    question:
      "标签 query-eval-edge 的图书：所属图书馆、Indexed Key、标题、年份、第一作者（含角色，找出编者）。",
    new: [
      q(
        `zotlit:query library=all filter='itemType == "book" && tags.contains("query-eval-edge")' fields=library,title,date.year,creators[0].fullName,creators[0].role limit=all`,
      ),
    ],
    old: [
      q(
        `zotlit:item-query libraries=all filter='itemType == "book" && tags.contains("query-eval-edge")' fields='["title","date.year","creators[0].fullName","creators[0].role"]' limit=all`,
      ),
    ],
    client: "现行：行里没有 library 字段，要从 Indexed Key 的 g 后缀推断",
  },
  {
    id: "annotations",
    group: "persona",
    question:
      "Citation Key 为 rougierTenSimpleRules2014 的论文的全部批注，按阅读顺序：类型、页码、引文/评论、源文件路径。",
    new: [
      q(
        `zotlit:query from=annotations filter='item.citationKey == "rougierTenSimpleRules2014"' fields=type,pageLabel,text,comment,attachment.path sort=attachment.indexedKey,sortIndex limit=all`,
      ),
    ],
    old: [
      q(
        `zotlit:annotation-query filter='item.citationKey == "rougierTenSimpleRules2014"' fields='["type","pageLabel","text","comment","attachment"]' sort='[{"field":"attachment.indexedKey","direction":"asc"},{"field":"sortIndex","direction":"asc"}]' limit=all`,
      ),
    ],
    client: null,
  },
  {
    id: "mixed",
    group: "persona",
    question:
      "标签 figure 的图片批注，且父条目 Citation Key 为 rougierTenSimpleRules2014：一个过滤式同时写批注条件和父条目条件。",
    new: [
      q(
        `zotlit:query from=annotations filter='type == "image" && tags.contains("figure") && item.citationKey == "rougierTenSimpleRules2014"' fields=item.title,tags,hasExcerptImage limit=all`,
      ),
    ],
    old: [
      q(
        `zotlit:annotation-query filter='type == "image" && tags.contains("figure") && item.citationKey == "rougierTenSimpleRules2014"' fields='["item.title","tags","hasExcerptImage"]' limit=all`,
      ),
    ],
    client: null,
  },
  {
    id: "position",
    group: "persona",
    question:
      "引用了 “Identify Your Message” 的批注，要位置（kind、页索引、矩形坐标）和源文件路径。",
    new: [
      q(
        `zotlit:query from=annotations filter='text.contains("Identify Your Message") && item.citationKey == "rougierTenSimpleRules2014"' fields=position,attachment.path limit=all`,
      ),
    ],
    old: [
      q(
        `zotlit:annotation-query filter='text.contains("Identify Your Message") && item.citationKey == "rougierTenSimpleRules2014"' fields='["position","attachment"]' limit=all`,
      ),
    ],
    client: null,
  },
  {
    id: "image",
    group: "persona",
    question: "标签 figure 的图片批注，确认 hasExcerptImage 后取出截图文件。",
    new: [
      q(
        `zotlit:query from=annotations filter='type == "image" && tags.contains("figure") && item.citationKey == "rougierTenSimpleRules2014"' fields=hasExcerptImage limit=all`,
      ),
      "zotlit:annotation-image key=ANNROU04",
    ],
    old: [
      q(
        `zotlit:annotation-query filter='type == "image" && tags.contains("figure") && item.citationKey == "rougierTenSimpleRules2014"' fields='["hasExcerptImage"]' limit=all`,
      ),
      "zotlit:annotation-image key=ANNROU04",
    ],
    client: null,
  },
  {
    id: "reading_plan",
    group: "persona",
    question:
      "阅读计划：标签 query-eval 的期刊论文，包括还没做批注的；每篇给图书馆、标题、批注数量，再列出批注。",
    new: [
      q(
        `zotlit:query library=all filter='itemType == "journalArticle" && tags.contains("query-eval")' fields=library,title,annotations.length,annotations[].text limit=all`,
      ),
    ],
    old: [
      q(
        `zotlit:item-query libraries=all filter='itemType == "journalArticle" && tags.contains("query-eval")' fields='["title"]' limit=all`,
      ),
      q(
        `zotlit:annotation-query libraries=all filter='item.itemType == "journalArticle" && item.tags.contains("query-eval")' fields='["text","item.title"]' limit=all`,
      ),
    ],
    client:
      "现行：两次调用后按 itemIndexedKey 自己合并、自己计数，才能保留零批注的论文",
  },
  {
    id: "shared_marks",
    group: "persona",
    question:
      "My Library 和 Lab Archive 各有一份同一篇论文，找两份上引用 “Identify Your Message” 的高亮，给父条目 Key、图书馆、颜色。",
    new: [
      q(
        `zotlit:query from=annotations library=all filter='type == "highlight" && text.contains("Identify Your Message")' fields=item.indexedKey,library,colorName,text limit=all`,
      ),
    ],
    old: [
      q(
        `zotlit:annotation-query libraries=all filter='type == "highlight" && text.contains("Identify Your Message")' fields='["colorName","text"]' limit=all`,
      ),
    ],
    client: "现行：图书馆要从 itemIndexedKey 的 g 后缀推断",
  },
  {
    id: "attachment",
    group: "persona",
    question: "Lab Archive 附件 QANPDF22g118 上的全部批注，按阅读顺序。",
    new: [
      q(
        `zotlit:query from=annotations filter='attachment.indexedKey == "QANPDF22g118"' fields=type,pageLabel,text,comment,attachment.path sort=sortIndex limit=all`,
      ),
    ],
    old: [
      q(
        `zotlit:annotation-query attachment=QANPDF22g118 fields='["type","pageLabel","text","comment","attachment"]' sort='[{"field":"sortIndex","direction":"asc"}]' limit=all`,
      ),
    ],
    client: null,
  },
  {
    id: "colors",
    group: "persona",
    question:
      "My Library 那份论文上，第 1 页、蓝色、标签 query-annotation-method 的高亮。",
    new: [
      q(
        `zotlit:query from=annotations library=personal filter='type == "highlight" && colorName == "blue" && pageLabel == "1" && tags.contains("query-annotation-method")' fields=text,colorName,tags,pageIndex limit=all`,
      ),
    ],
    old: [
      q(
        `zotlit:annotation-query library=personal filter='type == "highlight" && colorName == "blue" && pageLabel == "1" && tags.contains("query-annotation-method")' fields='["text","colorName","tags","pageIndex"]' limit=all`,
      ),
    ],
    client: null,
  },
  {
    id: "reverse_pages",
    group: "persona",
    question: "My Library 那份论文的批注，从最后一页倒着列到第一页。",
    new: [
      q(
        `zotlit:query from=annotations filter='item.indexedKey == "ROUG2014"' fields=type,pageLabel,pageIndex,text sort=-pageIndex,-sortIndex limit=all`,
      ),
    ],
    old: [
      q(
        `zotlit:annotation-query item=ROUG2014 fields='["type","pageLabel","pageIndex","text"]' sort='[{"field":"pageIndex","direction":"desc"},{"field":"sortIndex","direction":"desc"}]' limit=all`,
      ),
    ],
    client: null,
  },
  {
    id: "missing_source",
    group: "persona",
    question:
      "评论写着 “Check this source when the file arrives” 的批注：源文件路径、文件是否存在。",
    new: [
      q(
        `zotlit:query from=annotations filter='comment.contains("Check this source when the file arrives")' fields=comment,attachment.path,attachment.exists limit=all`,
      ),
    ],
    old: [
      q(
        `zotlit:annotation-query filter='comment.contains("Check this source when the file arrives")' fields='["comment","attachment"]' limit=all`,
      ),
    ],
    client: null,
  },
  {
    id: "repair_filter",
    group: "persona",
    question:
      '用户写了 tags == "query-annotation-method" 没结果；先看诊断/警告，再找出真正带该标签的批注。',
    new: [
      q(
        `zotlit:query from=annotations library=all filter='tags == "query-annotation-method"' fields=[] limit=all`,
      ),
      q(
        `zotlit:query from=annotations library=all filter='tags.contains("query-annotation-method")' fields=item.indexedKey,text,colorName limit=all`,
      ),
    ],
    old: [
      q(
        `zotlit:annotation-query libraries=all filter='tags == "query-annotation-method"' fields='[]' limit=all`,
      ),
      q(
        `zotlit:annotation-query libraries=all filter='tags.contains("query-annotation-method")' fields='["text","colorName"]' limit=all`,
      ),
    ],
    client: null,
  },
  {
    id: "export_annotations",
    group: "persona",
    question: "把附件 QANPDF22g118 上的全部批注导出到 JSON 文件。",
    new: [
      q(
        `zotlit:query from=annotations filter='attachment.indexedKey == "QANPDF22g118"' fields=type,pageLabel,text,comment,attachment.path limit=all output=/tmp/annotations.json`,
      ),
    ],
    old: [
      q(
        `zotlit:annotation-query attachment=QANPDF22g118 fields='["type","pageLabel","text","comment","attachment"]' limit=all output=/tmp/annotations.json`,
      ),
    ],
    client: null,
  },

  // ----- extra cross-entity questions -----
  {
    id: "no_usable_pdf",
    group: "extra",
    question:
      "哪些文献在这台电脑上没有可打开的 PDF？（没有附件，或 PDF 文件丢失）",
    new: [
      q(
        `zotlit:query filter='attachments.filter(value.contentType == "application/pdf" && value.exists).isEmpty()' fields=title,attachments[].path limit=all`,
      ),
    ],
    old: [
      q(`zotlit:item-query filter='!attachments' fields='["title"]' limit=all`),
    ],
    client:
      "现行只能问「完全没有附件」；「PDF 文件丢失」问不到（Item 上 attachments 是布尔值，没有附件数据集）",
    partial: true,
  },
  {
    id: "broken_links",
    group: "extra",
    question: "哪些附件是链接文件（linked_file）但文件已经不在磁盘上？",
    new: [
      q(
        `zotlit:query from=attachments filter='linkMode == "linked_file" && !exists' fields=title,path,item.title limit=all`,
      ),
    ],
    old: null,
    client: "现行没有附件数据集；批注查询只看得到「有批注的附件」",
  },
  {
    id: "duplicate_pdfs",
    group: "extra",
    question: "哪些文献挂了两个以上 PDF？（查重）",
    new: [
      q(
        `zotlit:query filter='attachments.filter(value.contentType == "application/pdf").length > 1' fields=title,attachments[].title limit=all`,
      ),
    ],
    old: null,
    client: "现行 Item 上 attachments 只是布尔值",
  },
  {
    id: "recently_annotated",
    group: "extra",
    question: "最近 120 天我做过批注的文献有哪些？（每篇只列一次）",
    new: [
      q(
        `zotlit:query filter='annotations.filter(value.dateModified >= today() - duration("120 days")).length > 0' fields=title,annotations.length sort=-dateModified limit=all`,
      ),
    ],
    old: [
      q(
        `zotlit:annotation-query filter='dateModified >= today() - duration("120 days")' fields='["item.title"]' limit=all`,
      ),
    ],
    client: "现行返回的是批注行，要自己按 itemIndexedKey 去重",
  },
  {
    id: "count_per_paper",
    group: "extra",
    question: "每篇论文有多少条批注？",
    new: [
      q(
        `zotlit:query from=annotations group=item.citationKey fields=[] limit=all`,
      ),
    ],
    old: [q(`zotlit:annotation-query fields='[]' limit=all`)],
    client: "现行：拿到全部批注行后自己按 itemIndexedKey 计数",
  },
  {
    id: "count_by_year",
    group: "extra",
    question: "Thesis 收藏夹里的文献按年份分别有几篇？",
    new: [
      q(
        `zotlit:query filter='collections.within("Thesis")' group=date.year fields=[] limit=all`,
      ),
    ],
    old: [
      q(
        `zotlit:item-query filter='collections.within("Thesis")' fields='["date.year"]' limit=all`,
      ),
    ],
    client: "现行：自己按 date.year 计数",
  },
  {
    id: "unread_in_collection",
    group: "extra",
    question: "Thesis 收藏夹里还没读过（一条高亮都没有）的论文。",
    new: [
      q(
        `zotlit:query filter='collections.within("Thesis") && annotations.filter(value.type == "highlight").isEmpty()' fields=title limit=all`,
      ),
    ],
    old: [
      q(
        `zotlit:item-query filter='collections.within("Thesis")' fields='["title"]' limit=all`,
      ),
      q(
        `zotlit:annotation-query filter='type == "highlight" && item.collections.within("Thesis")' fields='[]' limit=all`,
      ),
    ],
    client: "现行：两次调用，自己做差集",
  },
  {
    id: "attachment_types",
    group: "extra",
    question: "附件按类型（PDF / EPUB / 网页快照）各有多少？",
    new: [
      q(`zotlit:query from=attachments group=contentType fields=[] limit=all`),
    ],
    old: null,
    client: "现行没有附件数据集",
  },
  {
    id: "fuzzy_search",
    group: "extra",
    question:
      "找跟 “attention clinical” 相关的论文（模糊检索），只要有 PDF 的。",
    new: [
      q(
        `zotlit:query search="attention clinical" filter='attachments.filter(value.contentType == "application/pdf").length > 0' fields=title,date.year limit=10`,
      ),
    ],
    old: [
      q(
        `zotlit:item-query filter='title.lower().contains("attention") && attachments' fields='["title","date.year"]' limit=10`,
      ),
    ],
    client: "现行没有检索参数，只能猜 title.contains，排名和分词都没有",
    partial: true,
  },
  {
    id: "files_of_paper",
    group: "extra",
    question:
      "某篇论文（vaswaniAttention2017）的全部附件和文件路径，用来打开文件。",
    new: [
      q(
        `zotlit:query from=attachments filter='item.citationKey == "vaswaniAttention2017"' fields=title,contentType,path,exists limit=all`,
      ),
    ],
    old: null,
    client: "现行：只有带批注的附件能通过批注行看到 attachment.path",
  },
  {
    id: "csv_for_advisor",
    group: "extra",
    question: "把 Thesis 收藏夹的文献导成 CSV 发给导师。",
    new: [
      q(
        `zotlit:query filter='collections.within("Thesis")' fields=title,date.year,creators,publicationTitle limit=all format=csv`,
      ),
    ],
    old: [
      q(
        `zotlit:item-query filter='collections.within("Thesis")' fields='["title","date.year","creators","publicationTitle"]' limit=all`,
      ),
    ],
    client: "现行只有 JSON，要自己转 CSV",
  },
  {
    id: "recent_with_pdf_unread",
    group: "extra",
    question: "2019 年起、有附件、还没打上 to-read 标签的文献。",
    new: [
      q(
        `zotlit:query filter='date.year >= 2019 && !attachments.isEmpty() && !tags.contains("to-read")' fields=title,date.year limit=all`,
      ),
    ],
    old: [
      q(
        `zotlit:item-query filter='date.year >= 2019 && attachments && !tags.contains("to-read")' fields='["title","date.year"]' limit=all`,
      ),
    ],
    client: null,
  },
  {
    id: "chinese_title",
    group: "extra",
    question: "标题含「深度学习」的文献。",
    new: [
      q(
        `zotlit:query filter='title.contains("深度学习")' fields=title,publicationTitle limit=all`,
      ),
    ],
    old: [
      q(
        `zotlit:item-query filter='title.contains("深度学习")' fields='["title","publicationTitle"]' limit=all`,
      ),
    ],
    client: null,
  },
];
