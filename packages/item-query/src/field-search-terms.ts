// The Search Terms of a field: the other words a researcher uses for it, so
// that "journal" finds `publicationTitle`. Only a list that offers fields reads
// them. A query never holds one, and the planner and the Query Schema do not
// know them, so no Search Term can name a field in a Filter Expression.
import { FIELD_ALIASES } from "@zotlit/zotero-types";
import { FIELD_LABELS } from "@zotlit/zotero-types/field-labels";

import type { QueryDataset } from "./dataset";

/** The Query Dataset whose meaning a name has. */
type DatasetId = QueryDataset["id"];

type Terms = Readonly<Record<string, readonly string[]>>;

/** The words for the fields of an Item, by field. */
const ITEM_TERMS: Terms = {
  abstractNote: ["summary", "abstract note", "description", "摘要", "概要"],
  accessDate: ["date accessed", "access date", "retrieved", "访问时间"],
  applicationNumber: ["patent application", "申请号"],
  archive: ["archive name", "collection holder", "档案馆", "档案"],
  archiveID: ["arXiv ID", "archive number", "preprint number", "存档编号"],
  archiveLocation: ["box", "folder number", "shelf", "档案位置"],
  artworkMedium: ["material", "art medium", "技法", "媒介"],
  artworkSize: ["dimensions", "尺寸"],
  assignee: ["patent owner", "patent holder", "专利权人", "受让人"],
  audioFileType: ["audio format", "file format", "音频格式"],
  audioRecordingFormat: ["recording format", "audio format", "录音格式"],
  authority: ["government body", "issuing body", "机构", "权力机关"],
  billNumber: ["bill no", "legislation number", "法案编号"],
  blogTitle: ["blog name", "blog", "博客名称", "博客"],
  bookTitle: ["book", "edited volume", "book name", "图书名", "书名"],
  callNumber: ["shelf mark", "library call number", "索书号"],
  caseName: ["case", "case title", "lawsuit", "案例名称", "案件"],
  citationKey: [
    "citekey",
    "cite key",
    "bibtex key",
    "citation id",
    "引用键",
    "引文键",
  ],
  code: ["legal code", "code of law", "法典"],
  codeNumber: ["code no", "title number", "法典编号"],
  codePages: ["code page", "法典页码"],
  codeVolume: ["code vol", "法典卷"],
  committee: ["legislative committee", "委员会"],
  company: ["software company", "developer", "vendor", "公司"],
  conferenceName: [
    "conference",
    "meeting",
    "symposium",
    "workshop",
    "event",
    "会议名称",
    "会议",
  ],
  country: ["nation", "国家"],
  court: ["tribunal", "法院"],
  date: ["publication date", "published", "pub date", "出版日期", "发表日期"],
  dateAdded: ["added", "imported", "collected", "添加时间", "入库时间"],
  dateDecided: ["decision date", "judgment date", "判决日期"],
  dateEnacted: ["enactment date", "颁布日期", "生效日期"],
  dateModified: ["modified", "updated", "last edited", "修改时间", "更新时间"],
  dictionaryTitle: ["dictionary", "dictionary name", "词典名称", "词典"],
  distributor: ["film distributor", "发行商"],
  docketNumber: ["docket", "case number", "案号"],
  documentNumber: ["doc number", "document no", "文件编号"],
  DOI: ["digital object identifier", "article identifier", "数字对象标识符"],
  edition: ["ed", "revision", "版次", "版本"],
  encyclopediaTitle: ["encyclopedia", "encyclopedia name", "百科全书"],
  episodeNumber: ["episode", "ep", "集数"],
  eventPlace: ["venue", "conference location", "会议地点", "活动地点"],
  extra: ["other", "additional info", "misc", "notes field", "其他", "附加"],
  filingDate: ["date filed", "application date", "申请日期", "提交日期"],
  firstPage: ["start page", "beginning page", "起始页"],
  format: ["file format", "data format", "格式"],
  forumTitle: ["forum", "listserv", "newsgroup", "论坛名称", "论坛"],
  genre: ["category", "kind", "类型", "体裁"],
  history: ["legal history", "legislative history", "历史", "立法沿革"],
  identifier: ["id", "dataset identifier", "标识符"],
  institution: [
    "organization",
    "report institution",
    "research institute",
    "机构",
    "研究机构",
  ],
  interviewMedium: ["interview format", "访谈方式"],
  ISBN: ["book number", "international standard book number", "国际标准书号"],
  ISSN: [
    "serial number",
    "international standard serial number",
    "国际标准期刊号",
  ],
  issue: ["issue number", "journal issue", "no", "期号", "期"],
  issueDate: ["date issued", "grant date", "公告日期", "发布日期"],
  issuingAuthority: ["patent office", "issuer", "发证机关", "授权机构"],
  itemType: [
    "document type",
    "reference type",
    "publication type",
    "条目类型",
    "文献类型",
  ],
  journalAbbreviation: [
    "journal abbr",
    "abbreviated journal",
    "short journal name",
    "iso abbreviation",
    "期刊缩写",
    "刊名缩写",
  ],
  label: ["record label", "music label", "唱片公司"],
  language: ["lang", "locale", "语言", "语种"],
  legalStatus: ["patent status", "法律状态"],
  legislativeBody: ["legislature", "parliament", "congress", "立法机关"],
  letterType: ["correspondence type", "信函类型"],
  libraryCatalog: [
    "catalog",
    "database",
    "source database",
    "馆藏目录",
    "数据库",
  ],
  manuscriptType: ["manuscript kind", "稿件类型", "手稿类型"],
  mapType: ["map kind", "地图类型"],
  medium: ["format", "media", "媒介"],
  meetingName: ["meeting", "conference", "hearing", "会议名称"],
  nameOfAct: ["act", "statute name", "law name", "法案名称", "法规名称"],
  network: ["broadcaster", "tv network", "radio network", "广播网", "电视台"],
  number: ["no", "identifier number", "编号"],
  numberOfVolumes: ["volume count", "total volumes", "# of volumes", "总卷数"],
  numPages: [
    "page count",
    "total pages",
    "length",
    "number of pages",
    "总页数",
    "页数",
  ],
  organization: ["preprint organization", "standards body", "组织"],
  originalDate: [
    "first published",
    "original publication",
    "原始日期",
    "首次出版",
  ],
  originalPlace: ["original city", "原出版地"],
  originalPublisher: ["first publisher", "原出版社"],
  pages: ["page range", "page numbers", "pp", "页码", "页码范围"],
  partNumber: ["part no", "部分编号"],
  partTitle: ["part name", "部分标题"],
  patentNumber: ["patent no", "专利号"],
  place: ["city", "location", "publication place", "address", "出版地", "地点"],
  PMCID: ["pubmed central id", "pmc id"],
  PMID: ["pubmed id", "pubmed"],
  postType: ["post kind", "帖子类型"],
  presentationType: ["talk type", "slides", "演示类型"],
  priorityDate: ["first filing date", "优先权日"],
  priorityNumbers: ["priority claim", "优先权号"],
  proceedingsTitle: [
    "proceedings",
    "conference proceedings",
    "会议论文集",
    "论文集",
  ],
  programmingLanguage: ["code language", "prog language", "编程语言"],
  programTitle: ["program", "show", "programme", "节目名称"],
  publicationTitle: [
    "journal",
    "journal name",
    "journal title",
    "periodical",
    "magazine",
    "newspaper",
    "venue",
    "source title",
    "container title",
    "container-title",
    "published in",
    "期刊",
    "期刊名",
    "期刊名称",
    "刊名",
    "杂志",
    "报纸",
    "出版物",
    "来源",
  ],
  publicLawNumber: ["public law", "公法编号"],
  publisher: ["press", "imprint", "publishing house", "出版社", "出版商"],
  references: ["reference list", "citations", "参考文献"],
  reporter: ["law reporter", "reports", "判例汇编"],
  reporterVolume: ["reporter vol", "判例汇编卷"],
  reportNumber: ["report no", "technical report number", "报告编号"],
  reportType: ["report kind", "报告类型"],
  repository: [
    "preprint server",
    "git repository",
    "repo",
    "arxiv",
    "存储库",
    "仓库",
  ],
  repositoryLocation: ["repo location", "repository place", "存储库地点"],
  rights: ["copyright", "license", "licence", "权利", "版权", "许可"],
  runningTime: ["duration", "length", "runtime", "时长"],
  scale: ["map scale", "比例尺"],
  section: ["newspaper section", "code section", "栏目", "章节"],
  series: ["book series", "series name", "丛书", "系列"],
  seriesNumber: ["series no", "number in series", "丛书编号", "系列编号"],
  seriesText: ["series note", "丛书说明"],
  seriesTitle: ["series name", "journal series", "系列标题", "丛书名"],
  session: ["legislative session", "会期"],
  sessionTitle: ["panel", "conference session", "分会场", "会议场次"],
  shortTitle: ["abbreviated title", "title short", "简称", "短标题"],
  status: ["current status", "状态"],
  studio: ["film studio", "production company", "制片公司"],
  subject: ["topic", "email subject", "主题"],
  system: ["operating system", "platform", "os", "操作系统", "系统"],
  thesisType: [
    "degree",
    "dissertation type",
    "phd",
    "master",
    "论文类型",
    "学位",
  ],
  title: [
    "name",
    "paper title",
    "article title",
    "book title",
    "work",
    "题名",
    "标题",
    "篇名",
  ],
  type: ["kind", "genre", "类型"],
  university: [
    "school",
    "college",
    "degree-granting institution",
    "大学",
    "学校",
  ],
  url: ["link", "web address", "website", "address", "uri", "链接", "网址"],
  versionNumber: ["version", "release", "software version", "版本号"],
  videoRecordingFormat: ["video format", "视频格式"],
  volume: ["vol", "journal volume", "卷号", "卷次"],
  websiteTitle: ["website", "site name", "网站名称", "网站"],
  websiteType: ["site type", "网站类型"],
  // The fields beyond Zotero's own.
  creators: [
    "author",
    "authors",
    "editor",
    "translator",
    "contributor",
    "people",
    "作者",
    "编者",
    "译者",
    "创建者",
  ],
  firstAuthor: [
    "first author",
    "lead author",
    "primary author",
    "surname",
    "last name",
    "family name",
    "first name",
    "given name",
    "第一作者",
    "姓",
    "名",
  ],
  "date.year": [
    "publication year",
    "year published",
    "pub year",
    "年份",
    "出版年",
    "发表年",
  ],
  "date.month": ["publication month", "出版月份", "月份"],
  "date.day": ["publication day", "日"],
  lastRead: ["last opened", "reading date", "最近阅读", "上次阅读"],
  lastActivity: ["recent", "recently worked on", "最近活动", "最近使用"],
  lastActivitySource: ["activity kind", "活动来源"],
  tags: ["tag", "keyword", "keywords", "label", "标签", "关键词"],
  collections: [
    "collection",
    "folder",
    "group",
    "category",
    "分类",
    "文件夹",
    "集合",
  ],
};

/** The words for a field of an Attachment, whose names can differ from an Item's in meaning. */
const ATTACHMENT_TERMS: Terms = {
  title: ["file name", "filename", "attachment name", "附件标题", "文件名"],
  contentType: ["mime type", "media type", "内容类型"],
  fileType: ["pdf", "epub", "snapshot", "file format", "文件类型", "文件格式"],
  linkMode: ["linked file", "stored file", "imported file", "链接方式"],
  path: ["file path", "file location", "folder", "路径", "文件路径"],
  url: ["link", "web address", "source link", "链接", "网址"],
  exists: [
    "missing file",
    "file available",
    "broken link",
    "文件存在",
    "文件缺失",
  ],
  lastRead: ["last opened", "reading date", "最近阅读", "上次阅读"],
  tags: ["tag", "keyword", "label", "标签", "关键词"],
};

/** The words for a field of an Annotation. */
const ANNOTATION_TERMS: Terms = {
  type: [
    "annotation type",
    "highlight",
    "underline",
    "ink",
    "image",
    "批注类型",
  ],
  text: [
    "quote",
    "highlighted text",
    "excerpt",
    "selection",
    "passage",
    "引文",
    "摘录",
    "高亮文本",
  ],
  comment: ["note", "remark", "my note", "批注", "评论", "备注"],
  color: ["colour", "hex", "highlight color", "颜色"],
  colorName: ["colour", "highlight color", "yellow", "red", "颜色"],
  pageLabel: ["page", "page number", "页码", "页"],
  pageIndex: ["page position", "page order", "页序"],
  authorName: ["annotator", "annotation author", "who", "批注者", "作者"],
  sortIndex: ["position", "order", "reading order", "排序位置"],
  hasExcerptImage: [
    "image",
    "screenshot",
    "figure",
    "picture",
    "摘录图片",
    "截图",
  ],
  tags: ["tag", "keyword", "label", "标签", "关键词"],
};

/** The words for a field every Query Dataset reads with one meaning. */
const SHARED_TERMS: Terms = {
  dateAdded: ITEM_TERMS.dateAdded!,
  dateModified: ITEM_TERMS.dateModified!,
  library: ["group library", "my library", "shared library", "文献库", "群组"],
  key: ["item key", "zotero key", "id", "键"],
  indexedKey: ["item id", "unique id", "索引键"],
};

const TERMS_OF_DATASET: Readonly<Record<DatasetId, Terms>> = {
  items: ITEM_TERMS,
  attachments: ATTACHMENT_TERMS,
  annotations: ANNOTATION_TERMS,
};

/** The Query Dataset a path of `dataset` reads below each parent prefix. */
const PARENTS: readonly (readonly [string, DatasetId])[] = [
  ["item.", "items"],
  ["attachment.", "attachments"],
];

/** The type-specific fields of each base field. */
const SPECIFIC_FIELDS: ReadonlyMap<string, readonly string[]> = Map.groupBy(
  Object.keys(FIELD_ALIASES),
  (name) => FIELD_ALIASES[name]!,
);

/** A field's name and its label in each bundled language. */
function zoteroNames(field: string): readonly string[] {
  const labels = Object.values(FIELD_LABELS).flatMap((locale) => {
    const label = locale[field];
    return label === undefined ? [] : [label];
  });
  return [field, ...labels];
}

/** The words for one name of one Query Dataset, as written in the tables. */
function ownTerms(dataset: DatasetId, name: string): readonly string[] {
  const table = TERMS_OF_DATASET[dataset];
  const authored = table[name] ?? SHARED_TERMS[name];
  if (authored) return authored;
  // A path below a field, such as `firstAuthor.family`, reads its field's.
  const dot = name.indexOf(".");
  return dot < 0 ? [] : ownTerms(dataset, name.slice(0, dot));
}

/**
 * The Search Terms of `path`, a path of `dataset`, in lower case: its own
 * words, and for a Zotero field its name, its labels in every language and
 * the same of the fields it shares a base with. A path of a parent reads as
 * the path of the parent's dataset, so `item.publicationTitle` finds what
 * `publicationTitle` finds on Items.
 */
export function fieldSearchTerms(
  dataset: DatasetId,
  path: string,
): readonly string[] {
  for (const [prefix, parent] of PARENTS)
    if (dataset !== parent && path.startsWith(prefix))
      return fieldSearchTerms(parent, path.slice(prefix.length));
  const zotero =
    dataset === "items"
      ? [
          ...zoteroNames(path),
          ...(FIELD_ALIASES[path] ? zoteroNames(FIELD_ALIASES[path]) : []),
          ...(SPECIFIC_FIELDS.get(path) ?? []).flatMap(zoteroNames),
        ]
      : [];
  return [
    ...new Set(
      [...ownTerms(dataset, path), ...zotero].map((term) => term.toLowerCase()),
    ),
  ];
}

const WORD_BREAK = /[\s\-_/]+/;
/** Han script, which writes no spaces between words. */
const HAN = /\p{Script=Han}/u;

/**
 * Whether the typed `query` finds `term`: at the start of the term or of one
 * of its words, or anywhere in a Chinese term. A Search Term takes no match
 * of scattered letters: with so many terms, one would fill every list.
 */
export function matchesSearchTerm(term: string, query: string): boolean {
  const typed = query.trim().toLowerCase();
  if (typed === "") return false;
  const text = term.toLowerCase();
  return (
    text.startsWith(typed) ||
    text.split(WORD_BREAK).some((word) => word.startsWith(typed)) ||
    (HAN.test(typed) && text.includes(typed))
  );
}
