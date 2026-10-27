/** Make @napi-rs/canvas tolerant of pdf.js fill({...}) / Path2D quirks. */
export function patchContext(ctx) {
  const fill = ctx.fill.bind(ctx);
  ctx.fill = function (...args) {
    if (args.length && args[0] && typeof args[0] === 'object' && !(args[0] instanceof Path2D)) {
      // pdf.js sometimes passes a fill rule object; ignore
      return fill();
    }
    if (typeof args[0] === 'string' && args[0] !== 'nonzero' && args[0] !== 'evenodd') {
      return fill();
    }
    try { return fill(...args); } catch { return fill(); }
  };
  const clip = ctx.clip?.bind(ctx);
  if (clip) {
    ctx.clip = function (...args) {
      try { return clip(...args); } catch { return clip(); }
    };
  }
  return ctx;
}
