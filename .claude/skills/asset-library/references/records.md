# Records

The contract `scripts/library.py` implements and `scripts/test_library.py` exercises on a throwaway library. Read it before changing either. Flags are in `library.py COMMAND --help`, columns in `sqlite3 library.db .schema`; this file holds what neither shows: the meaning of fields and the invariants the code must keep.

## Cut declaration

The producing skill knows which library entries a cut selected; the library can't infer that from a project folder, so the producer writes the list into one declaration file per cut (format in SKILL.md step 4). `used --from FILE` records every entry in one transaction, or none when any is invalid. A `file` entry is hashed and must match its asset. `deliver --declared FILE` stores the resolved list on the delivery row, so later checks don't need the file.

## Uses

- `cut` is the project's cut (`v3`, `final-1.15x`), stored in the `version` column; `--version` stays as an alias of `--cut`.
- `artifact_version` is required on new rows: a media file's hash, or the bundle version copied into the project. Empty only on legacy rows, meaning unknown. Never filled in with "latest" and never back-filled.
- `modified` is true when the project changed a bundle's files after copying; `artifact_version` is then the version it started from.
- `role` is one of the `--role` choices. Older free-text roles stay as written and are reported, not rewritten.
- Recording an identical use again changes nothing.

## Invariants

- **Root**: one folder (`library.db`, `media/`, `bundles/`, `previews/`, `exports/` from `init`; an existing library may keep media anywhere under it). Paths are relative to the root, so it moves or syncs as one folder; older absolute paths stay as they are. Lookup: `--root`, else `ASSET_LIBRARY_ROOT`, else a ``Root: `PATH` `` line in `~/.asset-library/profile.md`.
- **Authority**: the database. Every write is one command in one transaction, so concurrent agents can't half-write a record; a writer waits up to 30 s. Nothing deletes rows; `archive` hides one from search and keeps its uses. Search also hides byte-identical duplicates (`canonical_id`).
- **Import** (`import CATALOG.json`) adds IDs the database lacks, marks a byte-identical file as a duplicate, skips entries whose file is missing, and reports fields that differ for existing IDs. It changes an existing row only with `--update ID`, and then only the fields the entry states. Invalid IDs, kinds or tags are reported, not added; unknown keys go to `extra_json`.
- **Schema** (`meta.schema_version`, now 2): opening an older database first writes `library.db.bak-<old>-<timestamp>` with SQLite's backup API, then migrates in one transaction by adding tables and nullable columns. Migrations never drop or rewrite rows. A newer or non-integer version is refused and left unchanged.
- **Export**: `exports/library.json` holds every row of every table, including tables a local adapter added (the search index is left out; a BLOB is `{"base64": "…"}`), plus a browsable `exports/index.html`.
- **Adapter**: a local script can `import library` and use `Library(root)` and `main(argv, root=…, extend=…)`; the module docstring lists the interface.

## Versions and bundles

```text
bundles/<id>/<short-version>/
  bundle.json     {id, kind, version, content, record}
  files/…         snapshot of every listed file
```

- The **version** is the full SHA-256 of the canonical JSON (sorted keys, no whitespace) of the content fields: `entry`, `files` (path, sha256, size), `dependencies`, `example`, `preview`, `validate`, and `dimensions` when given. The record fields (`origin`, `created_at`, `title`, `planned_use`) don't change it; notes live in the database. Commands print a 12-hex short form and accept any unique prefix of at least 4 hex; a folder name lengthens until unique on a collision.
- Required content: code and character need entry, example, preview and a validation command (or a recorded `--no-validate` reason); a model needs entry and preview. All three need `planned_use`. Media kinds need no bundle: `ingest` sets their hash and probe fields.
- Files come from `--files` under `--source`; a path that leaves the source, including through a symlink, is refused. Folders skip `.git`, `node_modules`, `__pycache__` and `.venv`.
- `origin` records the source folder with its git commit and whether the tree was dirty, or the `--origin` text. A skill-relative path alone isn't a version, because the skill changes; the snapshot is.
- `validate` is `{command, cwd, setup, env, timeout_s}`, run in a fresh temporary copy of the published snapshot. Its result (`passed`, `failed`, `not-run`) is stored on the version with a `test` note holding the exit status and output tail. A setup that needs the network or a licensed tool fails without them.
- **Legacy** assets registered before bundles existed have no known historical version. A bundle captured from today's files is a new version, never back-dated onto old uses. The first bundle moves the asset's `path` and preview into `bundles/` and keeps the old pointer in a `caveat` note.

### Publishing a version

`register` never exposes a version whose files are partial or differ from its digest:

1. **Stage**: hash the listed files, copy them into `bundles/.staging/<random>/files/` on the library's filesystem.
2. **Verify**: hash the copies and refuse if any changed mid-copy; write `bundle.json` and compute the version.
3. **Publish**: reuse an existing folder with the same full digest, or rename the staging folder into place (atomic on one filesystem).
4. **Record**: insert the version row in one transaction; only now do `search` and `show` see it. Then validate.
5. **On failure** before step 4, remove the staging folder. A published folder with no row (a crash between 3 and 4) is reported by `check` as an orphan and adopted by the next `register` of the same content after re-verifying; it is never served. Re-registering an identical version whose validation failed runs it again.

## Project check

`check --project P --cut C` reads the declaration from `--declared FILE`, or from the delivery row once the cut is delivered. It fails when there is no declaration for the cut or it names another project or cut; when a declared entry has no use for P and C (a use in another cut doesn't count); when a declared version differs from its use row (a legacy use with no version never matches); when a use points at a missing asset, version, file or folder; or when the newest bundle version registered from P is incomplete, differs from its manifest or failed validation. `deliver` also fails when a version registered from P since its last delivery (and not failed) is missing from `--registered`, and writes nothing while anything fails.

Without failing, it lists unrecorded references (library assets outside the declaration whose ID appears in a text file under the declaration's folder or `--project-dir`, or whose bytes match a file there; hidden folders, `node_modules` and the library are skipped, and the scan stops at 20,000 files), uses the declaration leaves out, legacy roles, legacy uses with unknown versions, and bundles from P that were never validated. It can't judge whether something should have been registered or was a good choice.
