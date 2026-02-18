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

void main() {
  fragColor = vec4(0.0);
  if (u_hasCursor < 0.5) return;

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
}
