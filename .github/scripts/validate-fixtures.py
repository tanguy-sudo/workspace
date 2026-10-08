"""Validate the synthetic migration fixtures without loading application code."""

from __future__ import annotations

import base64
import json
from pathlib import Path
from typing import Any, Iterable


ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT / "fixtures"
EXPECTED_SECTIONS = {
    "projects",
    "rh",
    "todos",
    "snippets",
    "snippetFolders",
    "snippetMixedOrder",
    "favorites",
    "recentlyVisited",
    "journal",
    "trash",
    "activityLog",
    "settings",
}


def load(name: str) -> Any:
    with (FIXTURES / name).open(encoding="utf-8") as stream:
        return json.load(stream)


def full_data(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict) or not isinstance(payload.get("data"), dict):
        raise AssertionError("expected a full export envelope")
    if payload.get("_meta", {}).get("version") != 6:
        raise AssertionError("expected export version 6")
    data = payload["data"]
    missing = EXPECTED_SECTIONS - data.keys()
    if missing:
        raise AssertionError(f"missing sections: {sorted(missing)}")
    return data


def walk_tree(node: Any, ancestors: tuple[str, ...] = ()) -> Iterable[dict[str, Any]]:
    if not isinstance(node, dict):
        raise AssertionError("tree node must be an object")
    node_id = node.get("id")
    if not isinstance(node_id, str) or not node_id:
        raise AssertionError("tree node must have a non-empty id")
    if node_id in ancestors:
        raise ValueError(f"cycle detected at {node_id}")
    yield node
    children = node.get("children", [])
    if not isinstance(children, list):
        raise AssertionError(f"children must be a list for {node_id}")
    for child in children:
        yield from walk_tree(child, (*ancestors, node_id))


def all_nodes(data: dict[str, Any]) -> Iterable[dict[str, Any]]:
    for project in data["projects"]:
        yield from walk_tree({"id": project["id"], "children": project.get("children", [])})
    yield from walk_tree(data["rh"])
    yield from walk_tree(data["snippetFolders"])
    yield from walk_tree(data["favorites"])


def validate_recurrence(data: dict[str, Any]) -> None:
    types = {
        todo.get("recurrence", {}).get("type")
        for todo in data["todos"]
        if todo.get("recurrence")
    }
    expected = {"daily", "weekly", "monthly_nth_weekday"}
    if not expected <= types:
        raise AssertionError(f"missing recurrence types: {sorted(expected - types)}")


def validate_attachments(data: dict[str, Any]) -> None:
    attachments = [node["file"] for node in all_nodes(data) if node.get("file")]
    if not attachments:
        raise AssertionError("full fixture must contain an attachment")
    for file in attachments:
        raw = file.get("base64", "")
        if "," not in raw:
            raise AssertionError("attachment must be a data URL")
        decoded = base64.b64decode(raw.split(",", 1)[1], validate=True)
        if file.get("size") != len(decoded):
            raise AssertionError(f"attachment size mismatch for {file.get('name')}")
        if file.get("size", 0) > 4 * 1024 * 1024:
            raise AssertionError("fixture attachment exceeds the application limit")


def password_items(data: dict[str, Any]) -> list[dict[str, Any]]:
    return [
        node
        for node in all_nodes(data)
        if node.get("nodeType") == "item" and node.get("type") == "password"
    ]


def validate_vault(data: dict[str, Any]) -> None:
    config = data["settings"].get("secretVault")
    if not config or not config.get("enabled"):
        raise AssertionError("vault fixture must enable the vault")
    if config.get("iterations") != 250000:
        raise AssertionError("unexpected PBKDF2 iteration count")
    if not config.get("salt") or not config.get("verifier", {}).get("iv"):
        raise AssertionError("vault config is incomplete")
    encrypted = [item for item in password_items(data) if item.get("secretEncrypted")]
    if len(encrypted) < 2:
        raise AssertionError("vault fixture must contain at least two encrypted secrets")
    for item in encrypted:
        payload = item["secretEncrypted"]
        if not payload.get("iv") or not payload.get("cipher"):
            raise AssertionError(f"encrypted payload is incomplete for {item.get('id')}")
        if item.get("login") or item.get("password"):
            raise AssertionError("encrypted password items must not keep cleartext secrets")


def validate_full_fixture(name: str) -> dict[str, Any]:
    data = full_data(load(name))
    if not data["projects"] or not data["todos"] or not data["journal"]:
        raise AssertionError(f"{name} must contain representative data")
    if not data["trash"] or not data["activityLog"] or not data["favorites"]["children"]:
        raise AssertionError(f"{name} must contain trash, activity and favorites")
    list(all_nodes(data))
    validate_recurrence(data)
    validate_attachments(data)
    return data


def main() -> None:
    empty = full_data(load("workspace-empty.json"))
    if any(empty[key] for key in ("projects", "todos", "snippets", "journal", "trash")):
        raise AssertionError("empty fixture contains data")

    validate_full_fixture("workspace-full.json")
    vault = full_data(load("workspace-with-vault.json"))
    validate_vault(vault)

    legacy = load("workspace-legacy-local-storage.json")
    if not isinstance(legacy, dict) or "data" in legacy or "_meta" in legacy:
        raise AssertionError("legacy fixture must be the raw localStorage object")
    if "projects" not in legacy or "settings" not in legacy:
        raise AssertionError("legacy fixture is incomplete")

    invalid_payload = load("invalid/workspace-cycle.json")
    invalid = invalid_payload.get("data")
    if not isinstance(invalid, dict) or not isinstance(invalid.get("projects"), list):
        raise AssertionError("invalid cycle fixture is incomplete")
    try:
        list(all_nodes(invalid))
    except ValueError:
        pass
    else:
        raise AssertionError("invalid cycle fixture was accepted")

    print("Fixtures valid: empty, full, legacy localStorage, vault, and invalid cycle rejection.")


if __name__ == "__main__":
    main()
