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

void main() {
  if (u_type == 2 && u_hasBgImage > 0.5) {
    fragColor = texture(u_bgImage, v_uv);
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
