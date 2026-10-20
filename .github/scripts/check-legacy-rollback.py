"""Validate a legacy-only rollback Pages artifact."""

from html.parser import HTMLParser
from pathlib import Path
import os
import re
import sys
from urllib.parse import unquote, urlparse


SITE = Path(os.environ.get("WORKSPACE_LEGACY_SOURCE", "_site")).resolve()
CSS_URL = re.compile(r"url\(\s*(?:['\"]([^'\"]+)['\"]|([^)]*?))\s*\)", re.IGNORECASE)


class ResourceParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.references: list[str] = []

    def handle_starttag(self, _tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.references.extend(value for name, value in attrs if name in {"href", "src"} and value)


def local_path(source: Path, reference: str) -> Path | None:
    parsed = urlparse(reference.strip())
    if not reference or reference.startswith(("#", "//")) or parsed.scheme:
        return None
    path = unquote(parsed.path)
    if not path:
        return None
    return (SITE / path.lstrip("/")) if path.startswith("/") else (source.parent / path)


def main() -> None:
    required = ("index.html", "todos.html", "projects.html", "export.html", "settings.html")
    for relative in required:
        if not (SITE / relative).is_file():
            raise AssertionError(f"missing legacy page: {relative}")

    if '"workspace:data-write"' not in (SITE / "js" / "db.js").read_text(encoding="utf-8"):
        raise AssertionError("legacy snapshot predates the TAN-58 cross-version write lock")
    if "WorkspaceDB.canWrite" not in (SITE / "js" / "storage.js").read_text(encoding="utf-8"):
        raise AssertionError("legacy snapshot does not guard shared Workspace writes")

    if os.environ.get("WORKSPACE_CHECK_ARTIFACT") == "1" and any(
        path.is_file()
        and path.match("workspace-*.json")
        and path.name not in {"workspace-empty.json", "workspace-full.json", "workspace-with-vault.json", "workspace-legacy-local-storage.json"}
        for path in SITE.rglob("*")
    ):
        raise AssertionError("rollback artifact contains a Workspace export")

    for source in (path for path in SITE.rglob("*") if path.is_file() and path.suffix.lower() in {".html", ".css"}):
        if source.suffix.lower() == ".html":
            parser = ResourceParser()
            text = source.read_text(encoding="utf-8")
            parser.feed(text)
            references = parser.references
        else:
            text = source.read_text(encoding="utf-8")
            references = [match.group(1) or match.group(2) for match in CSS_URL.finditer(text)]

        for reference in references:
            if source.name == "index.html" and reference == "/":
                continue
            if source == SITE / "angular" / "src" / "index.html" and reference == "favicon.ico":
                continue
            candidate = local_path(source, reference)
            if candidate is None:
                continue
            try:
                candidate.resolve().relative_to(SITE)
            except ValueError as error:
                raise AssertionError(f"resource escapes rollback artifact: {source}: {reference}") from error
            if not candidate.is_file():
                raise AssertionError(f"missing rollback resource: {source}: {reference}")

    print("Legacy rollback artifact valid.")


if __name__ == "__main__":
    try:
        main()
    except AssertionError as error:
        print(error, file=sys.stderr)
        sys.exit(1)
