-- Restores only the citation and vault-link spans selected by the parse worker.
local fragments
local prefix

local function restore(span)
  local fragment = fragments[span.identifier]
  if not fragment then return nil end
  local reader = "markdown+wikilinks_title_after_pipe"
  if fragment.kind == "link" then reader = reader .. "-citations" end
  local doc = pandoc.read(fragment.source, reader)
  if fragment.kind == "link" then
    doc = doc:walk({ Link = function(link)
      link.attributes["data-zotlit-parsed"] = "true"
      return link
    end })
  end
  return doc.blocks[1].content
end

-- A worker-selected source inside Pandoc math is prose under Obsidian's dollar rules.
local function restore_prose(math)
  if not math.text:find("[]{#" .. prefix .. "-", 1, true) then return nil end
  local delimiter = math.mathtype == "DisplayMath" and "$$" or "$"
  return pandoc.read(
    delimiter .. math.text .. delimiter,
    "markdown-tex_math_dollars-citations"
  ).blocks[1].content
end

function Pandoc(doc)
  local handle = assert(io.open("zotlit-parsed.json", "r"))
  local parsed = pandoc.json.decode(handle:read("a"), false)
  fragments = parsed.fragments
  prefix = parsed.prefix
  handle:close()
  -- Metadata keeps export's own contract, including explicit nocite entries.
  local body = pandoc.Pandoc(doc.blocks):walk({ Cite = function(cite) return cite.content end })
  body = body:walk({ Math = restore_prose }):walk({ Span = restore })
  doc.blocks = body.blocks
  return doc
end
