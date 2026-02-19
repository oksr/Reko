#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform int u_type;
uniform vec4 u_colorFrom;
uniform vec4 u_colorTo;
uniform float u_angleDeg;
uniform sampler2D u_bgImage;
uniform float u_hasBgImage;
uniform vec2 u_blurUv; // blur tap spacing in UV space (blur_px / canvas_size)

void main() {
  if (u_type == 2 && u_hasBgImage > 0.5) {
    if (u_blurUv.x > 0.0001) {
      // 5x5 separable Gaussian blur.
      // Tap spacing = u_blurUv, which equals blur_px / canvas_size.
      // Covers ±2 taps → effective radius = 2 * blur_px.
      // Gaussian 1D weights for taps at -2,-1,0,1,2 (sum = 1.0):
      const float G0 = 0.0625;
      const float G1 = 0.25;
      const float G2 = 0.375;
      float weights[5];
      weights[0] = G0; weights[1] = G1; weights[2] = G2; weights[3] = G1; weights[4] = G0;

      vec4 color = vec4(0.0);
      for (int dx = -2; dx <= 2; dx++) {
        for (int dy = -2; dy <= 2; dy++) {
          vec2 offset = vec2(float(dx) * u_blurUv.x, float(dy) * u_blurUv.y);
          float weight = weights[dx + 2] * weights[dy + 2];
          color += texture(u_bgImage, v_uv + offset) * weight;
        }
      }
      fragColor = color;
    } else {
      fragColor = texture(u_bgImage, v_uv);
    }
  } else if (u_type == 1) {
    float rad = radians(u_angleDeg);
    vec2 dir = vec2(cos(rad), sin(rad));
    float t = dot(v_uv - 0.5, dir) + 0.5;
    t = clamp(t, 0.0, 1.0);
    fragColor = mix(u_colorFrom, u_colorTo, t);
  } else {
    fragColor = u_colorFrom;
  }
}
