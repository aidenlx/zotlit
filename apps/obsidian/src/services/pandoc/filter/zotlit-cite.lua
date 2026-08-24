-- Turns Obsidian Literature Note links into Pandoc Cite nodes, per the resolution
-- map produced by `zotlit:resolve`.
--
-- One source, two built variants: the cli region shells out to a live Obsidian
-- process, the sandbox region reads a pre-written resolve map. The build keeps
-- exactly one of them; there is no runtime fallback between the two.
--
-- The cli variant also resolves a document's `zotlit-csl` property to the CSL
-- file citeproc opens, through `zotlit:csl`.

PANDOC_VERSION:must_be_at_least(
  "3.1.1",
  "zotlit-cite needs Pandoc 3.1.1 or newer, which is where pandoc.json arrived"
)

--- Collected before anything aborts, so one run reports every problem.
local errors = {}

local function add_error(code, message, context)
  errors[#errors + 1] = { code = code, message = message, context = context }
end

--- Writes every collected error to stderr and stops the Pandoc run.
local function report_errors()
  local input = PANDOC_STATE.input_files[1] or "(stdin)"
  for _, err in ipairs(errors) do
    io.stderr:write(string.format("zotlit-cite: [%s] %s\n", err.code, err.message))
    if err.context then
      io.stderr:write(string.format("  in: %s\n", err.context))
    end
    io.stderr:write(string.format("  at: %s\n", input))
  end
  error(string.format("zotlit-cite: stopped on %d error(s)", #errors), 0)
end

--- Decodes one JSON response from a `zotlit:*` command.
--- @return table payload
local function decode_payload(response, code, source)
  local ok, payload = pcall(pandoc.json.decode, response, false)
  if not ok or type(payload) ~= "table" then
    add_error(
      code,
      string.format("The %s is not valid JSON: %s", source, tostring(response))
    )
    report_errors()
  end
  return payload
end

--@variant cli
--- The absolute path of the Markdown input, which names the vault the Obsidian
--- CLI answers for.
local input_absolute
local function input_path()
  if input_absolute then
    return input_absolute
  end
  local input = PANDOC_STATE.input_files[1]
  if not input then
    add_error(
      "file-not-found",
      "The CLI filter variant needs one Markdown input file; Pandoc was given none."
    )
    report_errors()
  end
  input_absolute = input
  if not pandoc.path.is_absolute(input) then
    input_absolute = pandoc.path.normalize(
      pandoc.path.join({ pandoc.system.get_working_directory(), input })
    )
  end
  return input_absolute
end

--- Calls one `zotlit:*` handler, from the input file's directory so the Obsidian
--- CLI targets the vault that holds the input instead of the active vault.
local function call_obsidian(code, arguments)
  local response
  local ok, err = pcall(function()
    pandoc.system.with_working_directory(pandoc.path.directory(input_path()), function()
      response = pandoc.pipe("obsidian", arguments, "")
    end)
  end)
  if not ok then
    add_error(
      code,
      string.format(
        "`obsidian %s` failed: %s. Obsidian must be running with the input file's vault open and its command line interface enabled.",
        table.concat(arguments, " "),
        tostring(err)
      )
    )
    report_errors()
  end
  return response
end

local function read_resolve_payload()
  return call_obsidian(
    "resolve-call-failed",
    { "zotlit:resolve", "file=" .. input_path() }
  )
end

--- The absolute CSL file `zotlit:csl` materializes for one installed style ID.
local function csl_path(style)
  local context = string.format("zotlit-csl: %s", style)
  local payload = decode_payload(
    call_obsidian("csl-call-failed", { "zotlit:csl", "style=" .. style }),
    "csl-response-invalid",
    "zotlit:csl response"
  )
  if payload.errors and #payload.errors > 0 then
    for _, err in ipairs(payload.errors) do
      add_error(
        err.code or "csl-failed",
        err.message or "The zotlit:csl response reported an error with no message.",
        context
      )
    end
    report_errors()
  end
  if type(payload.path) ~= "string" then
    add_error(
      "csl-response-invalid",
      "The zotlit:csl response carries no style path.",
      context
    )
    report_errors()
  end
  return payload.path
end

--- Replaces a sole `zotlit-csl` with the CSL path citeproc opens. A standard
--- `csl` stays Pandoc's own, and `lang` is left as the document declares it.
local function resolve_style(meta)
  local requested = meta["zotlit-csl"]
  if requested == nil then
    return meta
  end
  if meta.csl ~= nil then
    add_error(
      "csl-ambiguous",
      'The document declares its Citation and References Style twice: "csl" names a style file Pandoc opens, "zotlit-csl" names the Zotero-installed style ID ZotLit resolves. Keep one of them.'
    )
    report_errors()
  end
  local style = pandoc.utils.stringify(requested)
  meta.csl = pandoc.MetaString(csl_path(style))
  meta["zotlit-csl"] = nil
  return meta
end
--@end

--@variant sandbox
--- Read relative to the Pandoc working directory, so the sandbox host writes the
--- map next to the input it converts.
local RESOLVE_MAP_FILE = "zotlit-resolve-map.json"

--- Reads the resolve map an external producer captured beforehand.
local function read_resolve_payload()
  local handle = io.open(RESOLVE_MAP_FILE, "r")
  if not handle then
    add_error(
      "resolve-map-missing",
      string.format(
        'The sandbox filter variant needs a pre-written resolve map at "%s", relative to the Pandoc working directory.',
        RESOLVE_MAP_FILE
      )
    )
    report_errors()
  end
  local response = handle:read("a")
  handle:close()
  return response
end

--- The sandbox host renders with the style it hands the engine, so document
--- metadata reaches Pandoc as the document wrote it.
local function resolve_style(meta)
  return meta
end
--@end

--- The `linkpath -> citation key` map, keyed by decoded bare linkpath.
--- @return table<string, string>
local function load_citations()
  local payload = decode_payload(
    read_resolve_payload(),
    "resolve-map-invalid",
    "resolution map"
  )
  if payload.errors and #payload.errors > 0 then
    for _, err in ipairs(payload.errors) do
      add_error(
        err.code or "resolve-failed",
        err.message or "The resolution map reported an error with no message.",
        err.linkpath and string.format("[[%s]]", err.linkpath)
      )
    end
    report_errors()
  end
  return payload.citations or {}
end

--- Lenient: only well-formed `%XX` triples decode, a bare `%` stays literal.
local function decode_linkpath(target)
  return (target:gsub("%%(%x%x)", function(hex)
    return string.char(tonumber(hex, 16))
  end))
end

--- Strict counterpart for Citation Fragment values.
--- @return string|nil value, string|nil reason
local function decode_value(raw)
  local out, index = {}, 1
  while index <= #raw do
    local char = raw:sub(index, index)
    if char == "%" then
      local hex = raw:sub(index + 1, index + 2)
      if not hex:match("^%x%x$") then
        return nil, "malformed percent encoding"
      end
      out[#out + 1] = string.char(tonumber(hex, 16))
      index = index + 3
    else
      out[#out + 1] = char
      index = index + 1
    end
  end
  local value = table.concat(out)
  if not utf8.len(value) then
    return nil, "invalid UTF-8 after decoding"
  end
  return value
end

--- @return string|nil reason
local function text_defect(value)
  if value == "" then
    return "an empty value"
  end
  if value:match("^%s") or value:match("%s$") then
    return "leading or trailing whitespace"
  end
  if value:find("[\n\r]") then
    return "a line break"
  end
  if value:find("%c") then
    return "a control character"
  end
  return nil
end

local function split(text, separator)
  local parts, start = {}, 1
  while true do
    local at = text:find(separator, start, true)
    if not at then
      parts[#parts + 1] = text:sub(start)
      return parts
    end
    parts[#parts + 1] = text:sub(start, at - 1)
    start = at + #separator
  end
end

local PARAMETERS = { mode = true, prefix = true, label = true, locator = true, suffix = true }

local CITATION_MODES = {
  normal = "NormalCitation",
  ["author-in-text"] = "AuthorInText",
  ["suppress-author"] = "SuppressAuthor",
}

--- CSL Locator labels, mapped to the citeproc locale term citeproc parses out of a
--- Citation suffix. This is the whole set citeproc parses: the labels CSL 1.0.2
--- added (appendix, table, elocation, article-locator, ...) stay out, because
--- citeproc leaves them in the suffix as literal text instead of reading them as a
--- locator.
local LOCATOR_TERMS = {
  book = "book",
  chapter = "chapter",
  column = "column",
  figure = "figure",
  folio = "folio",
  issue = "issue",
  line = "line",
  note = "note",
  opus = "opus",
  page = "page",
  paragraph = "paragraph",
  part = "part",
  section = "section",
  ["sub-verbo"] = "sub verbo",
  verse = "verse",
  volume = "volume",
}

--- Parses the text after `#cite:` into Citation details. Parsing is strict: every
--- defect stops the run.
--- @return table|nil details, string|nil reason
local function parse_fragment(fragment)
  if fragment == "" then
    return nil, "the Citation Fragment is empty"
  end

  local details = { mode = "normal" }
  local seen = {}
  for _, pair in ipairs(split(fragment, "&")) do
    local name, raw = pair:match("^([^=]*)=(.*)$")
    if not name then
      return nil, string.format('"%s" is missing its "="', pair)
    end
    if name == "" then
      return nil, string.format('"%s" has an empty parameter name', pair)
    end
    if not PARAMETERS[name] then
      return nil, string.format('"%s" is not a Citation Fragment parameter', name)
    end
    if seen[name] then
      return nil, string.format('"%s" appears more than once', name)
    end
    seen[name] = true

    local value, reason = decode_value(raw)
    if not value then
      return nil, string.format('"%s" has %s', name, reason)
    end
    local defect = text_defect(value)
    if defect then
      return nil, string.format('"%s" has %s', name, defect)
    end
    details[name] = value
  end

  if not CITATION_MODES[details.mode] then
    return nil, string.format('"mode" does not support "%s"', details.mode)
  end
  if details.label and not LOCATOR_TERMS[details.label] then
    return nil, string.format('"label" does not support "%s"', details.label)
  end
  if details.label and not details.locator then
    return nil, '"label" needs a "locator"'
  end
  if details.mode == "author-in-text" and details.prefix then
    return nil, '"prefix" does not combine with mode=author-in-text; keep the introduction outside the link'
  end
  return details
end

local function to_inlines(text)
  local inlines = pandoc.Inlines({})
  for word in text:gmatch("%S+") do
    if #inlines > 0 then
      inlines:insert(pandoc.Space())
    end
    inlines:insert(pandoc.Str(word))
  end
  return inlines
end

--- Locator and label ride in the suffix, which is how citeproc reads them.
local function build_suffix(details)
  local suffix = pandoc.Inlines({})
  if details.locator then
    suffix:extend(to_inlines(LOCATOR_TERMS[details.label or "page"]))
    suffix:insert(pandoc.Space())
    suffix:extend(to_inlines(details.locator))
  end
  if details.suffix then
    if #suffix > 0 then
      suffix:insert(pandoc.Str(","))
      suffix:insert(pandoc.Space())
    end
    suffix:extend(to_inlines(details.suffix))
  end
  return suffix
end

--- One Cite per standalone Citation or Citation Run.
local function build_cite(items)
  local entries, keys = {}, {}
  for position, item in ipairs(items) do
    if position > 1 and item.details.mode == "author-in-text" then
      add_error(
        "author-in-text-position",
        "An author-in-text Citation can occupy only the first position in a Citation Run.",
        item.context
      )
    end
    entries[position] = pandoc.Citation(
      item.key,
      CITATION_MODES[item.details.mode],
      to_inlines(item.details.prefix or ""),
      build_suffix(item.details),
      0
    )
    keys[position] = "@" .. item.key
  end
  return pandoc.Cite({ pandoc.Str("[" .. table.concat(keys, "; ") .. "]") }, entries)
end

local citations = {}

local function classify_target(target)
  local hash = target:find("#", 1, true)
  local bare = hash and target:sub(1, hash - 1) or target
  local fragment = hash and target:sub(hash + 1) or nil
  local intent = fragment and fragment:sub(1, 5) == "cite:" and fragment:sub(6) or nil

  local linkpath = decode_linkpath(bare)
  local key = citations[linkpath]
  local context = string.format("[[%s]]", target)

  if not key then
    if intent then
      add_error(
        "unresolved-citation-intent",
        string.format(
          'The "#cite:" fragment declares a Citation, but "%s" does not resolve to a Literature Note.',
          linkpath
        ),
        context
      )
    end
    return nil
  end

  if not intent then
    return { key = key, details = { mode = "normal" }, context = context }
  end

  local details, reason = parse_fragment(intent)
  if not details then
    add_error("citation-fragment-invalid", reason, context)
    return nil
  end
  return { key = key, details = details, context = context }
end

--- Classifies one Link against the resolution map. Cached by target, because a
--- broken Citation Run classifies the link that broke it a second time and one
--- defective link must report one error.
--- @return table|nil item `nil` when the Link is not a Citation.
local classified = {}
local function classify(link)
  local cached = classified[link.target]
  if cached == nil then
    cached = classify_target(link.target) or false
    classified[link.target] = cached
  end
  return cached or nil
end

--- Rewrites one inline list, grouping same-line semicolon-separated Citations into
--- one Cite. Only `Space` may sit around the separator: a `SoftBreak` ends the run.
--- Every inline list in the document runs through this, so Citations convert in
--- paragraphs, headings, table cells, captions, and inside inline containers alike.
local function process_inlines(inlines)
  local result = pandoc.Inlines({})
  local index = 1
  while index <= #inlines do
    local inline = inlines[index]
    local item = inline.t == "Link" and classify(inline) or nil
    if not item then
      result:insert(inline)
      index = index + 1
    else
      local items, last = { item }, index
      local cursor = index + 1
      while true do
        while inlines[cursor] and inlines[cursor].t == "Space" do
          cursor = cursor + 1
        end
        local separator = inlines[cursor]
        if not (separator and separator.t == "Str" and separator.text == ";") then
          break
        end
        cursor = cursor + 1
        while inlines[cursor] and inlines[cursor].t == "Space" do
          cursor = cursor + 1
        end
        local candidate = inlines[cursor]
        local next_item = candidate and candidate.t == "Link" and classify(candidate) or nil
        if not next_item then
          break
        end
        items[#items + 1] = next_item
        last = cursor
        cursor = cursor + 1
      end
      result:insert(build_cite(items))
      index = last + 1
    end
  end
  return result
end

function Pandoc(doc)
  doc.meta = resolve_style(doc.meta)
  citations = load_citations()
  local converted = doc:walk({ Inlines = process_inlines })
  if #errors > 0 then
    report_errors()
  end
  return converted
end
