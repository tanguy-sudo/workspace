// @ts-check
// ── password-vault.js ── chiffrement des items mot de passe ──

const VAULT_SESSION_KEY = "workspace-vault-key-v1";
const VAULT_VERIFIER_TEXT = "workspace-vault-verifier-v1";
const VAULT_PBKDF2_ITERATIONS = 250000;

function _vaultConfig() {
  return getData()?.settings?.secretVault || null;
}

function hasSecretVaultEnabled() {
  const cfg = _vaultConfig();
  return !!(cfg?.enabled && cfg?.salt && cfg?.verifier?.iv && cfg?.verifier?.cipher);
}

function isSecretVaultUnlocked() {
  try {
    return !!sessionStorage.getItem(VAULT_SESSION_KEY);
  } catch (_) {
    return false;
  }
}

function lockSecretVaultSession() {
  try {
    sessionStorage.removeItem(VAULT_SESSION_KEY);
  } catch (_) {}
}

function _vaultTextEncoder() {
  return new TextEncoder();
}

function _vaultTextDecoder() {
  return new TextDecoder();
}

function _bytesToBase64(bytes) {
  let binary = "";
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (const b of arr) binary += String.fromCharCode(b);
  return btoa(binary);
}

function _base64ToBytes(base64) {
  const binary = atob(base64 || "");
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function _deriveVaultKeyFromPassword(password, saltBase64) {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    _vaultTextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: _base64ToBytes(saltBase64),
      iterations: VAULT_PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"],
  );
}

async function _storeVaultSessionKey(key) {
  const raw = await crypto.subtle.exportKey("raw", key);
  try {
    sessionStorage.setItem(VAULT_SESSION_KEY, _bytesToBase64(new Uint8Array(raw)));
  } catch (_) {}
}

async function _getUnlockedVaultKey() {
  const rawBase64 = sessionStorage.getItem(VAULT_SESSION_KEY);
  if (!rawBase64) throw new Error("Vault verrouillé");
  return crypto.subtle.importKey(
    "raw",
    _base64ToBytes(rawBase64),
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}

async function _encryptVaultText(text, key) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    _vaultTextEncoder().encode(text),
  );
  return {
    iv: _bytesToBase64(iv),
    cipher: _bytesToBase64(new Uint8Array(encrypted)),
  };
}

async function _decryptVaultText(payload, key) {
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: _base64ToBytes(payload.iv) },
    key,
    _base64ToBytes(payload.cipher),
  );
  return _vaultTextDecoder().decode(decrypted);
}

function _visitProjectNodes(projects, visitor) {
  function walk(nodes) {
    for (const node of nodes || []) {
      visitor(node);
      if (node?.nodeType === "folder" && Array.isArray(node.children)) walk(node.children);
    }
  }
  for (const project of projects || []) walk(project.children || []);
}

async function enableSecretVault(password) {
  const salt = _bytesToBase64(crypto.getRandomValues(new Uint8Array(16)));
  const key = await _deriveVaultKeyFromPassword(password, salt);
  const verifier = await _encryptVaultText(VAULT_VERIFIER_TEXT, key);
  const data = getData();
  data.settings = {
    ...(data.settings || {}),
    secretVault: {
      enabled: true,
      salt,
      iterations: VAULT_PBKDF2_ITERATIONS,
      verifier,
    },
  };

  let migratedCount = 0;
  _visitProjectNodes(data.projects, async () => {});
  const passwordItems = [];
  _visitProjectNodes(data.projects, (node) => {
    if (node?.nodeType === "item" && node.type === "password") passwordItems.push(node);
  });
  for (const node of passwordItems) {
    if (node.secretEncrypted || (!node.login && !node.password)) continue;
    node.secretEncrypted = await _encryptVaultText(
      JSON.stringify({ login: node.login || "", password: node.password || "" }),
      key,
    );
    node.login = "";
    node.password = "";
    migratedCount += 1;
  }

  setData(data);
  await _storeVaultSessionKey(key);
  return { migratedCount };
}

async function unlockSecretVault(password) {
  const cfg = _vaultConfig();
  if (!cfg?.salt || !cfg?.verifier) throw new Error("Vault non configuré");
  const key = await _deriveVaultKeyFromPassword(password, cfg.salt);
  const verifier = await _decryptVaultText(cfg.verifier, key);
  if (verifier !== VAULT_VERIFIER_TEXT) throw new Error("Mot de passe maître invalide");
  await _storeVaultSessionKey(key);
  return true;
}

async function disableSecretVault() {
  const data = getData();
  const key = await _getUnlockedVaultKey();
  const passwordItems = [];
  _visitProjectNodes(data.projects, (node) => {
    if (node?.nodeType === "item" && node.type === "password" && node.secretEncrypted) passwordItems.push(node);
  });
  for (const node of passwordItems) {
    const secret = JSON.parse(await _decryptVaultText(node.secretEncrypted, key));
    node.login = secret.login || "";
    node.password = secret.password || "";
    delete node.secretEncrypted;
  }
  if (data.settings?.secretVault) delete data.settings.secretVault;
  setData(data);
  lockSecretVaultSession();
  return { migratedCount: passwordItems.length };
}

async function changeSecretVaultPassword(currentPassword, nextPassword) {
  const cfg = _vaultConfig();
  if (!cfg?.enabled || !cfg?.salt || !cfg?.verifier) {
    throw new Error("Vault non configuré");
  }

  const currentKey = await _deriveVaultKeyFromPassword(currentPassword, cfg.salt);
  const verifier = await _decryptVaultText(cfg.verifier, currentKey);
  if (verifier !== VAULT_VERIFIER_TEXT) throw new Error("Mot de passe maître invalide");

  const data = getData();
  const nextSalt = _bytesToBase64(crypto.getRandomValues(new Uint8Array(16)));
  const nextKey = await _deriveVaultKeyFromPassword(nextPassword, nextSalt);
  const passwordItems = [];
  _visitProjectNodes(data.projects, (node) => {
    if (node?.nodeType === "item" && node.type === "password") passwordItems.push(node);
  });

  let migratedCount = 0;
  for (const node of passwordItems) {
    let secret;
    if (node.secretEncrypted) {
      secret = JSON.parse(await _decryptVaultText(node.secretEncrypted, currentKey));
    } else {
      secret = { login: node.login || "", password: node.password || "" };
    }
    if (!secret.login && !secret.password) continue;
    node.secretEncrypted = await _encryptVaultText(JSON.stringify(secret), nextKey);
    node.login = "";
    node.password = "";
    migratedCount += 1;
  }

  data.settings = {
    ...(data.settings || {}),
    secretVault: {
      enabled: true,
      salt: nextSalt,
      iterations: VAULT_PBKDF2_ITERATIONS,
      verifier: await _encryptVaultText(VAULT_VERIFIER_TEXT, nextKey),
    },
  };

  setData(data);
  await _storeVaultSessionKey(nextKey);
  return { migratedCount };
}

async function encryptPasswordItemSecret(secret) {
  if (!hasSecretVaultEnabled()) return null;
  const key = await _getUnlockedVaultKey();
  return _encryptVaultText(JSON.stringify({
    login: secret?.login || "",
    password: secret?.password || "",
  }), key);
}

async function readPasswordItemSecret(item) {
  if (!item?.secretEncrypted) {
    return {
      login: item?.login || "",
      password: item?.password || "",
    };
  }
  const key = await _getUnlockedVaultKey();
  return JSON.parse(await _decryptVaultText(item.secretEncrypted, key));
}