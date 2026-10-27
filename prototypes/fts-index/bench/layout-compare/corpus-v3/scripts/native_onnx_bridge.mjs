/**
 * Map pdf-worker nativeONNXRun({model, inputs, outputNames}) → NativeOrt typed methods.
 */
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const ADDON = 'BENCH_ROOT/layout-compare/native-ort/ort_infer.linux-x64-gnu.node';
const MODELS = 'BENCH_ROOT/static-infer/models';

export function createNativeOrtEngine(threads = 1) {
  const { NativeOrt } = require(ADDON);
  return new NativeOrt(threads, {
    clusterer: path.join(MODELS, 'clusterer.onnx'),
    repair: path.join(MODELS, 'repair.onnx'),
    classifier: path.join(MODELS, 'classifier.onnx'),
    doclayout: path.join(MODELS, 'layout/pp_doclayout_s.onnx'),
  });
}

function byName(inputs) {
  const m = {};
  for (const inp of inputs || []) m[inp.name] = inp;
  return m;
}

function f32(inp) {
  return { data: Float32Array.from(inp.values), shape: inp.dims.map(Number) };
}
function boolT(inp) {
  return { data: inp.values.map(Boolean), shape: inp.dims.map(Number) };
}
function i64T(inp) {
  return { data: inp.values.map((v) => Number(v)), shape: inp.dims.map(Number) };
}

function outTensor(type, data, shape) {
  return { type, values: Array.from(data), dims: Array.from(shape) };
}

/**
 * @param {import('...').NativeOrt} eng
 */
export function makeNativeONNXRun(eng) {
  return async function nativeONNXRun({ model, inputs, outputNames }) {
    const name = String(model || '');
    const m = byName(inputs);
    if (name.includes('clusterer/model') || name.endsWith('clusterer.onnx') || name.includes('/clusterer/model')) {
      const r = eng.runClusterer(
        f32(m.line_features),
        boolT(m.line_pad_mask),
        f32(m.object_features),
        boolT(m.object_pad_mask),
      );
      const outputs = {
        emissions: outTensor('float32', r.emissions, r.emissionsShape),
        object_rule_logits: outTensor('float32', r.objectRuleLogits, r.objectShape),
      };
      if (outputNames?.length) {
        const filtered = {};
        for (const n of outputNames) if (outputs[n]) filtered[n] = outputs[n];
        return { outputs: filtered };
      }
      return { outputs };
    }
    if (name.includes('repair')) {
      const r = eng.runRepair(f32(m.features));
      return { outputs: { logits: outTensor('float32', r.logits, [r.logits.length]) } };
    }
    if (name.includes('classifier')) {
      const r = eng.runClassifier(
        f32(m.regular_features),
        f32(m.rich_features),
        i64T(m.hash_slots),
        i64T(m.char_slots),
        boolT(m.pad_mask),
      );
      return {
        outputs: {
          type_logits: outTensor('float32', r.typeLogits, r.typeShape),
          flow_logits: outTensor('float32', r.flowLogits, r.flowShape),
        },
      };
    }
    throw new Error(`nativeONNXRun: unknown model ${name}`);
  };
}
