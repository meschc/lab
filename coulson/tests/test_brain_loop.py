import threading
from types import SimpleNamespace as NS

from coulson.brain import Brain
from coulson.config import load
from coulson.memory import Memory
from coulson.tools import Context, Registry


def chunk(content="", tool_calls=None):
    return NS(message=NS(content=content, tool_calls=tool_calls))


def tc(name, args):
    return NS(function=NS(name=name, arguments=args))


class FakeClient:
    def __init__(self, scripts):
        self.scripts = list(scripts)
        self.calls = []

    def chat(self, **kw):
        self.calls.append(kw)
        return iter(self.scripts.pop(0))


def make(tmp_path, scripts):
    cfg = load()
    reg = Registry()
    opened = []

    @reg.add("open_app", "open", {"name": ("string", "n")}, ["name"])
    def open_app(ctx, name):
        opened.append(name)
        return f"Запущено: {name}"

    b = Brain(cfg, reg, Memory(tmp_path / "m.db"))
    b.client = FakeClient(scripts)
    return b, Context(cfg, memory=b.memory), opened


def test_tool_then_answer(tmp_path):
    b, ctx, opened = make(tmp_path, [
        [chunk(tool_calls=[tc("open_app", {"name": "Steam"})])],
        [chunk("Готово. "), chunk("Стим запущен. Запустить "), chunk("вашу игру?")],
    ])
    spoken = []
    reply = b.respond("открой стим", ctx, spoken.append)
    assert opened == ["Steam"]
    assert spoken == ["Готово. Стим запущен.", "Запустить вашу игру?"]
    assert reply.startswith("Готово")
    second = b.client.calls[1]["messages"]
    assert second[-1]["role"] == "tool" and "Запущено" in second[-1]["content"]
    assert b.history[-1]["role"] == "assistant"


def test_text_tool_call_fallback_is_not_spoken(tmp_path):
    b, ctx, opened = make(tmp_path, [
        [chunk("<tool_call>\n<function=open_app>\n<parameter=name>\nTelegram\n"), chunk("</parameter>\n</function>\n</tool_call>")],
        [chunk("Телеграм открыт.")],
    ])
    spoken = []
    b.respond("открой телегу", ctx, spoken.append)
    assert opened == ["Telegram"]
    assert spoken == ["Телеграм открыт."]


def test_cancel(tmp_path):
    cancel = threading.Event()
    cancel.set()
    b, ctx, opened = make(tmp_path, [[chunk("Длинный ответ. " * 5)]])
    spoken = []
    b.respond("расскажи", ctx, spoken.append, cancel=cancel)
    assert spoken == [] and opened == []
