#!/usr/bin/env python3
"""Run dependency-free release checks for the VoiceID static site."""

from __future__ import annotations

import re
import sys
from collections import Counter
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit


ROOT = Path(__file__).resolve().parents[1]
CJK_RE = re.compile(r"[\u3400-\u9fff]")
PORT_RE = re.compile(r"http\.server\s+(\d{2,5})")
STATIC_PAGE_PATHS = (
    "index.html",
    "en/index.html",
    "docs/index.html",
    "docs/en/index.html",
    "beta/index.html",
    "docs/VoiceID_Online_Beta_施工计划_v0.2.html",
)
PAGES_EXCLUDED_PATHS = {
    ".env.example",
    "apps",
    "biome.json",
    "infra",
    "node_modules",
    "package-lock.json",
    "package.json",
    "packages",
    "scripts",
    "services",
    "tsconfig.base.json",
}
BETA_STORAGE_KEYS = {
    "voiceid.beta.proof",
    "voiceid.beta.profile",
    "voiceid.beta.wallet",
    "voiceid.beta.session",
}
BETA_ALLOWED_RPC_METHODS = {"eth_requestAccounts", "eth_chainId", "personal_sign"}
BETA_FORBIDDEN_PATTERNS = {
    "transaction RPC": r"eth_sendTransaction|eth_signTransaction|wallet_switchEthereumChain",
    "persistent browser storage": r"localStorage|indexedDB|document\.cookie|caches\.",
    "audio recording/export": r"MediaRecorder|new\s+Blob|arrayBuffer\(",
    "external network API": r"fetch\(|XMLHttpRequest|WebSocket|sendBeacon",
    "sensitive console logging": r"console\.",
}
PUBLIC_TRUTH_MARKERS = {
    "index.html": ("Browser Playground v0.1", "不提供真实声纹识别或服务端认证"),
    "en/index.html": ("Browser Playground v0.1", "not speaker verification or server authentication"),
    "docs/index.html": ("demo-only / 无服务端认证", '"rawAudioPersisted": false'),
    "docs/en/index.html": ("demo-only / no server authentication", '"rawAudioPersisted": false'),
    "beta/index.html": ("VoiceID Browser Playground v0.1", "它不识别真实说话人"),
}


class PageAudit(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.attrs: list[tuple[str, dict[str, str | None]]] = []
        self.ids: list[str] = []
        self.links: list[str] = []
        self.resources: list[str] = []
        self.visible_text: list[str] = []
        self.literal_backticks: list[str] = []
        self.stack: list[str] = []
        self.h1_count = 0
        self.main_count = 0
        self.title_count = 0
        self.lang = ""

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = dict(attrs)
        self.attrs.append((tag, values))
        self.stack.append(tag)

        if tag == "html":
            self.lang = values.get("lang") or ""
        if tag == "h1":
            self.h1_count += 1
        if tag == "main":
            self.main_count += 1
        if tag == "title":
            self.title_count += 1
        if value := values.get("id"):
            self.ids.append(value)
        if tag == "a" and (href := values.get("href")):
            self.links.append(href)
        if tag in {"img", "script", "link"}:
            key = "src" if tag in {"img", "script"} else "href"
            if value := values.get(key):
                self.resources.append(value)

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.handle_starttag(tag, attrs)
        self.handle_endtag(tag)

    def handle_endtag(self, tag: str) -> None:
        for index in range(len(self.stack) - 1, -1, -1):
            if self.stack[index] == tag:
                del self.stack[index:]
                break

    def handle_data(self, data: str) -> None:
        if not data.strip() or any(tag in self.stack for tag in {"script", "style"}):
            return
        self.visible_text.append(data)
        if "`" in data and "code" not in self.stack and self.stack and self.stack[-1] in {"p", "li"}:
            self.literal_backticks.append(data.strip())


def parse_page(path: Path) -> PageAudit:
    audit = PageAudit()
    audit.feed(path.read_text(encoding="utf-8"))
    return audit


def local_target(page: Path, url: str) -> tuple[Path, str] | None:
    parts = urlsplit(url)
    if parts.scheme or parts.netloc or url.startswith(("data:", "mailto:", "tel:")):
        return None

    raw_path = unquote(parts.path)
    target = (page.parent / raw_path).resolve() if raw_path else page.resolve()
    if raw_path.endswith("/") or target.is_dir():
        target /= "index.html"
    return target, unquote(parts.fragment)


def is_within_root(path: Path) -> bool:
    return path == ROOT or ROOT in path.parents


def check_beta_safety(errors: list[str]) -> None:
    beta_dir = ROOT / "beta"
    if not beta_dir.exists():
        return

    js_files = sorted(beta_dir.rglob("*.js"))
    source_by_file = {path: path.read_text(encoding="utf-8") for path in js_files}
    combined_source = "\n".join(source_by_file.values())

    for label, pattern in BETA_FORBIDDEN_PATTERNS.items():
        matches = [str(path.relative_to(ROOT)) for path, source in source_by_file.items() if re.search(pattern, source)]
        if matches:
            errors.append(f"Beta contains forbidden {label}: {', '.join(matches)}")

    controller_source = source_by_file.get(beta_dir / "beta.js", "")
    storage_keys = set(re.findall(r'"(voiceid\.beta\.[a-z]+)"', controller_source))
    if storage_keys != BETA_STORAGE_KEYS:
        errors.append(
            "Beta sessionStorage keys differ from the schema: "
            f"expected {sorted(BETA_STORAGE_KEYS)}, found {sorted(storage_keys)}"
        )

    wallet_source = source_by_file.get(beta_dir / "adapters" / "wallet-provider.js", "")
    rpc_methods = set(re.findall(r'provider\.request\(\{\s*method:\s*"([^"]+)"', wallet_source))
    if not rpc_methods or not rpc_methods <= BETA_ALLOWED_RPC_METHODS:
        errors.append(f"Beta wallet RPC methods are missing or unsafe: {sorted(rpc_methods)}")

    required_invariants = {
        'assurance: "demo-only"': "demo-only VoiceProof assurance",
        "rawAudioPersisted: false": "raw audio persistence boundary",
        "serverVerified: false": "server verification boundary",
    }
    for source, label in required_invariants.items():
        if source not in combined_source:
            errors.append(f"Beta is missing required invariant: {label}")


def main() -> int:
    pages = [ROOT / relative for relative in STATIC_PAGE_PATHS if (ROOT / relative).exists()]
    errors: list[str] = []
    audits = {page: parse_page(page) for page in pages}

    missing_pages = sorted(relative for relative in STATIC_PAGE_PATHS if not (ROOT / relative).exists())
    for relative in missing_pages:
        errors.append(f"Missing declared static page: {relative}")

    if (ROOT / ".nojekyll").exists():
        errors.append(".nojekyll disables the Pages source exclusion boundary")
    pages_config = ROOT / "_config.yml"
    if not pages_config.exists():
        errors.append("Missing _config.yml Pages source exclusion boundary")
    else:
        configured_exclusions = set(
            re.findall(r"^\s+-\s+([^#\s]+)\s*$", pages_config.read_text(encoding="utf-8"), re.MULTILINE)
        )
        missing_exclusions = sorted(PAGES_EXCLUDED_PATHS - configured_exclusions)
        if missing_exclusions:
            errors.append(f"Pages config is missing exclusions: {', '.join(missing_exclusions)}")

    for relative, markers in PUBLIC_TRUTH_MARKERS.items():
        path = ROOT / relative
        source = path.read_text(encoding="utf-8") if path.exists() else ""
        for marker in markers:
            if marker not in source:
                errors.append(f"{relative}: missing public truth marker: {marker}")

    if not pages:
        errors.append("No HTML pages found")

    for page, audit in audits.items():
        relative = page.relative_to(ROOT)
        ids = set(audit.ids)

        if audit.h1_count != 1:
            errors.append(f"{relative}: expected one h1, found {audit.h1_count}")
        if audit.main_count != 1:
            errors.append(f"{relative}: expected one main, found {audit.main_count}")
        if audit.title_count != 1:
            errors.append(f"{relative}: expected one title, found {audit.title_count}")
        if not audit.lang:
            errors.append(f"{relative}: html lang is missing")

        duplicate_ids = sorted(value for value, count in Counter(audit.ids).items() if count > 1)
        if duplicate_ids:
            errors.append(f"{relative}: duplicate ids: {', '.join(duplicate_ids)}")

        for tag, attrs in audit.attrs:
            if tag == "img" and "alt" not in attrs:
                errors.append(f"{relative}: image is missing alt")
            if tag == "button" and attrs.get("type") not in {"button", "submit", "reset"}:
                errors.append(f"{relative}: button has a missing or invalid type")
            if attrs.get("target") == "_blank":
                rel = (attrs.get("rel") or "").split()
                if "noreferrer" not in rel:
                    errors.append(f"{relative}: target=_blank is missing rel=noreferrer")
            if label_ids := attrs.get("aria-labelledby"):
                missing = [value for value in label_ids.split() if value not in ids]
                if missing:
                    errors.append(f"{relative}: aria-labelledby references missing ids: {', '.join(missing)}")

        if audit.literal_backticks:
            errors.append(f"{relative}: visible Markdown backticks found outside code elements")

        if "en" in relative.parts:
            cjk_count = len(CJK_RE.findall("".join(audit.visible_text)))
            if cjk_count:
                errors.append(f"{relative}: English page contains {cjk_count} CJK characters")

        for url in audit.links + audit.resources:
            resolved = local_target(page, url)
            if resolved is None:
                continue
            target, fragment = resolved
            if not is_within_root(target):
                errors.append(f"{relative}: local path escapes repository: {url}")
                continue
            if not target.exists():
                errors.append(f"{relative}: missing local target: {url}")
                continue
            if fragment and target.suffix.lower() == ".html":
                target_audit = audits.get(target) or parse_page(target)
                if fragment not in set(target_audit.ids):
                    errors.append(f"{relative}: missing fragment target: {url}")

    checked_text_files = [ROOT / "README.md", *sorted((ROOT / "docs").glob("*.md")), *pages]
    for path in checked_text_files:
        if not path.exists():
            continue
        for port in PORT_RE.findall(path.read_text(encoding="utf-8")):
            if not 3400 <= int(port) <= 3499:
                errors.append(f"{path.relative_to(ROOT)}: preview port {port} is outside 3400-3499")

    check_beta_safety(errors)

    if errors:
        print(f"VoiceID site checks failed ({len(errors)}):")
        for error in errors:
            print(f"- {error}")
        return 1

    link_count = sum(len(audit.links) for audit in audits.values())
    resource_count = sum(len(audit.resources) for audit in audits.values())
    print(
        f"VoiceID site checks passed: {len(pages)} pages, "
        f"{link_count} links, {resource_count} resource references."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
