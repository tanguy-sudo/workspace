// @ts-check
// ── favorites.js ── panneau favoris flottant ──

(function () {
  let isOpen = false;
  let stack  = ['root'];
  let fab, backdrop, panel, bodyEl, bcEl;

  document.addEventListener('DOMContentLoaded', () => {
    backdrop = el('div', 'fav-backdrop');
    backdrop.addEventListener('click', close);

    fab = el('button', 'fav-fab');
    fab.innerHTML = IC.star + '';
    fab.title = 'Favoris';
    fab.innerHTML = `<svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor"><path d="M8 2l1.6 3.2 3.5.5-2.55 2.48.6 3.5L8 9.96 4.85 11.68l.6-3.5L2.9 5.7l3.5-.5z"/></svg>`;
    fab.addEventListener('click', toggle);

    panel = el('div', 'fav-panel');
    panel.innerHTML = `
      <div class="fav-panel-header">
        <div class="fav-panel-title">Favoris</div>
        <div class="fav-breadcrumb" id="fav-bc"></div>
      </div>
      <div class="fav-panel-body" id="fav-body"></div>
      <div class="fav-panel-footer">
        <button class="btn btn-ghost" id="fav-add-folder">+ Dossier</button>
        <button class="btn btn-ghost" id="fav-add-link">+ Lien</button>
      </div>`;

    document.body.appendChild(backdrop);
    document.body.appendChild(panel);
    document.body.appendChild(fab);

    bcEl   = panel.querySelector('#fav-bc');
    bodyEl = panel.querySelector('#fav-body');
    panel.querySelector('#fav-add-folder').addEventListener('click', () => addModal('folder'));
    panel.querySelector('#fav-add-link').addEventListener('click',   () => addModal('link'));
  });

  function toggle()   { isOpen ? close() : open(); }
  function open()     { isOpen=true; stack=['root']; fab.classList.add('open'); backdrop.classList.add('open'); panel.classList.add('open'); render(); }
  function close()    { isOpen=false; fab.classList.remove('open'); backdrop.classList.remove('open'); panel.classList.remove('open'); }
  function enter(id)  { stack.push(id); render(); }
  function back()     { if (stack.length > 1) { stack.pop(); render(); } }
  function jumpTo(i)  { stack = stack.slice(0, i+1); render(); }

  function _favReorderRelativeTo(srcId, targetId, before) {
    const parentId = stack[stack.length - 1] || 'root';
    const parent = parentId === 'root' ? getFavRoot() : findFavNode(parentId);
    if (!parent) return;
    const ids = (parent.children || []).map((c) => c.id).filter((id) => id !== srcId);
    const idx = ids.indexOf(targetId);
    if (idx === -1) return;
    ids.splice(before ? idx : idx + 1, 0, srcId);
    reorderFavChildren(parentId, ids);
    render();
  }

  function render() {
    const root    = getFavRoot();
    const current = findFavNode(stack[stack.length-1]);

    // Breadcrumb
    bcEl.innerHTML = '';
    stack.forEach((id, i) => {
      const node = findNode(root, id);
      if (!node) return;
      if (i > 0) bcEl.appendChild(el('span','fav-bc-sep','/'));
      const item = el('span', 'fav-bc-item' + (i===stack.length-1?' current':''));
      item.textContent = i===0 ? '★' : node.name;
      if (i < stack.length-1) item.addEventListener('click', () => jumpTo(i));
      bcEl.appendChild(item);
    });

    bodyEl.innerHTML = '';

    if (stack.length > 1) {
      const backBtn = document.createElement('button');
      backBtn.className = 'fav-back';
      backBtn.innerHTML = `${IC.back} Retour`;
      backBtn.addEventListener('click', back);
      makeDropTarget(backBtn, '__back__', (draggedId) => {
        const parentId = stack[stack.length - 2] || 'root';
        if (moveFavNode(draggedId, parentId)) {
          render();
          showToast('Déplacé dans le dossier parent', 'success');
        }
      });
      bodyEl.appendChild(backBtn);
    }

    if (!current?.children?.length) {
      bodyEl.appendChild(el('div','fav-empty','Dossier vide'));
      return;
    }

    (current.children || []).forEach(node => {
      const entry = document.createElement('button');
      entry.className = `fav-entry fav-${node.nodeType==='folder'?'folder':'link'}`;

      const icon = el('div','fav-entry-icon');
      icon.innerHTML = node.nodeType==='folder'
        ? `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M1.5 4a1 1 0 011-1h3.17a1 1 0 01.71.29l1.12 1.12a1 1 0 00.71.3H13.5a1 1 0 011 1v6a1 1 0 01-1 1h-11a1 1 0 01-1-1V4z"/></svg>`
        : `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M6.5 9.5a4 4 0 005.66-5.66L10.5 2.2A4 4 0 004.84 7.86"/><path d="M9.5 6.5a4 4 0 00-5.66 5.66L5.5 13.8A4 4 0 0011.16 8.14"/></svg>`;

      const name = el('div','fav-entry-name');
      name.textContent = node.name;
      name.title = node.url || node.name;

      const actions = el('div','fav-entry-actions');
      const btnR = el('button','btn-icon'); btnR.innerHTML=IC.edit;  btnR.title='Renommer';
      const btnD = el('button','btn-icon danger'); btnD.innerHTML=IC.trash; btnD.title='Supprimer';
      btnR.addEventListener('click', e => { e.stopPropagation(); renameModal(node); });
      btnD.addEventListener('click', e => { e.stopPropagation(); confirmDialog(`Supprimer « ${node.name} » ?`, () => { deleteFavNode(node.id); render(); }); });
      actions.appendChild(btnR); actions.appendChild(btnD);

      entry.appendChild(icon); entry.appendChild(name); entry.appendChild(actions);

      if (node.nodeType === 'folder') {
        const arr = el('span','fav-entry-arrow'); arr.innerHTML=IC.chevron;
        entry.appendChild(arr);
        entry.addEventListener('click', () => enter(node.id));
      } else {
        entry.addEventListener('click', () => window.open(node.url,'_blank'));
      }

      // ── Drag & drop ──
      const nodeType = node.nodeType === 'folder' ? 'fav-folder' : 'fav-link';
      makeDraggable(entry, node.id, nodeType);
      if (node.nodeType === 'folder') {
        makeDropTarget(entry, node.id, (draggedId, pos) => {
          if (pos) { _favReorderRelativeTo(draggedId, node.id, pos === 'before'); return; }
          if (moveFavNode(draggedId, node.id)) {
            render();
            showToast(`Déplacé dans « ${node.name} »`, 'success');
          }
        }, { reorderTypes: ['fav-folder', 'fav-link'] });
      } else {
        makeDropTarget(entry, node.id, (draggedId, pos) => {
          if (pos) _favReorderRelativeTo(draggedId, node.id, pos === 'before');
        }, { reorder: true });
      }

      bodyEl.appendChild(entry);
    });
  }

  function addModal(type) {
    const parentId = stack[stack.length-1];
    if (type === 'folder') {
      openNewFolderModal({
        placeholder: 'Ex: Interne',
        onCreate: (name) => {
          addFavNode(parentId, { nodeType: 'folder', name });
          render();
          showToast('Dossier créé');
        },
      });
      return;
    }
    // Lien
    const content = document.createElement('div');
    content.innerHTML =
      '<div class="field"><label>Nom du lien</label>' +
      '<input type="text" id="fav-inp-name" maxlength="60" placeholder="Ex: Intranet"></div>' +
      '<div class="field"><label>URL</label>' +
      '<input type="url" id="fav-inp-url" placeholder="https://…"></div>';
    createModal({
      title: 'Nouveau lien', content, confirmLabel: 'Ajouter',
      onConfirm: () => {
        const name = document.getElementById('fav-inp-name')?.value.trim();
        if (!name) { showToast('Nom requis'); return; }
        const url = document.getElementById('fav-inp-url')?.value.trim() || '#';
        addFavNode(parentId, { nodeType: 'link', name, url });
        render();
        showToast('Lien ajouté');
      },
    });
    setTimeout(() => document.getElementById('fav-inp-name')?.focus(), 40);
  }

  function renameModal(node) {
    openRenameModal(node.name, (name) => {
      renameFavNode(node.id, name);
      render();
    });
  }
})();
