# End-to-end tests

The suite uses a persistent Chromium profile created under `e2e/.profiles/`.
That directory is ignored and must never contain a personal browser profile.

Run it locally from the repository root:

```bash
python3 e2e/run.py
```

The runner builds Angular, serves an isolated copy of the site, seeds either
`workspace-empty.json` or `workspace-full.json` through the browser, and runs
the critical navigation, persistence, CRUD, import/export, vault, shortcut,
modal, responsive and Angular/legacy write-lock checks. Failed runs write
screenshots, page HTML and a redacted console log to `e2e/artifacts/`.

The browser executable can be selected with `WORKSPACE_BROWSER`. Chromium is
the default on CI; a local Chrome or Edge executable is also accepted.

The suite intentionally does not use a personal profile, real credentials,
or real network resources. File System Access and notifications are exercised
through their browser fallbacks when unavailable.
