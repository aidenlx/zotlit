use candle_core::{Device, Tensor, DType};
use std::collections::HashMap;
use std::time::Instant;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let model = candle_onnx::read_model("BENCH_ROOT/static-infer/models/repair.onnx")?;
    // Try simple eval
    let device = Device::Cpu;
    // Load features via raw - use zeros for smoke if npy hard
    let features = Tensor::randn(0f32, 1.0, (32, 219), &device)?;
    let mut inputs = HashMap::new();
    inputs.insert("features".to_string(), features);
    let t0 = Instant::now();
    match candle_onnx::simple_eval(&model, inputs) {
        Ok(outs) => {
            println!("candle repair OK in {:?}, outs={:?}", t0.elapsed(), outs.keys().collect::<Vec<_>>());
            for (k,v) in outs { println!("  {k}: {:?}", v.shape()); }
        }
        Err(e) => println!("candle repair FAILED: {e}"),
    }
    // Try clusterer
    let model = candle_onnx::read_model("BENCH_ROOT/static-infer/models/clusterer.onnx")?;
    let mut inputs = HashMap::new();
    inputs.insert("line_features".into(), Tensor::randn(0f32,1.,(1,64,22),&device)?);
    inputs.insert("line_pad_mask".into(), Tensor::zeros((1,64), DType::U8, &device)?);
    inputs.insert("object_features".into(), Tensor::randn(0f32,1.,(1,8,22),&device)?);
    inputs.insert("object_pad_mask".into(), Tensor::zeros((1,8), DType::U8, &device)?);
    match candle_onnx::simple_eval(&model, inputs) {
        Ok(_) => println!("candle clusterer OK"),
        Err(e) => println!("candle clusterer FAILED: {e}"),
    }
    Ok(())
}
