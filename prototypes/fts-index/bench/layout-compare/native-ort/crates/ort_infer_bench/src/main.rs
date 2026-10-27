use ort_infer_core::{load_bool, load_f32, load_i64, rgba_to_nchw, ModelPaths, OrtEngine};
use std::path::PathBuf;
use std::time::Instant;

fn rss_kb() -> u64 {
    let s = std::fs::read_to_string("/proc/self/status").unwrap_or_default();
    for line in s.lines() {
        if let Some(rest) = line.strip_prefix("VmRSS:") {
            return rest.split_whitespace().next().unwrap_or("0").parse().unwrap_or(0);
        }
    }
    0
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let models = PathBuf::from("BENCH_ROOT/static-infer/models");
    let reff = PathBuf::from("BENCH_ROOT/static-infer/ref");
    let out = PathBuf::from("BENCH_ROOT/layout-compare/results");
    std::fs::create_dir_all(&out)?;

    let mut report = serde_json::Map::new();
    report.insert("runtime".into(), serde_json::json!("rust-ort-static"));
    report.insert("ort_crate".into(), serde_json::json!("2.0.0-rc.15"));
    report.insert("rss_kb_start".into(), serde_json::json!(rss_kb()));

    let paths = ModelPaths {
        clusterer: Some(models.join("clusterer.onnx")),
        repair: Some(models.join("repair.onnx")),
        classifier: Some(models.join("classifier.onnx")),
        doclayout: Some(models.join("layout/pp_doclayout_s.onnx")),
    };
    let mut engine = OrtEngine::new(1, paths)?;
    for threads in [1usize, 4] {
        engine.set_threads(threads);
        let key = format!("t{threads}");
        let mut block = serde_json::Map::new();

        // clusterer
        let (timing, de, dobj) = engine.bench_clusterer_from_ref(&reff, 3, 30)?;
        block.insert(
            "clusterer".into(),
            serde_json::json!({
                "timing": timing,
                "max_abs_diff_emissions_vs_ref": de,
                "max_abs_diff_object_vs_ref": dobj,
            }),
        );

        // repair
        {
            let (fs, fd) = load_f32(&reff.join("repair_features.npy"))?;
            let (mut init_slot, init_ms) = {
                // warm via run
                let (_l, _) = engine.run_repair(&fd, [fs[0], fs[1]])?;
                ((), 0.0f64)
            };
            let _ = init_slot;
            let mut times = Vec::new();
            for _ in 0..50 {
                let t0 = Instant::now();
                let _ = engine.run_repair(&fd, [fs[0], fs[1]])?;
                times.push(t0.elapsed().as_secs_f64() * 1000.0);
            }
            times.sort_by(|a, b| a.partial_cmp(b).unwrap());
            let (logits, _) = engine.run_repair(&fd, [fs[0], fs[1]])?;
            let (_, pref) = load_f32(&reff.join("repair_logits.npy"))?;
            let mad = logits
                .iter()
                .zip(pref.iter())
                .map(|(a, b)| (a - b).abs())
                .fold(0.0f32, f32::max);
            block.insert(
                "repair".into(),
                serde_json::json!({
                    "p50_ms": times[times.len()/2],
                    "p95_ms": times[(times.len()*95)/100],
                    "init_ms": init_ms,
                    "max_abs_diff_vs_ref": mad,
                    "threads": threads,
                }),
            );
        }

        // classifier
        {
            let (s1, d1) = load_f32(&reff.join("classifier_regular_features.npy"))?;
            let (s2, d2) = load_f32(&reff.join("classifier_rich_features.npy"))?;
            let (s3, d3) = load_i64(&reff.join("classifier_hash_slots.npy"))?;
            let (s4, d4) = load_i64(&reff.join("classifier_char_slots.npy"))?;
            let (s5, d5) = load_bool(&reff.join("classifier_pad_mask.npy"))?;
            let _ = engine.run_classifier(&d1, s1.clone(), &d2, s2.clone(), &d3, s3.clone(), &d4, s4.clone(), &d5, s5.clone())?;
            let mut times = Vec::new();
            for _ in 0..30 {
                let t0 = Instant::now();
                let _ = engine.run_classifier(&d1, s1.clone(), &d2, s2.clone(), &d3, s3.clone(), &d4, s4.clone(), &d5, s5.clone())?;
                times.push(t0.elapsed().as_secs_f64() * 1000.0);
            }
            times.sort_by(|a, b| a.partial_cmp(b).unwrap());
            let (ty, _, fl, _, _) = engine.run_classifier(&d1, s1, &d2, s2, &d3, s3, &d4, s4, &d5, s5)?;
            let (_, tr) = load_f32(&reff.join("classifier_type_logits.npy"))?;
            let (_, fr) = load_f32(&reff.join("classifier_flow_logits.npy"))?;
            let dt = ty.iter().zip(tr.iter()).map(|(a,b)|(a-b).abs()).fold(0.0f32,f32::max);
            let df = fl.iter().zip(fr.iter()).map(|(a,b)|(a-b).abs()).fold(0.0f32,f32::max);
            block.insert("classifier".into(), serde_json::json!({
                "p50_ms": times[times.len()/2],
                "p95_ms": times[(times.len()*95)/100],
                "max_abs_diff_type_vs_ref": dt,
                "max_abs_diff_flow_vs_ref": df,
                "threads": threads,
            }));
        }

        // doclayout on synthetic + real page if present
        {
            let size = 480usize;
            let rgba = vec![200u8; size * size * 4];
            let t_pre0 = Instant::now();
            let (nchw, shape, scale) = rgba_to_nchw(&rgba, size, size, size);
            let pre_ms = t_pre0.elapsed().as_secs_f64() * 1000.0;
            // cold init
            let t_init = Instant::now();
            let _ = engine.run_doclayout(&nchw, shape, Some(&scale))?;
            let init_ms = t_init.elapsed().as_secs_f64() * 1000.0;
            let mut times = Vec::new();
            for _ in 0..15 {
                let t0 = Instant::now();
                let _ = engine.run_doclayout(&nchw, shape, Some(&scale))?;
                times.push(t0.elapsed().as_secs_f64() * 1000.0);
            }
            times.sort_by(|a, b| a.partial_cmp(b).unwrap());
            block.insert("doclayout_s_synthetic".into(), serde_json::json!({
                "preprocess_ms": pre_ms,
                "init_ms_first_run": init_ms,
                "p50_ms": times[times.len()/2],
                "p95_ms": times[(times.len()*95)/100],
                "threads": threads,
            }));
        }

        // real PNG if exists
        let png = PathBuf::from("BENCH_ROOT/layout-compare/pages/stroke-2col");
        if png.exists() {
            if let Ok(entries) = std::fs::read_dir(&png) {
                for e in entries.flatten() {
                    let p = e.path();
                    if p.extension().and_then(|x| x.to_str()) == Some("png") {
                        // use image crate? avoid dep — skip decode here; JS harness covers real pages
                        let _ = p;
                        break;
                    }
                }
            }
        }

        let sum = block["clusterer"]["timing"]["p50_ms"].as_f64().unwrap_or(0.0)
            + block["repair"]["p50_ms"].as_f64().unwrap_or(0.0)
            + block["classifier"]["p50_ms"].as_f64().unwrap_or(0.0);
        block.insert("block_seg_sum_p50_ms".into(), serde_json::json!(sum));
        block.insert("rss_kb".into(), serde_json::json!(rss_kb()));
        report.insert(key, serde_json::Value::Object(block));
    }

    report.insert("rss_kb_end".into(), serde_json::json!(rss_kb()));
    let exe = std::env::current_exe().ok();
    if let Some(p) = exe {
        report.insert("binary_path".into(), serde_json::json!(p.display().to_string()));
        report.insert("binary_bytes".into(), serde_json::json!(std::fs::metadata(&p).map(|m| m.len()).unwrap_or(0)));
    }
    std::fs::write(out.join("runtime_rust_ort_static.json"), serde_json::to_string_pretty(&serde_json::Value::Object(report))?)?;
    println!("wrote {:?}", out.join("runtime_rust_ort_static.json"));
    Ok(())
}
