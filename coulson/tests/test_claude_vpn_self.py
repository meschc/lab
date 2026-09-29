import json
import time
from types import SimpleNamespace as NS

import pytest

from coulson.config import load
from coulson.memory import Memory
from coulson.tools import Context, claude as C, load_all, selfcare as S, vpn as V


@pytest.fixture
def ctx(tmp_path, monkeypatch):
    monkeypatch.setattr("coulson.config.DATA_DIR", tmp_path)
    cfg = load()
    cfg["claude"]["default_project"] = str(tmp_path / "ws")
    said, notes = [], []
    c = Context(cfg, memory=Memory(tmp_path / "m.db"), speak=said.append, notify=notes.append,
                confirm=lambda d: True)
    c.said = said
    return c


# ---------------------------------------------------------------- VPN


def test_vpn_services_parsing(monkeypatch):
    out = ('Available network connection services in the current set (*=enabled):\n'
           '* (Disconnected)   1A2B-3C VPN (com.wireguard.macos) "Нидерланды"  [VPN:com.wireguard.macos]\n'
           '* (Connected)      4D5E-6F VPN (IPSec)               "Work"        [VPN:IPSec]\n')
    monkeypatch.setattr(V, "run", lambda cmd, timeout=30: out)
    assert V.services() == [("Нидерланды", "Disconnected"), ("Work", "Connected")]


def test_ensure_vpn_already_ok(ctx, monkeypatch):
    monkeypatch.setattr(V, "public_location", lambda timeout=6: ("NL", "1.2.3.4"))
    monkeypatch.setattr(V, "_connect", lambda c: pytest.fail("не нужно подключать"))
    ok, msg = V.ensure_vpn(ctx)
    assert ok and "NL" in msg


def test_ensure_vpn_connects_until_country_changes(ctx, monkeypatch):
    seq = iter([("RU", "5.5.5.5"), ("RU", "5.5.5.5"), ("DE", "9.9.9.9")])
    monkeypatch.setattr(V, "public_location", lambda timeout=6: next(seq))
    started = []
    monkeypatch.setattr(V, "_connect", lambda c: started.append(1) or "OK")
    monkeypatch.setattr(V.time, "sleep", lambda s: None)
    ok, msg = V.ensure_vpn(ctx)
    assert ok and started == [1] and "DE" in msg


def test_ensure_vpn_fails_if_still_russia(ctx, monkeypatch):
    monkeypatch.setattr(V, "public_location", lambda timeout=6: ("RU", "5.5.5.5"))
    monkeypatch.setattr(V, "_connect", lambda c: "OK")
    monkeypatch.setattr(V.time, "sleep", lambda s: None)
    ctx.cfg["vpn"]["connect_timeout"] = 0
    ok, msg = V.ensure_vpn(ctx)
    assert not ok and "RU" in msg


# ---------------------------------------------------------------- Claude


def test_claude_ask_needs_vpn(ctx, monkeypatch):
    monkeypatch.setattr(C, "ensure_vpn", lambda c: (False, "выход всё ещё через RU"))
    res = load_all().execute("claude", {"action": "ask", "task": "почини сайт"}, ctx)
    assert res.startswith("Ошибка") and "RU" in res


def test_claude_ask_runs_in_background_and_reports(ctx, monkeypatch, tmp_path):
    monkeypatch.setattr(C, "ensure_vpn", lambda c: (True, "VPN в порядке: выход через NL"))
    monkeypatch.setattr(C, "claude_bin", lambda cfg: "/usr/bin/claude")
    seen = {}

    def fake_run(cmd, cwd, capture_output, text, timeout, stdin):
        seen["cmd"], seen["cwd"] = cmd, cwd
        return NS(returncode=0, stderr="", stdout=json.dumps(
            {"type": "result", "subtype": "success", "is_error": False, "session_id": "s-1",
             "result": "Сделал страницу. Добавил стили и форму.\n\nДетали: index.html", "total_cost_usd": 0.12}))

    monkeypatch.setattr(C.subprocess, "run", fake_run)
    res = load_all().execute("claude", {"action": "ask", "task": "сделай лендинг"}, ctx)
    assert "Передал задачу Клоду" in res
    for _ in range(100):
        if ctx.said:
            break
        time.sleep(0.02)
    assert ctx.said == ["Клод закончил. Сделал страницу. Добавил стили и форму."]
    assert "--permission-mode" in seen["cmd"] and "acceptEdits" in seen["cmd"] and seen["cwd"].endswith("ws")
    assert C.last_session() == "s-1"
    assert ctx.memory.list_notes(tag="claude")[0].title.startswith("Claude: сделай лендинг")
    # продолжение той же сессии
    load_all().execute("claude", {"action": "continue", "task": "а теперь тёмную тему"}, ctx)
    time.sleep(0.2)
    assert seen["cmd"][seen["cmd"].index("--resume") + 1] == "s-1"


def test_claude_project_alias_self(ctx):
    from coulson import config
    assert C.resolve_project(ctx, "колсон") == config.ROOT


# ---------------------------------------------------------------- самоанализ


def test_incidents_journal_dedup_and_resolve(tmp_path):
    m = Memory(tmp_path / "m.db")
    m.add_incident("tool", "a")
    m.add_incident("tool", "a")
    m.add_incident("correction", "b")
    rows = m.incidents()
    assert [r[3] for r in rows] == ["b", "a"]
    m.resolve_incidents([r[0] for r in rows])
    assert m.incidents() == []


def test_analyze_derives_lessons_and_code_bugs(tmp_path):
    m = Memory(tmp_path / "m.db")
    m.add_incident("tool", "«открой доту» → app(open) → Не нашёл приложение «доту»")
    m.add_incident("correction", "Пользователь поправил: «не то, я просил громче»")
    answer = ("1. Когда не находишь игру по названию, сначала ищи её через app find.\n"
              "- Когда просят громче, используй sound up, а не set.\n"
              "КОД: parse_keys не понимает клавишу «home».")
    out = S.analyze(m, lambda prompt: answer)
    assert "Разобрал 2" in out and len(m.lessons()) == 2 and m.incidents(kinds=("tool", "correction")) == []
    assert m.incidents(kinds=("code",))[0][3].startswith("parse_keys")


def test_lessons_go_into_prompt_prefix(tmp_path):
    from coulson.brain import Brain

    m = Memory(tmp_path / "m.db")
    m.add_lesson("Когда просят громче, используй sound up")
    b = Brain(load(), load_all(), m)
    msgs = b._prefix()
    assert "sound up" in msgs[1]["content"] and "sound up" not in msgs[0]["content"]


def test_correction_is_logged(tmp_path):
    from tests.test_brain_loop import chunk, make

    b, ctx, opened = make(tmp_path, [[chunk("[ok] Открыл.")], [chunk("[ok] Исправляю.")]])
    b.respond("открой музыку", ctx, lambda s: None)
    b.respond("не то, я просил громче", ctx, lambda s: None)
    kinds = [r[2] for r in b.memory.incidents()]
    assert "correction" in kinds


def test_self_fix_needs_confirmation(ctx, monkeypatch):
    ctx.confirm = lambda d: False
    res = load_all().execute("self", {"action": "fix"}, ctx)
    assert "НЕ подтвердил" in res


def test_twenty_tools_exposed():
    reg = load_all()
    assert len(reg.exposed()) == 24 and {"claude", "self", "music"} <= set(reg.exposed()) and "vpn" not in reg.exposed()
