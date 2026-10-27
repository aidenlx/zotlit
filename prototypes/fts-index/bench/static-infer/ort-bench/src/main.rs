use ort::session::Session;
use ort::value::Tensor;
use std::fs::File;
use std::io::Read;
use std::path::Path;
use std::time::Instant;

fn read_npy_header(f: &mut File) -> (Vec<usize>, String) {
    let mut magic = [0u8; 6];
    f.read_exact(&mut magic).unwrap();
    let mut ver = [0u8; 2];
    f.read_exact(&mut ver).unwrap();
    let header_len = if ver[0] == 1 {
        let mut b = [0u8; 2];
        f.read_exact(&mut b).unwrap();
        u16::from_le_bytes(b) as usize
    } else {
        let mut b = [0u8; 4];
        f.read_exact(&mut b).unwrap();
        u32::from_le_bytes(b) as usize
    };
    let mut header = vec![0u8; header_len];
    f.read_exact(&mut header).unwrap();
    let header_str = String::from_utf8_lossy(&header).to_string();
    let shape_start = header_str.find('(').unwrap() + 1;
    let shape_end = header_str.find(')').unwrap();
    let shape: Vec<usize> = header_str[shape_start..shape_end]
        .split(',')
        .filter_map(|s| { let t = s.trim(); if t.is_empty() { None } else { Some(t.parse().unwrap()) } })
        .collect();
    (shape, header_str)
}
fn load_f32(path: &Path) -> (Vec<usize>, Vec<f32>) {
    let mut f = File::open(path).unwrap();
    let (shape, _) = read_npy_header(&mut f);
    let mut data = Vec::new();
    f.read_to_end(&mut data).unwrap();
    (shape, data.chunks_exact(4).map(|c| f32::from_le_bytes([c[0],c[1],c[2],c[3]])).collect())
}
fn load_bool(path: &Path) -> (Vec<usize>, Vec<bool>) {
    let mut f = File::open(path).unwrap();
    let (shape, _) = read_npy_header(&mut f);
    let mut data = Vec::new();
    f.read_to_end(&mut data).unwrap();
    (shape, data.iter().map(|&b| b != 0).collect())
}
fn load_i64(path: &Path) -> (Vec<usize>, Vec<i64>) {
    let mut f = File::open(path).unwrap();
    let (shape, _) = read_npy_header(&mut f);
    let mut data = Vec::new();
    f.read_to_end(&mut data).unwrap();
    (shape, data.chunks_exact(8).map(|c| i64::from_le_bytes(c.try_into().unwrap())).collect())
}
fn mad(a: &[f32], b: &[f32]) -> f32 {
    a.iter().zip(b.iter()).map(|(x,y)| (x-y).abs()).fold(0.0f32, f32::max)
}

fn main() -> ort::Result<()> {
    let env = ort::init().with_name("ort_bench").build()?;
    let root = Path::new("BENCH_ROOT/static-infer");
    let models = root.join("models");
    let reff = root.join("ref");
    let mut report = serde_json::Map::new();

    {
        let mut session = Session::builder(&env)?.with_intra_threads(1)?.commit_from_file(models.join("repair.onnx"))?;
        let (shape, data) = load_f32(&reff.join("repair_features.npy"));
        let input = Tensor::from_array((shape, data.into_boxed_slice()))?;
        for _ in 0..3 { let _ = session.run(ort::inputs!["features" => &input])?; }
        let mut times = Vec::new();
        for _ in 0..50 {
            let t0 = Instant::now();
            let _ = session.run(ort::inputs!["features" => &input])?;
            times.push(t0.elapsed().as_secs_f64() * 1000.0);
        }
        times.sort_by(|a,b| a.partial_cmp(b).unwrap());
        let med = times[times.len()/2];
        let outs = session.run(ort::inputs!["features" => &input])?;
        let (_s, out_arr) = outs["logits"].try_extract_tensor::<f32>()?;
        let out_vec = out_arr.to_vec();
        let (_, ref_data) = load_f32(&reff.join("repair_logits.npy"));
        let d = mad(&out_vec, &ref_data);
        println!("repair median_ms={med:.3} mad={d:.6e}");
        report.insert("repair".into(), serde_json::json!({"ok":true,"latency_ms_median":med,"max_abs_diff":d}));
    }

    {
        let mut session = Session::builder(&env)?.with_intra_threads(1)?.commit_from_file(models.join("clusterer.onnx"))?;
        let (s1,d1)=load_f32(&reff.join("clusterer_line_features.npy"));
        let (s2,d2)=load_bool(&reff.join("clusterer_line_pad_mask.npy"));
        let (s3,d3)=load_f32(&reff.join("clusterer_object_features.npy"));
        let (s4,d4)=load_bool(&reff.join("clusterer_object_pad_mask.npy"));
        let t1=Tensor::from_array((s1,d1.into_boxed_slice()))?;
        let t2=Tensor::from_array((s2,d2.into_boxed_slice()))?;
        let t3=Tensor::from_array((s3,d3.into_boxed_slice()))?;
        let t4=Tensor::from_array((s4,d4.into_boxed_slice()))?;
        for _ in 0..3 { let _=session.run(ort::inputs!["line_features"=>&t1,"line_pad_mask"=>&t2,"object_features"=>&t3,"object_pad_mask"=>&t4])?; }
        let mut times=Vec::new();
        for _ in 0..20 {
            let t0=Instant::now();
            let _=session.run(ort::inputs!["line_features"=>&t1,"line_pad_mask"=>&t2,"object_features"=>&t3,"object_pad_mask"=>&t4])?;
            times.push(t0.elapsed().as_secs_f64()*1000.0);
        }
        times.sort_by(|a,b| a.partial_cmp(b).unwrap());
        let med=times[times.len()/2];
        let outs=session.run(ort::inputs!["line_features"=>&t1,"line_pad_mask"=>&t2,"object_features"=>&t3,"object_pad_mask"=>&t4])?;
        let (_,e)=outs["emissions"].try_extract_tensor::<f32>()?;
        let (_,o)=outs["object_rule_logits"].try_extract_tensor::<f32>()?;
        let (_,er)=load_f32(&reff.join("clusterer_emissions.npy"));
        let (_,orv)=load_f32(&reff.join("clusterer_object_rule_logits.npy"));
        let de=mad(&e.to_vec(),&er); let dobj=mad(&o.to_vec(),&orv);
        println!("clusterer median_ms={med:.3} mad_e={de:.6e} mad_o={dobj:.6e}");
        report.insert("clusterer".into(), serde_json::json!({"ok":true,"latency_ms_median":med,"max_abs_diff_emissions":de,"max_abs_diff_object":dobj}));
    }

    {
        let mut session = Session::builder(&env)?.with_intra_threads(1)?.commit_from_file(models.join("classifier.onnx"))?;
        let (s1,d1)=load_f32(&reff.join("classifier_regular_features.npy"));
        let (s2,d2)=load_f32(&reff.join("classifier_rich_features.npy"));
        let (s3,d3)=load_i64(&reff.join("classifier_hash_slots.npy"));
        let (s4,d4)=load_i64(&reff.join("classifier_char_slots.npy"));
        let (s5,d5)=load_bool(&reff.join("classifier_pad_mask.npy"));
        let t1=Tensor::from_array((s1,d1.into_boxed_slice()))?;
        let t2=Tensor::from_array((s2,d2.into_boxed_slice()))?;
        let t3=Tensor::from_array((s3,d3.into_boxed_slice()))?;
        let t4=Tensor::from_array((s4,d4.into_boxed_slice()))?;
        let t5=Tensor::from_array((s5,d5.into_boxed_slice()))?;
        for _ in 0..3 { let _=session.run(ort::inputs!["regular_features"=>&t1,"rich_features"=>&t2,"hash_slots"=>&t3,"char_slots"=>&t4,"pad_mask"=>&t5])?; }
        let mut times=Vec::new();
        for _ in 0..20 {
            let t0=Instant::now();
            let _=session.run(ort::inputs!["regular_features"=>&t1,"rich_features"=>&t2,"hash_slots"=>&t3,"char_slots"=>&t4,"pad_mask"=>&t5])?;
            times.push(t0.elapsed().as_secs_f64()*1000.0);
        }
        times.sort_by(|a,b| a.partial_cmp(b).unwrap());
        let med=times[times.len()/2];
        let outs=session.run(ort::inputs!["regular_features"=>&t1,"rich_features"=>&t2,"hash_slots"=>&t3,"char_slots"=>&t4,"pad_mask"=>&t5])?;
        let (_,tv)=outs["type_logits"].try_extract_tensor::<f32>()?;
        let (_,fv)=outs["flow_logits"].try_extract_tensor::<f32>()?;
        let (_,tr)=load_f32(&reff.join("classifier_type_logits.npy"));
        let (_,fr)=load_f32(&reff.join("classifier_flow_logits.npy"));
        let dt=mad(&tv.to_vec(),&tr); let df=mad(&fv.to_vec(),&fr);
        println!("classifier median_ms={med:.3} mad_t={dt:.6e} mad_f={df:.6e}");
        report.insert("classifier".into(), serde_json::json!({"ok":true,"latency_ms_median":med,"max_abs_diff_type":dt,"max_abs_diff_flow":df}));
    }

    {
        let mut session = Session::builder(&env)?.with_intra_threads(1)?.commit_from_file(models.join("ocr/ch_PP-OCRv5_det_mobile.onnx"))?;
        let h=320usize; let w=320usize;
        let data=vec![0.5f32;1*3*h*w];
        let t=Tensor::from_array((vec![1usize,3,h,w], data.into_boxed_slice()))?;
        let in_name=session.inputs()[0].name().to_string();
        for _ in 0..2 { let _=session.run(ort::inputs![&in_name => &t])?; }
        let mut times=Vec::new();
        for _ in 0..5 {
            let t0=Instant::now();
            let _=session.run(ort::inputs![&in_name => &t])?;
            times.push(t0.elapsed().as_secs_f64()*1000.0);
        }
        times.sort_by(|a,b| a.partial_cmp(b).unwrap());
        let med=times[times.len()/2];
        println!("ocr_det median_ms={med:.3}");
        report.insert("ocr_det_v5_mobile".into(), serde_json::json!({"ok":true,"latency_ms_median":med}));
    }

    std::fs::create_dir_all(root.join("results")).ok();
    std::fs::write(root.join("results/ort.json"), serde_json::to_string_pretty(&serde_json::Value::Object(report)).unwrap()).unwrap();
    println!("wrote results/ort.json");
    Ok(())
}
