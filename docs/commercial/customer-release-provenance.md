# Customer Release Provenance

Status: **current release identity is source-known; shipped artifact provenance is pending**.

The source identity is ANPOS 1.3.13, commercial service 0.3.9, runtime contract `split-github-app-v1`. `config/release/customer-release-provenance.json` prevents those source versions from being mistaken for proof that a particular customer artifact was built, handed off and published from the same exact canonical tree.

Before publication, bind the exact canonical revision/tree, immutable artifact SHA-256, vendor handoff receipt and published release reference. The customer release-note draft must match that bound identity.

Until then, the release note remains a draft and `customer_release_publication_authorized` remains false.
