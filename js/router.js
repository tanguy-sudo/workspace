// @ts-check
// ── router.js ── navigation & URL params ──

function getParam(key) { return new URLSearchParams(window.location.search).get(key); }
function getCurrentProjectId() { return getParam('id'); }
function getCurrentFolderId()  { return getParam('folder'); }

function _navigate(url) {
  document.body.classList.add('page-leaving');
  setTimeout(() => window.location.href = url, 180);
}

function _resetProjectsScope() {
  try {
    if (typeof safeStorageSet === 'function') {
      safeStorageSet('workspace-projects-parent', '');
    } else {
      localStorage.setItem('workspace-projects-parent', '');
    }
  } catch (_) {}
}

function goHome()        { _navigate('index.html'); }
function goProjects(parentId) {
  const url = parentId ? `projects.html?parent=${encodeURIComponent(parentId)}` : 'projects.html';
  _navigate(url);
}
function goRH(folderId)  { _navigate(folderId ? `rh.html?folder=${folderId}` : 'rh.html'); }
function goTodos()       { _navigate('todos.html'); }
function goSnippets()    { _navigate('snippets.html'); }
function goSmartPlan()   { _navigate('smart-planning.html'); }
function goSettings()    { _navigate('settings.html'); }

function goToProject(id, folderId) {
  _navigate(folderId ? `project.html?id=${id}&folder=${folderId}` : `project.html?id=${id}`);
}

function setActiveNav() {
  const page = window.location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.topbar-nav a').forEach(a => {
    const href = a.getAttribute('href');
    a.classList.toggle('active', href === page || (page === '' && href === 'index.html'));
    // Transition fluide sur clic
    a.addEventListener('click', e => {
      const target = a.getAttribute('href');
      if (target === 'projects.html') {
        _resetProjectsScope();
        if (page === 'projects.html') {
          e.preventDefault();
          _navigate('projects.html');
          return;
        }
      }
      if (target && !target.startsWith('#') && target !== page) {
        e.preventDefault();
        _navigate(target);
      }
    });
  });

  const settingsLink = document.querySelector('.topbar-settings-link');
  if (settingsLink) {
    settingsLink.classList.toggle('active', page === 'settings.html');
    settingsLink.addEventListener('click', e => {
      const target = settingsLink.getAttribute('href');
      if (target && target !== page) {
        e.preventDefault();
        _navigate(target);
      }
    });
  }
}
