#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform float u_hasCursor;
uniform vec2 u_cursorPos;
uniform float u_cursorRadius;
uniform float u_isSpotlight;
uniform float u_cursorOpacity;
uniform vec4 u_cursorColor;
uniform vec2 u_cursorVelocity;   // canvas UV per frame, pre-scaled

const int TRAIL_SAMPLES = 8;

void main() {
  fragColor = vec4(0.0);
  if (u_hasCursor < 0.5) return;

  float speed = length(u_cursorVelocity);

  if (speed < 0.001) {
    // --- Static cursor ---
    float dist = length(v_uv - u_cursorPos);
    if (u_isSpotlight > 0.5) {
      float mask = smoothstep(u_cursorRadius * 0.8, u_cursorRadius * 1.2, dist);
      fragColor = vec4(0.0, 0.0, 0.0, mask * u_cursorOpacity * 0.6);
    } else {
      float ring = smoothstep(u_cursorRadius, u_cursorRadius * 0.6, dist);
      float core = smoothstep(u_cursorRadius * 0.3, 0.0, dist);
      float glow = ring * (1.0 - core * 0.5);
      fragColor = vec4(u_cursorColor.rgb, glow * u_cursorOpacity);
    }
  } else {
    // --- Motion trail: sample N positions along negative velocity ---
    // Use max() so the brightest trail sample wins per fragment — avoids
    // the broken weighted-average alpha that div-by-totalWeight would produce
    // (mixing premultiplied color+alpha in a single vec4 division is wrong).
    float bestAlpha = 0.0;
    for (int i = 0; i < TRAIL_SAMPLES; i++) {
      float t = float(i) / float(TRAIL_SAMPLES);   // 0 = current, 1 = oldest trail
      float fade = 1.0 - t * 0.85;                // opacity fades toward tail
      vec2 samplePos = u_cursorPos - u_cursorVelocity * t;
      float dist = length(v_uv - samplePos);

      float alpha;
      if (u_isSpotlight > 0.5) {
        float mask = smoothstep(u_cursorRadius * 0.8, u_cursorRadius * 1.2, dist);
        alpha = mask * 0.6 * fade;
      } else {
        float ring = smoothstep(u_cursorRadius, u_cursorRadius * 0.6, dist);
        float core = smoothstep(u_cursorRadius * 0.3, 0.0, dist);
        alpha = ring * (1.0 - core * 0.5) * fade;
      }

      bestAlpha = max(bestAlpha, alpha);
    }
    fragColor = vec4(u_cursorColor.rgb, bestAlpha * u_cursorOpacity);
  }
}
