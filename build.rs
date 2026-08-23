fn main() {
    println!("cargo:rerun-if-changed=assets/app-icon.ico");

    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        let mut resource = winresource::WindowsResource::new();
        resource
            .set_icon("assets/app-icon.ico")
            .set("ProductName", "Nghe Nhac Pro Max")
            .set("FileDescription", "Nghe Nhac Pro Max music player")
            .set("InternalName", "nghenhacpromax.exe")
            .set("OriginalFilename", "nghenhacpromax.exe");
        resource
            .compile()
            .expect("failed to compile Windows resources");
    }
}
