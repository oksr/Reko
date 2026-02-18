#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_screen;
uniform vec2 u_screenOrigin;
uniform vec2 u_screenSize;
uniform float u_borderRadius;
uniform float u_hasShadow;
uniform float u_shadowIntensity;
uniform vec2 u_canvasSize;
uniform vec2 u_zoomCenter;
uniform float u_zoomScale;

float roundedRectSDF(vec2 p, vec2 center, vec2 halfSize, float radius) {
  vec2 d = abs(p - center) - halfSize + radius;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - radius;
}

void main() {
  fragColor = vec4(0.0);

  vec2 screenCenter = u_screenOrigin + u_screenSize * 0.5;
  vec2 halfSize = u_screenSize * 0.5;
  float radiusNorm = u_borderRadius / u_canvasSize.x;

  if (u_hasShadow > 0.5) {
    float shadowAlphas[3] = float[3](0.10, 0.15, 0.20);
    float shadowOffsetY[3] = float[3](4.0, 12.0, 24.0);
    float shadowBlur[3] = float[3](6.0, 24.0, 48.0);

    for (int i = 0; i < 3; i++) {
      vec2 offset = vec2(0.0, shadowOffsetY[i] / u_canvasSize.y);
      float blur = shadowBlur[i] / u_canvasSize.x;
      float d = roundedRectSDF(v_uv, screenCenter + offset, halfSize, radiusNorm);
      float shadowMask = 1.0 - smoothstep(-blur, blur, d);
      float alpha = shadowMask * shadowAlphas[i] * u_shadowIntensity;
      fragColor = vec4(0.0, 0.0, 0.0, alpha);
    }
  }

  float d = roundedRectSDF(v_uv, screenCenter, halfSize, radiusNorm);
  if (d < 0.5 / u_canvasSize.x) {
    vec2 localUV = (v_uv - u_screenOrigin) / u_screenSize;
    float invScale = 1.0 / u_zoomScale;
    localUV = u_zoomCenter + (localUV - u_zoomCenter) * invScale;
    localUV = clamp(localUV, 0.0, 1.0);

    vec4 screenColor = texture(u_screen, localUV);
    float aa = 1.0 - smoothstep(-0.5 / u_canvasSize.x, 0.5 / u_canvasSize.x, d);
    fragColor = vec4(screenColor.rgb, screenColor.a * aa);
  }
}
