"""VPN: включить, выключить, проверить — и убедиться, что выход НЕ через запрещённую страну (по умолчанию RU).

Включение — через системный механизм macOS (scutil --nc): им управляются и встроенные VPN (IKEv2/L2TP),
и приложения, добавившие свою конфигурацию в «Настройки → VPN» (WireGuard, Amnezia, v2rayTun, Outline и др.).
Для остальных — команда Shortcuts или просто запуск приложения. Страну проверяем по внешнему IP.
"""
from __future__ import annotations

import logging
import re
import time

from . import registry, run

log = logging.getLogger(__name__)

_GEO = [  # несколько сервисов: какой-то может быть заблокирован или недоступен
    ("https://ipinfo.io/json", "country", "ip"),
    ("https://ipapi.co/json/", "country_code", "ip"),
    ("https://ifconfig.co/json", "country_iso", "ip"),
    ("http://ip-api.com/json", "countryCode", "query"),
]


def public_location(timeout: float = 6) -> tuple[str | None, str | None]:
    """(страна ISO, внешний IP) или (None, None), если интернета/сервисов нет."""
    import httpx

    for url, ckey, ikey in _GEO:
        try:
            r = httpx.get(url, timeout=timeout, headers={"User-Agent": "curl/8"})
            data = r.json()
            country = (data.get(ckey) or "").upper()
            if re.fullmatch(r"[A-Z]{2}", country):
                return country, data.get(ikey)
        except Exception as e:
            log.debug("geo %s: %s", url, e)
    return None, None


def services() -> list[tuple[str, str]]:
    """VPN-подключения macOS: [(имя, статус)]."""
    out = run(["scutil", "--nc", "list"], timeout=10)
    res = []
    for line in out.splitlines():
        m = re.search(r"\((Connected|Disconnected|Connecting|Disconnecting|Invalid)\).*?\"([^\"]+)\"", line)
        if m:
            res.append((m.group(2), m.group(1)))
    return res


def _service_name(ctx) -> str | None:
    name = ctx.cfg.vpn.get("name") or ""
    found = services()
    if name:
        for n, _ in found:
            if n.lower() == name.lower():
                return n
        return name
    return found[0][0] if found else None


def _connect(ctx) -> str:
    method = ctx.cfg.vpn.get("method", "auto")
    name = ctx.cfg.vpn.get("name") or ""
    if method in ("auto", "scutil"):
        svc = _service_name(ctx)
        if svc:
            return run(["scutil", "--nc", "start", svc], timeout=15)
        if method == "scutil":
            return "Ошибка: VPN-подключений в системе нет (scutil --nc list пуст)"
    if method == "shortcut" and name:
        return run(["shortcuts", "run", f"{name} On"], timeout=30)
    if method == "app" and name:
        return run(["open", "-a", name])
    return "Ошибка: не знаю, как включить VPN — укажи vpn.method/vpn.name в config.local.yaml (см. vpn list)"


def _disconnect(ctx) -> str:
    method = ctx.cfg.vpn.get("method", "auto")
    name = ctx.cfg.vpn.get("name") or ""
    if method in ("auto", "scutil"):
        svc = _service_name(ctx)
        if svc:
            return run(["scutil", "--nc", "stop", svc], timeout=15)
    if method == "shortcut" and name:
        return run(["shortcuts", "run", f"{name} Off"], timeout=30)
    if method == "app" and name:
        from .system import quit_if_running
        return quit_if_running(name)
    return "Ошибка: VPN не настроен"


def forbidden(ctx) -> set[str]:
    return {c.upper() for c in (ctx.cfg.vpn.get("forbidden_countries") or ["RU"])}


def ensure_vpn(ctx) -> tuple[bool, str]:
    """Гарантировать выход в интернет НЕ из запрещённой страны. (ok, пояснение для человека)."""
    bad = forbidden(ctx)
    country, ip = public_location()
    if country and country not in bad:
        return True, f"VPN в порядке: выход через {country} ({ip})"
    res = _connect(ctx)
    if res.startswith("Ошибка"):
        return False, res + (f". Сейчас выход через {country}" if country else "")
    deadline = time.monotonic() + float(ctx.cfg.vpn.get("connect_timeout", 25))
    while time.monotonic() < deadline:
        time.sleep(2)
        country, ip = public_location(timeout=4)
        if country and country not in bad:
            return True, f"Включил VPN: выход через {country} ({ip})"
    where = f"выход всё ещё через {country}" if country else "не удалось определить страну — нет интернета?"
    return False, f"VPN не заработал: {where}"


@registry.add("vpn", "VPN: on (включить и проверить, что страна не Россия), off, status (подключения и страна "
              "выхода), list (VPN-подключения в системе).",
              {"action": ("string", "")}, ["action"], enums={"action": ["on", "off", "status", "list"]})
def vpn(ctx, action: str) -> str:
    if action == "on":
        ok, msg = ensure_vpn(ctx)
        return msg if ok else f"Ошибка: {msg}"
    if action == "off":
        return _disconnect(ctx)
    if action == "list":
        found = services()
        return "\n".join(f"{n} — {s}" for n, s in found) or "VPN-подключений в системе нет"
    country, ip = public_location()
    active = [n for n, s in services() if s == "Connected"]
    where = f"выход через {country} ({ip})" if country else "страну определить не удалось"
    warn = " — это запрещённая страна, VPN не работает" if country in forbidden(ctx) else ""
    return f"Подключено: {', '.join(active) or 'ничего'}; {where}{warn}"
