use std::path::PathBuf;
use std::process::Command;

fn main() {
    tauri_build::build();

    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let swift_project_dir = manifest_dir.parent().unwrap().join("RekoEngine");

    // Build Swift framework
    let status = Command::new("swift")
        .args(["build", "-c", "release"])
        .current_dir(&swift_project_dir)
        .status()
        .expect("Failed to run swift build. Is Xcode installed?");

    assert!(status.success(), "Swift build failed");

    // Link static library
    let swift_lib_dir = swift_project_dir.join(".build/release");
    println!(
        "cargo:rustc-link-search=native={}",
        swift_lib_dir.display()
    );
    println!("cargo:rustc-link-lib=static=RekoEngine");

    // Link Apple frameworks
    for framework in &[
        "ScreenCaptureKit",
        "AVFoundation",
        "VideoToolbox",
        "Metal",
        "CoreMedia",
        "CoreVideo",
        "CoreGraphics",
        "CoreAudio",
        "CoreFoundation",
        "Foundation",
        "AppKit",
    ] {
        println!("cargo:rustc-link-lib=framework={framework}");
    }

    // Link Swift standard library
    let swift_path_output = Command::new("xcrun")
        .args(["--toolchain", "default", "--find", "swift"])
        .output()
        .expect("Failed to find swift toolchain");
    let swift_bin = String::from_utf8(swift_path_output.stdout).unwrap();
    let swift_lib_path = PathBuf::from(swift_bin.trim())
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .join("lib/swift/macosx");
    println!(
        "cargo:rustc-link-search=native={}",
        swift_lib_path.display()
    );

    // Add rpaths so the binary can find Swift dynamic libraries at runtime
    // System path (resolves from dyld shared cache on macOS 14+)
    println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");
    // Toolchain backdeployment path (has libswift_Concurrency.dylib)
    let swift_55_path = PathBuf::from(swift_bin.trim())
        .parent().unwrap()
        .parent().unwrap()
        .join("lib/swift-5.5/macosx");
    println!(
        "cargo:rustc-link-arg=-Wl,-rpath,{}",
        swift_55_path.display()
    );
    println!(
        "cargo:rustc-link-arg=-Wl,-rpath,{}",
        swift_lib_path.display()
    );

    // Rebuild when Swift sources change
    println!(
        "cargo:rerun-if-changed={}",
        swift_project_dir.join("Sources").display()
    );
    println!(
        "cargo:rerun-if-changed={}",
        swift_project_dir.join("Package.swift").display()
    );
}
