"""Write the legacy *.html entry points of _site as redirects to the Angular app.

The URL mapping mirrors LegacyRouteService (angular/src/app/core/routing).
Run `python3 .github/scripts/build-legacy-redirects.py --check` to self-test.
"""

from pathlib import Path
import sys

SITE = Path(__file__).resolve().parents[2] / "_site"
PAGES = (
    "index.html", "todos.html", "projects.html", "project.html", "snippets.html",
    "rh.html", "journal.html", "smart-planning.html", "settings.html", "export.html",
)
TEMPLATE = """<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><title>Workspace</title>
<noscript><meta http-equiv="refresh" content="0;url=/workspace/app/"></noscript></head>
<body><script>
(function(){
var page="__PAGE__",q=new URLSearchParams(location.search),route=page==="index.html"?"home":page.slice(0,-5);
if(page==="project.html"){var id=q.get("id");if(id){route="project/"+encodeURIComponent(id);q.delete("id")}else{route="projects";q=new URLSearchParams()}}
if(page==="project.html"||page==="rh.html"||page==="snippets.html"){var f=q.get("folder");q.delete("folder");if(f&&!q.get("path"))q.set("path",f)}
var s=q.toString();
location.replace("/workspace/app/#/"+route+(s?"?"+s:""));
})();
</script></body></html>
"""


def build(site: Path) -> None:
    for page in PAGES:
        (site / page).write_text(TEMPLATE.replace("__PAGE__", page), encoding="utf-8")


def check() -> None:
    import tempfile
    with tempfile.TemporaryDirectory() as tmp:
        build(Path(tmp))
        for page in PAGES:
            html = (Path(tmp) / page).read_text(encoding="utf-8")
            assert f'page="{page}"' in html and "/workspace/app/#/" in html, page


if __name__ == "__main__":
    check() if "--check" in sys.argv else build(SITE)
