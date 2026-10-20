"""Generate compatibility redirects for former legacy page URLs."""

from pathlib import Path
import sys

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
var s=q.toString();location.replace("/workspace/app/#/"+route+(s?"?"+s:""));
})();
</script></body></html>
"""


def build(site: Path) -> None:
    for page in PAGES:
        (site / page).write_text(TEMPLATE.replace("__PAGE__", page), encoding="utf-8")


def check() -> None:
    import tempfile

    with tempfile.TemporaryDirectory() as tmp:
        site = Path(tmp)
        build(site)
        for page in PAGES:
            html = (site / page).read_text(encoding="utf-8")
            assert f'page="{page}"' in html and "/workspace/app/#/" in html, page


if __name__ == "__main__":
    if "--check" in sys.argv:
        check()
    else:
        index = sys.argv.index("--site") if "--site" in sys.argv else -1
        if index < 0 or index + 1 >= len(sys.argv):
            raise SystemExit("usage: build-legacy-redirects.py --site <directory>")
        site = Path(sys.argv[index + 1])
        site.mkdir(parents=True, exist_ok=True)
        build(site)
