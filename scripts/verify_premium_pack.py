#!/usr/bin/env python3
"""Verify a private ANPOS Premium Pack against the canonical source contract.

This verifier certifies structure and content provenance only. Passing it does not
activate a Pro entitlement, create Marketplace billing authority, prove live
provider compatibility, or authorize a commercial launch.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path, PurePosixPath
from typing import Any

try:
    from jsonschema import Draft202012Validator
except Exception:  # pragma: no cover - surfaced as a verification error
    Draft202012Validator = None

ROOT = Path(__file__).resolve().parents[1]
SCHEMA_PATH = ROOT / "schemas" / "premium-pack-manifest.schema.json"
CONTRACT_PATH = ROOT / "config" / "licensing" / "premium-pack-contract.json"
MANIFEST_NAME = "ANPOS-PREMIUM-MANIFEST.json"

SECRET_MARKERS = (
    b"-----begin private key-----",
    b"-----begin rsa private key-----",
    b"github_pat_",
    b"ghp_",
    b"postgresql://",
)


class VerificationError(RuntimeError):
    pass


def load_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        raise VerificationError(f"INVALID_JSON:{path.name}:{exc}") from exc
    if not isinstance(value, dict):
        raise VerificationError(f"JSON_OBJECT_REQUIRED:{path.name}")
    return value


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def semver_tuple(value: str) -> tuple[int, int, int]:
    core = value.split("-", 1)[0]
    try:
        major, minor, patch = core.split(".")
        return int(major), int(minor), int(patch)
    except Exception as exc:
        raise VerificationError(f"INVALID_SEMVER:{value}") from exc


def safe_payload_path(relative: str) -> PurePosixPath:
    if not relative or "\\" in relative or relative.startswith("/"):
        raise VerificationError(f"INVALID_PAYLOAD_PATH:{relative}")
    pure = PurePosixPath(relative)
    if any(part in {"", ".", ".."} for part in pure.parts):
        raise VerificationError(f"INVALID_PAYLOAD_PATH:{relative}")
    return pure


def canonical_identity() -> tuple[str | None, str | None]:
    try:
        revision = subprocess.check_output(
            ["git", "-C", str(ROOT), "rev-parse", "HEAD"],
            text=True,
            stderr=subprocess.DEVNULL,
        ).strip()
        tree = subprocess.check_output(
            ["git", "-C", str(ROOT), "rev-parse", "HEAD^{tree}"],
            text=True,
            stderr=subprocess.DEVNULL,
        ).strip()
        return revision or None, tree or None
    except Exception:
        return None, None


def canonical_tracked_digests() -> dict[str, list[str]]:
    try:
        output = subprocess.check_output(
            ["git", "-C", str(ROOT), "ls-files", "-z"],
            stderr=subprocess.DEVNULL,
        )
    except Exception as exc:
        raise VerificationError("CANONICAL_GIT_TRACKED_FILES_UNAVAILABLE") from exc

    result: dict[str, list[str]] = {}
    for raw in output.split(b"\0"):
        if not raw:
            continue
        relative = raw.decode("utf-8")
        path = ROOT / relative
        if not path.is_file() or path.is_symlink():
            continue
        digest = sha256_file(path)
        result.setdefault(digest, []).append(relative)
    if not result:
        raise VerificationError("CANONICAL_TRACKED_DIGEST_SET_EMPTY")
    return result


def validate_manifest_schema(manifest: dict[str, Any]) -> None:
    if Draft202012Validator is None:
        raise VerificationError("JSONSCHEMA_DEPENDENCY_REQUIRED")
    schema = load_json(SCHEMA_PATH)
    try:
        Draft202012Validator.check_schema(schema)
    except Exception as exc:
        raise VerificationError(f"PREMIUM_SCHEMA_INVALID:{exc}") from exc
    errors = sorted(Draft202012Validator(schema).iter_errors(manifest), key=lambda error: list(error.absolute_path))
    if errors:
        error = errors[0]
        location = "/".join(str(part) for part in error.absolute_path) or "<root>"
        raise VerificationError(f"PREMIUM_MANIFEST_SCHEMA_ERROR:{location}:{error.message}")


def verify(
    repository: Path,
    *,
    expected_pack_id: str | None = None,
    expected_pack_version: str | None = None,
    expected_protocol_version: str | None = None,
) -> dict[str, Any]:
    repository = repository.resolve()
    if not repository.is_dir():
        raise VerificationError("PREMIUM_REPOSITORY_DIRECTORY_REQUIRED")

    contract = load_json(CONTRACT_PATH)
    if contract.get("status") != "contract_and_distribution_source_no_premium_payload":
        raise VerificationError("PREMIUM_CONTRACT_STATUS_UNEXPECTED")
    if contract.get("manifest_name") != MANIFEST_NAME:
        raise VerificationError("PREMIUM_CONTRACT_MANIFEST_NAME_MISMATCH")

    manifest_path = repository / MANIFEST_NAME
    if not manifest_path.is_file() or manifest_path.is_symlink():
        raise VerificationError("PREMIUM_MANIFEST_REQUIRED")
    manifest = load_json(manifest_path)
    validate_manifest_schema(manifest)

    pack_id = str(manifest["pack_id"])
    pack_version = str(manifest["pack_version"])
    if expected_pack_id is not None and pack_id != expected_pack_id:
        raise VerificationError(f"PREMIUM_PACK_ID_MISMATCH:{pack_id}")
    if expected_pack_version is not None and pack_version != expected_pack_version:
        raise VerificationError(f"PREMIUM_PACK_VERSION_MISMATCH:{pack_version}")

    compatibility = manifest["source_protocol_compatibility"]
    minimum = str(compatibility["minimum"])
    maximum = str(compatibility["maximum"])
    if semver_tuple(minimum) > semver_tuple(maximum):
        raise VerificationError("PREMIUM_PROTOCOL_COMPATIBILITY_RANGE_INVALID")
    if expected_protocol_version is not None:
        requested = semver_tuple(expected_protocol_version)
        if not (semver_tuple(minimum) <= requested <= semver_tuple(maximum)):
            raise VerificationError(f"PREMIUM_PROTOCOL_NOT_COMPATIBLE:{expected_protocol_version}")

    capabilities = {str(row["id"]): row for row in manifest["capabilities"]}
    if len(capabilities) != len(manifest["capabilities"]):
        raise VerificationError("PREMIUM_DUPLICATE_CAPABILITY_ID")

    providers = {str(row["provider_id"]): row for row in manifest["providers"]}
    if len(providers) != len(manifest["providers"]):
        raise VerificationError("PREMIUM_DUPLICATE_PROVIDER_ID")
    for provider_id, provider in providers.items():
        for capability_id in provider["capability_ids"]:
            if capability_id not in capabilities:
                raise VerificationError(f"PREMIUM_PROVIDER_UNKNOWN_CAPABILITY:{provider_id}:{capability_id}")
        if provider.get("partnership_or_certification_claim") is not False:
            raise VerificationError(f"PREMIUM_PROVIDER_PARTNERSHIP_CLAIM_FORBIDDEN:{provider_id}")

    allowed_prefixes = contract["allowed_path_prefixes"]
    canonical_digests = canonical_tracked_digests()
    listed_paths: set[str] = set()
    content_set_rows: list[str] = []
    total_bytes = 0

    for row in manifest["files"]:
        relative = str(row["path"])
        pure = safe_payload_path(relative)
        if relative in listed_paths:
            raise VerificationError(f"PREMIUM_DUPLICATE_FILE_PATH:{relative}")
        listed_paths.add(relative)

        asset_class = str(row["asset_class"])
        expected_prefix = str(allowed_prefixes.get(asset_class, ""))
        if not expected_prefix or not relative.startswith(expected_prefix):
            raise VerificationError(f"PREMIUM_ASSET_CLASS_PATH_MISMATCH:{relative}:{asset_class}")

        path = repository.joinpath(*pure.parts)
        try:
            resolved = path.resolve(strict=True)
        except FileNotFoundError as exc:
            raise VerificationError(f"PREMIUM_FILE_MISSING:{relative}") from exc
        if repository != resolved and repository not in resolved.parents:
            raise VerificationError(f"PREMIUM_PATH_ESCAPES_REPOSITORY:{relative}")
        if path.is_symlink() or not path.is_file():
            raise VerificationError(f"PREMIUM_REGULAR_FILE_REQUIRED:{relative}")

        actual_bytes = path.stat().st_size
        declared_bytes = int(row["bytes"])
        if actual_bytes != declared_bytes:
            raise VerificationError(f"PREMIUM_FILE_BYTE_COUNT_MISMATCH:{relative}")
        actual_sha = sha256_file(path)
        if actual_sha != row["sha256"]:
            raise VerificationError(f"PREMIUM_FILE_SHA256_MISMATCH:{relative}")
        if actual_sha in canonical_digests:
            copied = canonical_digests[actual_sha][0]
            raise VerificationError(f"PREMIUM_FILE_EXACT_COPY_OF_CANONICAL_SOURCE:{relative}:{copied}")

        sample = path.read_bytes().lower()
        for marker in SECRET_MARKERS:
            if marker in sample:
                raise VerificationError(f"PREMIUM_SECRET_MARKER_FORBIDDEN:{relative}:{marker.decode('ascii', 'ignore')}")

        capability_ids = [str(value) for value in row["capability_ids"]]
        for capability_id in capability_ids:
            if capability_id not in capabilities:
                raise VerificationError(f"PREMIUM_FILE_UNKNOWN_CAPABILITY:{relative}:{capability_id}")
            if asset_class not in capabilities[capability_id]["asset_classes"]:
                raise VerificationError(f"PREMIUM_CAPABILITY_ASSET_CLASS_MISMATCH:{relative}:{capability_id}")

        if asset_class == "premium_provider_adapter":
            parts = pure.parts
            if len(parts) < 4 or parts[0:2] != ("premium", "providers"):
                raise VerificationError(f"PREMIUM_PROVIDER_PATH_INVALID:{relative}")
            provider_id = parts[2]
            provider = providers.get(provider_id)
            if provider is None:
                raise VerificationError(f"PREMIUM_PROVIDER_MANIFEST_ENTRY_REQUIRED:{relative}:{provider_id}")
            missing = set(capability_ids) - set(provider["capability_ids"])
            if missing:
                raise VerificationError(f"PREMIUM_PROVIDER_CAPABILITY_MISMATCH:{relative}:{sorted(missing)}")

        total_bytes += actual_bytes
        content_set_rows.append(f"{relative}\0{actual_sha}\0{actual_bytes}\n")

    actual_payload_paths: set[str] = set()
    for path in repository.rglob("*"):
        if path.is_symlink():
            raise VerificationError(f"PREMIUM_SYMLINK_FORBIDDEN:{path.relative_to(repository).as_posix()}")
        if not path.is_file():
            continue
        relative = path.relative_to(repository).as_posix()
        if relative == MANIFEST_NAME:
            continue
        safe_payload_path(relative)
        actual_payload_paths.add(relative)
    if actual_payload_paths != listed_paths:
        missing = sorted(listed_paths - actual_payload_paths)
        extra = sorted(actual_payload_paths - listed_paths)
        raise VerificationError(f"PREMIUM_PAYLOAD_MANIFEST_SET_MISMATCH:missing={missing}:extra={extra}")

    provenance = manifest["provenance"]
    if provenance.get("distribution_scope") != "private_premium_repository":
        raise VerificationError("PREMIUM_PRIVATE_DISTRIBUTION_SCOPE_REQUIRED")
    if provenance.get("contains_customer_secrets") is not False or provenance.get("contains_operator_secrets") is not False:
        raise VerificationError("PREMIUM_SECRET_PROVENANCE_MUST_BE_FALSE")
    if provenance.get("derived_only_from_public_core") is not False:
        raise VerificationError("PREMIUM_DISTINCT_VALUE_REQUIRED")
    if provenance.get("immutable_release_identity_required") is not True:
        raise VerificationError("PREMIUM_IMMUTABLE_RELEASE_IDENTITY_REQUIRED")

    manifest_sha = sha256_file(manifest_path)
    content_set_sha = hashlib.sha256("".join(sorted(content_set_rows)).encode("utf-8")).hexdigest()
    revision, tree = canonical_identity()
    return {
        "ok": True,
        "verification": "anpos_private_premium_pack_contract_v1",
        "pack_id": pack_id,
        "pack_version": pack_version,
        "source_protocol_compatibility": {"minimum": minimum, "maximum": maximum},
        "verified_protocol_version": expected_protocol_version,
        "file_count": len(listed_paths),
        "total_bytes": total_bytes,
        "manifest_sha256": manifest_sha,
        "content_set_sha256": content_set_sha,
        "canonical_verifier_revision": revision,
        "canonical_verifier_tree": tree,
        "pro_sale_ready": False,
        "note": "Verification certifies pack integrity only; entitlement-gated distribution and production E2E remain required before Pro can be sold.",
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repository", required=True, type=Path, help="Private premium pack checkout/directory")
    parser.add_argument("--expected-pack-id")
    parser.add_argument("--expected-pack-version")
    parser.add_argument("--expected-protocol-version")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        receipt = verify(
            args.repository,
            expected_pack_id=args.expected_pack_id,
            expected_pack_version=args.expected_pack_version,
            expected_protocol_version=args.expected_protocol_version,
        )
    except VerificationError as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, sort_keys=True), file=sys.stderr)
        return 1
    print(json.dumps(receipt, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
