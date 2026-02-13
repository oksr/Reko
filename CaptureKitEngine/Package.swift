// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "CaptureKitEngine",
    platforms: [.macOS(.v14)],
    products: [
        .library(
            name: "CaptureKitEngine",
            type: .static,
            targets: ["CaptureKitEngine"]
        ),
    ],
    targets: [
        .target(
            name: "CaptureKitEngine",
            path: "Sources/CaptureKitEngine",
            publicHeadersPath: "include",
            linkerSettings: [
                .linkedFramework("ScreenCaptureKit"),
                .linkedFramework("AVFoundation"),
                .linkedFramework("VideoToolbox"),
                .linkedFramework("Metal"),
                .linkedFramework("CoreMedia"),
                .linkedFramework("CoreVideo"),
                .linkedFramework("CoreGraphics"),
                .linkedFramework("CoreAudio"),
            ]
        ),
        .testTarget(
            name: "CaptureKitEngineTests",
            dependencies: ["CaptureKitEngine"]
        ),
    ]
)
