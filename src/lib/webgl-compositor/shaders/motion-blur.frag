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
  if (u_intensity < 0.001) {
    fragColor = texture(u_scene, v_uv);
    return;
  }

  vec2 toCenter = v_uv - u_zoomCenter;
  vec2 radialVelocity = toCenter * u_intensity;
  vec2 totalVelocity = u_velocity + radialVelocity;

  vec4 color = vec4(0.0);
  for (int i = 0; i < SAMPLES; i++) {
    float t = float(i) / float(SAMPLES) - 0.5;
    vec2 offset = totalVelocity * t;
    color += texture(u_scene, v_uv + offset);
  }
  fragColor = color / float(SAMPLES);
}
