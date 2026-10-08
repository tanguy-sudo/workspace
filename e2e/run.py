"""Run the TAN-48 browser smoke suite with an isolated persistent profile."""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import traceback
from contextlib import suppress
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

from playwright.sync_api import Page, expect, sync_playwright


ROOT = Path(__file__).resolve().parents[1]
ANGULAR = ROOT / 'angular'
FIXTURES = ROOT / 'fixtures'
ARTIFACTS = ROOT / 'e2e' / 'artifacts'
PROFILES = ROOT / 'e2e' / '.profiles'
PORT = int(os.environ.get('WORKSPACE_E2E_PORT', '4173'))
BASE_URL = f'http://127.0.0.1:{PORT}'
APP_URL = f'{BASE_URL}/workspace/app/'


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, _format: str, *_args: object) -> None:
        pass


def build_site() -> Path:
    npm = shutil.which('npm') or shutil.which('npm.cmd') or 'npm.cmd'
    subprocess.run([npm, 'run', 'build'], cwd=ANGULAR, check=True)

    site = ROOT / '_site'
    shutil.rmtree(site, ignore_errors=True)
    (site / 'workspace' / 'app').mkdir(parents=True)
    shutil.copytree(
        ANGULAR / 'dist' / 'workspace' / 'app' / 'browser',
        site / 'workspace' / 'app',
        dirs_exist_ok=True,
    )
    for source in ROOT.glob('*.html'):
        shutil.copy2(source, site / source.name)
    shutil.copy2(ROOT / 'e2e' / 'seed.html', site / '__tan-48-seed.html')
    for directory in ('assets', 'css', 'js'):
        shutil.copytree(ROOT / directory, site / directory, dirs_exist_ok=True)
    return site


def start_server(site: Path) -> tuple[ThreadingHTTPServer, threading.Thread]:
    server = ThreadingHTTPServer(
        ('127.0.0.1', PORT),
        lambda *args: QuietHandler(*args, directory=str(site)),
    )
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, thread


def load_fixture(name: str) -> dict[str, Any]:
    return json.loads((FIXTURES / name).read_text(encoding='utf8'))


def app_route(fragment: str) -> str:
    return f'{APP_URL}#{fragment}'


def seed_fixture(page: Page, name: str) -> None:
    payload = load_fixture(name)

    # Leave the Angular page before seeding so no application timer can rewrite the fixture.
    page.goto(f'{BASE_URL}/__tan-48-seed.html', wait_until='domcontentloaded')
    page.evaluate('localStorage.clear(); sessionStorage.clear();')
    page.evaluate(
        """async ({data}) => {
          const request = indexedDB.open('workspace');
          await new Promise((resolve, reject) => {
            request.onupgradeneeded = () => {
              if (!request.result.objectStoreNames.contains('kv')) {
                request.result.createObjectStore('kv', { keyPath: 'key' });
              }
            };
            request.onsuccess = resolve;
            request.onerror = () => reject(request.error);
          });
          const db = request.result;
          await new Promise((resolve, reject) => {
            const transaction = db.transaction('kv', 'readwrite');
            const store = transaction.objectStore('kv');
            store.clear();
            store.put({ key: 'data', value: data });
            transaction.oncomplete = resolve;
            transaction.onerror = () => reject(transaction.error);
          });
          db.close();
        }""",
        {'data': payload['data']},
    )
    page.goto(app_route('/home'), wait_until='domcontentloaded')


def read_workspace(page: Page) -> dict[str, Any]:
    return page.evaluate(
        """async () => {
          const request = indexedDB.open('workspace');
          await new Promise((resolve, reject) => {
            request.onsuccess = resolve;
            request.onerror = () => reject(request.error);
          });
          const db = request.result;
          const value = await new Promise((resolve, reject) => {
            const transaction = db.transaction('kv', 'readonly');
            const read = transaction.objectStore('kv').get('data');
            read.onsuccess = () => resolve(read.result?.value ?? null);
            read.onerror = () => reject(read.error);
          });
          db.close();
          return value;
        }""",
    )


def wait_for_workspace(page: Page, predicate: Any, timeout_ms: int = 5000) -> dict[str, Any]:
    deadline = time.monotonic() + timeout_ms / 1000
    while time.monotonic() < deadline:
        workspace = read_workspace(page)
        if predicate(workspace):
            return workspace
        page.wait_for_timeout(50)
    return read_workspace(page)


def expect_heading(page: Page, selector: str, text: str) -> None:
    expect(page.locator(selector)).to_contain_text(text)


def click_with_prompts(page: Page, target: Any, answers: list[str]) -> None:
    remaining = iter(answers)

    def accept(dialog: Any) -> None:
        dialog.accept(next(remaining))

    page.on('dialog', accept)
    try:
        target.click()
    finally:
        page.remove_listener('dialog', accept)


def run_scenario(page: Page, fixture_name: str) -> None:
    seed_fixture(page, fixture_name)
    expect(page.locator('#dashboard-title')).to_be_visible()

    for label, heading in (
        ('RH', 'RH'),
        ('Projects', 'Projets'),
        ('Tâches', 'Tâches'),
        ('Snippets', 'Snippets'),
        ('Journal', 'Journal'),
        ('Export', 'Export des données'),
        ('Planification', 'Planification'),
    ):
        page.get_by_role('link', name=label, exact=True).click()
        expect(page.locator('h1')).to_contain_text(heading)

    page.goto(app_route('/settings'), wait_until='domcontentloaded')
    expect_heading(page, '#settings-title', 'Paramètres')

    page.goto(app_route('/todos?status=waitinginfo&project=none&view=list'), wait_until='domcontentloaded')
    expect(page).to_have_url(re.compile(r'status=waitinginfo.*project=none'))
    expect_heading(page, '#todos-title', 'Tâches')

    if fixture_name == 'workspace-full.json':
        page.goto(
            app_route('/project/project-alpha?path=folder-alpha-docs&focus=item-alpha-code&kind=item'),
            wait_until='domcontentloaded',
        )
        expect_heading(page, '#project-name', 'Projet Alpha')
        expect(page.locator('.item-card.focused')).to_have_count(1)

        page.goto(
            app_route('/rh?path=rh-team,rh-onboarding&focus=rh-guide'),
            wait_until='domcontentloaded',
        )
        expect_heading(page, '#rh-title', 'RH')
        expect(page.locator('.document-card')).to_contain_text('Guide de test')

        page.goto(
            app_route('/snippets?path=snippet-tools&focus=snippet-json'),
            wait_until='domcontentloaded',
        )
        expect_heading(page, '#snippets-title', 'Snippets')
        expect(page.locator('.snippet-card')).to_contain_text('Parser JSON')

    page.goto(app_route('/home'), wait_until='domcontentloaded')
    page.keyboard.press('Control+K')
    expect(page.get_by_role('dialog')).to_be_visible()
    expect(page.get_by_label('Rechercher dans le workspace')).to_be_focused()
    if fixture_name == 'workspace-full.json':
        page.get_by_label('Rechercher dans le workspace').fill('Parser JSON')
        expect(page.get_by_role('option', name=re.compile('Parser JSON'))).to_be_visible()
    page.keyboard.press('Escape')
    expect(page.get_by_role('dialog')).to_have_count(0)


def run_filled_crud(page: Page) -> None:
    seed_fixture(page, 'workspace-full.json')

    page.goto(app_route('/todos'), wait_until='domcontentloaded')
    page.get_by_role('button', name='+ Nouvelle tâche', exact=True).click()
    dialog = page.locator('.todo-dialog')
    expect(dialog).to_be_visible()
    dialog.locator('input[name=title]').fill('E2E tâche')
    dialog.locator('input[name=context]').fill('e2e')
    dialog.get_by_role('button', name='Créer', exact=True).click()

    todo = page.locator('.todo-card', has_text='E2E tâche')
    expect(todo).to_contain_text('E2E tâche')
    todo.get_by_role('button', name='Terminer E2E tâche').click()
    expect(todo).to_have_class(re.compile(r'\bis-done\b'))
    page.reload(wait_until='domcontentloaded')
    todo = page.locator('.todo-card', has_text='E2E tâche')
    expect(todo).to_have_class(re.compile(r'\bis-done\b'))
    persisted = read_workspace(page)
    assert any(item['title'] == 'E2E tâche' and item['status'] == 'done' for item in persisted['todos'])

    todo.get_by_role('button', name='Supprimer E2E tâche', exact=True).click()
    alert = page.get_by_role('alertdialog')
    expect(alert).to_be_visible()
    alert.get_by_role('button', name='Supprimer', exact=True).click()
    expect(page.locator('.todo-card', has_text='E2E tâche')).to_have_count(0)
    persisted = wait_for_workspace(
        page,
        lambda workspace: any(
            item.get('title') == 'E2E tâche' and item.get('_trashType') == 'todo'
            for item in workspace.get('trash', [])
        ),
    )
    assert any(item['title'] == 'E2E tâche' and item['_trashType'] == 'todo' for item in persisted['trash'])

    page.goto(app_route('/smart-planning'), wait_until='domcontentloaded')
    page.locator('#p-time').fill('60*5')
    page.locator('#btn-plan').click()
    expect(page.locator('#plan-result')).to_be_visible()
    expect(page.locator('#plan-list')).to_be_visible()
    if page.locator('.success-button').count():
        page.locator('.success-button').first.click()
        expect(page.locator('#session-counter')).to_be_visible()

    page.goto(app_route('/project/project-alpha'), wait_until='domcontentloaded')
    expect_heading(page, '#project-name', 'Projet Alpha')
    page.get_by_role('button', name='+ Dossier', exact=True).click()
    folder_dialog = page.locator('.dialog', has_text='Nouveau dossier')
    folder_dialog.locator('input[name=folder-name]').fill('E2E dossier')
    folder_dialog.get_by_role('button', name='Enregistrer', exact=True).click()
    expect(page.locator('.folder-card', has_text='E2E dossier')).to_be_visible()

    page.get_by_role('button', name='+ Item', exact=True).click()
    item_dialog = page.locator('.dialog', has_text='Ajouter un item')
    item_dialog.locator('input[name=item-title]').fill('E2E lien')
    item_dialog.get_by_role('button', name='Ajouter', exact=True).click()
    expect(page.locator('.item-card', has_text='E2E lien')).to_be_visible()

    page.goto(app_route('/rh?path=rh-team,rh-onboarding&focus=rh-guide'), wait_until='domcontentloaded')
    expect(page.locator('.document-card')).to_contain_text('Guide de test')

    page.goto(app_route('/snippets?path=snippet-tools&focus=snippet-json'), wait_until='domcontentloaded')
    snippet = page.locator('.snippet-card', has_text='Parser JSON')
    snippet.get_by_role('button', name='Copier', exact=True).click()
    expect(page.locator('.toast', has_text=re.compile('copi', re.IGNORECASE))).to_be_visible()

    page.goto(app_route('/settings'), wait_until='domcontentloaded')
    page.get_by_role('button', name='Choisir un dossier par défaut', exact=True).click()
    expect(page.locator('.toast', has_text=re.compile('supporte', re.IGNORECASE))).to_be_visible()

    page.goto(app_route('/journal'), wait_until='domcontentloaded')
    page.get_by_role('button', name='+ Nouvelle entree', exact=True).click()
    page.locator('input[aria-label="Titre de l\'entree"]').fill('E2E journal')
    page.locator('textarea[aria-label="Contenu Markdown"]').fill('**Journal E2E**')
    page.get_by_role('button', name='Enregistrer maintenant', exact=True).click()
    expect(page.locator('.entry-list-item', has_text='E2E journal')).to_be_visible()
    page.reload(wait_until='domcontentloaded')
    expect(page.locator('.entry-list-item', has_text='E2E journal')).to_be_visible()

    page.goto(app_route('/export'), wait_until='domcontentloaded')
    expect(page.get_by_role('heading', name='Sauvegarde complète')).to_be_visible()
    with page.expect_download() as download_info:
        page.locator('.header-actions').get_by_role('button', name='Sauvegarde JSON', exact=True).click()
    download = download_info.value
    exported = json.loads(Path(download.path()).read_text(encoding='utf8'))
    assert exported['_meta']['version'] == 6
    assert exported['data']['settings']['siteName'] == 'Workspace Fixture'
    download.delete()

    page.locator('input[type=file]').set_input_files({
        'name': 'todos.json',
        'mimeType': 'application/json',
        'buffer': json.dumps([{
            'id': 'todo-daily',
            'title': 'Tâche importée E2E',
            'status': 'todo',
        }]).encode('utf8'),
    })
    expect(page.get_by_text('Import partiel')).to_be_visible()
    page.get_by_role('button', name='Importer', exact=True).click()
    expect(page.get_by_text('Import fusionné')).to_be_visible()
    page.goto(app_route('/todos'), wait_until='domcontentloaded')
    expect(page.locator('.todo-card', has_text='Tâche importée E2E')).to_be_visible()
    assert any(
        item['title'] == 'Tâche importée E2E'
        for item in read_workspace(page)['todos']
    )


def run_vault(page: Page) -> None:
    seed_fixture(page, 'workspace-with-vault.json')
    page.goto(app_route('/settings'), wait_until='domcontentloaded')

    page.get_by_role('button', name='Déverrouiller', exact=True).click()
    dialog = page.locator('.dialog', has_text='Déverrouiller')
    dialog.locator('input[type=password]').fill('wrong-password')
    dialog.get_by_role('button', name='Déverrouiller', exact=True).click()
    expect(page.locator('.toast', has_text=re.compile('invalide', re.IGNORECASE))).to_be_visible()

    dialog.locator('input[type=password]').fill('fixture-master-password')
    dialog.get_by_role('button', name='Déverrouiller', exact=True).click()
    expect(page.locator('.settings-value', has_text='Activé et déverrouillé')).to_be_visible()
    page.get_by_role('button', name='Verrouiller', exact=True).click()
    expect(page.locator('.settings-value', has_text='Activé et verrouillé')).to_be_visible()


def run_domain_crud(page: Page) -> None:
    seed_fixture(page, 'workspace-full.json')

    page.goto(app_route('/projects'), wait_until='domcontentloaded')
    page.get_by_role('button', name='+ Nouveau', exact=True).click()
    project_dialog = page.get_by_role('dialog', name='Nouveau projet')
    project_dialog.get_by_label('Nom du projet').fill('E2E projet')
    project_dialog.get_by_role('button', name='Créer', exact=True).click()
    project = page.locator('.project-card', has_text='E2E projet')
    expect(project).to_be_visible()
    project.get_by_role('button', name='Supprimer le projet', exact=True).click()
    alert = page.get_by_role('alertdialog')
    expect(alert).to_be_visible()
    alert.get_by_role('button', name='Supprimer', exact=True).click()
    expect(project).to_have_count(0)

    page.goto(app_route('/rh'), wait_until='domcontentloaded')
    page.get_by_role('button', name='+ Dossier', exact=True).click()
    rh_dialog = page.get_by_role('dialog', name='Nouveau dossier')
    rh_dialog.get_by_label('Nom du dossier').fill('E2E RH')
    rh_dialog.get_by_role('button', name='Créer', exact=True).click()
    folder = page.locator('[role="treeitem"]', has_text='E2E RH')
    expect(folder).to_be_visible()
    folder.get_by_role('button', name=re.compile('Dossier : E2E RH')).click()
    page.get_by_role('button', name='+ Document', exact=True).click()
    document_dialog = page.get_by_role('dialog', name='Nouveau document')
    document_dialog.get_by_label('Titre du document').fill('E2E document')
    document_dialog.get_by_role('button', name='Créer', exact=True).click()
    document = page.locator('[role="treeitem"]', has_text='E2E document')
    expect(document).to_be_visible()
    document.get_by_role('button', name=re.compile('Document : E2E document')).click()
    expect(page.locator('.document-card')).to_contain_text('E2E document')
    page.locator('.document-card').get_by_role('button', name='Supprimer', exact=True).click()
    alert = page.get_by_role('alertdialog', name='Supprimer E2E document ?')
    expect(alert).to_be_visible()
    alert.get_by_role('button', name='Confirmer', exact=True).click()
    expect(document).to_have_count(0)

    page.goto(app_route('/snippets'), wait_until='domcontentloaded')
    page.get_by_role('button', name='Dossier', exact=True).click()
    snippet_folder_dialog = page.get_by_role('dialog', name='Nouveau dossier')
    snippet_folder_dialog.get_by_label('Nom du dossier').fill('E2E snippets')
    snippet_folder_dialog.get_by_role('button', name='Créer', exact=True).click()
    page.locator('.folder-row', has_text='E2E snippets').first.click()
    page.get_by_role('button', name='Nouveau', exact=True).click()
    snippet_dialog = page.get_by_role('dialog', name='Nouveau snippet')
    snippet_dialog.get_by_label('Titre du snippet').fill('E2E snippet')
    snippet_dialog.get_by_label('Code').fill('console.log(1)')
    snippet_dialog.get_by_role('button', name='Créer', exact=True).click()
    snippet = page.locator('.snippet-card', has_text='E2E snippet')
    expect(snippet).to_be_visible()
    snippet.get_by_role('button', name='Supprimer', exact=True).click()
    alert = page.get_by_role('alertdialog', name='Supprimer E2E snippet ?')
    expect(alert).to_be_visible()
    alert.get_by_role('button', name='Confirmer', exact=True).click()
    expect(snippet).to_have_count(0)


def run_dnd_and_selection(page: Page) -> None:
    seed_fixture(page, 'workspace-full.json')

    page.goto(app_route('/snippets?path=snippet-tools'), wait_until='domcontentloaded')
    source = page.locator('.snippet-card', has_text='Parser JSON')
    target = page.locator('.folder-row', has_text='SQL')
    source.drag_to(target)
    expect(page.locator('.snippet-card', has_text='Parser JSON')).to_have_count(0)
    target.click()
    expect(page.locator('.snippet-card', has_text='Parser JSON')).to_be_visible()

    page.goto(app_route('/todos'), wait_until='domcontentloaded')
    page.get_by_role('button', name='Sélectionner', exact=True).click()
    checkboxes = page.locator('.selection-checkbox')
    checkboxes.nth(0).check()
    checkboxes.nth(1).check()
    expect(page.locator('.selection-bar')).to_contain_text('2 sélectionné')

    page.goto(app_route('/rh'), wait_until='domcontentloaded')
    treeitems = page.locator('[role="treeitem"]')
    treeitems.first.focus()
    treeitems.first.press('Space')
    page.keyboard.press('ArrowDown')
    page.wait_for_timeout(50)
    page.keyboard.press('Enter')
    persisted = wait_for_workspace(
        page,
        lambda workspace: [node['id'] for node in workspace['rh']['children']] == ['rh-policy', 'rh-team'],
    )
    assert [node['id'] for node in persisted['rh']['children']] == ['rh-policy', 'rh-team']


def run_notification_fallback(page: Page) -> None:
    seed_fixture(page, 'workspace-full.json')
    page.goto(f'{BASE_URL}/__tan-48-seed.html', wait_until='domcontentloaded')
    page.evaluate(
        """async () => {
          const request = indexedDB.open('workspace');
          await new Promise((resolve, reject) => {
            request.onsuccess = resolve;
            request.onerror = () => reject(request.error);
          });
          const db = request.result;
          const row = await new Promise((resolve, reject) => {
            const transaction = db.transaction('kv', 'readonly');
            const read = transaction.objectStore('kv').get('data');
            read.onsuccess = () => resolve(read.result);
            read.onerror = () => reject(read.error);
          });
          const data = row.value;
          const now = Date.now();
          data.todos.push({
            id: 'e2e-due-reminder', title: 'E2E rappel', description: '', status: 'todo',
            priorityId: 'important', context: 'e2e', attachedTo: '', estimatedTime: 0,
            dependencies: [], tags: [], dueDate: '', reminderAt: new Date(now - 1000).toISOString(),
            recurrence: null, pinned: false, projectId: '', createdAt: now, updatedAt: now,
          });
          await new Promise((resolve, reject) => {
            const transaction = db.transaction('kv', 'readwrite');
            transaction.objectStore('kv').put({ key: 'data', value: data });
            transaction.oncomplete = resolve;
            transaction.onerror = () => reject(transaction.error);
          });
          db.close();
        }""",
    )
    page.goto(app_route('/home'), wait_until='domcontentloaded')
    expect(page.locator('.toast', has_text='Rappel : E2E rappel')).to_be_visible()
    assert 'e2e-due-reminder' in (page.evaluate("localStorage.getItem('workspace-reminder-fired-v1')") or '')


def run_responsive_and_shortcuts(page: Page) -> None:
    seed_fixture(page, 'workspace-full.json')
    page.set_viewport_size({'width': 390, 'height': 844})
    page.goto(app_route('/home'), wait_until='domcontentloaded')
    menu = page.get_by_role('button', name='Ouvrir le menu')
    expect(menu).to_be_visible()
    menu.click()
    expect(page.locator('#main-navigation')).to_have_class(re.compile(r'\bopen\b'))
    page.locator('#main-navigation').get_by_role('link', name='Tâches', exact=True).click()
    expect_heading(page, '#todos-title', 'Tâches')
    page.reload(wait_until='domcontentloaded')
    expect(page.locator('.todo-card')).to_have_count(4)

    page.goto(app_route('/home'), wait_until='domcontentloaded')
    page.keyboard.press('g')
    page.keyboard.press('p')
    expect_heading(page, '#projects-title', 'Projets')
    page.keyboard.press('?')
    expect(page.locator('#shortcuts-title')).to_be_visible()
    page.keyboard.press('Escape')
    expect(page.locator('#shortcuts-title')).to_have_count(0)
    page.set_viewport_size({'width': 1280, 'height': 900})


def run_legacy_smoke(page: Page) -> None:
    page.goto(f'{BASE_URL}/index.html', wait_until='domcontentloaded')
    expect(page.locator('body')).to_contain_text('Workspace')
    for path, heading in (
        ('todos.html', 'Tâches'),
        ('projects.html', 'Projets'),
        ('journal.html', 'Journal'),
        ('smart-planning.html', 'Planification'),
        ('settings.html', 'Paramètres'),
        ('export.html', 'Export'),
    ):
        page.goto(f'{BASE_URL}/{path}', wait_until='domcontentloaded')
        expect(page.locator('body')).to_contain_text(heading)


def launch_context(playwright: Any, profile: Path, diagnostics: list[str]) -> Any:
    options: dict[str, Any] = {
        'headless': True,
        'viewport': {'width': 1280, 'height': 900},
        'service_workers': 'block',
    }
    executable = os.environ.get('WORKSPACE_BROWSER')
    if executable:
        options['executable_path'] = executable
    context = playwright.chromium.launch_persistent_context(str(profile), **options)
    context.add_init_script(
        """(() => {
          try { Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: undefined }); } catch (_) {}
          try { Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined }); } catch (_) {}
          try { Object.defineProperty(window, 'Notification', { configurable: true, value: undefined }); } catch (_) {}
          try { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined }); } catch (_) {}
          try { document.execCommand = () => true; } catch (_) {}
        })();""",
    )
    def route_request(route: Any) -> None:
        if route.request.url.startswith(BASE_URL):
            route.continue_()
        else:
            route.abort()

    context.route('**/*', route_request)

    def attach(page: Page) -> None:
        page.on(
            'console',
            lambda message: diagnostics.append(message.text)
            if message.type == 'error' else None,
        )
        page.on('pageerror', lambda error: diagnostics.append(str(error)))

    context.on('page', attach)
    for page in context.pages:
        attach(page)
    return context


def redact_text(value: str) -> str:
    value = value.replace('fixture-master-password', '[redacted]')
    return re.sub(r'fixture-(?:password|user|secret)[^\s<"\']*', '[redacted]', value, flags=re.IGNORECASE)


def capture_failure(page: Page | None, diagnostics: list[str]) -> None:
    (ARTIFACTS / 'failure-console.log').write_text(
        '\n'.join(redact_text(message) for message in diagnostics),
        encoding='utf8',
    )
    if page is None:
        return
    with suppress(Exception):
        page.locator('input[type=password]').evaluate_all(
            "inputs => inputs.forEach(input => input.value = '')",
        )
        page.screenshot(path=str(ARTIFACTS / 'failure.png'), full_page=True)
        (ARTIFACTS / 'failure.html').write_text(redact_text(page.content()), encoding='utf8')


def run_suite() -> None:
    site = build_site()
    shutil.rmtree(ARTIFACTS, ignore_errors=True)
    ARTIFACTS.mkdir(parents=True)
    shutil.rmtree(PROFILES, ignore_errors=True)
    PROFILES.mkdir(parents=True)
    server, thread = start_server(site)
    diagnostics: list[str] = []
    context: Any = None
    page: Page | None = None
    profile = PROFILES / 'tan-48'

    try:
        with sync_playwright() as playwright:
            context = launch_context(playwright, profile, diagnostics)
            page = context.pages[0] if context.pages else context.new_page()
            page.wait_for_timeout(250)
            run_scenario(page, 'workspace-empty.json')
            run_scenario(page, 'workspace-full.json')
            run_filled_crud(page)
            run_domain_crud(page)
            run_vault(page)
            run_dnd_and_selection(page)
            run_notification_fallback(page)
            run_responsive_and_shortcuts(page)
            run_legacy_smoke(page)
            actionable = [message for message in diagnostics if not message.startswith('Failed to load resource')]
            if actionable:
                raise AssertionError('Browser diagnostics: ' + ' | '.join(redact_text(message) for message in actionable))
            page.screenshot(path=str(ARTIFACTS / 'last-run.png'), full_page=True)

            page.goto(app_route('/settings'), wait_until='domcontentloaded')
            page.get_by_label('Nom du site').fill('E2E profil persistant')
            page.get_by_role('button', name='Enregistrer', exact=True).click()
            expect(page.get_by_label('Nom du site')).to_have_value('E2E profil persistant')
            persisted = wait_for_workspace(
                page,
                lambda workspace: workspace['settings']['siteName'] == 'E2E profil persistant',
            )
            assert persisted['settings']['siteName'] == 'E2E profil persistant'

            context.close()
            context = launch_context(playwright, profile, diagnostics)
            page = context.pages[0] if context.pages else context.new_page()
            page.goto(app_route('/todos'), wait_until='domcontentloaded')
            expect_heading(page, '#todos-title', 'Tâches')
            expect(page.locator('.todo-card', has_text='Verifier le boot quotidien')).to_be_visible()
            page.goto(app_route('/settings'), wait_until='domcontentloaded')
            expect(page.get_by_label('Nom du site')).to_have_value('E2E profil persistant')
            actionable = [message for message in diagnostics if not message.startswith('Failed to load resource')]
            if actionable:
                raise AssertionError('Browser diagnostics after restart: ' + ' | '.join(redact_text(message) for message in actionable))
    except Exception:
        capture_failure(page, diagnostics)
        raise
    finally:
        if context is not None:
            with suppress(Exception):
                context.close()
        server.shutdown()
        thread.join(timeout=2)
        shutil.rmtree(site, ignore_errors=True)
        shutil.rmtree(PROFILES, ignore_errors=True)


if __name__ == '__main__':
    try:
        run_suite()
        print('TAN-48 end-to-end smoke suite passed')
    except BaseException as error:
        traceback.print_exception(error, file=sys.stderr)
        sys.exit(1)
