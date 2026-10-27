#![deny(clippy::all)]

use napi::bindgen_prelude::*;
use napi_derive::napi;
use ort_infer_core::{rgba_to_nchw, ModelPaths, OrtEngine};
use parking_lot::Mutex;
use std::path::PathBuf;
use std::sync::Arc;

struct EngineState {
    engine: OrtEngine,
}

#[napi]
pub struct NativeOrt {
    inner: Arc<Mutex<EngineState>>,
}

#[napi(object)]
pub struct ModelPathConfig {
    pub clusterer: Option<String>,
    pub repair: Option<String>,
    pub classifier: Option<String>,
    pub doclayout: Option<String>,
}

#[napi(object)]
pub struct FloatTensor {
    pub data: Float32Array,
    pub shape: Vec<u32>,
}

#[napi(object)]
pub struct BoolTensor {
    pub data: Vec<bool>,
    pub shape: Vec<u32>,
}

#[napi(object)]
pub struct I64Tensor {
    pub data: Vec<i64>,
    pub shape: Vec<u32>,
}

#[napi(object)]
pub struct ClustererResult {
    pub emissions: Float32Array,
    pub emissions_shape: Vec<u32>,
    pub object_rule_logits: Float32Array,
    pub object_shape: Vec<u32>,
    pub infer_ms: f64,
    pub handoff_ms: f64,
}

#[napi(object)]
pub struct RepairResult {
    pub logits: Float32Array,
    pub infer_ms: f64,
    pub handoff_ms: f64,
}

#[napi(object)]
pub struct ClassifierResult {
    pub type_logits: Float32Array,
    pub type_shape: Vec<u32>,
    pub flow_logits: Float32Array,
    pub flow_shape: Vec<u32>,
    pub infer_ms: f64,
    pub handoff_ms: f64,
}

#[napi(object)]
pub struct DocLayoutResult {
    pub boxes: Float32Array,
    pub shape: Vec<u32>,
    pub infer_ms: f64,
    pub handoff_ms: f64,
    pub preprocess_ms: f64,
    pub output_names: Vec<String>,
}

fn to_usize(v: &[u32]) -> Vec<usize> {
    v.iter().map(|&x| x as usize).collect()
}

#[napi]
impl NativeOrt {
    #[napi(constructor)]
    pub fn new(threads: u32, paths: ModelPathConfig) -> Result<Self> {
        let mp = ModelPaths {
            clusterer: paths.clusterer.map(PathBuf::from),
            repair: paths.repair.map(PathBuf::from),
            classifier: paths.classifier.map(PathBuf::from),
            doclayout: paths.doclayout.map(PathBuf::from),
        };
        let engine = OrtEngine::new(threads as usize, mp)
            .map_err(|e| Error::from_reason(e.to_string()))?;
        Ok(Self {
            inner: Arc::new(Mutex::new(EngineState { engine })),
        })
    }

    #[napi]
    pub fn set_threads(&self, threads: u32) {
        self.inner.lock().engine.set_threads(threads as usize);
    }

    #[napi]
    pub fn threads(&self) -> u32 {
        self.inner.lock().engine.threads() as u32
    }

    #[napi]
    pub fn run_clusterer(
        &self,
        line_features: FloatTensor,
        line_pad: BoolTensor,
        object_features: FloatTensor,
        object_pad: BoolTensor,
    ) -> Result<ClustererResult> {
        let t_h0 = std::time::Instant::now();
        let lf: Vec<f32> = line_features.data.to_vec();
        let of: Vec<f32> = object_features.data.to_vec();
        let lp = line_pad.data.clone();
        let op = object_pad.data.clone();
        let ls = to_usize(&line_features.shape);
        let lps = to_usize(&line_pad.shape);
        let os = to_usize(&object_features.shape);
        let ops = to_usize(&object_pad.shape);
        let handoff_ms = t_h0.elapsed().as_secs_f64() * 1000.0;
        let eng = &self.inner.lock().engine;
        let (e, es, o, osh, infer_ms) = eng
            .run_clusterer(
                &lf,
                [ls[0], ls[1], ls[2]],
                &lp,
                [lps[0], lps[1]],
                &of,
                [os[0], os[1], os[2]],
                &op,
                [ops[0], ops[1]],
            )
            .map_err(|e| Error::from_reason(e.to_string()))?;
        Ok(ClustererResult {
            emissions: Float32Array::from(e),
            emissions_shape: es.into_iter().map(|x| x as u32).collect(),
            object_rule_logits: Float32Array::from(o),
            object_shape: osh.into_iter().map(|x| x as u32).collect(),
            infer_ms,
            handoff_ms,
        })
    }

    #[napi]
    pub fn run_repair(&self, features: FloatTensor) -> Result<RepairResult> {
        let t0 = std::time::Instant::now();
        let data: Vec<f32> = features.data.to_vec();
        let shape = to_usize(&features.shape);
        let handoff_ms = t0.elapsed().as_secs_f64() * 1000.0;
        let (logits, infer_ms) = self
            .inner
            .lock()
            .engine
            .run_repair(&data, [shape[0], shape[1]])
            .map_err(|e| Error::from_reason(e.to_string()))?;
        Ok(RepairResult {
            logits: Float32Array::from(logits),
            infer_ms,
            handoff_ms,
        })
    }

    #[napi]
    pub fn run_classifier(
        &self,
        regular: FloatTensor,
        rich: FloatTensor,
        hash_slots: I64Tensor,
        char_slots: I64Tensor,
        pad_mask: BoolTensor,
    ) -> Result<ClassifierResult> {
        let t0 = std::time::Instant::now();
        let r = regular.data.to_vec();
        let ri = rich.data.to_vec();
        let h = hash_slots.data.clone();
        let c = char_slots.data.clone();
        let p = pad_mask.data.clone();
        let handoff_ms = t0.elapsed().as_secs_f64() * 1000.0;
        let (ty, ts, fl, fs, infer_ms) = self
            .inner
            .lock()
            .engine
            .run_classifier(
                &r,
                to_usize(&regular.shape),
                &ri,
                to_usize(&rich.shape),
                &h,
                to_usize(&hash_slots.shape),
                &c,
                to_usize(&char_slots.shape),
                &p,
                to_usize(&pad_mask.shape),
            )
            .map_err(|e| Error::from_reason(e.to_string()))?;
        Ok(ClassifierResult {
            type_logits: Float32Array::from(ty),
            type_shape: ts.into_iter().map(|x| x as u32).collect(),
            flow_logits: Float32Array::from(fl),
            flow_shape: fs.into_iter().map(|x| x as u32).collect(),
            infer_ms,
            handoff_ms,
        })
    }

    /// Accept raw RGBA Buffer from node-canvas (width*height*4), preprocess in Rust.
    #[napi]
    pub fn run_doclayout_rgba(
        &self,
        rgba: Buffer,
        width: u32,
        height: u32,
        size: Option<u32>,
    ) -> Result<DocLayoutResult> {
        let t0 = std::time::Instant::now();
        let size = size.unwrap_or(480) as usize;
        let (nchw, shape, scale) = rgba_to_nchw(&rgba, width as usize, height as usize, size);
        let preprocess_ms = t0.elapsed().as_secs_f64() * 1000.0;
        let t1 = std::time::Instant::now();
        // handoff already in preprocess (copied from Buffer)
        let handoff_ms = preprocess_ms;
        let (boxes, bshape, infer_ms, names) = self
            .inner
            .lock()
            .engine
            .run_doclayout(&nchw, shape, Some(&scale))
            .map_err(|e| Error::from_reason(e.to_string()))?;
        let _ = t1;
        Ok(DocLayoutResult {
            boxes: Float32Array::from(boxes),
            shape: bshape.into_iter().map(|x| x as u32).collect(),
            infer_ms,
            handoff_ms,
            preprocess_ms,
            output_names: names,
        })
    }

    /// Accept precomputed NCHW Float32Array (zero-copy-ish from JS TypedArray).
    #[napi]
    pub fn run_doclayout_nchw(
        &self,
        nchw: FloatTensor,
        scale_factor: Option<Float32Array>,
    ) -> Result<DocLayoutResult> {
        let t0 = std::time::Instant::now();
        let data = nchw.data.to_vec();
        let shape = to_usize(&nchw.shape);
        let sf = scale_factor.map(|a| a.to_vec());
        let handoff_ms = t0.elapsed().as_secs_f64() * 1000.0;
        let (boxes, bshape, infer_ms, names) = self
            .inner
            .lock()
            .engine
            .run_doclayout(
                &data,
                [shape[0], shape[1], shape[2], shape[3]],
                sf.as_deref(),
            )
            .map_err(|e| Error::from_reason(e.to_string()))?;
        Ok(DocLayoutResult {
            boxes: Float32Array::from(boxes),
            shape: bshape.into_iter().map(|x| x as u32).collect(),
            infer_ms,
            handoff_ms,
            preprocess_ms: 0.0,
            output_names: names,
        })
    }
}

#[napi]
pub fn addon_info() -> serde_json::Value {
    serde_json::json!({
        "name": "ort_infer_napi",
        "ort": "static-linked via ort 2.0.0-rc.15 download-binaries",
        "feature_extraction": "JS (document-worker); tensors handed to native",
        "bitmap_path": "PDF.js + node-canvas RGBA Buffer → Rust preprocess or NCHW Float32Array",
    })
}
