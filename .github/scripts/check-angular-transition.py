"""Check the isolated Angular transition artifact and legacy entry points."""

from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[2]
SITE = ROOT / "_site"
ANGULAR = SITE / "app"


def require_file(path: Path, label: str) -> None:
    if not path.is_file():
        raise AssertionError(f"missing {label}: {path}")


def main() -> None:
    require_file(SITE / "index.html", "legacy home")
    require_file(SITE / "todos.html", "legacy todos page")
    index = ANGULAR / "index.html"
    require_file(index, "Angular transition entry point")

    html = index.read_text(encoding="utf-8")
    if '<base href="/workspace/app/">' not in html:
        raise AssertionError("Angular transition entry point has an unexpected base href")

    for forbidden in ("node_modules", "fixtures", "src", "angular.json", "package-lock.json"):
        if (ANGULAR / forbidden).exists():
            raise AssertionError(f"transition artifact contains forbidden path: {forbidden}")
    if any(path.is_file() and path.match("workspace-*.json") for path in SITE.rglob("*")):
        raise AssertionError("Pages artifact contains a workspace export")
    for path in SITE.rglob("*"):
        if path.is_file() and path.suffix in {".html", ".js", ".css"} and "fixture-password" in path.read_text(encoding="utf-8"):
            raise AssertionError("Pages artifact contains a fixture secret")
    if html.count("Content-Security-Policy") != 1:
        raise AssertionError("Angular transition entry point must contain exactly one Content-Security-Policy")
    if "Content-Security-Policy" not in html:
        raise AssertionError("Angular transition entry point has no Content-Security-Policy")

    print("Angular transition artifact valid; legacy entry points preserved.")


if __name__ == "__main__":
    try:
        main()
    except AssertionError as error:
        print(error, file=sys.stderr)
        sys.exit(1)
