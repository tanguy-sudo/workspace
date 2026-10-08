from html.parser import HTMLParser
from pathlib import Path
import re
import sys
from urllib.parse import unquote, urlparse


ROOT = Path(__file__).resolve().parents[2]
CSS_URL = re.compile(r"url\(\s*(?:['\"]([^'\"]+)['\"]|([^)]*?))\s*\)", re.IGNORECASE)


class ResourceParser(HTMLParser):
    def __init__(self, source):
        super().__init__()
        self.source = source
        self.references = []

    def handle_starttag(self, _tag, attrs):
        for name, value in attrs:
            if name in {"href", "src"} and value:
                self.references.append(value)


def is_local_reference(value):
    value = value.strip()
    parsed = urlparse(value)
    return bool(value and not value.startswith("#") and not value.startswith("//") and not parsed.scheme)


def check_reference(source, value):
    if not is_local_reference(value):
        return None

    path = unquote(urlparse(value).path)
    if not path:
        return None

    candidate = (ROOT / path.lstrip("/")) if path.startswith("/") else ROOT / source.parent / path
    candidate = candidate.resolve()

    try:
        candidate.relative_to(ROOT)
    except ValueError:
        return f"{source}: resource escapes repository: {value}"

    if not candidate.is_file():
        return f"{source}: missing resource: {value}"
    return None


def references_in(source):
    text = source.read_text(encoding="utf-8")
    if source.suffix.lower() == ".html":
        parser = ResourceParser(source)
        parser.feed(text)
        return parser.references
    return [match.group(1) or match.group(2) for match in CSS_URL.finditer(text)]


errors = []
for relative in ROOT.rglob("*.html"):
    # Angular resolves source templates and public assets during its build;
    # their source-relative paths are not legacy HTML resources.
    source = relative.relative_to(ROOT)
    if source.parts[:1] == ("angular",):
        continue
    errors.extend(error for value in references_in(relative) if (error := check_reference(source, value)))

for relative in ROOT.rglob("*.css"):
    source = relative.relative_to(ROOT)
    errors.extend(error for value in references_in(relative) if (error := check_reference(source, value)))

if errors:
    print("\n".join(errors), file=sys.stderr)
    sys.exit(1)

print("All local HTML/CSS resources exist.")
