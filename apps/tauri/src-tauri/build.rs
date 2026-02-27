use std::path::PathBuf;
use std::process::Command;

fn main() {
    tauri_build::build();

    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let swift_project_dir = manifest_dir
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .join("RekoEngine");

    // Detect the Cargo target architecture so we build Swift for the right arch.
    // When building a universal binary, Cargo invokes build.rs twice (once per
    // arch), so we read CARGO_CFG_TARGET_ARCH to know which slice we need.
    let target_arch = std::env::var("CARGO_CFG_TARGET_ARCH").unwrap_or_default();

    let swift_triple = match target_arch.as_str() {
        "x86_64" => "x86_64-apple-macosx",
        _ => "arm64-apple-macosx", // default to arm64
    };

    // Build Swift for the specific target triple
    let status = Command::new("swift")
        .args(["build", "-c", "release", "--triple", swift_triple])
        .current_dir(&swift_project_dir)
        .status()
        .expect("Failed to run swift build. Is Xcode installed?");

    assert!(status.success(), "Swift build failed for triple {swift_triple}");

    // The output directory is keyed by triple when --triple is used
    let swift_lib_dir = swift_project_dir.join(format!(".build/{swift_triple}/release"));

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
    println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");
    let swift_55_path = PathBuf::from(swift_bin.trim())
        .parent()
        .unwrap()
        .parent()
        .unwrap()
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
