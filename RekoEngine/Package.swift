// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "RekoEngine",
    platforms: [.macOS(.v14)],
    products: [
        .library(
            name: "RekoEngine",
            type: .static,
            targets: ["RekoEngine"]
        ),
    ],
    targets: [
        .target(
            name: "RekoEngine",
            path: "Sources/RekoEngine",
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
            name: "RekoEngineTests",
            dependencies: ["RekoEngine"]
        ),
    ]
)
