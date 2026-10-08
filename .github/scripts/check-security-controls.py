"""Check external resource integrity and prevent personal data in Pages."""

from __future__ import annotations

from html.parser import HTMLParser
from pathlib import Path
import re
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[2]
HIGHLIGHT_PREFIX = "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/"
EXPECTED_SRI = {
    "highlight.min.js": "sha384-F/bZzf7p3Joyp5psL90p/p89AZJsndkSoGwRpXcZhleCWhd8SnRuoYo4d0yirjJp",
    "styles/atom-one-dark.min.css": "sha384-oaMLBGEzBOJx3UHwac0cVndtX5fxGQIfnAeFZ35RTgqPcYlbprH9o9PUV/F8Le07",
}
UNCONTROLLED_EXTERNAL = re.compile(r"https://(?:fonts\.googleapis\.com|fonts\.gstatic\.com)")
SECRET_MARKERS = re.compile(r"fixture-(?:password|secret|user)", re.IGNORECASE)


class ResourceParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.external: list[tuple[str, dict[str, str]]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = {name: value or "" for name, value in attrs}
        for key in ("src", "href"):
            value = values.get(key, "")
            if value.startswith(HIGHLIGHT_PREFIX):
                self.external.append((tag, values))


def main() -> None:
    errors: list[str] = []
    source_files = [*ROOT.glob("*.html"), *ROOT.glob("*.js"), *ROOT.glob("css/*.css"), *ROOT.glob("js/**/*.js")]
    for path in source_files:
        text = path.read_text(encoding="utf8")
        if UNCONTROLLED_EXTERNAL.search(text):
            errors.append(f"{path}: uncontrolled external font resource")
        if path.suffix.lower() == ".html":
            parser = ResourceParser()
            parser.feed(text)
            for tag, attrs in parser.external:
                url = attrs.get("src", "") or attrs.get("href", "")
                resource = url.removeprefix(HIGHLIGHT_PREFIX)
                if attrs.get("integrity") != EXPECTED_SRI.get(resource):
                    errors.append(f"{path}: external {tag} lacks sha384 integrity")

        for resource, integrity in EXPECTED_SRI.items():
            if f"{HIGHLIGHT_PREFIX}{resource}" in text and integrity not in text:
                errors.append(f"{path}: generated Highlight.js resource has an unexpected integrity hash")

    workflow = (ROOT / ".github" / "workflows" / "ci-cd.yml").read_text(encoding="utf8")
    for pattern in ("--exclude='workspace-*.json'",):
        if pattern not in workflow:
            errors.append(f"Pages artifact does not exclude {pattern}")

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

    for path in (ROOT / "angular" / "src").rglob("*"):
        if path.is_file() and path.suffix in {".ts", ".html", ".scss"} and not path.name.endswith(".spec.ts"):
            text = path.read_text(encoding="utf8")
            if SECRET_MARKERS.search(text):
                errors.append(f"possible fixture secret in application source: {path.relative_to(ROOT)}")

    if errors:
        print("\n".join(errors), file=sys.stderr)
        raise SystemExit(1)
    print("Published security controls valid: external resources have SRI and personal artifacts are excluded.")


if __name__ == "__main__":
    main()
