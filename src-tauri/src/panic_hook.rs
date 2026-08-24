use std::fs::OpenOptions;
use std::io::Write;
use std::panic;

/// Install a panic hook that appends the panic payload to
/// `%LOCALAPPDATA%/nghenhacpromax/app/logs/panic.log` (Windows AppData)
/// so a crash is never silent.
pub fn install() {
    let previous = panic::take_hook();
    panic::set_hook(Box::new(move |info| {
        if let Err(err) = write_panic_log(&info.to_string()) {
            eprintln!("Failed to write panic log: {err}");
        }
        previous(info);
    }));
}

fn write_panic_log(message: &str) -> std::io::Result<()> {
    let proj = directories::ProjectDirs::from("com", "nghenhacpromax", "app").ok_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "could not resolve app data directory",
        )
    })?;
    let log_dir = proj.data_local_dir().join("logs");
    std::fs::create_dir_all(&log_dir)?;
    let path = log_dir.join("panic.log");
    let mut file = OpenOptions::new().create(true).append(true).open(path)?;
    let ts = chrono::Utc::now().to_rfc3339();
    let thread = std::thread::current();
    let thread_name = thread.name().unwrap_or("unnamed");
    writeln!(
        file,
        "[{ts}] thread='{thread_name}' panic: {message}\n---\n"
    )?;
    Ok(())
}
