//! Static-linked ONNX Runtime inference for ZotLit layout pipeline.
//! Models are loaded from paths at runtime (AGPL block-seg weights stay external).

use ort::environment::Environment;
use ort::session::Session;
use ort::value::Tensor;
use parking_lot::Mutex;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Instant;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum InferError {
    #[error("ort: {0}")]
    Ort(String),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("{0}")]
    Msg(String),
}

impl From<ort::Error> for InferError {
    fn from(e: ort::Error) -> Self {
        InferError::Ort(e.to_string())
    }
}

fn shape_usize(shape: &ort::value::Shape) -> Vec<usize> {
    shape.iter().map(|&d| d as usize).collect()
}

pub type Result<T> = std::result::Result<T, InferError>;

fn mad(a: &[f32], b: &[f32]) -> f32 {
    a.iter().zip(b.iter()).map(|(x, y)| (x - y).abs()).fold(0.0f32, f32::max)
}

pub struct OrtEngine {
    env: Arc<Environment>,
    threads: usize,
    clusterer: Mutex<Option<Session>>,
    repair: Mutex<Option<Session>>,
    classifier: Mutex<Option<Session>>,
    doclayout: Mutex<Option<Session>>,
    paths: ModelPaths,
}

#[derive(Clone, Debug, Default)]
pub struct ModelPaths {
    pub clusterer: Option<PathBuf>,
    pub repair: Option<PathBuf>,
    pub classifier: Option<PathBuf>,
    pub doclayout: Option<PathBuf>,
}

#[derive(Serialize, Clone, Debug)]
pub struct Timing {
    pub init_ms: f64,
    pub p50_ms: f64,
    pub p95_ms: f64,
    pub mean_ms: f64,
    pub min_ms: f64,
    pub max_ms: f64,
    pub runs: usize,
    pub threads: usize,
}

fn percentile(sorted: &[f64], p: f64) -> f64 {
    if sorted.is_empty() {
        return 0.0;
    }
    let idx = ((sorted.len() as f64 - 1.0) * p).round() as usize;
    sorted[idx.min(sorted.len() - 1)]
}

fn summarize(mut times: Vec<f64>, init_ms: f64, threads: usize) -> Timing {
    times.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let n = times.len();
    let mean = if n == 0 { 0.0 } else { times.iter().sum::<f64>() / n as f64 };
    Timing {
        init_ms,
        p50_ms: percentile(&times, 0.50),
        p95_ms: percentile(&times, 0.95),
        mean_ms: mean,
        min_ms: times.first().copied().unwrap_or(0.0),
        max_ms: times.last().copied().unwrap_or(0.0),
        runs: n,
        threads,
    }
}

impl OrtEngine {
    pub fn new(threads: usize, paths: ModelPaths) -> Result<Self> {
        let env = Arc::new(ort::init().with_name("zotlit_ort").build().map_err(|e| InferError::Ort(e.to_string()))?);
        Ok(Self {
            env,
            threads: threads.max(1),
            clusterer: Mutex::new(None),
            repair: Mutex::new(None),
            classifier: Mutex::new(None),
            doclayout: Mutex::new(None),
            paths,
        })
    }

    pub fn set_threads(&mut self, threads: usize) {
        self.threads = threads.max(1);
        // Force reload on next use
        *self.clusterer.lock() = None;
        *self.repair.lock() = None;
        *self.classifier.lock() = None;
        *self.doclayout.lock() = None;
    }

    fn ensure<'a>(
        &'a self,
        slot: &'a Mutex<Option<Session>>,
        path: &Option<PathBuf>,
    ) -> Result<(parking_lot::MutexGuard<'a, Option<Session>>, f64)> {
        let mut g = slot.lock();
        if g.is_none() {
            let p = path
                .as_ref()
                .ok_or_else(|| InferError::Msg("model path not set".into()))?;
            let t0 = Instant::now();
            let session = Session::builder(&self.env)
                .map_err(|e| InferError::Ort(e.to_string()))?
                .with_intra_threads(self.threads.max(1))
                .map_err(|e| InferError::Ort(e.to_string()))?
                .commit_from_file(p)
                .map_err(|e| InferError::Ort(e.to_string()))?;
            let init = t0.elapsed().as_secs_f64() * 1000.0;
            *g = Some(session);
            Ok((g, init))
        } else {
            Ok((g, 0.0))
        }
    }

    /// Run clusterer: line_features[1,T,22], line_pad[1,T], object_features[1,O,22], object_pad[1,O]
    pub fn run_clusterer(
        &self,
        line_features: &[f32],
        line_shape: [usize; 3],
        line_pad: &[bool],
        line_pad_shape: [usize; 2],
        object_features: &[f32],
        object_shape: [usize; 3],
        object_pad: &[bool],
        object_pad_shape: [usize; 2],
    ) -> Result<(Vec<f32>, Vec<usize>, Vec<f32>, Vec<usize>, f64)> {
        let (mut g, _) = self.ensure(&self.clusterer, &self.paths.clusterer)?;
        let session = g.as_mut().unwrap();
        let t1 = Tensor::from_array((line_shape.to_vec(), line_features.to_vec().into_boxed_slice()))?;
        let t2 = Tensor::from_array((line_pad_shape.to_vec(), line_pad.to_vec().into_boxed_slice()))?;
        let t3 = Tensor::from_array((object_shape.to_vec(), object_features.to_vec().into_boxed_slice()))?;
        let t4 = Tensor::from_array((object_pad_shape.to_vec(), object_pad.to_vec().into_boxed_slice()))?;
        let t0 = Instant::now();
        let outs = session.run(ort::inputs![
            "line_features" => &t1,
            "line_pad_mask" => &t2,
            "object_features" => &t3,
            "object_pad_mask" => &t4
        ])?;
        let ms = t0.elapsed().as_secs_f64() * 1000.0;
        let (es, e) = outs["emissions"].try_extract_tensor::<f32>()?;
        let (os, o) = outs["object_rule_logits"].try_extract_tensor::<f32>()?;
        Ok((e.to_vec(), shape_usize(es), o.to_vec(), shape_usize(os), ms))
    }

    pub fn run_repair(&self, features: &[f32], shape: [usize; 2]) -> Result<(Vec<f32>, f64)> {
        let (mut g, _) = self.ensure(&self.repair, &self.paths.repair)?;
        let session = g.as_mut().unwrap();
        let input = Tensor::from_array((shape.to_vec(), features.to_vec().into_boxed_slice()))?;
        let t0 = Instant::now();
        let outs = session.run(ort::inputs!["features" => &input])?;
        let ms = t0.elapsed().as_secs_f64() * 1000.0;
        let (_s, out) = outs["logits"].try_extract_tensor::<f32>()?;
        Ok((out.to_vec(), ms))
    }

    pub fn run_classifier(
        &self,
        regular: &[f32],
        regular_shape: Vec<usize>,
        rich: &[f32],
        rich_shape: Vec<usize>,
        hash_slots: &[i64],
        hash_shape: Vec<usize>,
        char_slots: &[i64],
        char_shape: Vec<usize>,
        pad_mask: &[bool],
        pad_shape: Vec<usize>,
    ) -> Result<(Vec<f32>, Vec<usize>, Vec<f32>, Vec<usize>, f64)> {
        let (mut g, _) = self.ensure(&self.classifier, &self.paths.classifier)?;
        let session = g.as_mut().unwrap();
        let t1 = Tensor::from_array((regular_shape, regular.to_vec().into_boxed_slice()))?;
        let t2 = Tensor::from_array((rich_shape, rich.to_vec().into_boxed_slice()))?;
        let t3 = Tensor::from_array((hash_shape, hash_slots.to_vec().into_boxed_slice()))?;
        let t4 = Tensor::from_array((char_shape, char_slots.to_vec().into_boxed_slice()))?;
        let t5 = Tensor::from_array((pad_shape, pad_mask.to_vec().into_boxed_slice()))?;
        let t0 = Instant::now();
        let outs = session.run(ort::inputs![
            "regular_features" => &t1,
            "rich_features" => &t2,
            "hash_slots" => &t3,
            "char_slots" => &t4,
            "pad_mask" => &t5
        ])?;
        let ms = t0.elapsed().as_secs_f64() * 1000.0;
        let (ts, ty) = outs["type_logits"].try_extract_tensor::<f32>()?;
        let (fs, fl) = outs["flow_logits"].try_extract_tensor::<f32>()?;
        Ok((ty.to_vec(), shape_usize(ts), fl.to_vec(), shape_usize(fs), ms))
    }

    /// DocLayout: NCHW float32 image + optional scale_factor
    pub fn run_doclayout(
        &self,
        nchw: &[f32],
        nchw_shape: [usize; 4],
        scale_factor: Option<&[f32]>,
    ) -> Result<(Vec<f32>, Vec<usize>, f64, Vec<String>)> {
        let (mut g, _) = self.ensure(&self.doclayout, &self.paths.doclayout)?;
        let session = g.as_mut().unwrap();
        let input_names: Vec<String> = session.inputs().iter().map(|i| i.name().to_string()).collect();
        let image = Tensor::from_array((nchw_shape.to_vec(), nchw.to_vec().into_boxed_slice()))?;
        let t0 = Instant::now();
        let out_names: Vec<String> = session.outputs().iter().map(|o| o.name().to_string()).collect();
        let outs = if input_names.iter().any(|n| n.contains("scale")) {
            let sf = scale_factor.unwrap_or(&[1.0, 1.0]);
            let scale = Tensor::from_array((vec![1usize, 2], sf.to_vec().into_boxed_slice()))?;
            let img_name = input_names
                .iter()
                .find(|n| n.contains("image") || *n == "im_shape" || n.contains("x") || *n == "input")
                .cloned()
                .unwrap_or_else(|| input_names[0].clone());
            let scale_name = input_names
                .iter()
                .find(|n| n.contains("scale"))
                .cloned()
                .unwrap_or_else(|| input_names[1].clone());
            session.run(ort::inputs![
                img_name.as_str() => &image,
                scale_name.as_str() => &scale
            ])?
        } else {
            let img_name = input_names.first().map(|s| s.as_str()).unwrap_or("image");
            session.run(ort::inputs![img_name => &image])?
        };
        let ms = t0.elapsed().as_secs_f64() * 1000.0;
        let key = out_names
            .iter()
            .find(|n| n.contains("fetch") || n.contains("multiclass"))
            .cloned()
            .unwrap_or_else(|| out_names[0].clone());
        let (shape, data) = outs[key.as_str()].try_extract_tensor::<f32>()?;
        Ok((data.to_vec(), shape_usize(shape), ms, out_names))
    }

    pub fn bench_clusterer_from_ref(&self, ref_dir: &Path, warmup: usize, runs: usize) -> Result<(Timing, f32, f32)> {
        let (lf_s, lf) = load_f32(&ref_dir.join("clusterer_line_features.npy"))?;
        let (lp_s, lp) = load_bool(&ref_dir.join("clusterer_line_pad_mask.npy"))?;
        let (of_s, of) = load_f32(&ref_dir.join("clusterer_object_features.npy"))?;
        let (op_s, op) = load_bool(&ref_dir.join("clusterer_object_pad_mask.npy"))?;
        let (mut g, init_ms) = self.ensure(&self.clusterer, &self.paths.clusterer)?;
        let session = g.as_mut().unwrap();
        let t1 = Tensor::from_array((lf_s.clone(), lf.clone().into_boxed_slice()))?;
        let t2 = Tensor::from_array((lp_s.clone(), lp.clone().into_boxed_slice()))?;
        let t3 = Tensor::from_array((of_s.clone(), of.clone().into_boxed_slice()))?;
        let t4 = Tensor::from_array((op_s.clone(), op.clone().into_boxed_slice()))?;
        for _ in 0..warmup {
            let _ = session.run(ort::inputs![
                "line_features" => &t1, "line_pad_mask" => &t2,
                "object_features" => &t3, "object_pad_mask" => &t4
            ])?;
        }
        let mut times = Vec::with_capacity(runs);
        for _ in 0..runs {
            let t0 = Instant::now();
            let _ = session.run(ort::inputs![
                "line_features" => &t1, "line_pad_mask" => &t2,
                "object_features" => &t3, "object_pad_mask" => &t4
            ])?;
            times.push(t0.elapsed().as_secs_f64() * 1000.0);
        }
        let outs = session.run(ort::inputs![
            "line_features" => &t1, "line_pad_mask" => &t2,
            "object_features" => &t3, "object_pad_mask" => &t4
        ])?;
        let (_, e) = outs["emissions"].try_extract_tensor::<f32>()?;
        let (_, o) = outs["object_rule_logits"].try_extract_tensor::<f32>()?;
        let (_, er) = load_f32(&ref_dir.join("clusterer_emissions.npy"))?;
        let (_, orv) = load_f32(&ref_dir.join("clusterer_object_rule_logits.npy"))?;
        Ok((summarize(times, init_ms, self.threads), mad(&e.to_vec(), &er), mad(&o.to_vec(), &orv)))
    }

    pub fn paths(&self) -> &ModelPaths {
        &self.paths
    }

    pub fn threads(&self) -> usize {
        self.threads
    }
}

pub fn load_f32(path: &Path) -> Result<(Vec<usize>, Vec<f32>)> {
    let (shape, data) = read_npy(path)?;
    let floats: Vec<f32> = data
        .chunks_exact(4)
        .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
        .collect();
    Ok((shape, floats))
}

pub fn load_bool(path: &Path) -> Result<(Vec<usize>, Vec<bool>)> {
    let (shape, data) = read_npy(path)?;
    Ok((shape, data.iter().map(|&b| b != 0).collect()))
}

pub fn load_i64(path: &Path) -> Result<(Vec<usize>, Vec<i64>)> {
    let (shape, data) = read_npy(path)?;
    let vals: Vec<i64> = data
        .chunks_exact(8)
        .map(|c| i64::from_le_bytes(c.try_into().unwrap()))
        .collect();
    Ok((shape, vals))
}

fn read_npy(path: &Path) -> Result<(Vec<usize>, Vec<u8>)> {
    use std::fs::File;
    use std::io::Read;
    let mut f = File::open(path)?;
    let mut magic = [0u8; 6];
    f.read_exact(&mut magic)?;
    let mut ver = [0u8; 2];
    f.read_exact(&mut ver)?;
    let header_len = if ver[0] == 1 {
        let mut b = [0u8; 2];
        f.read_exact(&mut b)?;
        u16::from_le_bytes(b) as usize
    } else {
        let mut b = [0u8; 4];
        f.read_exact(&mut b)?;
        u32::from_le_bytes(b) as usize
    };
    let mut header = vec![0u8; header_len];
    f.read_exact(&mut header)?;
    let header_str = String::from_utf8_lossy(&header);
    let shape_start = header_str.find('(').ok_or_else(|| InferError::Msg("npy shape".into()))? + 1;
    let shape_end = header_str.find(')').ok_or_else(|| InferError::Msg("npy shape".into()))?;
    let shape: Vec<usize> = header_str[shape_start..shape_end]
        .split(',')
        .filter_map(|s| {
            let t = s.trim();
            if t.is_empty() {
                None
            } else {
                Some(t.parse().unwrap())
            }
        })
        .collect();
    let mut data = Vec::new();
    f.read_to_end(&mut data)?;
    Ok((shape, data))
}

/// RGBA u8 H×W×4 → NCHW ImageNet-normalized f32 at `size`×`size` (nearest resize).
pub fn rgba_to_nchw(rgba: &[u8], width: usize, height: usize, size: usize) -> (Vec<f32>, [usize; 4], [f32; 2]) {
    let mut out = vec![0f32; 1 * 3 * size * size];
    let mean = [0.485f32, 0.456, 0.406];
    let std = [0.229f32, 0.224, 0.225];
    for y in 0..size {
        let sy = (y as f32 * height as f32 / size as f32) as usize;
        for x in 0..size {
            let sx = (x as f32 * width as f32 / size as f32) as usize;
            let si = (sy.min(height - 1) * width + sx.min(width - 1)) * 4;
            for c in 0..3 {
                let v = rgba[si + c] as f32 / 255.0;
                out[c * size * size + y * size + x] = (v - mean[c]) / std[c];
            }
        }
    }
    let scale = [size as f32 / height as f32, size as f32 / width as f32];
    (out, [1, 3, size, size], scale)
}
