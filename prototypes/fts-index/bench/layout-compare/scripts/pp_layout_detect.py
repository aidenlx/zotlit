#!/usr/bin/env python3
"""Run PP-DocLayout-S (ONNX via onnxruntime) on rendered PNGs; write boxes.json.
Also optionally run Paddle LayoutDetection for reference labels.
Usage: pp_layout_detect.py <pagesDir> [--threads N] [--model S|plus-L]
"""
import argparse, json, os, time, sys
from pathlib import Path
import numpy as np

LABELS_S = [
  "paragraph_title","image","text","number","abstract","content","figure_title",
  "formula","table","table_title","reference","doc_title","footnote","header",
  "algorithm","footer","seal","chart_title","chart","formula_number",
  "header_image","footer_image","aside_text",
]
EXCLUDE = {"header","footer","number","header_image","footer_image","seal","aside_text"}
# keep formula/table/image captions optionally as auxiliary
AUX = {"image","table","formula","figure_title","table_title","chart","chart_title","footnote","reference","formula_number"}

def preprocess(img_bgr, size=480):
  import cv2
  h, w = img_bgr.shape[:2]
  resized = cv2.resize(img_bgr, (size, size), interpolation=cv2.INTER_LINEAR)
  rgb = cv2.cvtColor(resized, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
  mean = np.array([0.485, 0.456, 0.406], dtype=np.float32)
  std = np.array([0.229, 0.224, 0.225], dtype=np.float32)
  rgb = (rgb - mean) / std
  chw = np.transpose(rgb, (2, 0, 1))[None].astype(np.float32)
  scale = np.array([[size / float(h), size / float(w)]], dtype=np.float32)  # may be unused; GFL uses absolute
  # Paddle scale_factor is often [h_scale, w_scale] = target/orig
  scale_factor = np.array([[size / float(h), size / float(w)]], dtype=np.float32)
  return chw, scale_factor, w, h

def nms_xyxy(boxes, scores, iou_thr=0.5):
  if len(boxes) == 0: return []
  boxes = boxes.astype(np.float32)
  x1,y1,x2,y2 = boxes.T
  areas = (x2-x1).clip(0)*(y2-y1).clip(0)
  order = scores.argsort()[::-1]
  keep = []
  while order.size > 0:
    i = order[0]; keep.append(int(i))
    if order.size == 1: break
    xx1 = np.maximum(x1[i], x1[order[1:]])
    yy1 = np.maximum(y1[i], y1[order[1:]])
    xx2 = np.minimum(x2[i], x2[order[1:]])
    yy2 = np.minimum(y2[i], y2[order[1:]])
    inter = (xx2-xx1).clip(0)*(yy2-yy1).clip(0)
    iou = inter / (areas[i] + areas[order[1:]] - inter + 1e-6)
    order = order[1:][iou <= iou_thr]
  return keep

def parse_fetch(out, orig_w, orig_h, size=480, thr=0.4):
  # fetch_name_0: [N,6] typically [cls, score, x1,y1,x2,y2] in input-size coords or letterbox
  arr = np.array(out)
  if arr.ndim != 2 or arr.shape[1] < 6:
    return []
  sx = orig_w / size; sy = orig_h / size
  boxes = []
  for row in arr:
    cls_id, score, x1, y1, x2, y2 = row[:6]
    if score < thr: continue
    cid = int(cls_id)
    label = LABELS_S[cid] if 0 <= cid < len(LABELS_S) else f"cls{cid}"
    boxes.append({
      "label": label, "score": float(score), "cls": cid,
      "bbox": [float(x1*sx), float(y1*sy), float(x2*sx), float(y2*sy)],  # pixel coords of rendered image
    })
  if not boxes: return []
  # per-class soft nms
  by = {}
  for b in boxes:
    by.setdefault(b["label"], []).append(b)
  kept = []
  for lab, bs in by.items():
    bb = np.array([b["bbox"] for b in bs]); sc = np.array([b["score"] for b in bs])
    for i in nms_xyxy(bb, sc, 0.5):
      kept.append(bs[i])
  return kept

def reading_order(boxes):
  """Simple XY-cut-ish: sort by columns then top-to-bottom.
  Image coords: y down, x right.
  """
  if not boxes: return []
  # use mid-x for column detect
  mids = sorted( (b["bbox"][0]+b["bbox"][2])/2 for b in boxes )
  gap, gap_at = 0, None
  for i in range(1, len(mids)):
    g = mids[i]-mids[i-1]
    if g > gap: gap, gap_at = g, (mids[i-1]+mids[i])/2
  xs = [b["bbox"][0] for b in boxes]+[b["bbox"][2] for b in boxes]
  page_w = max(xs)-min(xs) if xs else 0
  two_col = page_w > 50 and gap > page_w * 0.12 and len(boxes) >= 4
  def key_tb(b):
    return (b["bbox"][1], b["bbox"][0])  # top then left
  if two_col and gap_at is not None:
    left = sorted([b for b in boxes if (b["bbox"][0]+b["bbox"][2])/2 < gap_at], key=key_tb)
    right = sorted([b for b in boxes if (b["bbox"][0]+b["bbox"][2])/2 >= gap_at], key=key_tb)
    return left + right, True
  return sorted(boxes, key=key_tb), False

def main():
  ap = argparse.ArgumentParser()
  ap.add_argument("pages_dir")
  ap.add_argument("--threads", type=int, default=1)
  ap.add_argument("--model", default="S", choices=["S","paddle-S","paddle-plus"])
  ap.add_argument("--thr", type=float, default=0.4)
  args = ap.parse_args()
  pages_dir = Path(args.pages_dir)
  pages = json.loads((pages_dir/"pages.json").read_text())
  import onnxruntime as ort
  so = ort.SessionOptions(); so.intra_op_num_threads = args.threads; so.inter_op_num_threads = 1
  model_path = "BENCH_ROOT/static-infer/models/layout/pp_doclayout_s.onnx"
  t_init0 = time.perf_counter()
  sess = ort.InferenceSession(model_path, so, providers=["CPUExecutionProvider"])
  init_ms = (time.perf_counter()-t_init0)*1000
  import cv2

  results = []; times=[]
  for p in pages:
    png = pages_dir / p["png"]
    img = cv2.imread(str(png))
    if img is None: raise SystemExit(f"missing {png}")
    chw, scale_factor, ow, oh = preprocess(img, 480)
    # warmup once
    feeds = {"image": chw, "scale_factor": scale_factor}
    if not times:
      for _ in range(2):
        sess.run(None, feeds)
    t0 = time.perf_counter()
    outs = sess.run(None, feeds)
    dt = (time.perf_counter()-t0)*1000
    times.append(dt)
    boxes = parse_fetch(outs[0], ow, oh, 480, args.thr)
    ordered, two_col = reading_order(boxes)
    for i,b in enumerate(ordered): b["order"]=i
    body = [b for b in ordered if b["label"] not in EXCLUDE]
    results.append({
      "page_index": p["page_index"],
      "render_w": p["render_w"], "render_h": p["render_h"],
      "width_pt": p["width_pt"], "height_pt": p["height_pt"],
      "boxes": ordered, "body_boxes": body, "two_col": two_col,
      "infer_ms": dt,
      "n_boxes": len(ordered),
      "n_excluded": sum(1 for b in ordered if b["label"] in EXCLUDE),
    })
  times_sorted = sorted(times)
  summary = {
    "model": "PP-DocLayout-S-onnx",
    "threads": args.threads,
    "init_ms": init_ms,
    "pages": len(results),
    "median_ms": times_sorted[len(times_sorted)//2] if times_sorted else None,
    "p95_ms": times_sorted[int(len(times_sorted)*0.95)] if times_sorted else None,
    "mean_ms": float(np.mean(times)) if times else None,
    "exclude_labels": sorted(EXCLUDE),
  }
  out = {"summary": summary, "pages": results}
  out_path = pages_dir / "layout-boxes.json"
  out_path.write_text(json.dumps(out))
  print(json.dumps(summary, indent=2))

if __name__ == "__main__":
  main()
