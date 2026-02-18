#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform float u_hasClick;
uniform vec2 u_clickPos;
uniform float u_clickProgress;
uniform float u_clickRadius;
uniform float u_clickOpacity;
uniform vec4 u_clickColor;

void main() {
  fragColor = vec4(0.0);
  if (u_hasClick < 0.5) return;

  float dist = length(v_uv - u_clickPos);

  float currentRadius = u_clickRadius * mix(0.3, 1.0, u_clickProgress);
  float fade = 1.0 - u_clickProgress;

  float ringWidth = u_clickRadius * 0.08;
  float ring = smoothstep(ringWidth, 0.0, abs(dist - currentRadius));

  float fill = smoothstep(currentRadius, 0.0, dist) * 0.3;

  float alpha = (ring + fill) * fade * u_clickOpacity;
  fragColor = vec4(u_clickColor.rgb, alpha);
}
