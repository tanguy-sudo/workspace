// @ts-check
// ── pages/settings.js ──

const BACKUP_FREQUENCIES = [
  { value: 0, label: "Désactivée" },
  { value: 6, label: "Toutes les 6 heures" },
  { value: 12, label: "Toutes les 12 heures" },
  { value: 24, label: "Tous les jours" },
  { value: 72, label: "Tous les 3 jours" },
  { value: 168, label: "Toutes les semaines" },
  { value: 336, label: "Toutes les 2 semaines" },
  { value: 720, label: "Tous les mois" },
];

bootPage(() => {
  initPageCommon();
  initSettingsPage();
});

function initSettingsPage() {
  const userInput = document.getElementById("user-name");
  const siteInput = document.getElementById("site-name");
  const folderValue = document.getElementById("backup-folder-value");
  const frequencySelect = document.getElementById("backup-frequency");
  const vaultStatus = document.getElementById("vault-status");
  const pickFolderBtn = document.getElementById("btn-pick-backup-folder");
  const clearFolderBtn = document.getElementById("btn-clear-backup-folder");
  const saveBtn = document.getElementById("btn-save-settings");
  const testBackupBtn = document.getElementById("btn-test-backup");
  const enableVaultBtn = document.getElementById("btn-vault-enable");
  const unlockVaultBtn = document.getElementById("btn-vault-unlock");
  const lockVaultBtn = document.getElementById("btn-vault-lock");
  const changeVaultBtn = document.getElementById("btn-vault-change");
  const disableVaultBtn = document.getElementById("btn-vault-disable");

  if (!userInput || !siteInput || !folderValue || !frequencySelect) return;

  const s = getSettings();
  const currentHours = Number(s?.autoBackupFrequencyHours);
  const fallbackHours = Number.isFinite(currentHours) && currentHours >= 0 ? currentHours : 168;

  frequencySelect.innerHTML = BACKUP_FREQUENCIES.map(
    (f) => `<option value="${f.value}">${f.label}</option>`,
  ).join("");

  userInput.value = (s?.userName || "").trim();
  siteInput.value = (s?.siteName || "Workspace").trim() || "Workspace";
  folderValue.textContent = (s?.backupFolder || "Téléchargements").trim() || "Téléchargements";
  frequencySelect.value = String(fallbackHours);
  void _syncFolderLabel(folderValue, renderSummary);

  const save = () => {
    if (typeof WorkspaceDB?.canWrite === "function" && !WorkspaceDB.canWrite()) {
      showToast("Lecture seule : une autre fenêtre détient le verrou d’écriture Workspace", "error");
      return;
    }
    const userName = userInput.value.trim();
    const siteName = siteInput.value.trim() || "Workspace";
    const backupFolder = folderValue.textContent?.trim() || "Téléchargements";
    const autoBackupFrequencyHours = parseInt(frequencySelect.value, 10);

    updateSettings({
      userName,
      siteName,
      backupFolder,
      autoBackupFrequencyHours: Number.isFinite(autoBackupFrequencyHours)
        ? Math.max(0, autoBackupFrequencyHours)
        : 168,
    });

    if (typeof applySiteBranding === "function") applySiteBranding();
    renderSummary();
    showToast("Paramètres enregistrés", "success");
  };

  saveBtn?.addEventListener("click", save);
  pickFolderBtn?.addEventListener("click", async () => {
    const handle = await chooseBackupDirectory();
    if (handle?.name) {
      folderValue.textContent = handle.name;
      updateSettings({ backupFolder: handle.name });
      renderSummary();
      showToast("Dossier par défaut enregistré", "success");
    }
  });
  clearFolderBtn?.addEventListener("click", async () => {
    if (typeof window.WorkspaceDB?.setBackupDirectoryHandle === "function") {
      await window.WorkspaceDB.setBackupDirectoryHandle(null);
    }
    folderValue.textContent = "Téléchargements";
    updateSettings({ backupFolder: "Téléchargements" });
    renderSummary();
    showToast("Dossier par défaut réinitialisé", "success");
  });
  [userInput, siteInput, frequencySelect].forEach((el) => {
    el.addEventListener("change", renderSummary);
    el.addEventListener("input", renderSummary);
  });

  testBackupBtn?.addEventListener("click", () => {
    void saveWorkspaceBackup({ auto: true, preferPicker: true });
  });

  enableVaultBtn?.addEventListener("click", async () => {
    if (hasSecretVaultEnabled()) {
      showToast("Le mot de passe maître est déjà activé", "error");
      return;
    }
    const password = await _openVaultPasswordModal({
      title: "Activer le mot de passe maître",
      confirmLabel: "Activer",
      requireConfirm: true,
      description: "Ce mot de passe sera nécessaire pour relire les identifiants exportés ou importés.",
    });
    if (!password) return;
    try {
      const result = await enableSecretVault(password);
      renderSummary();
      showToast(`Mot de passe maître activé${result.migratedCount ? ` (${result.migratedCount} item(s) migré(s))` : ""}`, "success");
    } catch (_) {
      showToast("Activation impossible", "error");
    }
  });

  unlockVaultBtn?.addEventListener("click", async () => {
    if (!hasSecretVaultEnabled()) {
      showToast("Le mot de passe maître n'est pas activé", "error");
      return;
    }
    if (isSecretVaultUnlocked()) {
      showToast("Session déjà déverrouillée", "success");
      return;
    }
    const password = await _openVaultPasswordModal({
      title: "Déverrouiller la session",
      confirmLabel: "Déverrouiller",
    });
    if (!password) return;
    try {
      await unlockSecretVault(password);
      renderSummary();
      showToast("Session déverrouillée", "success");
    } catch (_) {
      showToast("Mot de passe maître invalide", "error");
    }
  });

  lockVaultBtn?.addEventListener("click", () => {
    lockSecretVaultSession();
    renderSummary();
    showToast("Session verrouillée", "success");
  });

  changeVaultBtn?.addEventListener("click", async () => {
    if (!hasSecretVaultEnabled()) {
      showToast("Le mot de passe maître n'est pas activé", "error");
      return;
    }
    const data = await _openVaultChangePasswordModal();
    if (!data) return;
    try {
      const result = await changeSecretVaultPassword(data.currentPassword, data.nextPassword);
      renderSummary();
      showToast(`Mot de passe maître modifié${result.migratedCount ? ` (${result.migratedCount} item(s) rechiffré(s))` : ""}`, "success");
    } catch (_) {
      showToast("Mot de passe actuel invalide ou changement impossible", "error");
    }
  });

  disableVaultBtn?.addEventListener("click", async () => {
    if (!hasSecretVaultEnabled()) {
      showToast("Le mot de passe maître n'est pas activé", "error");
      return;
    }
    if (!isSecretVaultUnlocked()) {
      const password = await _openVaultPasswordModal({
        title: "Confirmer le déverrouillage",
        confirmLabel: "Déverrouiller",
      });
      if (!password) return;
      try {
        await unlockSecretVault(password);
      } catch (_) {
        showToast("Mot de passe maître invalide", "error");
        return;
      }
    }
    confirmDialog("Désactiver le mot de passe maître remettra les identifiants et mots de passe en clair dans le stockage. Continuer ?", () => {
      void (async () => {
        try {
          const result = await disableSecretVault();
          renderSummary();
          showToast(`Mot de passe maître désactivé${result.migratedCount ? ` (${result.migratedCount} item(s) restauré(s))` : ""}`, "success");
        } catch (_) {
          showToast("Désactivation impossible", "error");
        }
      })();
    });
  });

  renderSummary();

  function renderSummary() {
    const userName = userInput.value.trim() || "Non défini";
    const siteName = siteInput.value.trim() || "Workspace";
    const folder = folderValue.textContent?.trim() || "Téléchargements";
    const freqHours = parseInt(frequencySelect.value, 10);

    const summaryUser = document.getElementById("summary-user");
    const summarySite = document.getElementById("summary-site");
    const summaryFolder = document.getElementById("summary-folder");
    const summaryFrequency = document.getElementById("summary-frequency");
    const summaryVault = document.getElementById("summary-vault");
    const summaryLast = document.getElementById("summary-last");

    if (summaryUser) summaryUser.textContent = userName;
    if (summarySite) summarySite.textContent = siteName;
    if (summaryFolder) summaryFolder.textContent = folder;
    if (summaryFrequency) summaryFrequency.textContent = _frequencyLabel(freqHours);
    if (summaryVault) summaryVault.textContent = _vaultStatusLabel();
    if (summaryLast) summaryLast.textContent = _lastBackupLabel();
    if (vaultStatus) vaultStatus.textContent = _vaultStatusLabel();
    if (enableVaultBtn) enableVaultBtn.disabled = hasSecretVaultEnabled();
    if (unlockVaultBtn) unlockVaultBtn.disabled = !hasSecretVaultEnabled() || isSecretVaultUnlocked();
    if (lockVaultBtn) lockVaultBtn.disabled = !isSecretVaultUnlocked();
    if (changeVaultBtn) changeVaultBtn.disabled = !hasSecretVaultEnabled();
    if (disableVaultBtn) disableVaultBtn.disabled = !hasSecretVaultEnabled();
  }
}

function _vaultStatusLabel() {
  if (!hasSecretVaultEnabled()) return "Désactivé";
  return isSecretVaultUnlocked() ? "Activé et déverrouillé" : "Activé et verrouillé";
}

function _openVaultPasswordModal({ title, confirmLabel, requireConfirm = false, description = "" }) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const content = document.createElement("div");
    content.innerHTML = `
      ${description ? `<p style="margin:0 0 12px;color:var(--text-2)">${escHtml(description)}</p>` : ""}
      <div class="field"><label>Mot de passe maître</label><input id="vault-password" type="password" autocomplete="new-password"></div>
      ${requireConfirm ? '<div class="field"><label>Confirmation</label><input id="vault-password-confirm" type="password" autocomplete="new-password"></div>' : ""}`;
    const api = createModal({
      title,
      confirmLabel,
      content,
      watchConfirm: true,
      isConfirmEnabled: () => !!document.getElementById("vault-password")?.value,
      disabledConfirmTitle: "Le mot de passe est requis",
      onConfirm: () => {
        const password = document.getElementById("vault-password")?.value || "";
        const confirm = document.getElementById("vault-password-confirm")?.value || "";
        if (!password) return false;
        if (requireConfirm && password !== confirm) {
          showToast("Les mots de passe ne correspondent pas", "error");
          return false;
        }
        done(password);
      },
    });
    const overlay = api.confirmBtn?.closest(".modal")?.parentElement;
    overlay?.querySelector(".btn-cancel")?.addEventListener("click", () => done(null), { once: true });
    overlay?.querySelector(".btn-close")?.addEventListener("click", () => done(null), { once: true });
    overlay?.addEventListener("click", (e) => {
      if (e.target === overlay) done(null);
    }, { once: true });
  });
}

function _openVaultChangePasswordModal() {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const content = document.createElement("div");
    content.innerHTML = `
      <p style="margin:0 0 12px;color:var(--text-2)">Le coffre reste chiffré. Les secrets existants seront rechiffrés avec le nouveau mot de passe.</p>
      <div class="field"><label>Mot de passe actuel</label><input id="vault-current-password" type="password" autocomplete="current-password"></div>
      <div class="field"><label>Nouveau mot de passe</label><input id="vault-next-password" type="password" autocomplete="new-password"></div>
      <div class="field"><label>Confirmation du nouveau mot de passe</label><input id="vault-next-password-confirm" type="password" autocomplete="new-password"></div>`;
    const api = createModal({
      title: "Changer le mot de passe maître",
      confirmLabel: "Changer",
      content,
      watchConfirm: true,
      isConfirmEnabled: () => {
        const current = document.getElementById("vault-current-password")?.value || "";
        const next = document.getElementById("vault-next-password")?.value || "";
        const confirm = document.getElementById("vault-next-password-confirm")?.value || "";
        return !!current && !!next && !!confirm;
      },
      disabledConfirmTitle: "Tous les champs sont requis",
      onConfirm: () => {
        const currentPassword = document.getElementById("vault-current-password")?.value || "";
        const nextPassword = document.getElementById("vault-next-password")?.value || "";
        const nextConfirm = document.getElementById("vault-next-password-confirm")?.value || "";
        if (!currentPassword || !nextPassword || !nextConfirm) return false;
        if (nextPassword !== nextConfirm) {
          showToast("Les mots de passe ne correspondent pas", "error");
          return false;
        }
        if (currentPassword === nextPassword) {
          showToast("Le nouveau mot de passe doit être différent", "error");
          return false;
        }
        done({ currentPassword, nextPassword });
      },
    });
    const overlay = api.confirmBtn?.closest(".modal")?.parentElement;
    overlay?.querySelector(".btn-cancel")?.addEventListener("click", () => done(null), { once: true });
    overlay?.querySelector(".btn-close")?.addEventListener("click", () => done(null), { once: true });
    overlay?.addEventListener("click", (e) => {
      if (e.target === overlay) done(null);
    }, { once: true });
  });
}

async function _syncFolderLabel(folderValue, onDone) {
  if (typeof getBackupDirectoryLabel !== "function") return;
  const label = await getBackupDirectoryLabel();
  if (folderValue && (!folderValue.textContent || folderValue.textContent === "Téléchargements")) {
    folderValue.textContent = label;
  }
  onDone?.();
}

function _frequencyLabel(hours) {
  if (!Number.isFinite(hours) || hours < 0) return "Toutes les semaines";
  const item = BACKUP_FREQUENCIES.find((f) => f.value === hours);
  if (item) return item.label;
  if (hours === 0) return "Désactivée";
  if (hours < 24) return `Toutes les ${hours} heures`;
  const days = Math.round(hours / 24);
  return days <= 1 ? "Tous les jours" : `Tous les ${days} jours`;
}

function _lastBackupLabel() {
  const last = parseInt(localStorage.getItem("workspace-last-backup") || "0", 10);
  if (!last) return "Jamais";
  const d = new Date(last);
  return d.toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
