"""Host-neutral, bounded continuation loop; not a deployed AI agent.

The injected host must authenticate the principal, enforce leases/fencing,
verify each execution receipt, and CAS-write durable checkpoints. No identity,
review approval, runner or external permission is created by this module.
"""


class ContinuationSafetyError(RuntimeError):
    pass


def choose(candidates, completed, scopes, visited=frozenset()):
    ready = []
    kind_order = {"accepted_pr": 0, "actionable_issue": 1, "work_unit": 2}
    for item in candidates:
        identifier = item.get("id")
        if not isinstance(identifier, str) or not identifier:
            raise ContinuationSafetyError("Missing stable work item ID")
        if identifier in completed or identifier in visited:
            continue
        if item.get("kind") not in kind_order:
            continue
        if item.get("status") not in ("ready", "in_progress"):
            continue
        if item.get("external_blocker"):
            continue
        if item.get("independent_review_required") and not item.get("independent_review_approved"):
            continue
        if item.get("scope") not in scopes:
            continue
        if any(dep not in completed for dep in item.get("dependencies", [])):
            continue
        ready.append(item)
    return min(
        ready,
        key=lambda item: (
            item.get("phase", 999),
            kind_order[item["kind"]],
            item.get("priority", 999),
            item["id"],
        ),
        default=None,
    )


def run_continuation(host, max_milestones=8):
    """Execute a bounded number of eligible milestones without routine prompts.

    host.authority() returns verified current principal/lease evidence;
    host.snapshot() returns canonical revision/main SHA, items, completion set;
    host.execute(item, revision, fence) returns a verified source-bound receipt;
    host.checkpoint(receipt, expected_revision, fence) performs remote CAS.
    """
    if not isinstance(max_milestones, int) or not 1 <= max_milestones <= 32:
        raise ValueError("Bounded milestone budget required")
    completed_this_run = []
    visited = set()
    for _ in range(max_milestones):
        authority = host.authority()
        if not (
            authority.get("authenticated")
            and authority.get("lease_current")
            and authority.get("principal")
            and authority.get("epoch", 0) > 0
            and authority.get("fencing_token")
            and authority.get("scopes")
        ):
            raise ContinuationSafetyError("Unverified Supervisor principal or lease")
        snapshot = host.snapshot()
        revision, main_sha = snapshot.get("revision"), snapshot.get("main_sha")
        if not revision or not isinstance(main_sha, str) or len(main_sha) != 40:
            raise ContinuationSafetyError("Canonical main SHA/CAS revision missing")
        items = snapshot.get("items", [])
        ids = [item.get("id") for item in items]
        if len(ids) != len(set(ids)):
            raise ContinuationSafetyError("Duplicate work IDs")
        item = choose(items, set(snapshot.get("completed", [])),
                      set(authority["scopes"]), visited)
        if item is None:
            return completed_this_run
        visited.add(item["id"])
        receipt = host.execute(item, revision, authority["fencing_token"])
        if not (
            receipt.get("verified")
            and receipt.get("item_id") == item["id"]
            and receipt.get("source_sha") == main_sha
            and receipt.get("evidence_ref")
        ):
            raise ContinuationSafetyError("Mismatched or unverified work receipt")
        if host.checkpoint(receipt, revision, authority["fencing_token"]) is not True:
            raise ContinuationSafetyError("Durable CAS checkpoint failed")
        if host.snapshot().get("revision") == revision:
            raise ContinuationSafetyError("Checkpoint claimed without state transition")
        completed_this_run.append(item["id"])
    return completed_this_run
