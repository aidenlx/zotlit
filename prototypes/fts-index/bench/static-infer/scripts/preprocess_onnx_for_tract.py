#!/usr/bin/env python3
"""Rewrite Zotero block-seg ONNX so tract can load them.

tract (as of 2024/2025) struggles with:
1. Clip on INT64 tensors (TDim/I64) — rewrite to Max+Min
2. Clip min/max *attributes* (invalid on opset≥11; some exporters still emit them)
3. Dynamic Range(start,limit,delta) used for arange(0,N) — fold to Constant when N known

Usage:
  python preprocess_onnx_for_tract.py \\
      --clusterer-T 64 --classifier-N 48
"""
from __future__ import annotations
import argparse
from pathlib import Path
import numpy as np
import onnx
from onnx import helper, numpy_helper, TensorProto

ROOT = Path("BENCH_ROOT/static-infer/models")


def dtype_map(g):
    d = {}
    for init in g.initializer:
        d[init.name] = init.data_type
    for vi in list(g.input) + list(g.value_info) + list(g.output):
        et = vi.type.tensor_type.elem_type
        if et:
            d[vi.name] = et
    return d


def rewrite(src: Path, dst: Path, fold_range_to: int | None) -> None:
    m = onnx.load(str(src))
    g = m.graph
    dtypes = dtype_map(g)
    out_nodes = []
    for n in g.node:
        if n.op_type == "Clip":
            # drop legacy min/max attrs
            attrs = [a for a in n.attribute if a.name not in ("min", "max")]
            del n.attribute[:]
            n.attribute.extend(attrs)
            tin = dtypes.get(n.input[0], TensorProto.FLOAT)
            intish = tin == TensorProto.INT64 or any(
                dtypes.get(i) == TensorProto.INT64 for i in n.input[1:3] if i
            )
            if intish and len(n.input) >= 3:
                mid = n.output[0] + "__clip_mid"
                out_nodes.append(
                    helper.make_node("Max", [n.input[0], n.input[1]], [mid], name=n.name + "__max")
                )
                out_nodes.append(
                    helper.make_node("Min", [mid, n.input[2]], [n.output[0]], name=n.name + "__min")
                )
                continue
        if n.op_type == "Range" and fold_range_to is not None:
            arr = np.arange(fold_range_to, dtype=np.int64)
            out_nodes.append(
                helper.make_node(
                    "Constant",
                    [],
                    [n.output[0]],
                    name=n.name + "__const",
                    value=numpy_helper.from_array(arr),
                )
            )
            continue
        out_nodes.append(n)
    del g.node[:]
    g.node.extend(out_nodes)
    onnx.save(m, str(dst))
    print(f"wrote {dst} ({len(out_nodes)} nodes)")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--clusterer-T", type=int, default=64)
    ap.add_argument("--classifier-N", type=int, default=48)
    args = ap.parse_args()
    rewrite(ROOT / "clusterer.onnx", ROOT / "clusterer.fixed.onnx", args.clusterer_T)
    rewrite(ROOT / "classifier.onnx", ROOT / "classifier.fixed.onnx", args.classifier_N)
    # repair needs no rewrite
    print("repair.onnx: no rewrite needed")


if __name__ == "__main__":
    main()
