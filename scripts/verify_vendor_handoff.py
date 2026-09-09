#!/usr/bin/env python3
"""Verify a vendor repository checkout/directory against the certified deterministic ANPOS export.

Run this script from the canonical ANPOS checkout at the exact approved source revision.
It reconstructs the expected vendor export from committed Git blobs and compares every
repository byte against that export. A target Git checkout is verified from committed
HEAD blobs (not newline-converted working-tree bytes); a plain export directory is
verified from filesystem bytes. The verifier never reads or writes credentials.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path, PurePosixPath
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import export_vendor_repositories as exporter

MANIFEST_NAME = exporter.MANIFEST_NAME
SHA40_RE = re.compile(r"^[0-9a-f]{40}$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
ALLOWED_GIT_MODES = {"100644", "100755"}
EXPECTED_SERVICE_NAME = "anpos-commercial-service"


class VerificationError(RuntimeError):
    pass


def run_git_text(root: Path, *args: str) -> str:
    result = subprocess.run(
        ["git", *args], cwd=root, check=False, capture_output=True, text=True
    )
    if result.returncode != 0:
        detail = result.stderr.strip() or result.stdout.strip() or "git command failed"
        raise VerificationError(detail)
    return result.stdout


def run_git_bytes(root: Path, *args: str) -> bytes:
    result = subprocess.run(["git", *args], cwd=root, check=False, capture_output=True)
    if result.returncode != 0:
        detail = result.stderr.decode("utf-8", errors="replace").strip()
        if not detail:
            detail = result.stdout.decode("utf-8", errors="replace").strip() or "git command failed"
        raise VerificationError(detail)
    return result.stdout


def sha256_bytes(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def validate_relative_path(value: str) -> str:
    if not isinstance(value, str) or not value or "\\" in value or value.startswith("/"):
        raise VerificationError(f"unsafe repository path in handoff: {value!r}")
    path = PurePosixPath(value)
    if path.is_absolute() or path == PurePosixPath(".") or ".." in path.parts:
        raise VerificationError(f"unsafe repository path in handoff: {value!r}")
    if ".git" in path.parts:
        raise VerificationError(f"nested .git path is forbidden in handoff content: {value!r}")
    return path.as_posix()


def canonical_identity(source_root: Path) -> tuple[str, str]:
    revision = run_git_text(source_root, "rev-parse", "HEAD").strip()
    tree = run_git_text(source_root, "rev-parse", "HEAD^{tree}").strip()
    if not SHA40_RE.fullmatch(revision) or not SHA40_RE.fullmatch(tree):
        raise VerificationError("canonical source revision/tree is not a full SHA-1 identity")
    return revision, tree


def filesystem_snapshot(repository: Path) -> tuple[dict[str, bytes], dict[str, str] | None, str | None]:
    files: dict[str, bytes] = {}
    for current, dirnames, filenames in os.walk(repository, followlinks=False):
        current_path = Path(current)
        relative_current = current_path.relative_to(repository)
        for dirname in list(dirnames):
            candidate = current_path / dirname
            relative = candidate.relative_to(repository)
            if candidate.is_symlink():
                raise VerificationError(f"symlink directory is forbidden: {relative.as_posix()}")
            if ".git" in relative.parts:
                raise VerificationError(f"nested .git directory is forbidden: {relative.as_posix()}")
        for filename in filenames:
            candidate = current_path / filename
            relative = candidate.relative_to(repository)
            if candidate.is_symlink():
                raise VerificationError(f"symlink file is forbidden: {relative.as_posix()}")
            path = validate_relative_path(relative.as_posix())
            files[path] = candidate.read_bytes()
    return files, None, None


def git_snapshot(repository: Path) -> tuple[dict[str, bytes], dict[str, str], str]:
    dirty = run_git_text(
        repository,
        "status",
        "--porcelain=v1",
        "--untracked-files=all",
        "--ignored=matching",
    ).strip()
    if dirty:
        raise VerificationError(
            "target Git checkout must be clean, including tracked changes, untracked files, and ignored files, before handoff verification"
        )

    revision = run_git_text(repository, "rev-parse", "HEAD").strip()
    raw = run_git_bytes(repository, "ls-tree", "-r", "-z", "HEAD")
    files: dict[str, bytes] = {}
    modes: dict[str, str] = {}
    for record in raw.split(b"\0"):
        if not record:
            continue
        try:
            metadata, raw_path = record.split(b"\t", 1)
            mode, object_type, object_id = metadata.decode("ascii").split(" ", 2)
            path = validate_relative_path(raw_path.decode("utf-8"))
        except (ValueError, UnicodeDecodeError) as exc:
            raise VerificationError("unable to parse target Git tree") from exc
        if object_type != "blob":
            raise VerificationError(f"non-blob target Git entry is forbidden: {path}")
        if mode not in ALLOWED_GIT_MODES:
            raise VerificationError(f"unsupported target Git mode {mode}: {path}")
        files[path] = run_git_bytes(repository, "cat-file", "blob", object_id)
        modes[path] = mode
    return files, modes, revision


def snapshot(repository: Path) -> tuple[dict[str, bytes], dict[str, str] | None, str | None]:
    repository = repository.resolve()
    if not repository.is_dir():
        raise VerificationError(f"vendor repository path is not a directory: {repository}")
    if (repository / ".git").exists():
        return git_snapshot(repository)
    return filesystem_snapshot(repository)


def load_manifest(content: bytes) -> dict[str, Any]:
    try:
        data = json.loads(content.decode("utf-8"))
    except Exception as exc:
        raise VerificationError(f"{MANIFEST_NAME} is not valid UTF-8 JSON: {exc}") from exc
    if not isinstance(data, dict):
        raise VerificationError(f"{MANIFEST_NAME} must contain a JSON object")
    return data


def expected_modes_from_manifest(manifest: dict[str, Any]) -> dict[str, str]:
    records = manifest.get("files")
    if not isinstance(records, list) or not records:
        raise VerificationError("export manifest must contain a non-empty files list")
    modes = {MANIFEST_NAME: "100644"}
    seen: set[str] = set()
    total_bytes = 0
    for item in records:
        if not isinstance(item, dict):
            raise VerificationError("export manifest file record must be an object")
        path = validate_relative_path(str(item.get("path") or ""))
        if path in seen or path == MANIFEST_NAME:
            raise VerificationError(f"duplicate/reserved export manifest path: {path}")
        seen.add(path)
        mode = str(item.get("git_mode") or "")
        if mode not in ALLOWED_GIT_MODES:
            raise VerificationError(f"export manifest contains unsupported Git mode {mode}: {path}")
        digest = str(item.get("sha256") or "")
        size = item.get("size")
        if not SHA256_RE.fullmatch(digest):
            raise VerificationError(f"export manifest contains invalid SHA-256: {path}")
        if not isinstance(size, int) or size < 0:
            raise VerificationError(f"export manifest contains invalid size: {path}")
        total_bytes += size
        modes[path] = mode
    if manifest.get("file_count") != len(records):
        raise VerificationError("export manifest file_count does not match files list")
    if manifest.get("total_bytes") != total_bytes:
        raise VerificationError("export manifest total_bytes does not match files list")
    return modes


def content_set_digest(files: dict[str, bytes]) -> str:
    digest = hashlib.sha256()
    for path in sorted(files):
        digest.update(path.encode("utf-8"))
        digest.update(b"\0")
        digest.update(sha256_bytes(files[path]).encode("ascii"))
        digest.update(b"\0")
    return digest.hexdigest()


def verify_repository(
    repository: Path,
    *,
    expected_mode: str,
    expected_source_revision: str,
    expected_source_tree: str,
    expected_service_version: str | None = None,
    expected_protocol_version: str | None = None,
    expected_runtime_contract: str | None = None,
    source_root: Path = ROOT,
) -> dict[str, Any]:
    if expected_mode not in {"service", "template"}:
        raise VerificationError("expected mode must be service or template")
    if not SHA40_RE.fullmatch(expected_source_revision) or not SHA40_RE.fullmatch(expected_source_tree):
        raise VerificationError("expected source revision/tree must be full 40-character lowercase Git SHA-1 values")

    source_root = source_root.resolve()
    revision, tree = canonical_identity(source_root)
    if revision != expected_source_revision:
        raise VerificationError(
            f"canonical checkout revision mismatch: expected {expected_source_revision}, got {revision}; checkout the approved source revision first"
        )
    if tree != expected_source_tree:
        raise VerificationError(
            f"canonical checkout tree mismatch: expected {expected_source_tree}, got {tree}"
        )

    with tempfile.TemporaryDirectory(prefix="anpos-vendor-handoff-") as tmp:
        outputs = exporter.export_repositories(
            source_root,
            Path(tmp),
            modes=(expected_mode,),
            allow_dirty_tracked=True,
        )
        expected_files, _, _ = filesystem_snapshot(outputs[expected_mode])

    actual_files, actual_modes, target_revision = snapshot(repository)
    expected_paths = set(expected_files)
    actual_paths = set(actual_files)
    if actual_paths != expected_paths:
        missing = sorted(expected_paths - actual_paths)
        extra = sorted(actual_paths - expected_paths)
        details = []
        if missing:
            details.append("missing=" + ",".join(missing[:10]))
        if extra:
            details.append("extra=" + ",".join(extra[:10]))
        raise VerificationError("vendor handoff file set mismatch: " + "; ".join(details))

    mismatched = [path for path in sorted(expected_paths) if actual_files[path] != expected_files[path]]
    if mismatched:
        raise VerificationError("vendor handoff byte mismatch: " + ",".join(mismatched[:10]))

    manifest = load_manifest(actual_files[MANIFEST_NAME])
    expected_modes = expected_modes_from_manifest(manifest)
    if actual_modes is not None:
        mode_mismatches = [
            path for path, mode in sorted(expected_modes.items()) if actual_modes.get(path) != mode
        ]
        if mode_mismatches:
            raise VerificationError("vendor handoff Git mode mismatch: " + ",".join(mode_mismatches[:10]))

    if manifest.get("schema_version") != 1:
        raise VerificationError("unsupported export manifest schema_version")
    if manifest.get("export_mode") != expected_mode:
        raise VerificationError("export manifest mode does not match expected handoff mode")
    if manifest.get("source_revision") != expected_source_revision:
        raise VerificationError("export manifest source_revision does not match approved source revision")
    if manifest.get("source_tree") != expected_source_tree:
        raise VerificationError("export manifest source_tree does not match approved source tree")
    if manifest.get("source_material") != "committed_git_blobs_at_head":
        raise VerificationError("export manifest source_material is not committed_git_blobs_at_head")
    if manifest.get("tracked_source_only") is not True or manifest.get("contains_secrets") is not False:
        raise VerificationError("export manifest source/secrets safety flags are invalid")
    expected_scope = "commercial-service/" if expected_mode == "service" else "canonical-minus-vendor-only-paths"
    if manifest.get("source_scope") != expected_scope:
        raise VerificationError("export manifest source_scope does not match expected handoff mode")

    artifact_identity: dict[str, str] | None = None
    if expected_mode == "service":
        if not expected_service_version or not expected_protocol_version or not expected_runtime_contract:
            raise VerificationError(
                "service handoff verification requires expected service, protocol, and runtime-contract identities"
            )
        try:
            package = json.loads(actual_files["package.json"].decode("utf-8"))
        except Exception as exc:
            raise VerificationError(f"service package.json is unavailable or invalid: {exc}") from exc
        anpos = package.get("anpos") or {}
        artifact_identity = {
            "service": str(package.get("name") or ""),
            "service_version": str(package.get("version") or ""),
            "source_protocol_version": str(anpos.get("source_protocol_version") or "") if isinstance(anpos, dict) else "",
            "runtime_contract": str(anpos.get("runtime_contract") or "") if isinstance(anpos, dict) else "",
        }
        expected_identity = {
            "service": EXPECTED_SERVICE_NAME,
            "service_version": expected_service_version,
            "source_protocol_version": expected_protocol_version,
            "runtime_contract": expected_runtime_contract,
        }
        if artifact_identity != expected_identity:
            raise VerificationError(
                f"service artifact identity mismatch: expected {expected_identity}, got {artifact_identity}"
            )

    return {
        "ok": True,
        "verification": "exact_deterministic_vendor_export",
        "export_mode": expected_mode,
        "canonical_source_revision": expected_source_revision,
        "canonical_source_tree": expected_source_tree,
        "target_repository_revision": target_revision,
        "manifest_sha256": sha256_bytes(actual_files[MANIFEST_NAME]),
        "content_set_sha256": content_set_digest(actual_files),
        "repository_file_count": len(actual_files),
        "exported_file_count": manifest["file_count"],
        "exported_total_bytes": manifest["total_bytes"],
        "artifact_identity": artifact_identity,
    }


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repository", type=Path, required=True, help="Export directory or clean Git checkout to verify")
    parser.add_argument("--expected-mode", choices=("service", "template"), required=True)
    parser.add_argument("--expected-source-revision", required=True)
    parser.add_argument("--expected-source-tree", required=True)
    parser.add_argument("--expected-service-version")
    parser.add_argument("--expected-protocol-version")
    parser.add_argument("--expected-runtime-contract")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv or sys.argv[1:])
    try:
        receipt = verify_repository(
            args.repository,
            expected_mode=args.expected_mode,
            expected_source_revision=args.expected_source_revision,
            expected_source_tree=args.expected_source_tree,
            expected_service_version=args.expected_service_version,
            expected_protocol_version=args.expected_protocol_version,
            expected_runtime_contract=args.expected_runtime_contract,
        )
    except (VerificationError, exporter.ExportError) as exc:
        print(f"ANPOS vendor handoff verification FAILED: {exc}", file=sys.stderr)
        return 2
    print(json.dumps(receipt, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
