#!/usr/bin/env python3
"""Canonical ANPOS child bootstrap entrypoint.

Delegates to the normal child initializer. Commercial/vendor distribution
handling is intentionally absent from this project repository.
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    command = [sys.executable, str(ROOT / "scripts" / "bootstrap_instance.py"), *sys.argv[1:]]
    result = subprocess.run(command, cwd=ROOT)
    return result.returncode


if __name__ == "__main__":
    raise SystemExit(main())
