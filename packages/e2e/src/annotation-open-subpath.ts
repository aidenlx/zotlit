// What an open that lands on one Annotation hands Obsidian's PDF view: the
// subpath of its ephemeral state, read as the keys the reader acts on rather
// than as one spelling of them.

/**
 * Eval statements, for an async evaluation that has `until` in scope, that
 * run `gesture` and answer, as JSON, the keys of the first subpath an open
 * sets that names an Annotation. Opens that name none, such as an Attachment
 * link's open still settling from an earlier gesture, are passed over. The
 * patch on `WorkspaceLeaf.prototype.setEphemeralState` is undone in place.
 */
export function annotationOpenSubpath(gesture: string): string {
  return `const proto=Object.getPrototypeOf(app.workspace.getMostRecentLeaf());const native=proto.setEphemeralState;let subpath=null;proto.setEphemeralState=function(state){if(subpath===null&&typeof state?.subpath==='string'&&state.subpath.includes('zt-annotation='))subpath=state.subpath;return native.call(this,state);};try{${gesture}const found=await until('the PDF opens at the Annotation',()=>subpath,10000);return JSON.stringify(Object.fromEntries(new URLSearchParams(found.replace(/^#/,''))));}finally{proto.setEphemeralState=native;}`;
}

/** The keys an open at Annotation `annotation` of Attachment `attachment` carries. */
export function annotationOpenKeys({
  page,
  annotation,
  attachment,
}: {
  page: number;
  annotation: string;
  attachment: string;
}): Record<string, string> {
  return {
    page: String(page),
    "zt-annotation": annotation,
    "zt-attachment": attachment,
  };
}
