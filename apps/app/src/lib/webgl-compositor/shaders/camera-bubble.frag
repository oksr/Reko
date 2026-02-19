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
uniform float u_canvasAspect; // canvasWidth / canvasHeight
uniform float u_hasShadow;
uniform float u_shadowIntensity;

// Compute the bubble shape SDF given local UV and pixel aspect
float bubbleSDF(vec2 localUV, float pixelAspect, float isCircle) {
  vec2 centered = localUV - 0.5;
  centered.x *= pixelAspect;

  if (isCircle > 0.5) {
    return length(centered) - 0.5;
  } else {
    vec2 halfSize = vec2(pixelAspect * 0.5, 0.5);
    float cornerR = min(halfSize.x, halfSize.y) * 0.2;
    vec2 q = abs(centered) - halfSize + cornerR;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - cornerR;
  }
}

void main() {
  fragColor = vec4(0.0);
  if (u_hasCamera < 0.5) return;

  float pixelAspect = (u_camSize.x * u_canvasAspect) / u_camSize.y;

  // Shadow pass — extend bounds to allow shadow blur outside the bubble rect
  if (u_hasShadow > 0.5) {
    // Shadow needs a larger area than the bubble rect
    float shadowExpand = 0.06; // extra UV margin for shadow blur
    vec2 expandedOrigin = u_camOrigin - shadowExpand;
    vec2 expandedSize = u_camSize + shadowExpand * 2.0;
    vec2 expandedUV = (v_uv - expandedOrigin) / expandedSize;

    if (expandedUV.x >= 0.0 && expandedUV.x <= 1.0 && expandedUV.y >= 0.0 && expandedUV.y <= 1.0) {
      // Map expanded UV back to bubble-local UV
      // Convert v_uv to local UV relative to bubble origin
      vec2 localForShadow = (v_uv - u_camOrigin) / u_camSize;

      float shadowAlphas[3] = float[3](0.08, 0.12, 0.16);
      float shadowOffsetY[3] = float[3](0.01, 0.025, 0.04);
      float shadowBlur[3] = float[3](0.015, 0.04, 0.07);

      for (int i = 0; i < 3; i++) {
        vec2 offsetUV = localForShadow - vec2(0.0, shadowOffsetY[i]);
        float sd = bubbleSDF(offsetUV, pixelAspect, u_isCircle);
        float shadowMask = 1.0 - smoothstep(-shadowBlur[i], shadowBlur[i], sd);
        float alpha = shadowMask * shadowAlphas[i] * u_shadowIntensity;
        fragColor = vec4(0.0, 0.0, 0.0, clamp(fragColor.a + alpha, 0.0, 0.85));
      }
    }
  }

  // Map to local UV [0,1]x[0,1] within the bubble rect
  vec2 localUV = (v_uv - u_camOrigin) / u_camSize;

  // Early exit if outside the rect (but shadow may already be drawn above)
  if (localUV.x < 0.0 || localUV.x > 1.0 || localUV.y < 0.0 || localUV.y > 1.0) return;

  float d = bubbleSDF(localUV, pixelAspect, u_isCircle);

  // Border width — already in bubble-local UV space (pixels / bubbleSizePx)
  float bw = u_borderWidth;

  // outerMask: 1 inside shape outer edge, 0 outside
  // innerMask: 1 inside shape inner edge (inset by bw), 0 outside
  // Use fwidth for pixel-perfect AA — derives the exact edge transition width
  // from the SDF's screen-space rate of change.
  float aa = fwidth(d);
  float outerMask = smoothstep(aa, -aa, d);
  float innerMask = smoothstep(aa, -aa, d + bw);
  float borderMask = outerMask - innerMask;

  // Draw border
  if (borderMask > 0.0) {
    fragColor = vec4(mix(fragColor.rgb, u_borderColor.rgb, borderMask * u_borderColor.a),
                     max(fragColor.a, borderMask * u_borderColor.a));
  }

  // Draw camera feed inside inner edge
  if (innerMask > 0.0) {
    vec2 camUV = localUV;
    float bubblePixelAspect = pixelAspect;
    if (u_cameraAspect > bubblePixelAspect) {
      float scale = bubblePixelAspect / u_cameraAspect;
      camUV.x = 0.5 + (camUV.x - 0.5) * scale;
    } else {
      float scale = u_cameraAspect / bubblePixelAspect;
      camUV.y = 0.5 + (camUV.y - 0.5) * scale;
    }
    camUV = clamp(camUV, 0.0, 1.0);

    vec4 camColor = texture(u_camera, camUV);
    fragColor = vec4(mix(fragColor.rgb, camColor.rgb, innerMask), mix(fragColor.a, camColor.a, innerMask));
  }
}
