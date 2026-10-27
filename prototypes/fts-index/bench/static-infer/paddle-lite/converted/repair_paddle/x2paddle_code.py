import paddle
import math
from x2paddle.op_mapper.onnx2paddle import onnx_custom_layer as x2paddle_nn

class ONNXModel(paddle.nn.Layer):
    def __init__(self):
        super(ONNXModel, self).__init__()
        self.x2paddle_w0 = self.create_parameter(shape=[256, 219], attr='x2paddle_w0', dtype='float32', default_initializer=paddle.nn.initializer.Constant(value=0.0))
        self.x2paddle_b0 = self.create_parameter(shape=[256], attr='x2paddle_b0', dtype='float32', default_initializer=paddle.nn.initializer.Constant(value=0.0))
        self.x2paddle_w1 = self.create_parameter(shape=[128, 256], attr='x2paddle_w1', dtype='float32', default_initializer=paddle.nn.initializer.Constant(value=0.0))
        self.x2paddle_b1 = self.create_parameter(shape=[128], attr='x2paddle_b1', dtype='float32', default_initializer=paddle.nn.initializer.Constant(value=0.0))
        self.x2paddle_w2 = self.create_parameter(shape=[1, 128], attr='x2paddle_w2', dtype='float32', default_initializer=paddle.nn.initializer.Constant(value=0.0))
        self.x2paddle_b2 = self.create_parameter(shape=[1], attr='x2paddle_b2', dtype='float32', default_initializer=paddle.nn.initializer.Constant(value=0.0))
        self.x2paddle_half = self.create_parameter(shape=[1], attr='x2paddle_half', dtype='float32', default_initializer=paddle.nn.initializer.Constant(value=0.0))
        self.x2paddle_one = self.create_parameter(shape=[1], attr='x2paddle_one', dtype='float32', default_initializer=paddle.nn.initializer.Constant(value=0.0))
        self.x2paddle_inv_sqrt2 = self.create_parameter(shape=[1], attr='x2paddle_inv_sqrt2', dtype='float32', default_initializer=paddle.nn.initializer.Constant(value=0.0))

    def forward(self, x2paddle_features):
        x2paddle_w0 = self.x2paddle_w0
        x2paddle_b0 = self.x2paddle_b0
        x2paddle_w1 = self.x2paddle_w1
        x2paddle_b1 = self.x2paddle_b1
        x2paddle_w2 = self.x2paddle_w2
        x2paddle_b2 = self.x2paddle_b2
        x2paddle_half = self.x2paddle_half
        x2paddle_one = self.x2paddle_one
        x2paddle_inv_sqrt2 = self.x2paddle_inv_sqrt2
        x2paddle_h0_mm = paddle.matmul(x=x2paddle_features, y=x2paddle_w0, transpose_y=True)
        x2paddle_h0 = paddle.add(x=x2paddle_h0_mm, y=x2paddle_b0)
        x2paddle_h0_scaled = paddle.multiply(x=x2paddle_h0, y=x2paddle_inv_sqrt2)
        x2paddle_h0_erf = paddle.erf(x=x2paddle_h0_scaled)
        x2paddle_h0_one_plus = paddle.add(x=x2paddle_h0_erf, y=x2paddle_one)
        x2paddle_h0_mul = paddle.multiply(x=x2paddle_h0, y=x2paddle_h0_one_plus)
        x2paddle_h0_gelu = paddle.multiply(x=x2paddle_h0_mul, y=x2paddle_half)
        x2paddle_h1_mm = paddle.matmul(x=x2paddle_h0_gelu, y=x2paddle_w1, transpose_y=True)
        x2paddle_h1 = paddle.add(x=x2paddle_h1_mm, y=x2paddle_b1)
        x2paddle_h1_scaled = paddle.multiply(x=x2paddle_h1, y=x2paddle_inv_sqrt2)
        x2paddle_h1_erf = paddle.erf(x=x2paddle_h1_scaled)
        x2paddle_h1_one_plus = paddle.add(x=x2paddle_h1_erf, y=x2paddle_one)
        x2paddle_h1_mul = paddle.multiply(x=x2paddle_h1, y=x2paddle_h1_one_plus)
        x2paddle_h1_gelu = paddle.multiply(x=x2paddle_h1_mul, y=x2paddle_half)
        x2paddle_logits_2d_mm = paddle.matmul(x=x2paddle_h1_gelu, y=x2paddle_w2, transpose_y=True)
        x2paddle_logits_2d = paddle.add(x=x2paddle_logits_2d_mm, y=x2paddle_b2)
        x2paddle_logits = paddle.squeeze(x=x2paddle_logits_2d, axis=[1])
        return x2paddle_logits

def main(x2paddle_features):
    # There are 1 inputs.
    # x2paddle_features: shape-[-1, 219], type-float32.
    paddle.disable_static()
    params = paddle.load(r'BENCH_ROOT/static-infer/paddle-lite/converted/repair_paddle/model.pdparams')
    model = ONNXModel()
    model.set_dict(params, use_structured_name=True)
    model.eval()
    out = model(x2paddle_features)
    return out
