#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_cursorIcon;
uniform vec2 u_cursorPos;       // hotspot position in canvas UV
uniform vec2 u_cursorSize;      // (sizePx / canvasWidth, sizePx / canvasHeight)
uniform float u_hasCursorIcon;

void main() {
  fragColor = vec4(0.0);
  if (u_hasCursorIcon < 0.5) return;

  // Convert canvas UV to cursor-local UV.
  // u_cursorSize already accounts for aspect ratio per-axis.
  vec2 localUV = (v_uv - u_cursorPos) / u_cursorSize;

  // Discard pixels outside the cursor quad
  if (localUV.x < 0.0 || localUV.x > 1.0 || localUV.y < 0.0 || localUV.y > 1.0) return;

  fragColor = texture(u_cursorIcon, localUV);
}
