# Host state

Read state a host owns — a PDF.js page's `renderingState`, the open document proxy, the DOM, the workspace — from the host at the moment of the ask, through a seam helper (`renderedPagesOf(controller)`). A private set, map, or snapshot filled by event replay is a **mirror**: it misses what stood before the subscription and keeps what the host has since dropped. An event listener acts on the event; what it needs comes from the host. Own only what the module itself produced — what it painted, what it registered.
