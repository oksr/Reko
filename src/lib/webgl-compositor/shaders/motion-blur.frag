#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_scene;
uniform vec2 u_velocity;
uniform float u_intensity;
uniform vec2 u_zoomCenter;

const int SAMPLES = 12;

void main() {
  // FBO textures are stored with Y=0 at the bottom (OpenGL convention),
  // but v_uv has Y=0 at the top (HTML texture convention from the vertex shader).
  // Flip Y so we sample the FBO at the correct row.
  vec2 fboUV = vec2(v_uv.x, 1.0 - v_uv.y);

  // Compute total velocity first — includes both linear pan and radial zoom.
  // Check the combined magnitude so pan-only blur (intensity=0, dx/dy>0) still fires.
  vec2 toCenter = v_uv - u_zoomCenter;
  vec2 radialVelocity = toCenter * u_intensity;
  vec2 totalVelocity = u_velocity + radialVelocity;

  if (length(totalVelocity) < 0.0005) {
    fragColor = texture(u_scene, fboUV);
    return;
  }

  // Gaussian-weighted kernel: full weight at center (t=0), ~5% at extremes (t=±0.5).
  // Produces a smooth, soft falloff instead of the harsh box-blur average.
  vec4 color = vec4(0.0);
  float totalWeight = 0.0;
  for (int i = 0; i < SAMPLES; i++) {
    float t = float(i) / float(SAMPLES) - 0.5;
    float w = exp(-t * t * 8.0);
    vec2 vOffset = totalVelocity * t;
    color += w * texture(u_scene, fboUV + vec2(vOffset.x, -vOffset.y));
    totalWeight += w;
  }
  fragColor = color / totalWeight;
}
