#!/usr/bin/env python3
"""Paddle LayoutDetection reference for quality (PP-DocLayout-S / plus-L)."""
import argparse, json, os, time
from pathlib import Path
os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")

EXCLUDE = {"header","footer","number","header_image","footer_image","seal","aside_text"}

def reading_order(boxes):
  if not boxes: return [], False
  mids = sorted((b["bbox"][0]+b["bbox"][2])/2 for b in boxes)
  gap, gap_at = 0, None
  for i in range(1,len(mids)):
    g=mids[i]-mids[i-1]
    if g>gap: gap,gap_at=g,(mids[i-1]+mids[i])/2
  xs=[b["bbox"][0] for b in boxes]+[b["bbox"][2] for b in boxes]
  page_w=max(xs)-min(xs) if xs else 0
  two_col = page_w>50 and gap>page_w*0.12 and len(boxes)>=4
  key=lambda b:(b["bbox"][1], b["bbox"][0])
  if two_col and gap_at is not None:
    left=sorted([b for b in boxes if (b["bbox"][0]+b["bbox"][2])/2 < gap_at], key=key)
    right=sorted([b for b in boxes if (b["bbox"][0]+b["bbox"][2])/2 >= gap_at], key=key)
    return left+right, True
  return sorted(boxes, key=key), False

def main():
  ap=argparse.ArgumentParser()
  ap.add_argument("pages_dir")
  ap.add_argument("--model", default="PP-DocLayout-S")
  ap.add_argument("--thr", type=float, default=0.4)
  args=ap.parse_args()
  pages_dir=Path(args.pages_dir)
  pages=json.loads((pages_dir/"pages.json").read_text())
  from paddleocr import LayoutDetection
  t0=time.perf_counter()
  m=LayoutDetection(model_name=args.model, threshold=args.thr)
  init_ms=(time.perf_counter()-t0)*1000
  results=[]; times=[]
  for p in pages:
    png=str(pages_dir/p["png"])
    t1=time.perf_counter()
    out=m.predict(png, batch_size=1)
    dt=(time.perf_counter()-t1)*1000; times.append(dt)
    r=out[0]
    d=r.json() if callable(getattr(r,"json",None)) else (r if isinstance(r,dict) else {})
    # paddlex structure varies
    boxes_raw = None
    if isinstance(d, dict):
      boxes_raw = d.get("boxes") or (d.get("res") or {}).get("boxes")
      if boxes_raw is None and "res" in d and isinstance(d["res"], list):
        boxes_raw = d["res"]
    boxes=[]
    if boxes_raw:
      for b in boxes_raw:
        if isinstance(b, dict):
          label=b.get("label") or b.get("cls_label") or b.get("class_name")
          score=float(b.get("score") or b.get("confidence") or 0)
          coord=b.get("coordinate") or b.get("bbox") or b.get("box")
          if coord is None and all(k in b for k in ("xmin","ymin","xmax","ymax")):
            coord=[b["xmin"],b["ymin"],b["xmax"],b["ymax"]]
          if label is None or coord is None: continue
          boxes.append({"label":str(label),"score":score,"bbox":[float(x) for x in coord[:4]]})
    ordered, two_col = reading_order(boxes)
    for i,b in enumerate(ordered): b["order"]=i
    body=[b for b in ordered if b["label"] not in EXCLUDE]
    results.append({"page_index":p["page_index"],"render_w":p["render_w"],"render_h":p["render_h"],
      "width_pt":p["width_pt"],"height_pt":p["height_pt"],"boxes":ordered,"body_boxes":body,
      "two_col":two_col,"infer_ms":dt,"n_boxes":len(ordered),
      "n_excluded":sum(1 for b in ordered if b["label"] in EXCLUDE)})
  times_sorted=sorted(times)
  summary={"model":args.model,"init_ms":init_ms,"pages":len(results),
    "median_ms":times_sorted[len(times_sorted)//2] if times_sorted else None,
    "p95_ms":times_sorted[min(len(times_sorted)-1,int(len(times_sorted)*0.95))] if times_sorted else None,
    "mean_ms":sum(times)/len(times) if times else None}
  (pages_dir/"layout-boxes-paddle.json").write_text(json.dumps({"summary":summary,"pages":results}))
  # also write as layout-boxes.json for downstream if not present
  if not (pages_dir/"layout-boxes.json").exists():
    (pages_dir/"layout-boxes.json").write_text(json.dumps({"summary":summary,"pages":results}))
  print(json.dumps(summary, indent=2))

if __name__=="__main__":
  main()
