# Workspace Data Contract

This document is the compatibility boundary between the legacy application and
the Angular application. The TypeScript definitions live in
`angular/src/app/core/persistence/workspace-data.ts` and are based on the
fixtures in `fixtures/`.

## Persisted Storage

The first Angular increment must keep the existing IndexedDB shape exactly:

| Property | Value |
|---|---|
| Database | `workspace` |
| Dexie schema version | `1` |
| Object store | `kv` |
| Primary key | `key` |
| Workspace row | `{ key: "data", value: WorkspaceData }` |
| Backup directory row | `{ key: "backupDirHandle", value: FileSystemDirectoryHandle }` |
| Legacy source | `localStorage["workspace_data"]` |

`kv["data"]` contains the complete workspace root. The legacy localStorage
value is the raw root object, not an export envelope. Migration is attempted
only when the IndexedDB data row does not exist. A successful migration writes
the same object to `kv["data"]`; it does not delete or rewrite the legacy key.

The current legacy runtime keeps a synchronous in-memory cache and persists
mutations with a short debounce. The Angular adapter must preserve the same
read/write semantics until a separate migration explicitly changes them.

## Canonical Root

`WorkspaceData` contains these sections:

| Section | Shape | Compatibility rule |
|---|---|---|
| `projects` | project array with nested folders/items | Keep project IDs, `parentId`, child order and item fields. |
| `rh` | RH folder/document tree | Keep node IDs, tree order, Markdown, tags and attachments. |
| `todos` | task array | Keep IDs, status, priority, dates, recurrence, dependencies and optional fields. |
| `snippets` | snippet array | Keep IDs, code, language, tags, favorite state and `folderId`. |
| `snippetFolders` | folder tree | Keep folder IDs and hierarchy. |
| `snippetMixedOrder` | `Record<string, string[]>` | Keep `f:<id>` and `s:<id>` tokens and their order. |
| `favorites` | folder/link tree | Keep link URLs, IDs and order. |
| `journal` | journal entry array | Keep Markdown, mood, tags and timestamps. |
| `trash` | soft-deleted entry array | Keep original fields and `_trashType`/`_deletedAt` metadata. |
| `recentlyVisited` | visit array | Keep type, ID, label and timestamp. |
| `activityLog` | activity array | Keep type, action, IDs, labels and timestamp. |
| `settings` | settings object | Keep preferences, saved views, templates and vault configuration. |

The TypeScript interfaces use index signatures for forward-compatible fields.
Unknown root, section, node and item fields must survive a read followed by a
write. Optional fields must not be replaced with defaults when they are already
present. Defaults may be applied only when reading an actually missing legacy
field, and the original unknown fields must still be retained.

## Export Envelope

The complete JSON export remains:

```json
{
  "_meta": {
    "app": "Workspace",
    "version": 6,
    "exportedAt": "ISO-8601 timestamp"
  },
  "data": { "...": "WorkspaceData" }
}
```

The export version (`6`) and the Dexie schema version (`1`) are different
version spaces. Section exports and the raw legacy localStorage value do not
have to contain `_meta`.

Section JSON keeps the legacy shapes (`todos` is an array; snippets use
`{ "snippets", "folders" }`; tree sections contain their tree root). Markdown
and CSV are readable projections: CSV keeps the historical task columns and
adds current fields such as `priorityId`, `description`, recurrence and
dependencies. The complete JSON and JSON files inside ZIP archives are
lossless. Readable Markdown/CSV and individual ZIP files omit password/login
values from project password items; encrypted vault payloads remain in JSON
when the vault is enabled.

## Cryptographic Compatibility

The historical password vault format is immutable for the first increment:

- PBKDF2 with SHA-256;
- 250000 iterations;
- random 16-byte salt, Base64 encoded;
- AES-GCM with a 256-bit key;
- random 12-byte IV, Base64 encoded;
- encrypted payload fields `iv` and `cipher`;
- vault fields `salt`, `iterations`, `verifier.iv`, `verifier.cipher` and
  `secretEncrypted.iv`/`secretEncrypted.cipher`.

Angular must read and write this format without re-encrypting existing values
just because another view was opened. A cryptographic format change requires a
new explicit migration and a fixture that can still be opened by the legacy
application.

## Versioning Rules

1. Keep Dexie schema version `1` while the database still contains the single
   `kv` store. Do not bump it for TypeScript-only changes or new optional fields.
2. Bump the Dexie version only when stores, indexes or physical row shapes
   change. Every bump needs an upgrade function, an old-database fixture and a
   reopen/read/write test before release.
3. Keep export version `6` for additive, optional and unknown fields. Bump it
   only when the envelope or the meaning of an existing field changes.
4. A renamed, removed or reinterpreted field requires a versioned migration;
   silently dropping it is forbidden.
5. Migrations are forward-only, idempotent and non-destructive. They must be
   safe to run again after an interrupted page load.
6. Before a destructive import or schema migration, create a complete JSON
   backup. Never use a blind overwrite as a rollback strategy.

## Forbidden Changes

The following changes are out of contract and require a dedicated migration
decision, fixtures and compatibility tests:

- renaming `workspace`, `kv`, `data`, `backupDirHandle` or `workspace_data`;
- splitting the root into new stores while legacy can still be used;
- replacing a complete `kv["data"]` write with section-only writes;
- normalizing away unknown fields, optional fields or ordering tokens;
- changing local date strings or recurrence semantics;
- converting encrypted vault values to clear text or changing their encoding;
- deleting the legacy pages, key or export format during coexistence;
- allowing legacy and Angular to own the same writes concurrently without a
  coordination mechanism.

## Verification

The contract test serializes and reads `fixtures/workspace-full.json`. It checks
all required sections, representative nested IDs, recurrence, mixed snippet
order, attachment data, encrypted vault fields and an injected unknown field.
Any codec change that loses one of these values fails the test.

```text
cd angular
npm ci
npm test -- --watch=false
```
