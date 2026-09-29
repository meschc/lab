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


def test_mood_tag_split_across_chunks_is_not_spoken(tmp_path):
    b, ctx, opened = make(tmp_path, [
        [chunk("[wa"), chunk("rn] Свободно всего 9 гигабайт. "), chunk("Диск почти заполнен.")],
    ])
    spoken, moods = [], []
    reply = b.respond("сколько места", ctx, spoken.append, on_mood=moods.append)
    assert spoken == ["Свободно всего 9 гигабайт.", "Диск почти заполнен."]
    assert moods == [0.5] and reply.startswith("Свободно")
    assert b.history[-1]["content"].startswith("[warn] ")


def test_mood_fallback_by_words_and_tool_errors(tmp_path):
    b, ctx, opened = make(tmp_path, [[chunk("К сожалению, не удалось найти файл.")]])
    moods = []
    b.respond("найди файл", ctx, lambda s: None, on_mood=moods.append)
    assert moods == [0.5]


def test_prefix_is_stable_between_turns(tmp_path):
    b, ctx, opened = make(tmp_path, [[chunk("[ok] Первый.")], [chunk("[ok] Второй.")]])
    b.respond("раз", ctx, lambda s: None)
    b.respond("два", ctx, lambda s: None)
    m1, m2 = (c["messages"] for c in b.client.calls)
    assert m1[0] == m2[0]                       # системный промпт не меняется (кэш Ollama)
    assert m1[-1]["content"].endswith("раз") and m1[-1]["content"].startswith("(сейчас")
    assert m2[:len(m1) - 1] == m1[:-1]          # новая реплика только дописывается в конец
    assert m2[len(m1) - 1]["content"] == "раз"   # в истории — без отметки времени


def test_image_attached_in_conversation(tmp_path):
    img = tmp_path / "shot.jpg"
    img.write_bytes(b"x")
    b, ctx, opened = make(tmp_path, [
        [chunk(tool_calls=[tc("look", {"source": "screen", "question": "что тут"})])],
        [chunk("[ok] На экране Стим.")],
    ])

    @b.tools.add("look", "look", {"source": ("string", ""), "question": ("string", "")}, ["source", "question"])
    def look(ctx, source, question):
        ctx.attach_image(str(img))
        return "Снимок приложен"

    b.respond("что на экране", ctx, lambda s: None)
    last = b.client.calls[1]["messages"][-1]
    assert last["role"] == "user" and last["images"] == [str(img)]
    assert not img.exists()  # временный снимок удалён


def test_facts_go_after_system_prompt(tmp_path):
    b, ctx, opened = make(tmp_path, [[chunk("[ok] Да.")], [chunk("[ok] Ага.")]])
    b.respond("раз", ctx, lambda s: None)
    b.memory.add_fact("Любимая игра — Dota 2")
    b.respond("два", ctx, lambda s: None)
    m1, m2 = (c["messages"] for c in b.client.calls)
    assert m1[0] == m2[0] and m2[0]["role"] == "system" and "Dota" not in m2[0]["content"]
    assert m2[1]["role"] == "user" and "Dota 2" in m2[1]["content"] and m2[2]["role"] == "assistant"
