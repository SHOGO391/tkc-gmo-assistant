"""Validate the ZIP; on macOS, exercise pinned runtime download and localhost startup."""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import platform
import socket
import subprocess
import sys
import tempfile
import time
from urllib.request import urlopen
from zipfile import ZipFile

sys.stdout.reconfigure(encoding="utf-8")
ROOT = Path(__file__).resolve().parents[1]
ARCHIVE = ROOT / "private" / "tkc-gmo-assistant-mac.zip"
PREFIX = "tkc-gmo-assistant/"


def verify_contents():
    with ZipFile(ARCHIVE) as archive:
        names = archive.namelist()
        assert len(names) == len(set(names)), "Duplicate ZIP entries"
        assert archive.testzip() is None, "ZIP integrity failure"
        manifest = json.loads(archive.read(PREFIX + "bundle-manifest.json"))
        assert manifest["liveWritesEnabled"] is False
        assert set(names) == {PREFIX + name for name in manifest["files"]} | {
            PREFIX + "bundle-manifest.json", PREFIX + ".mac-preview-bundle",
        }, "Unexpected ZIP entries"
        permitted_roots = {"src", "dist", "web", "docs", "scripts", "tests"}
        permitted_top = {"README.md", "LICENSE", "SECURITY.md", "AGENTS.md", "package.json", "package-lock.json", "Start-Mac.command", "tsconfig.json", "playwright.config.ts", "bundle-manifest.json", ".mac-preview-bundle"}
        for name in names:
            relative = PurePosixPath(name.removeprefix(PREFIX))
            assert name.startswith(PREFIX) and not relative.is_absolute() and ".." not in relative.parts
            assert relative.parts[0] in permitted_roots | permitted_top, "Non-code directory in ZIP"
            assert relative.suffix not in {".db", ".sqlite", ".csv", ".docx", ".pdf", ".png"}, "Business data in ZIP"
        for name, expected in manifest["files"].items():
            assert hashlib.sha256(archive.read(PREFIX + name)).hexdigest() == expected, name
        launcher = archive.getinfo(PREFIX + "Start-Mac.command")
        assert (launcher.external_attr >> 16) & 0o111, "Launcher is not executable"
        assert b"\r" not in archive.read(launcher), "Non-Unix line endings"
    expected = ARCHIVE.with_suffix(".zip.sha256").read_text(encoding="ascii").split()[0]
    assert hashlib.sha256(ARCHIVE.read_bytes()).hexdigest() == expected
    print("ZIP content, manifest, checksum, executable permission and data exclusion: passed")


def mac_smoke():
    with tempfile.TemporaryDirectory(prefix="tkc-mac-bundle-") as directory:
        root = Path(directory)
        # ditto mirrors macOS archive extraction and preserves Unix executable permissions.
        subprocess.run(["/usr/bin/ditto", "-x", "-k", str(ARCHIVE), str(root)], check=True)
        application = root / "tkc-gmo-assistant"
        launcher = application / "Start-Mac.command"
        assert os.access(launcher, os.X_OK), "Extracted launcher permission lost"
        env = {**os.environ, "DATA_DIR": str(root / "business-data"), "TKC_RUNTIME_DIR": str(root / "runtime")}
        # Force the pinned official runtime path even when CI already has Node installed.
        check = subprocess.run([str(launcher), "--bundled-node", "--check"], cwd=application, env=env,
                               text=True, encoding="utf-8", capture_output=True, timeout=240)
        if check.returncode != 0:
            raise RuntimeError("Mac launcher preparation failed\n" + check.stdout[-3000:] + check.stderr[-3000:])
        start = check.stdout.index('{\n  "mode"')
        report = json.loads(check.stdout[start:])
        assert report["previewReady"] is True and report["liveWritesEnabled"] is False
        assert report["liveTkcConnection"] == "unverified" and report["node"] == "v24.21.0"
        assert list((root / "business-data").iterdir()) == [], "Doctor created business files"
        print(f"Mac extracted ZIP: pinned runtime download/checksum, production dependencies and doctor passed ({report['arch']})")
        with socket.socket() as free:
            free.bind(("127.0.0.1", 0))
            port = free.getsockname()[1]
        env["PORT"] = str(port)
        log_path = root / "startup.log"
        with log_path.open("w", encoding="utf-8") as log:
            process = subprocess.Popen([str(launcher), "--bundled-node", "--no-browser"], cwd=application,
                                       env=env, stdout=log, stderr=subprocess.STDOUT)
            try:
                deadline = time.monotonic() + 120
                healthy = False
                while time.monotonic() < deadline and process.poll() is None:
                    try:
                        with urlopen(f"http://127.0.0.1:{port}/api/bootstrap", timeout=2) as response:
                            payload = json.load(response)
                        assert payload["mode"] == "P1 preview" and payload["jobs"] == []
                        # Never print the local request token.
                        healthy = True
                        break
                    except OSError:
                        time.sleep(0.5)
                if not healthy:
                    raise RuntimeError("Mac preview startup failed\n" + log_path.read_text(encoding="utf-8")[-3000:])
                print("Mac localhost preview startup and empty job state: passed; no TKC connection attempted")
            finally:
                process.terminate()
                try:
                    process.wait(timeout=15)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)


if __name__ == "__main__":
    verify_contents()
    if platform.system() == "Darwin":
        mac_smoke()
    else:
        print("Mac runtime/startup test deferred to macOS CI; this host validates packaging only")
