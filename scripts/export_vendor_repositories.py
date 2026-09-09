#!/usr/bin/env python3
"""Export vendor-only ANPOS repositories from committed canonical source.

The exporter reads committed Git blobs from HEAD rather than working-tree bytes.
This makes exports independent of CRLF/smudge filters and prevents untracked local
files such as credentials from entering vendor repositories. Outputs include
deterministic provenance manifests. The customer-facing commercial template also
excludes every path classified as vendor-only by the committed source-boundary policy.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parents[1]
SERVICE_PREFIX = PurePosixPath("commercial-service")
SERVICE_REPOSITORY_NAME = "anpos-commercial-service"
TEMPLATE_REPOSITORY_NAME = "anpos-commercial-template"
VENDOR_BOUNDARY_REPOSITORY_PATH = "config/licensing/vendor-source-boundary.json"
MANIFEST_NAME = "EXPORT-MANIFEST.json"
FORBIDDEN_PARTS = {".git", ".bundle", ".next", ".vercel", "node_modules", "__pycache__", ".pytest_cache"}
FORBIDDEN_SECRET_NAMES = {".env", "id_rsa", "id_ed25519"}
FORBIDDEN_SECRET_SUFFIXES = {".pem", ".p12", ".pfx"}
ALLOWED_BLOB_MODES = {"100644", "100755"}
SERVICE_GITIGNORE = """node_modules/\n.next/\n.vercel/\n.env\n.env.*\n!.env.example\n*.pem\n*.p12\n*.pfx\n"""


class ExportError(RuntimeError):
    pass


@dataclass(frozen=True)
class TrackedEntry:
    path: PurePosixPath
    mode: str
    object_id: str


def run_git(source_root: Path, *args: str) -> str:
    result = subprocess.run(
        ["git", *args], cwd=source_root, check=False, capture_output=True, text=True
    )
    if result.returncode != 0:
        detail = result.stderr.strip() or result.stdout.strip() or "git command failed"
        raise ExportError(detail)
    return result.stdout


def run_git_bytes(source_root: Path, *args: str) -> bytes:
    result = subprocess.run(
        ["git", *args], cwd=source_root, check=False, capture_output=True
    )
    if result.returncode != 0:
        detail = result.stderr.decode("utf-8", errors="replace").strip()
        if not detail:
            detail = result.stdout.decode("utf-8", errors="replace").strip() or "git command failed"
        raise ExportError(detail)
    return result.stdout


def tracked_entries(source_root: Path) -> list[TrackedEntry]:
    raw = run_git_bytes(source_root, "ls-tree", "-r", "-z", "HEAD")
    entries: list[TrackedEntry] = []
    for record in raw.split(b"\0"):
        if not record:
            continue
        try:
            metadata, raw_path = record.split(b"\t", 1)
            mode, object_type, object_id = metadata.decode("ascii").split(" ", 2)
            path = PurePosixPath(raw_path.decode("utf-8"))
        except (ValueError, UnicodeDecodeError) as exc:
            raise ExportError("unable to parse committed Git tree") from exc
        if object_type != "blob":
            raise ExportError(f"non-blob committed entry is not exportable: {path.as_posix()}")
        entries.append(TrackedEntry(path=path, mode=mode, object_id=object_id))
    return sorted(entries, key=lambda entry: entry.path.as_posix())


def load_committed_vendor_only_paths(source_root: Path) -> tuple[str, ...]:
    try:
        raw = run_git_bytes(source_root, "show", f"HEAD:{VENDOR_BOUNDARY_REPOSITORY_PATH}")
        data = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError, ExportError) as exc:
        raise ExportError(f"unable to read committed vendor source boundary: {exc}") from exc
    if data.get("activation_scope") != "canonical_vendor_source_management_only":
        raise ExportError("committed vendor source boundary activation_scope is invalid")
    values = data.get("vendor_only_paths")
    if not isinstance(values, list) or not values:
        raise ExportError("committed vendor source boundary must contain non-empty vendor_only_paths")
    result: list[str] = []
    seen: set[str] = set()
    for value in values:
        if not isinstance(value, str) or not value or value.startswith("/"):
            raise ExportError("vendor-only path must be a non-empty repository-relative string")
        path = PurePosixPath(value)
        if path.is_absolute() or ".." in path.parts or path == PurePosixPath("."):
            raise ExportError(f"unsafe vendor-only path: {value!r}")
        normalized = path.as_posix().rstrip("/")
        if normalized in seen:
            raise ExportError(f"duplicate vendor-only path: {normalized}")
        seen.add(normalized)
        result.append(normalized)
    return tuple(result)


def path_matches_vendor_only(path: PurePosixPath, vendor_only_paths: tuple[str, ...]) -> bool:
    text = path.as_posix()
    return any(text == prefix or text.startswith(prefix + "/") for prefix in vendor_only_paths)


def is_forbidden_secret(relative: PurePosixPath) -> bool:
    name = relative.name.lower()
    if name in FORBIDDEN_SECRET_NAMES:
        return True
    if name.startswith(".env.") and name != ".env.example":
        return True
    return relative.suffix.lower() in FORBIDDEN_SECRET_SUFFIXES


def validate_entry(entry: TrackedEntry) -> None:
    relative = entry.path
    if relative.is_absolute() or ".." in relative.parts:
        raise ExportError(f"unsafe tracked path: {relative.as_posix()}")
    if any(part in FORBIDDEN_PARTS for part in relative.parts):
        raise ExportError(f"generated/runtime path must not be tracked or exported: {relative.as_posix()}")
    if is_forbidden_secret(relative):
        raise ExportError(f"secret-like tracked file must not be exported: {relative.as_posix()}")
    if entry.mode not in ALLOWED_BLOB_MODES:
        if entry.mode == "120000":
            raise ExportError(f"symlink export is refused: {relative.as_posix()}")
        raise ExportError(f"unsupported Git file mode {entry.mode}: {relative.as_posix()}")


def sha256_bytes(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def source_revision(source_root: Path) -> tuple[str, str]:
    revision = run_git(source_root, "rev-parse", "HEAD").strip()
    tree = run_git(source_root, "rev-parse", "HEAD^{tree}").strip()
    return revision, tree


def ensure_clean_tracked_tree(source_root: Path) -> None:
    dirty = run_git(source_root, "status", "--porcelain", "--untracked-files=no").strip()
    if dirty:
        raise ExportError("tracked working tree is dirty; commit or restore tracked changes before vendor export")


def select_entries(
    entries: list[TrackedEntry],
    mode: str,
    vendor_only_paths: tuple[str, ...],
) -> list[tuple[TrackedEntry, PurePosixPath]]:
    selected: list[tuple[TrackedEntry, PurePosixPath]] = []
    service_prefix = SERVICE_PREFIX.as_posix() + "/"
    for entry in entries:
        text = entry.path.as_posix()
        if mode == "service":
            if not text.startswith(service_prefix):
                continue
            target_relative = PurePosixPath(text[len(service_prefix):])
        elif mode == "template":
            if path_matches_vendor_only(entry.path, vendor_only_paths):
                continue
            target_relative = entry.path
        else:
            raise ExportError(f"unknown export mode: {mode}")
        selected.append((entry, target_relative))
    if not selected:
        raise ExportError(f"no committed files selected for {mode} export")
    return selected


def write_git_blob(source_root: Path, entry: TrackedEntry, target: Path) -> bytes:
    validate_entry(entry)
    content = run_git_bytes(source_root, "cat-file", "blob", entry.object_id)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(content)
    os.chmod(target, 0o755 if entry.mode == "100755" else 0o644)
    return content


def copy_selected(
    source_root: Path,
    destination: Path,
    selected: list[tuple[TrackedEntry, PurePosixPath]],
) -> list[dict[str, object]]:
    records: list[dict[str, object]] = []
    for entry, target_relative in selected:
        if is_forbidden_secret(target_relative):
            raise ExportError(f"secret-like export target refused: {target_relative.as_posix()}")
        target = destination.joinpath(*target_relative.parts)
        content = write_git_blob(source_root, entry, target)
        records.append(
            {
                "path": target_relative.as_posix(),
                "origin": entry.path.as_posix(),
                "git_mode": entry.mode,
                "git_object": entry.object_id,
                "size": len(content),
                "sha256": sha256_bytes(content),
            }
        )
    return records


def write_generated_service_gitignore(destination: Path, records: list[dict[str, object]]) -> None:
    target = destination / ".gitignore"
    if target.exists():
        return
    target.write_text(SERVICE_GITIGNORE, encoding="utf-8", newline="\n")
    records.append(
        {
            "path": ".gitignore",
            "origin": "generated:vendor-service-gitignore",
            "git_mode": "100644",
            "git_object": None,
            "size": target.stat().st_size,
            "sha256": sha256(target),
        }
    )


def write_manifest(
    destination: Path,
    *,
    mode: str,
    revision: str,
    source_tree: str,
    records: list[dict[str, object]],
) -> None:
    records.sort(key=lambda item: str(item["path"]))
    manifest = {
        "schema_version": 1,
        "export_mode": mode,
        "source_revision": revision,
        "source_tree": source_tree,
        "source_scope": "commercial-service/" if mode == "service" else "canonical-minus-vendor-only-paths",
        "source_material": "committed_git_blobs_at_head",
        "tracked_source_only": True,
        "contains_secrets": False,
        "files": records,
        "file_count": len(records),
        "total_bytes": sum(int(item["size"]) for item in records),
    }
    (destination / MANIFEST_NAME).write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8", newline="\n"
    )


def export_repositories(
    source_root: Path,
    output_root: Path,
    *,
    modes: tuple[str, ...] = ("service", "template"),
    allow_dirty_tracked: bool = False,
) -> dict[str, Path]:
    source_root = source_root.resolve()
    output_root = output_root.resolve()
    if source_root == output_root or source_root in output_root.parents:
        raise ExportError("output directory must be outside the canonical source repository")
    if not (source_root / ".git").exists():
        raise ExportError("source root must be a Git worktree with a .git entry")
    if not allow_dirty_tracked:
        ensure_clean_tracked_tree(source_root)

    revision, tree = source_revision(source_root)
    entries = tracked_entries(source_root)
    vendor_only_paths = load_committed_vendor_only_paths(source_root)
    target_names = {
        "service": SERVICE_REPOSITORY_NAME,
        "template": TEMPLATE_REPOSITORY_NAME,
    }
    for mode in modes:
        if mode not in target_names:
            raise ExportError(f"unknown export mode: {mode}")
        if (output_root / target_names[mode]).exists():
            raise ExportError(f"export target already exists: {output_root / target_names[mode]}")

    output_root.mkdir(parents=True, exist_ok=True)
    stage_root = Path(tempfile.mkdtemp(prefix=".anpos-vendor-export-", dir=output_root))
    staged: dict[str, Path] = {}
    committed_targets: list[Path] = []
    try:
        for mode in modes:
            destination = stage_root / target_names[mode]
            destination.mkdir(parents=True)
            records = copy_selected(
                source_root,
                destination,
                select_entries(entries, mode, vendor_only_paths),
            )
            if mode == "service":
                write_generated_service_gitignore(destination, records)
            write_manifest(destination, mode=mode, revision=revision, source_tree=tree, records=records)
            staged[mode] = destination

        final: dict[str, Path] = {}
        for mode in modes:
            target = output_root / target_names[mode]
            if target.exists():
                raise ExportError(f"export target appeared during staging: {target}")
            os.replace(staged[mode], target)
            committed_targets.append(target)
            final[mode] = target
        return final
    except Exception:
        for target in reversed(committed_targets):
            shutil.rmtree(target, ignore_errors=True)
        raise
    finally:
        shutil.rmtree(stage_root, ignore_errors=True)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True, help="Parent directory outside the canonical repository")
    parser.add_argument("--mode", choices=("all", "service", "template"), default="all")
    parser.add_argument(
        "--allow-dirty-tracked",
        action="store_true",
        help="Development-only: permit a dirty worktree; export still uses committed HEAD blobs only",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    modes = ("service", "template") if args.mode == "all" else (args.mode,)
    try:
        outputs = export_repositories(
            ROOT,
            args.output,
            modes=modes,
            allow_dirty_tracked=args.allow_dirty_tracked,
        )
    except ExportError as exc:
        print(f"ANPOS vendor export failed: {exc}", file=sys.stderr)
        return 1
    for mode, path in outputs.items():
        print(f"{mode}: {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
