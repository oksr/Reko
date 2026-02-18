#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_camera;
uniform vec2 u_camOrigin;
uniform vec2 u_camSize;
uniform float u_isCircle;
uniform float u_borderWidth;
uniform vec4 u_borderColor;
uniform float u_cameraAspect;
uniform float u_hasCamera;

float circleSDF(vec2 p, vec2 center, float radius) {
  return length(p - center) - radius;
}

float roundedRectSDF(vec2 p, vec2 center, vec2 halfSize, float radius) {
  vec2 d = abs(p - center) - halfSize + radius;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - radius;
}

void main() {
  fragColor = vec4(0.0);
  if (u_hasCamera < 0.5) return;

  vec2 center = u_camOrigin + u_camSize * 0.5;
  float radius = min(u_camSize.x, u_camSize.y) * 0.5;

  float d;
  if (u_isCircle > 0.5) {
    d = circleSDF(v_uv, center, radius);
  } else {
    float cornerR = radius * 0.2;
    d = roundedRectSDF(v_uv, center, u_camSize * 0.5, cornerR);
  }

  float outerD = d;
  float innerD = d + u_borderWidth;
  float borderMask = smoothstep(0.001, -0.001, outerD) * (1.0 - smoothstep(-0.001, 0.001, innerD));
  fragColor = u_borderColor * borderMask;

  if (innerD < 0.001) {
    vec2 localUV = (v_uv - u_camOrigin) / u_camSize;
    float bubbleAspect = u_camSize.x / u_camSize.y;
    if (u_cameraAspect > bubbleAspect) {
      float scale = bubbleAspect / u_cameraAspect;
      localUV.x = 0.5 + (localUV.x - 0.5) / scale;
    } else {
      float scale = u_cameraAspect / bubbleAspect;
      localUV.y = 0.5 + (localUV.y - 0.5) / scale;
    }
    localUV = clamp(localUV, 0.0, 1.0);

    vec4 camColor = texture(u_camera, localUV);
    float mask = smoothstep(0.001, -0.001, innerD);
    fragColor = mix(fragColor, camColor, mask);
  }
}
