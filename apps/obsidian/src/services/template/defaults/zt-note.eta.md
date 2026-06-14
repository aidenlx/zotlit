# <%= zt.title %>

[Zotero](<%= zt.backlink %>) <%= zt.attachments.map(a => a.fileLink).filter(Boolean).join(" ") %>
<%~ include("content", zt) %>
