from coulson.config import load
from coulson.memory import Memory
from coulson.tools import Context, load_all


def test_memory(tmp_path):
    m = Memory(tmp_path / "m.db")
    assert m.add_fact("Любимая игра пользователя — Cyberpunk 2077") == "Запомнил."
    assert m.add_fact("Любимая игра пользователя — Cyberpunk 2077!") == "Обновил в памяти."
    assert len(m.facts()) == 1
    m.log("user", "Колсон, какая погода в Москве?")
    assert "погода" in m.recall("погода")
    assert "Забыл" in m.forget("Cyberpunk")
    assert m.facts() == []


def test_registry(tmp_path):
    cfg = load()
    reg = load_all()
    names = set(reg.tools)
    for n in ["open_app", "web_search", "look", "run_shell", "memory", "set_timer", "vpn", "sound", "write_file"]:
        assert n in names
    for s in reg.schemas():
        assert s["function"]["parameters"]["type"] == "object"
    asked = []
    ctx = Context(cfg, memory=Memory(tmp_path / "m.db"), confirm=lambda d: asked.append(d) or False)
    res = reg.execute("run_shell", {"command": "rm -rf /tmp/x"}, ctx)
    assert "НЕ подтвердил" in res and asked
    assert "Запомнил" in reg.execute("memory", {"action": "remember", "text": "Зовут Кирилл"}, ctx)
    assert "Кирилл" in reg.execute("memory", {"action": "recall", "text": "Кирилл"}, ctx)
    assert "нет" in reg.execute("nope", {}, ctx)
    assert "не хватает" in reg.execute("open_app", {}, ctx)


def test_arg_coercion():
    from coulson.tools import _coerce
    assert _coerce("false", ("boolean", "")) is False
    assert _coerce("true", ("boolean", "")) is True
    assert _coerce("40", ("integer", "")) == 40
    assert _coerce("2,5", ("number", "")) == 2.5
    assert _coerce(3.0, ("integer", "")) == 3
    assert _coerce("abc", ("integer", "")) == "abc"
