"""Bounded AI-native continuation core; requires a real authenticated host.

This is not a persistent agent or a deployment. The injected runtime must
authenticate a principal, maintain a real fenced lease, verify execution
receipts, and persist checkpoints with remote compare-and-swap.
"""

from __future__ import annotations

from datetime import datetime, timezone


class ContinuationSafetyError(RuntimeError):
    """Authority, provenance, checkpoint or tampering fault: fail closed."""


class RetryableWorkError(RuntimeError):
    """A specifically classified ordinary work failure that may be repaired."""


class BlockedWorkError(RuntimeError):
    """A lane-specific external gate; do not stop other eligible lanes."""


KIND_ORDER = {"accepted_pr": 0, "actionable_issue": 1, "work_unit": 2}


def _valid_sha(value):
    return isinstance(value, str) and len(value) == 40 and all(
        character in "0123456789abcdef" for character in value.lower()
    )


def _authority(host, scope=None):
    authority = host.authority()
    if not isinstance(authority, dict):
        raise ContinuationSafetyError("Missing authenticated authority record")
    expiry = authority.get("expires_at")
    try:
        expiry = datetime.fromisoformat(expiry.replace("Z", "+00:00"))
    except (AttributeError, TypeError, ValueError):
        raise ContinuationSafetyError("Missing or invalid lease expiry") from None
    if (
        authority.get("authenticated") is not True
        or authority.get("identity_verified") is not True
        or authority.get("lease_current") is not True
        or not isinstance(authority.get("principal"), str)
        or not authority["principal"].strip()
        or type(authority.get("epoch")) is not int
        or authority["epoch"] < 1
        or not isinstance(authority.get("fencing_token"), str)
        or not authority["fencing_token"].strip()
        or not isinstance(authority.get("scopes"), (list, tuple, set, frozenset))
        or not authority["scopes"]
        or expiry.tzinfo is None
        or expiry <= datetime.now(timezone.utc)
    ):
        raise ContinuationSafetyError("No verified, unexpired, scoped Supervisor lease")
    if scope is not None and scope not in authority["scopes"]:
        raise ContinuationSafetyError("Supervisor no longer authorized for selected work scope")
    return authority


def _snapshot(host):
    snapshot = host.snapshot()
    if not isinstance(snapshot, dict):
        raise ContinuationSafetyError("Canonical snapshot missing")
    revision, main_sha, items = (
        snapshot.get("revision"),
        snapshot.get("main_sha"),
        snapshot.get("items"),
    )
    if (
        not isinstance(revision, str)
        or not revision.strip()
        or not _valid_sha(main_sha)
        or not isinstance(items, (list, tuple))
        or not isinstance(snapshot.get("completed"), (list, tuple, set, frozenset))
    ):
        raise ContinuationSafetyError("Invalid source revision, main SHA or canonical work state")
    ids = [item.get("id") if isinstance(item, dict) else None for item in items]
    if any(not isinstance(identifier, str) or not identifier.strip() for identifier in ids):
        raise ContinuationSafetyError("Canonical work item identifier missing")
    if len(ids) != len(set(ids)):
        raise ContinuationSafetyError("Duplicate canonical work identifiers")
    return snapshot


def choose(candidates, completed, scopes, visited=frozenset()):
    """Deterministically select highest-priority, independently eligible work."""
    ready = []
    for item in candidates:
        identifier = item["id"]
        if identifier in completed or identifier in visited:
            continue
        if item.get("kind") not in KIND_ORDER:
            continue
        if item.get("status") not in ("ready", "in_progress"):
            continue
        if item.get("external_blocker"):
            continue
        if item.get("independent_review_required") and not item.get("independent_review_approved"):
            continue
        if item.get("scope") not in scopes:
            continue
        if any(dep not in completed for dep in item.get("dependencies", ())):
            continue
        ready.append(item)
    return min(
        ready,
        key=lambda item: (
            item.get("phase", 999),
            KIND_ORDER[item["kind"]],
            item.get("priority", 999),
            item["id"],
        ),
        default=None,
    )


def _same_authority(previous, current):
    for key in ("principal", "epoch", "fencing_token"):
        if current.get(key) != previous.get(key):
            raise ContinuationSafetyError("Supervisor principal, epoch or fencing changed mid-milestone")


def run_continuation(host, max_milestones=8, max_retries_per_item=2):
    """Advance bounded milestones without owner handoffs or unsafe authority reuse.

    Required host methods: authority(), snapshot(), execute(item, revision, fence),
    checkpoint(receipt, revision, fence). For classified RetryableWorkError,
    host.repair(item, revision, fence) is optional; without it a failed lane
    is skipped. A retry/repair never bypasses fresh identity and snapshot checks.
    Unknown exceptions and all safety failures stop the invocation rather than
    being disguised as ordinary repairable failures.
    """
    if type(max_milestones) is not int or not 1 <= max_milestones <= 32:
        raise ValueError("Bounded milestone budget required")
    if type(max_retries_per_item) is not int or not 0 <= max_retries_per_item <= 3:
        raise ValueError("Bounded retry budget required")

    verified = []
    visited = set()
    for _ in range(max_milestones):
        authority = _authority(host)
        snapshot = _snapshot(host)
        item = choose(
            snapshot["items"],
            set(snapshot["completed"]),
            set(authority["scopes"]),
            visited,
        )
        if item is None:
            return verified
        visited.add(item["id"])
        revision = snapshot["revision"]
        main_sha = snapshot["main_sha"]
        fence = authority["fencing_token"]
        receipt = None

        for attempt in range(max_retries_per_item + 1):
            refreshed = _authority(host, item["scope"])
            _same_authority(authority, refreshed)
            current = _snapshot(host)
            if current["revision"] != revision or current["main_sha"] != main_sha:
                raise ContinuationSafetyError("Canonical source advanced before execution")
            try:
                receipt = host.execute(item, revision, fence)
                break
            except BlockedWorkError:
                receipt = None
                break
            except RetryableWorkError:
                receipt = None
                repair = getattr(host, "repair", None)
                if attempt >= max_retries_per_item or not callable(repair):
                    break
                # Repair is a separate mutation: recheck authenticated authority
                # and canonical source BEFORE running it, not only afterward.
                still_authorized = _authority(host, item["scope"])
                _same_authority(authority, still_authorized)
                repair_base = _snapshot(host)
                if repair_base["revision"] != revision or repair_base["main_sha"] != main_sha:
                    raise ContinuationSafetyError("Canonical source drift before authorized repair")
                repair(item, revision, fence)
                # Fresh lease and revision are checked again at the retry.
        if receipt is None:
            # Scope only this ordinary/external blocker to the attempted lane.
            continue
        if not isinstance(receipt, dict) or not (
            receipt.get("verified") is True
            and receipt.get("item_id") == item["id"]
            and receipt.get("source_sha") == main_sha
            and isinstance(receipt.get("evidence_ref"), str)
            and receipt["evidence_ref"].strip()
        ):
            raise ContinuationSafetyError("Fabricated, incomplete or wrong-source milestone receipt")

        refreshed = _authority(host, item["scope"])
        _same_authority(authority, refreshed)
        latest = _snapshot(host)
        if latest["revision"] != revision or latest["main_sha"] != main_sha:
            raise ContinuationSafetyError("Canonical source drift before protected checkpoint")
        if host.checkpoint(receipt, revision, fence) is not True:
            raise ContinuationSafetyError("CAS checkpoint failed; unsafe to proceed")
        after = _snapshot(host)
        if after["revision"] == revision:
            raise ContinuationSafetyError("Checkpoint not durably reflected in canonical revision")
        # A verified milestone is NOT automatically a completed work unit.
        verified.append(item["id"])
    return verified
