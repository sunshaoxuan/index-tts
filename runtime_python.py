from __future__ import annotations

import os
import sys
from pathlib import Path


def _configured_interpreter(root: Path, configured: str) -> Path:
    path = Path(configured).expanduser()
    if not path.is_absolute():
        path = root / path
    return path.absolute()


def main_python(root: Path, platform: str | None = None) -> Path:
    configured = os.environ.get("INDEXTTS_PYTHON", "").strip()
    if configured:
        return _configured_interpreter(root, configured)
    if (platform or os.name) == "nt":
        return (root.resolve() / ".venv" / "Scripts" / "python.exe").resolve()
    return Path(sys.executable).resolve()


def voice_python(root: Path, platform: str | None = None) -> Path:
    configured = os.environ.get("INDEXTTS_VOICE_PYTHON", "").strip()
    if configured:
        return _configured_interpreter(root, configured)
    if (platform or os.name) == "nt":
        return (root.resolve() / ".venv-voice-design" / "Scripts" / "python.exe").resolve()
    return main_python(root, platform=platform)
