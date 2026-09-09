# Commercial Artifact Freshness Evidence

Status: **fresh artifact evidence required after canonical source changes**.

The canonical repository may remain fully certified while previously generated vendor/operator artifacts become stale. `config/release/commercial-artifact-freshness.json` makes that boundary explicit.

## Freshness rule

Whenever canonical source revision or tree changes, regenerate and reverify:

- vendor commercial-service export;
- vendor customer-template export;
- operator launch bootstrap artifact.

Retain exact canonical revision/tree identity, commercial-service version, immutable artifact references, and verification-receipt/digest evidence. All three outputs must derive from the same latest certified canonical revision.

## What does not prove freshness

A previous successful vendor packaging run, an older operator bootstrap, matching protocol version alone, or a green health endpoint cannot prove the artifact matches the latest source tree.

`artifact_freshness_verified` remains false until fresh evidence is recorded after the latest canonical change.
