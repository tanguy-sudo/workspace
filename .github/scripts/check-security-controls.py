"""Check external resource integrity and prevent personal data in Pages."""

from __future__ import annotations

from pathlib import Path
import re
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[2]
SECRET_MARKERS = re.compile(r"fixture-(?:password|secret|user)", re.IGNORECASE)


def main() -> None:
    errors: list[str] = []
    ignored_export = subprocess.run(
        ["git", "check-ignore", "--quiet", "workspace-example.json"],
        cwd=ROOT,
        check=False,
    )
    if ignored_export.returncode != 0:
        errors.append("workspace-*.json must be ignored by Git")
    tracked_exports = subprocess.run(
        ["git", "ls-files", "--", "workspace-*.json"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    if tracked_exports.stdout.strip():
        errors.append("workspace exports must not be tracked by Git")

    for page in ("index.html", "todos.html", "projects.html", "project.html", "snippets.html", "rh.html", "journal.html", "smart-planning.html", "settings.html", "export.html"):
        if (ROOT / page).exists():
            errors.append(f"legacy application page must not be present on main: {page}")
    tracked_paths = subprocess.run(
        ["git", "ls-files", "--", "js/", "css/"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    tracked_sources = [path for path in tracked_paths.stdout.splitlines() if (ROOT / path).exists()]
    if tracked_sources:
        directory = tracked_sources[0].split("/")[0]
        errors.append(f"legacy source directory must not be tracked on main: {directory}")

    for path in (ROOT / "angular" / "src").rglob("*"):
        if path.is_file() and path.suffix in {".ts", ".html", ".scss"} and not path.name.endswith(".spec.ts"):
            if SECRET_MARKERS.search(path.read_text(encoding="utf8")):
                errors.append(f"possible fixture secret in application source: {path.relative_to(ROOT)}")

    if errors:
        print("\n".join(errors), file=sys.stderr)
        raise SystemExit(1)
    print("Published security controls valid: application sources contain no fixture secrets or personal exports.")


if __name__ == "__main__":
    main()
