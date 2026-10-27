use std::fs::File;
use std::io::Read;
use std::path::Path;
use std::time::Instant;
use tract_onnx::prelude::*;

fn read_npy_header(f: &mut File) -> TractResult<(Vec<usize>, String)> {
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
    let header_str = String::from_utf8_lossy(&header).to_string();
    let shape_start = header_str.find('(').unwrap() + 1;
    let shape_end = header_str.find(')').unwrap();
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
    Ok((shape, header_str))
}

fn load_npy_f32(path: &Path) -> TractResult<(Vec<usize>, Vec<f32>)> {
    let mut f = File::open(path)?;
    let (shape, _) = read_npy_header(&mut f)?;
    let mut data = Vec::new();
    f.read_to_end(&mut data)?;
    let floats: Vec<f32> = data
        .chunks_exact(4)
        .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
        .collect();
    Ok((shape, floats))
}

fn load_npy_bool(path: &Path) -> TractResult<(Vec<usize>, Vec<bool>)> {
    let mut f = File::open(path)?;
    let (shape, _) = read_npy_header(&mut f)?;
    let mut data = Vec::new();
    f.read_to_end(&mut data)?;
    Ok((shape, data.iter().map(|&b| b != 0).collect()))
}

fn load_npy_i64(path: &Path) -> TractResult<(Vec<usize>, Vec<i64>)> {
    let mut f = File::open(path)?;
    let (shape, _) = read_npy_header(&mut f)?;
    let mut data = Vec::new();
    f.read_to_end(&mut data)?;
    let vals: Vec<i64> = data
        .chunks_exact(8)
        .map(|c| i64::from_le_bytes(c.try_into().unwrap()))
        .collect();
    Ok((shape, vals))
}

fn max_abs_diff(a: &[f32], b: &[f32]) -> f32 {
    a.iter()
        .zip(b.iter())
        .map(|(x, y)| (x - y).abs())
        .fold(0.0f32, f32::max)
}

fn bench(
    name: &str,
    mut run: impl FnMut() -> TractResult<TVec<TValue>>,
    n_warm: usize,
    n_run: usize,
) -> TractResult<(TVec<TValue>, f64)> {
    for _ in 0..n_warm {
        let _ = run()?;
    }
    let mut times = Vec::new();
    let mut last = None;
    for _ in 0..n_run {
        let t0 = Instant::now();
        let out = run()?;
        times.push(t0.elapsed().as_secs_f64() * 1000.0);
        last = Some(out);
    }
    times.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let med = times[times.len() / 2];
    println!(
        "{name}: median_ms={med:.3} min={:.3} max={:.3}",
        times[0],
        times[times.len() - 1]
    );
    Ok((last.unwrap(), med))
}

fn load_with_facts(
    path: &Path,
    facts: &[(&str, DatumType, &[usize])],
) -> TractResult<TypedRunnableModel<TypedModel>> {
    let mut model = tract_onnx::onnx().model_for_path(path)?;
    for (name, dt, shape) in facts {
        let fact = InferenceFact::dt_shape(*dt, shape.iter().copied());
        // try by name first
        if let Ok(ix) = model.node_id_by_name(name) {
            model.set_input_fact(model.input_outlets()?.iter().position(|o| o.node == ix).unwrap_or(0), fact.clone())?;
        }
    }
    // Also set by input index order
    for (i, (_name, dt, shape)) in facts.iter().enumerate() {
        if i < model.inputs.len() {
            model.set_input_fact(i, InferenceFact::dt_shape(*dt, shape.iter().copied()))?;
        }
    }
    Ok(model.into_optimized()?.into_runnable()?)
}

fn main() -> TractResult<()> {
    let root = Path::new("BENCH_ROOT/static-infer");
    let models = root.join("models");
    let reff = root.join("ref");
    let mut report = serde_json::Map::new();

    // repair
    {
        let model = load_with_facts(
            &models.join("repair.onnx"),
            &[("features", f32::datum_type(), &[32, 219])],
        )?;
        let (shape, data) = load_npy_f32(&reff.join("repair_features.npy"))?;
        let input: TValue = Tensor::from_shape(&shape, &data)?.into();
        let (out, med) = bench("repair", || model.run(tvec!(input.clone())), 3, 50)?;
        let flat: Vec<f32> = out[0].to_array_view::<f32>()?.iter().copied().collect();
        let (_, ref_data) = load_npy_f32(&reff.join("repair_logits.npy"))?;
        let mad = max_abs_diff(&flat, &ref_data);
        println!("repair max_abs_diff={mad:.6e}");
        report.insert(
            "repair".into(),
            serde_json::json!({"ok": true, "latency_ms_median": med, "max_abs_diff": mad}),
        );
    }

    // clusterer with concrete B,T,O
    match (|| -> TractResult<_> {
        let model = load_with_facts(
            &models.join("clusterer.fixed.onnx"),
            &[
                ("line_features", f32::datum_type(), &[1, 64, 22]),
                ("line_pad_mask", bool::datum_type(), &[1, 64]),
                ("object_features", f32::datum_type(), &[1, 8, 22]),
                ("object_pad_mask", bool::datum_type(), &[1, 8]),
            ],
        )?;
        let (s1, d1) = load_npy_f32(&reff.join("clusterer_line_features.npy"))?;
        let (s2, d2) = load_npy_bool(&reff.join("clusterer_line_pad_mask.npy"))?;
        let (s3, d3) = load_npy_f32(&reff.join("clusterer_object_features.npy"))?;
        let (s4, d4) = load_npy_bool(&reff.join("clusterer_object_pad_mask.npy"))?;
        let inputs = tvec!(
            Tensor::from_shape(&s1, &d1)?.into(),
            Tensor::from_shape(&s2, &d2)?.into(),
            Tensor::from_shape(&s3, &d3)?.into(),
            Tensor::from_shape(&s4, &d4)?.into(),
        );
        let (out, med) = bench("clusterer", || model.run(inputs.clone()), 3, 20)?;
        let (_, e_ref) = load_npy_f32(&reff.join("clusterer_emissions.npy"))?;
        let (_, o_ref) = load_npy_f32(&reff.join("clusterer_object_rule_logits.npy"))?;
        let e_out: Vec<f32> = out[0].to_array_view::<f32>()?.iter().copied().collect();
        let o_out: Vec<f32> = out[1].to_array_view::<f32>()?.iter().copied().collect();
        let mad_e = max_abs_diff(&e_out, &e_ref);
        let mad_o = max_abs_diff(&o_out, &o_ref);
        println!("clusterer max_abs_diff emissions={mad_e:.6e} object={mad_o:.6e}");
        Ok(serde_json::json!({"ok": true, "latency_ms_median": med, "max_abs_diff_emissions": mad_e, "max_abs_diff_object": mad_o}))
    })() {
        Ok(v) => {
            report.insert("clusterer".into(), v);
        }
        Err(e) => {
            eprintln!("clusterer FAILED: {e:?}");
            report.insert(
                "clusterer".into(),
                serde_json::json!({"ok": false, "error": format!("{e}")}),
            );
        }
    }

    // classifier
    match (|| -> TractResult<_> {
        let model = load_with_facts(
            &models.join("classifier.fixed.onnx"),
            &[
                ("regular_features", f32::datum_type(), &[1, 48, 196]),
                ("rich_features", f32::datum_type(), &[1, 48, 306]),
                ("hash_slots", i64::datum_type(), &[1, 48, 36]),
                ("char_slots", i64::datum_type(), &[1, 48, 4]),
                ("pad_mask", bool::datum_type(), &[1, 48]),
            ],
        )?;
        let (s1, d1) = load_npy_f32(&reff.join("classifier_regular_features.npy"))?;
        let (s2, d2) = load_npy_f32(&reff.join("classifier_rich_features.npy"))?;
        let (s3, d3) = load_npy_i64(&reff.join("classifier_hash_slots.npy"))?;
        let (s4, d4) = load_npy_i64(&reff.join("classifier_char_slots.npy"))?;
        let (s5, d5) = load_npy_bool(&reff.join("classifier_pad_mask.npy"))?;
        let inputs = tvec!(
            Tensor::from_shape(&s1, &d1)?.into(),
            Tensor::from_shape(&s2, &d2)?.into(),
            Tensor::from_shape(&s3, &d3)?.into(),
            Tensor::from_shape(&s4, &d4)?.into(),
            Tensor::from_shape(&s5, &d5)?.into(),
        );
        let (out, med) = bench("classifier", || model.run(inputs.clone()), 3, 20)?;
        let (_, type_ref) = load_npy_f32(&reff.join("classifier_type_logits.npy"))?;
        let (_, flow_ref) = load_npy_f32(&reff.join("classifier_flow_logits.npy"))?;
        let t_out: Vec<f32> = out[0].to_array_view::<f32>()?.iter().copied().collect();
        let f_out: Vec<f32> = out[1].to_array_view::<f32>()?.iter().copied().collect();
        let mad_t = max_abs_diff(&t_out, &type_ref);
        let mad_f = max_abs_diff(&f_out, &flow_ref);
        println!("classifier max_abs_diff type={mad_t:.6e} flow={mad_f:.6e}");
        Ok(serde_json::json!({"ok": true, "latency_ms_median": med, "max_abs_diff_type": mad_t, "max_abs_diff_flow": mad_f}))
    })() {
        Ok(v) => {
            report.insert("classifier".into(), v);
        }
        Err(e) => {
            eprintln!("classifier FAILED: {e:?}");
            report.insert(
                "classifier".into(),
                serde_json::json!({"ok": false, "error": format!("{e}")}),
            );
        }
    }

    // OCR det with concrete shape
    match (|| -> TractResult<_> {
        let path = models.join("ocr/ch_PP-OCRv5_det_mobile.fixed.onnx");
        let model = load_with_facts(
            &path,
            &[("x", f32::datum_type(), &[1, 3, 320, 320])],
        )?;
        let h = 320usize;
        let w = 320usize;
        let data = vec![0.5f32; 1 * 3 * h * w];
        let input: TValue = Tensor::from_shape(&[1, 3, h, w], &data)?.into();
        let (out, med) = bench("ocr_det_v5_mobile", || model.run(tvec!(input.clone())), 2, 5)?;
        let shape = out[0].shape().to_vec();
        println!("ocr_det output shape={shape:?}");
        Ok(serde_json::json!({"ok": true, "latency_ms_median": med, "out_shape": shape}))
    })() {
        Ok(v) => {
            report.insert("ocr_det_v5_mobile".into(), v);
        }
        Err(e) => {
            eprintln!("ocr_det FAILED: {e:?}");
            report.insert(
                "ocr_det_v5_mobile".into(),
                serde_json::json!({"ok": false, "error": format!("{e}")}),
            );
        }
    }

    // Also try OCR with pulse/declutter alternatives - skip if above fails

    let out_path = root.join("results/tract.json");
    std::fs::create_dir_all(root.join("results"))?;
    std::fs::write(
        &out_path,
        serde_json::to_string_pretty(&serde_json::Value::Object(report))?,
    )?;
    println!("wrote {out_path:?}");
    Ok(())
}
