import Foundation
import Metal
import CoreVideo
import CoreGraphics
import simd

// MARK: - ExportError

public enum ExportError: Error, LocalizedError {
    case metalDeviceNotFound
    case commandQueueCreationFailed
    case shaderCompilationFailed(String)
    case pipelineCreationFailed(String)
    case textureCacheCreationFailed
    case pixelBufferPoolCreationFailed
    case pixelBufferCreationFailed
    case textureFromPixelBufferFailed
    case commandBufferCreationFailed
    case renderPassFailed
    case notConfigured
    case videoDecoderFailed(String)
    case invalidProject(String)
    case cancelled
    case writerFailed(String)

    public var errorDescription: String? {
        switch self {
        case .metalDeviceNotFound: return "No Metal device found"
        case .commandQueueCreationFailed: return "Failed to create Metal command queue"
        case .shaderCompilationFailed(let msg): return "Shader compilation failed: \(msg)"
        case .pipelineCreationFailed(let msg): return "Pipeline creation failed: \(msg)"
        case .textureCacheCreationFailed: return "Failed to create CVMetalTextureCache"
        case .pixelBufferPoolCreationFailed: return "Failed to create CVPixelBufferPool"
        case .pixelBufferCreationFailed: return "Failed to create CVPixelBuffer from pool"
        case .textureFromPixelBufferFailed: return "Failed to create Metal texture from pixel buffer"
        case .commandBufferCreationFailed: return "Failed to create command buffer"
        case .renderPassFailed: return "Render pass encoding failed"
        case .notConfigured: return "Compositor not configured — call configure(width:height:) first"
        case .videoDecoderFailed(let msg): return "Video decoder failed: \(msg)"
        case .invalidProject(let msg): return "Invalid project: \(msg)"
        case .cancelled: return "Export cancelled"
        case .writerFailed(let msg): return "Asset writer failed: \(msg)"
        }
    }
}

// MARK: - ExportEffects

public struct CameraEffects {
    public var sizePercent: Double
    public var position: String          // "bottom-right", "bottom-left", "top-right", "top-left"
    public var isCircle: Bool
    public var borderWidth: Double
    public var borderColor: String       // hex, e.g. "#ffffff"

    public init(sizePercent: Double = 15, position: String = "bottom-right",
                isCircle: Bool = true, borderWidth: Double = 3,
                borderColor: String = "#ffffff") {
        self.sizePercent = sizePercent
        self.position = position
        self.isCircle = isCircle
        self.borderWidth = borderWidth
        self.borderColor = borderColor
    }
}

public struct ExportEffects {
    // Background
    public var bgColorFrom: String       // hex
    public var bgColorTo: String         // hex
    public var bgAngleDeg: Double
    public var bgIsSolid: Bool
    public var padding: Double           // percent (0-100)

    // Frame
    public var borderRadius: Double      // pixels
    public var hasShadow: Bool
    public var shadowIntensity: Double   // 0..1

    // Camera
    public var camera: CameraEffects?

    // Cursor
    public var cursorEnabled: Bool
    public var cursorType: String      // "highlight" | "spotlight"
    public var cursorSize: Double      // px
    public var cursorColor: String     // hex
    public var cursorOpacity: Double   // 0-1

    // Click highlight
    public var clickHighlightEnabled: Bool
    public var clickHighlightColor: String    // hex
    public var clickHighlightOpacity: Double  // 0-1
    public var clickHighlightSize: Double     // max ripple radius in px

    public init(bgColorFrom: String = "#1a1a2e", bgColorTo: String = "#16213e",
                bgAngleDeg: Double = 135, bgIsSolid: Bool = false,
                padding: Double = 8, borderRadius: Double = 12,
                hasShadow: Bool = true, shadowIntensity: Double = 0.5,
                camera: CameraEffects? = nil,
                cursorEnabled: Bool = false, cursorType: String = "highlight",
                cursorSize: Double = 40, cursorColor: String = "#ffcc00",
                cursorOpacity: Double = 0.6,
                clickHighlightEnabled: Bool = false,
                clickHighlightColor: String = "#ffffff",
                clickHighlightOpacity: Double = 0.5,
                clickHighlightSize: Double = 30) {
        self.bgColorFrom = bgColorFrom
        self.bgColorTo = bgColorTo
        self.bgAngleDeg = bgAngleDeg
        self.bgIsSolid = bgIsSolid
        self.padding = padding
        self.borderRadius = borderRadius
        self.hasShadow = hasShadow
        self.shadowIntensity = shadowIntensity
        self.camera = camera
        self.cursorEnabled = cursorEnabled
        self.cursorType = cursorType
        self.cursorSize = cursorSize
        self.cursorColor = cursorColor
        self.cursorOpacity = cursorOpacity
        self.clickHighlightEnabled = clickHighlightEnabled
        self.clickHighlightColor = clickHighlightColor
        self.clickHighlightOpacity = clickHighlightOpacity
        self.clickHighlightSize = clickHighlightSize
    }

    /// Convenience initializer that decodes from a loosely-typed dictionary
    /// (used when the project JSON is parsed via JSONSerialization).
    /// Keys must match the Rust serde(rename_all = "camelCase") serialization.
    public init(from dict: [String: Any]) {
        let bg = dict["background"] as? [String: Any] ?? [:]
        let bgType = bg["type"] as? String ?? "gradient"
        self.bgIsSolid = (bgType == "solid")
        if self.bgIsSolid {
            let color = bg["color"] as? String ?? "#000000"
            self.bgColorFrom = color
            self.bgColorTo = color
        } else {
            self.bgColorFrom = bg["gradientFrom"] as? String ?? "#1a1a2e"
            self.bgColorTo = bg["gradientTo"] as? String ?? "#16213e"
        }
        self.bgAngleDeg = bg["gradientAngle"] as? Double ?? 135
        self.padding = bg["padding"] as? Double ?? 8

        let frame = dict["frame"] as? [String: Any] ?? [:]
        self.borderRadius = frame["borderRadius"] as? Double ?? 12
        self.hasShadow = frame["shadow"] as? Bool ?? true
        self.shadowIntensity = frame["shadowIntensity"] as? Double ?? 0.5

        let cam = dict["cameraBubble"] as? [String: Any] ?? [:]
        let camVisible = cam["visible"] as? Bool ?? false
        if camVisible {
            self.camera = CameraEffects(
                sizePercent: cam["size"] as? Double ?? 15,
                position: cam["position"] as? String ?? "bottom-right",
                isCircle: (cam["shape"] as? String ?? "circle") == "circle",
                borderWidth: cam["borderWidth"] as? Double ?? 3,
                borderColor: cam["borderColor"] as? String ?? "#ffffff"
            )
        } else {
            self.camera = nil
        }

        let cur = dict["cursor"] as? [String: Any] ?? [:]
        self.cursorEnabled = cur["enabled"] as? Bool ?? false
        self.cursorType = cur["type"] as? String ?? "highlight"
        self.cursorSize = cur["size"] as? Double ?? 40
        self.cursorColor = cur["color"] as? String ?? "#ffcc00"
        self.cursorOpacity = cur["opacity"] as? Double ?? 0.6

        let click = cur["clickHighlight"] as? [String: Any] ?? [:]
        self.clickHighlightEnabled = click["enabled"] as? Bool ?? false
        self.clickHighlightColor = click["color"] as? String ?? "#ffffff"
        self.clickHighlightOpacity = click["opacity"] as? Double ?? 0.5
        self.clickHighlightSize = click["size"] as? Double ?? 30
    }
}

// MARK: - LayoutMath

/// Pure layout math functions — no Metal dependency, easily testable.
public enum LayoutMath {

    /// Map a resolution string to concrete pixel dimensions.
    /// Preserves the recording's aspect ratio — width is scaled proportionally to height.
    /// Dimensions are rounded to even numbers for H.264 compatibility.
    public static func outputSize(resolution: String, recordingWidth: Int, recordingHeight: Int) -> (width: Int, height: Int) {
        guard recordingHeight > 0 else { return (width: recordingWidth, height: recordingHeight) }
        switch resolution {
        case "4k":
            let w = Int(round(2160.0 * Double(recordingWidth) / Double(recordingHeight)))
            return (width: w & ~1, height: 2160)
        case "1080p":
            let w = Int(round(1080.0 * Double(recordingWidth) / Double(recordingHeight)))
            return (width: w & ~1, height: 1080)
        case "720p":
            let w = Int(round(720.0 * Double(recordingWidth) / Double(recordingHeight)))
            return (width: w & ~1, height: 720)
        default:
            return (width: recordingWidth, height: recordingHeight)
        }
    }

    /// Compute the screen content rect inside the canvas, honoring padding and
    /// aspect-ratio–preserving fit.  Padding percentage follows the CSS convention
    /// where `padding: N%` is N% of the *width* of the containing element applied
    /// uniformly on all four sides.
    public static func screenRect(
        canvasWidth: Double, canvasHeight: Double,
        screenWidth: Double, screenHeight: Double,
        paddingPercent: Double
    ) -> CGRect {
        let pad = canvasWidth * paddingPercent / 100.0
        let innerW = canvasWidth  - 2.0 * pad
        let innerH = canvasHeight - 2.0 * pad

        guard innerW > 0 && innerH > 0 && screenWidth > 0 && screenHeight > 0 else {
            return .zero
        }

        let screenAspect = screenWidth / screenHeight
        let innerAspect  = innerW / innerH

        let fitW: Double
        let fitH: Double
        if screenAspect > innerAspect {
            // Width-limited
            fitW = innerW
            fitH = innerW / screenAspect
        } else {
            // Height-limited
            fitH = innerH
            fitW = innerH * screenAspect
        }

        let x = (canvasWidth  - fitW) / 2.0
        let y = (canvasHeight - fitH) / 2.0
        return CGRect(x: x, y: y, width: fitW, height: fitH)
    }

    /// Compute the top-left origin of the camera bubble.
    /// Uses a 4% margin and sizes the bubble as `sizePercent`% of canvas width (square).
    public static func cameraOrigin(
        canvasWidth: Double, canvasHeight: Double,
        sizePercent: Double, position: String
    ) -> CGPoint {
        let margin = canvasWidth * 0.04
        let size   = canvasWidth * sizePercent / 100.0

        let x: Double
        let y: Double
        switch position {
        case "bottom-right":
            x = canvasWidth  - margin - size
            y = canvasHeight - margin - size
        case "bottom-left":
            x = margin
            y = canvasHeight - margin - size
        case "top-right":
            x = canvasWidth - margin - size
            y = margin
        case "top-left":
            x = margin
            y = margin
        default:
            x = canvasWidth  - margin - size
            y = canvasHeight - margin - size
        }
        return CGPoint(x: x, y: y)
    }
}

// MARK: - CompositeUniforms

/// Must match the Metal-side `CompositeUniforms` struct exactly — 16-byte aligned fields.
struct CompositeUniforms {
    // Background gradient
    var bgColorFrom: SIMD4<Float>       // 16
    var bgColorTo: SIMD4<Float>         // 16
    var bgAngleRad: Float               // 4
    var bgIsSolid: Float                // 4  (0 or 1)

    // Screen rect (normalised 0..1)
    var screenOriginX: Float            // 4
    var screenOriginY: Float            // 4
    var screenSizeW: Float              // 4
    var screenSizeH: Float              // 4

    // Frame
    var borderRadius: Float             // 4
    var hasShadow: Float                // 4  (0 or 1)
    var shadowIntensity: Float          // 4

    // Camera
    var hasCamera: Float                // 4  (0 or 1)
    var cameraOriginX: Float            // 4
    var cameraOriginY: Float            // 4
    var cameraSizeW: Float              // 4
    var cameraSizeH: Float              // 4
    var cameraIsCircle: Float           // 4  (0 or 1)
    var cameraBorderWidth: Float        // 4  (normalised)
    var cameraBorderColor: SIMD4<Float> // 16

    // Canvas dimensions (pixels)
    var canvasWidth: Float              // 4
    var canvasHeight: Float             // 4
    var cameraAspect: Float = 1.0      // 4  camera texture width/height (for object-cover)
    var _pad1: Float = 0               // 4

    // Zoom
    var zoomCenterX: Float = 0.5       // 4  (normalised 0..1)
    var zoomCenterY: Float = 0.5       // 4
    var zoomScale: Float = 1.0         // 4  (1.0 = no zoom)
    var _pad2: Float = 0               // 4

    // Cursor
    var hasCursor: Float = 0           // 4  (0 or 1)
    var cursorX: Float = 0             // 4  (normalised 0..1)
    var cursorY: Float = 0             // 4
    var cursorRadius: Float = 0        // 4  (pixels)
    var cursorIsSpotlight: Float = 0   // 4  (0=highlight, 1=spotlight)
    var cursorOpacity: Float = 0       // 4
    var _pad3: SIMD2<Float> = .zero    // 8
    var cursorColor: SIMD4<Float> = .zero // 16

    // Click highlight
    var hasClick: Float = 0            // 4  (0 or 1)
    var clickX: Float = 0             // 4  (normalised 0..1 within screen)
    var clickY: Float = 0             // 4
    var clickProgress: Float = 0      // 4  (0 = just clicked → 1 = fully faded)
    var clickRadius: Float = 0        // 4  (pixels)
    var clickOpacity: Float = 0       // 4
    var _padClick: SIMD2<Float> = .zero // 8
    var clickColor: SIMD4<Float> = .zero // 16
}

// MARK: - Embedded Metal Shader Source

private let metalShaderSource = """
#include <metal_stdlib>
using namespace metal;

struct CompositeUniforms {
    float4 bgColorFrom;
    float4 bgColorTo;
    float  bgAngleRad;
    float  bgIsSolid;

    float  screenOriginX;
    float  screenOriginY;
    float  screenSizeW;
    float  screenSizeH;

    float  borderRadius;
    float  hasShadow;
    float  shadowIntensity;

    float  hasCamera;
    float  cameraOriginX;
    float  cameraOriginY;
    float  cameraSizeW;
    float  cameraSizeH;
    float  cameraIsCircle;
    float  cameraBorderWidth;
    float4 cameraBorderColor;

    float  canvasWidth;
    float  canvasHeight;
    float  cameraAspect;    // camera texture width/height
    float  _pad1;

    // Zoom
    float  zoomCenterX;
    float  zoomCenterY;
    float  zoomScale;
    float  _pad2;

    // Cursor
    float  hasCursor;
    float  cursorX;
    float  cursorY;
    float  cursorRadius;
    float  cursorIsSpotlight;
    float  cursorOpacity;
    float2 _pad3;
    float4 cursorColor;

    // Click highlight
    float  hasClick;
    float  clickX;
    float  clickY;
    float  clickProgress;
    float  clickRadius;
    float  clickOpacity;
    float2 _padClick;
    float4 clickColor;
};

struct VertexOut {
    float4 position [[position]];
    float2 uv;
};

// Fullscreen triangle — 3 vertices, no vertex buffer needed.
vertex VertexOut composite_vertex(uint vid [[vertex_id]]) {
    VertexOut out;
    // Generates a triangle that covers the full clip space:
    //   vid 0 -> (-1, -1)   vid 1 -> ( 3, -1)   vid 2 -> (-1,  3)
    float2 pos = float2((vid << 1) & 2, vid & 2);
    out.position = float4(pos * 2.0 - 1.0, 0.0, 1.0);
    // UV: top-left = (0,0), bottom-right = (1,1)
    out.uv = float2(pos.x, 1.0 - pos.y);
    return out;
}

// --- SDF helpers ---

float roundedRectSDF(float2 p, float2 center, float2 halfSize, float radius) {
    float2 d = abs(p - center) - halfSize + radius;
    return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - radius;
}

float circleSDF(float2 p, float2 center, float radius) {
    return length(p - center) - radius;
}

// --- Fragment shader ---

fragment float4 composite_fragment(
    VertexOut in [[stage_in]],
    texture2d<float> screenTex [[texture(0)]],
    texture2d<float> cameraTex [[texture(1)]],
    constant CompositeUniforms &u [[buffer(0)]]
) {
    constexpr sampler texSampler(mag_filter::linear, min_filter::linear, address::clamp_to_edge);

    float2 uv = in.uv;                       // 0..1 in canvas space
    float2 px = uv * float2(u.canvasWidth, u.canvasHeight); // pixel coords

    // ---- Layer 1: Background ----
    float4 color;
    if (u.bgIsSolid > 0.5) {
        color = u.bgColorFrom;
    } else {
        float2 dir = float2(sin(u.bgAngleRad), -cos(u.bgAngleRad));
        float t = saturate(dot(uv - 0.5, dir) + 0.5);
        color = mix(u.bgColorFrom, u.bgColorTo, t);
    }

    // Screen rect in pixels
    float2 scrOrigin = float2(u.screenOriginX, u.screenOriginY) * float2(u.canvasWidth, u.canvasHeight);
    float2 scrSize   = float2(u.screenSizeW, u.screenSizeH) * float2(u.canvasWidth, u.canvasHeight);
    float2 scrCenter = scrOrigin + scrSize * 0.5;
    float2 scrHalf   = scrSize * 0.5;
    float  scrRadius = u.borderRadius;

    // ---- Layer 2: Shadow (SDF-based, 3-layer) ----
    if (u.hasShadow > 0.5) {
        float intensity = u.shadowIntensity;

        // Layer 1: y+4, blur 6
        {
            float2 c = scrCenter + float2(0.0, 4.0);
            float d = roundedRectSDF(px, c, scrHalf, scrRadius);
            float a = 1.0 - smoothstep(-6.0, 6.0, d);
            color = mix(color, float4(0,0,0,1), a * intensity * 0.10);
        }
        // Layer 2: y+12, blur 24
        {
            float2 c = scrCenter + float2(0.0, 12.0);
            float d = roundedRectSDF(px, c, scrHalf, scrRadius);
            float a = 1.0 - smoothstep(-24.0, 24.0, d);
            color = mix(color, float4(0,0,0,1), a * intensity * 0.15);
        }
        // Layer 3: y+24, blur 48
        {
            float2 c = scrCenter + float2(0.0, 24.0);
            float d = roundedRectSDF(px, c, scrHalf, scrRadius);
            float a = 1.0 - smoothstep(-48.0, 48.0, d);
            color = mix(color, float4(0,0,0,1), a * intensity * 0.20);
        }
    }

    // ---- Layer 3: Screen content (rounded corners via SDF, with zoom crop) ----
    {
        float d = roundedRectSDF(px, scrCenter, scrHalf, scrRadius);
        if (d < 0.5) {
            // Map pixel to screen texture UV
            float2 scrUV = (px - scrOrigin) / scrSize;

            // Apply zoom crop: zoom into (zoomCenterX, zoomCenterY) by zoomScale
            if (u.zoomScale > 1.001) {
                float invScale = 1.0 / u.zoomScale;
                float2 zoomCenter = float2(u.zoomCenterX, u.zoomCenterY);
                scrUV = zoomCenter + (scrUV - zoomCenter) * invScale;
            }

            scrUV = saturate(scrUV);
            float4 scrColor = screenTex.sample(texSampler, scrUV);
            float aa = 1.0 - smoothstep(-0.5, 0.5, d);
            color = mix(color, scrColor, aa);
        }
    }

    // ---- Layer 4: Camera bubble ----
    if (u.hasCamera > 0.5) {
        float2 camOrigin = float2(u.cameraOriginX, u.cameraOriginY) * float2(u.canvasWidth, u.canvasHeight);
        float2 camSize   = float2(u.cameraSizeW, u.cameraSizeH) * float2(u.canvasWidth, u.canvasHeight);
        float2 camCenter = camOrigin + camSize * 0.5;
        float  camRadius = u.cameraIsCircle > 0.5 ? camSize.x * 0.5 : 16.0;

        float d;
        if (u.cameraIsCircle > 0.5) {
            d = circleSDF(px, camCenter, camSize.x * 0.5);
        } else {
            d = roundedRectSDF(px, camCenter, camSize * 0.5, camRadius);
        }

        float borderPx = u.cameraBorderWidth * u.canvasWidth;
        float borderD  = d + borderPx;

        // Border ring
        if (borderD < 0.5 && d >= -0.5) {
            float aa = 1.0 - smoothstep(-0.5, 0.5, d);
            float borderAA = 1.0 - smoothstep(-0.5, 0.5, borderD);
            float ring = borderAA * (1.0 - aa);
            color = mix(color, u.cameraBorderColor, ring);
        }

        // Camera content (object-cover: center-crop to fill square bubble)
        if (d < 0.5) {
            float2 camUV = (px - camOrigin) / camSize;
            // Adjust UV for object-cover (center-crop the camera texture)
            float a = u.cameraAspect;
            if (a > 1.0) {
                // Camera wider than bubble — crop sides, fit by height
                camUV.x = camUV.x / a + (a - 1.0) / (2.0 * a);
            } else if (a < 1.0) {
                // Camera taller than bubble — crop top/bottom, fit by width
                camUV.y = camUV.y * a + (1.0 - a) / 2.0;
            }
            camUV = saturate(camUV);
            float4 camColor = cameraTex.sample(texSampler, camUV);
            float aa = 1.0 - smoothstep(-0.5, 0.5, d);
            color = mix(color, camColor, aa);
        }
    }

    // ---- Layer 5: Cursor effect ----
    if (u.hasCursor > 0.5) {
        // Cursor position in pixel space (relative to screen rect)
        float2 cursorPx = scrOrigin + float2(u.cursorX, u.cursorY) * scrSize;

        // Apply same zoom transform as screen content
        if (u.zoomScale > 1.001) {
            float2 zoomCenter = scrOrigin + float2(u.zoomCenterX, u.zoomCenterY) * scrSize;
            cursorPx = zoomCenter + (cursorPx - zoomCenter) * u.zoomScale;
        }

        float dist = length(px - cursorPx);

        if (u.cursorIsSpotlight > 0.5) {
            // Spotlight: darken everything except around cursor
            float spotlightMask = smoothstep(u.cursorRadius * 0.8, u.cursorRadius * 1.2, dist);
            color = mix(color, color * (1.0 - u.cursorOpacity), spotlightMask);
        } else {
            // Highlight: bright ring/glow around cursor
            float ring = 1.0 - smoothstep(u.cursorRadius * 0.6, u.cursorRadius, dist);
            color = mix(color, u.cursorColor, ring * u.cursorOpacity);
        }
    }

    // ---- Layer 6: Click highlight ----
    // Matches preview: expanding circle with border + radial-gradient fill.
    // clickRadius is pre-scaled to export canvas pixels in Swift.
    if (u.hasClick > 0.5) {
        float2 clickPx = scrOrigin + float2(u.clickX, u.clickY) * scrSize;

        if (u.zoomScale > 1.001) {
            float2 zoomCenter = scrOrigin + float2(u.zoomCenterX, u.zoomCenterY) * scrSize;
            clickPx = zoomCenter + (clickPx - zoomCenter) * u.zoomScale;
        }

        float clickDist = length(px - clickPx);
        float fade = 1.0 - u.clickProgress;

        // Scale 0.3 → 1.0 over animation (matches preview)
        float currentRadius = u.clickRadius * (0.3 + u.clickProgress * 0.7);

        // Border width scales with radius (preview 2px CSS ≈ retina-scaled)
        float borderWidth = max(u.clickRadius * 0.07, 2.0);

        // Border ring
        float outerEdge = 1.0 - smoothstep(currentRadius - 0.5, currentRadius + 0.5, clickDist);
        float innerEdge = 1.0 - smoothstep(currentRadius - borderWidth - 0.5, currentRadius - borderWidth + 0.5, clickDist);
        float ring = outerEdge - innerEdge;

        // Radial gradient fill (center → transparent at 70% radius)
        float fillMask = 1.0 - smoothstep(0.0, currentRadius * 0.7, clickDist);
        float fillAlpha = fillMask * 0.3;

        float alpha = max(ring, fillAlpha * outerEdge) * u.clickOpacity * fade;
        color = mix(color, u.clickColor, saturate(alpha));
    }

    return color;
}
"""

// MARK: - parseHexColor

/// Parse a CSS hex color string (e.g. "#1a1a2e" or "#fff") into a normalised SIMD4<Float>.
private func parseHexColor(_ hex: String) -> SIMD4<Float> {
    var h = hex.trimmingCharacters(in: .whitespacesAndNewlines)
    if h.hasPrefix("#") { h.removeFirst() }

    // Expand shorthand (#abc → #aabbcc)
    if h.count == 3 {
        h = h.map { "\($0)\($0)" }.joined()
    }

    guard h.count == 6, let val = UInt32(h, radix: 16) else {
        return SIMD4<Float>(0, 0, 0, 1)
    }

    let r = Float((val >> 16) & 0xFF) / 255.0
    let g = Float((val >>  8) & 0xFF) / 255.0
    let b = Float( val        & 0xFF) / 255.0
    return SIMD4<Float>(r, g, b, 1.0)
}

// MARK: - MetalCompositor

public final class MetalCompositor {
    private let device: MTLDevice
    private let commandQueue: MTLCommandQueue
    private let pipelineState: MTLRenderPipelineState
    private var textureCache: CVMetalTextureCache?

    // Output buffer pool — created by configure()
    private var outputPool: CVPixelBufferPool?
    private var outputWidth: Int = 0
    private var outputHeight: Int = 0

    public init() throws {
        guard let device = MTLCreateSystemDefaultDevice() else {
            throw ExportError.metalDeviceNotFound
        }
        self.device = device

        guard let queue = device.makeCommandQueue() else {
            throw ExportError.commandQueueCreationFailed
        }
        self.commandQueue = queue

        // Compile shaders from embedded source
        let library: MTLLibrary
        do {
            library = try device.makeLibrary(source: metalShaderSource, options: nil)
        } catch {
            throw ExportError.shaderCompilationFailed(error.localizedDescription)
        }

        guard let vertexFn   = library.makeFunction(name: "composite_vertex"),
              let fragmentFn = library.makeFunction(name: "composite_fragment") else {
            throw ExportError.shaderCompilationFailed("Could not find vertex/fragment functions")
        }

        let pipelineDesc = MTLRenderPipelineDescriptor()
        pipelineDesc.vertexFunction   = vertexFn
        pipelineDesc.fragmentFunction = fragmentFn
        pipelineDesc.colorAttachments[0].pixelFormat = .bgra8Unorm

        do {
            self.pipelineState = try device.makeRenderPipelineState(descriptor: pipelineDesc)
        } catch {
            throw ExportError.pipelineCreationFailed(error.localizedDescription)
        }

        // Texture cache for CVPixelBuffer → MTLTexture
        var cache: CVMetalTextureCache?
        let status = CVMetalTextureCacheCreate(kCFAllocatorDefault, nil, device, nil, &cache)
        guard status == kCVReturnSuccess, let cache = cache else {
            throw ExportError.textureCacheCreationFailed
        }
        self.textureCache = cache
    }

    /// Set up the output dimensions and pixel buffer pool.
    /// Call this once before rendering frames.
    public func configure(width: Int, height: Int) throws {
        self.outputWidth  = width
        self.outputHeight = height

        let poolAttrs: [String: Any] = [
            kCVPixelBufferPoolMinimumBufferCountKey as String: 3,
        ]
        let bufferAttrs: [String: Any] = [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
            kCVPixelBufferWidthKey as String: width,
            kCVPixelBufferHeightKey as String: height,
            kCVPixelBufferMetalCompatibilityKey as String: true,
            kCVPixelBufferIOSurfacePropertiesKey as String: [:] as [String: Any],
        ]

        var pool: CVPixelBufferPool?
        let status = CVPixelBufferPoolCreate(
            kCFAllocatorDefault,
            poolAttrs as CFDictionary,
            bufferAttrs as CFDictionary,
            &pool
        )
        guard status == kCVReturnSuccess, let pool = pool else {
            throw ExportError.pixelBufferPoolCreationFailed
        }
        self.outputPool = pool
    }

    /// Render one composited frame and return the result as a CVPixelBuffer.
    ///
    /// - Parameters:
    ///   - screenPixelBuffer: The decoded screen recording frame (BGRA).
    ///   - cameraPixelBuffer: Optional decoded camera frame (BGRA).
    ///   - effects: Visual effects configuration.
    ///   - screenWidth: Native width of the screen recording.
    ///   - screenHeight: Native height of the screen recording.
    /// - Returns: A new CVPixelBuffer containing the composited frame.
    public func renderFrame(
        screenPixelBuffer: CVPixelBuffer,
        cameraPixelBuffer: CVPixelBuffer?,
        effects: ExportEffects,
        screenWidth: Int,
        screenHeight: Int,
        zoomX: Double = 0.5,
        zoomY: Double = 0.5,
        zoomScale: Double = 1.0,
        cursorX: Double? = nil,
        cursorY: Double? = nil,
        clickX: Double? = nil,
        clickY: Double? = nil,
        clickProgress: Double = 0.0
    ) throws -> CVPixelBuffer {
        guard let pool = outputPool else { throw ExportError.notConfigured }

        let canvasW = Double(outputWidth)
        let canvasH = Double(outputHeight)

        // --- Layout ---
        let scrRect = LayoutMath.screenRect(
            canvasWidth: canvasW, canvasHeight: canvasH,
            screenWidth: Double(screenWidth), screenHeight: Double(screenHeight),
            paddingPercent: effects.padding
        )

        // --- Uniforms ---
        var uniforms = CompositeUniforms(
            bgColorFrom: parseHexColor(effects.bgColorFrom),
            bgColorTo:   parseHexColor(effects.bgColorTo),
            bgAngleRad:  Float(effects.bgAngleDeg * .pi / 180.0),
            bgIsSolid:   effects.bgIsSolid ? 1.0 : 0.0,

            screenOriginX: Float(scrRect.origin.x    / canvasW),
            screenOriginY: Float(scrRect.origin.y    / canvasH),
            screenSizeW:   Float(scrRect.size.width  / canvasW),
            screenSizeH:   Float(scrRect.size.height / canvasH),

            borderRadius:   Float(effects.borderRadius),
            hasShadow:      effects.hasShadow ? 1.0 : 0.0,
            shadowIntensity: Float(effects.shadowIntensity),

            hasCamera:      0.0,
            cameraOriginX:  0.0,
            cameraOriginY:  0.0,
            cameraSizeW:    0.0,
            cameraSizeH:    0.0,
            cameraIsCircle: 0.0,
            cameraBorderWidth: 0.0,
            cameraBorderColor: SIMD4<Float>(1, 1, 1, 1),

            canvasWidth:  Float(canvasW),
            canvasHeight: Float(canvasH)
        )

        if let cam = effects.camera, let camBuf = cameraPixelBuffer {
            let camOrigin = LayoutMath.cameraOrigin(
                canvasWidth: canvasW, canvasHeight: canvasH,
                sizePercent: cam.sizePercent, position: cam.position
            )
            let camSizePx = canvasW * cam.sizePercent / 100.0

            uniforms.hasCamera      = 1.0
            uniforms.cameraOriginX  = Float(camOrigin.x / canvasW)
            uniforms.cameraOriginY  = Float(camOrigin.y / canvasH)
            uniforms.cameraSizeW    = Float(camSizePx / canvasW)
            uniforms.cameraSizeH    = Float(camSizePx / canvasH)
            uniforms.cameraIsCircle = cam.isCircle ? 1.0 : 0.0
            uniforms.cameraBorderWidth = Float(cam.borderWidth / canvasW)
            uniforms.cameraBorderColor = parseHexColor(cam.borderColor)

            // Camera texture aspect ratio for object-cover center-cropping
            let camTexW = CVPixelBufferGetWidth(camBuf)
            let camTexH = CVPixelBufferGetHeight(camBuf)
            uniforms.cameraAspect = Float(camTexW) / max(Float(camTexH), 1.0)
        }

        // --- Zoom ---
        uniforms.zoomCenterX = Float(zoomX)
        uniforms.zoomCenterY = Float(zoomY)
        uniforms.zoomScale = Float(zoomScale)

        // --- Cursor ---
        if effects.cursorEnabled, let cx = cursorX, let cy = cursorY {
            uniforms.hasCursor = 1.0
            uniforms.cursorX = Float(cx)
            uniforms.cursorY = Float(cy)
            uniforms.cursorRadius = Float(effects.cursorSize)
            uniforms.cursorIsSpotlight = effects.cursorType == "spotlight" ? 1.0 : 0.0
            uniforms.cursorOpacity = Float(effects.cursorOpacity)
            uniforms.cursorColor = parseHexColor(effects.cursorColor)
        }

        // --- Click highlight ---
        // In the preview, `size` is CSS px inside the video element.
        // The video fills the frame, so size is relative to the displayed video.
        // We express the radius as a fraction of screen-rect width and resolve
        // to canvas pixels in the shader via scrSize.
        // Preview video display width ≈ 640px (typical editor preview).
        // `size / 640` gives the normalised fraction of screen width.
        if effects.clickHighlightEnabled, let cx = clickX, let cy = clickY {
            uniforms.hasClick = 1.0
            uniforms.clickX = Float(cx)
            uniforms.clickY = Float(cy)
            uniforms.clickProgress = Float(clickProgress)
            // Scale: size is in preview-CSS-px; convert to export canvas px
            let scaledRadius = effects.clickHighlightSize * scrRect.size.width / 640.0
            uniforms.clickRadius = Float(scaledRadius)
            uniforms.clickOpacity = Float(effects.clickHighlightOpacity)
            uniforms.clickColor = parseHexColor(effects.clickHighlightColor)
        }

        // --- Textures ---
        let screenTex = try metalTexture(from: screenPixelBuffer)

        // Use a 1x1 transparent texture as placeholder when no camera
        let cameraTex: MTLTexture
        if let camBuf = cameraPixelBuffer {
            cameraTex = try metalTexture(from: camBuf)
        } else {
            cameraTex = try makePlaceholderTexture()
        }

        // --- Output pixel buffer ---
        var outputBuffer: CVPixelBuffer?
        let status = CVPixelBufferPoolCreatePixelBuffer(kCFAllocatorDefault, pool, &outputBuffer)
        guard status == kCVReturnSuccess, let output = outputBuffer else {
            throw ExportError.pixelBufferCreationFailed
        }

        let outputTex = try metalTexture(from: output)

        // --- Render ---
        guard let cmdBuffer = commandQueue.makeCommandBuffer() else {
            throw ExportError.commandBufferCreationFailed
        }

        let passDesc = MTLRenderPassDescriptor()
        passDesc.colorAttachments[0].texture     = outputTex
        passDesc.colorAttachments[0].loadAction  = .clear
        passDesc.colorAttachments[0].storeAction = .store
        passDesc.colorAttachments[0].clearColor  = MTLClearColor(red: 0, green: 0, blue: 0, alpha: 1)

        guard let encoder = cmdBuffer.makeRenderCommandEncoder(descriptor: passDesc) else {
            throw ExportError.renderPassFailed
        }

        encoder.setRenderPipelineState(pipelineState)
        encoder.setFragmentBytes(&uniforms, length: MemoryLayout<CompositeUniforms>.stride, index: 0)
        encoder.setFragmentTexture(screenTex, index: 0)
        encoder.setFragmentTexture(cameraTex, index: 1)
        encoder.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 3)
        encoder.endEncoding()

        cmdBuffer.commit()
        cmdBuffer.waitUntilCompleted()

        return output
    }

    // MARK: - Private Helpers

    /// Convert a CVPixelBuffer to an MTLTexture via the texture cache.
    private func metalTexture(from pixelBuffer: CVPixelBuffer) throws -> MTLTexture {
        guard let cache = textureCache else {
            throw ExportError.textureCacheCreationFailed
        }

        let width  = CVPixelBufferGetWidth(pixelBuffer)
        let height = CVPixelBufferGetHeight(pixelBuffer)

        var cvTexture: CVMetalTexture?
        let status = CVMetalTextureCacheCreateTextureFromImage(
            kCFAllocatorDefault,
            cache,
            pixelBuffer,
            nil,
            .bgra8Unorm,
            width,
            height,
            0,
            &cvTexture
        )
        guard status == kCVReturnSuccess, let cvTex = cvTexture,
              let texture = CVMetalTextureGetTexture(cvTex) else {
            throw ExportError.textureFromPixelBufferFailed
        }
        return texture
    }

    /// Create a tiny 1x1 transparent texture to bind when no camera is present.
    private func makePlaceholderTexture() throws -> MTLTexture {
        let desc = MTLTextureDescriptor.texture2DDescriptor(
            pixelFormat: .bgra8Unorm, width: 1, height: 1, mipmapped: false
        )
        desc.usage = [.shaderRead]
        guard let tex = device.makeTexture(descriptor: desc) else {
            throw ExportError.textureFromPixelBufferFailed
        }
        var pixel: UInt32 = 0x00000000  // transparent black (BGRA)
        tex.replace(
            region: MTLRegionMake2D(0, 0, 1, 1),
            mipmapLevel: 0,
            withBytes: &pixel,
            bytesPerRow: 4
        )
        return tex
    }
}
