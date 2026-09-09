# Commercial Legal Document Evidence

Status: **operator/counsel evidence pending**. This is not legal advice and does not authorize sale.

`config/licensing/legal-approval.json` remains the commercial legal decision authority. `config/licensing/legal-document-evidence.json` adds integrity/provenance requirements so a future approval cannot float independently of the exact customer-facing documents that were reviewed.

## Evidence required per document

For Terms, Privacy, commercial license/EULA, refund/cancellation policy, and support terms, retain:

- explicit approved state;
- document version;
- SHA-256 of the reviewed customer-facing content or retained immutable artifact;
- effective customer-facing URL when applicable;
- reviewer identity/authority reference;
- review timestamp.

The approval must also bind the intended commercial-service and ANPOS protocol release scope. A later material document or product change requires a new evidence record rather than silently reusing an old approval.

## Fail-closed rule

Templates, draft prose, repository commits, or generic counsel discussions are not approval evidence. Until exact document evidence and release scope are present, `legal_evidence_complete` remains false and commercial launch must continue to treat the legal gate as pending.
