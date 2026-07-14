---
name: Mongo multi-document transactions and duplicate-key errors
description: Why catching E11000 inside a session.withTransaction() block still crashes the whole operation, and the fix.
---

Inside a MongoDB multi-document transaction (`session.withTransaction`), a single failed write — even one caught and swallowed by application code (e.g. `catch (err) { if (err.code !== 11000) throw err; }`) — marks the entire session as aborted. Every subsequent operation in that same transaction then fails with `MongoServerError: Transaction with { txnNumber: N } has been aborted`, even though your code never re-threw.

**Why:** MongoDB transactions abort at the server/session level on write conflicts, not just at the driver/application level. try/catch only stops the JS control flow from propagating the error upward; it does not un-abort the session.

**How to apply:** When an operation inside a transaction is expected to sometimes hit a unique-index conflict as a normal case (e.g. "block this identifier, but it might already be blocked" — idempotent upsert-like behavior), pre-check for existing matching documents with a `find`/`findOne` *inside the same session* first, and only attempt the insert for documents that don't already exist. Reserve the catch-and-inspect-E11000 pattern for genuine unexpected races, and in that case let the error propagate (abort + surface a 409/Conflict to the caller) rather than trying to keep using the same session afterward.
