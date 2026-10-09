"""Build a source/compiled preview ZIP from an explicit code-only allowlist."""
import hashlib
import json
from pathlib import Path
import sys
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

sys.stdout.reconfigure(encoding="utf-8")
ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "private" / "tkc-gmo-assistant-mac.zip"
PREFIX = "tkc-gmo-assistant/"


def allowed_files():
    fixed = ["README.md", "LICENSE", "SECURITY.md", "AGENTS.md", "package.json", "package-lock.json", "Start-Mac.command", "tsconfig.json", "playwright.config.ts"]
    paths = [ROOT / name for name in fixed]
    for directory, pattern in [
        ("src", "*.ts"), ("dist/src", "*.js"), ("web", "*.html"),
        ("web", "*.js"), ("web", "*.css"), ("docs", "*.md"),
        ("scripts", "*.py"), ("tests", "*.test.ts"), ("tests/browser", "*.spec.ts"),
    ]:
        # Local task status changes during verification and is not user documentation.
        paths.extend(p for p in sorted((ROOT / directory).glob(pattern)) if p != ROOT / "docs/STATUS.md")
    for path in paths:
        if not path.is_file() or path.is_symlink():
            raise RuntimeError(f"Missing or symlinked bundle input: {path.relative_to(ROOT)}")
    if not (ROOT / "dist/src/server.js").is_file() or not (ROOT / "dist/src/doctor.js").is_file():
        raise RuntimeError("Run npm run build first")
    return sorted(set(paths))


def add(archive, name, content, executable=False):
    item = ZipInfo(PREFIX + name)
    item.create_system = 3
    item.external_attr = (0o100755 if executable else 0o100644) << 16
    item.compress_type = ZIP_DEFLATED
    archive.writestr(item, content)


def main():
    files = allowed_files()
    payloads = {p.relative_to(ROOT).as_posix(): p.read_bytes() for p in files}
    if b"\r" in payloads["Start-Mac.command"]:
        raise RuntimeError("Mac launcher must have LF line endings")
    manifest = {
        "format": 1, "version": json.loads(payloads["package.json"])["version"],
        "mode": "P1 preview", "liveWritesEnabled": False,
        "files": {name: hashlib.sha256(value).hexdigest() for name, value in payloads.items()},
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(OUTPUT, "w") as archive:
        for name, content in payloads.items():
            add(archive, name, content, name == "Start-Mac.command")
        add(archive, ".mac-preview-bundle", b"P1 preview; compiled JavaScript included\n")
        add(archive, "bundle-manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2).encode("utf-8"))
    digest = hashlib.sha256(OUTPUT.read_bytes()).hexdigest()
    OUTPUT.with_suffix(".zip.sha256").write_text(f"{digest}  {OUTPUT.name}\n", encoding="ascii")
    print(f"Mac bundle: {OUTPUT}")
    print(f"Code files: {len(files)}; size: {OUTPUT.stat().st_size} bytes; SHA-256: {digest}")


if __name__ == "__main__":
    main()
