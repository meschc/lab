import numpy as np

from coulson.config import load
from coulson.memory import Memory
from coulson.tools import Context, load_all

TOPICS = [("грузи", "отпуск", "поехать", "тбилиси", "путешеств", "горы"),
          ("молоко", "хлеб", "купить", "магазин"),
          ("проект", "созвон", "андре", "работ")]


class FakeEmbedder:
    """Вектор = темы, к которым относятся слова: хватает, чтобы проверить поиск «по смыслу», а не по словам."""
    available = True

    def embed(self, texts, query=False):
        out = []
        for t in texts:
            low = t.lower()
            v = np.array([sum(w in low for w in topic) for topic in TOPICS] + [0.3], dtype=np.float32)
            out.append(v / np.linalg.norm(v))
        return np.stack(out)


def mem(tmp_path):
    m = Memory(tmp_path / "m.db", FakeEmbedder())
    return m


def test_notes_crud(tmp_path):
    m = Memory(tmp_path / "m.db")
    n1 = m.add_note("Купить молоко", kind="task", tags="#дом, покупки")
    n2 = m.add_note("Идея: бот для заметок", title="Идеи")
    assert [h.id for h in m.list_notes(kind="task", open_only=True)] == [n1]
    assert m.list_notes(tag="покупки")[0].id == n1
    assert m.update_note(n1, done=True) and m.list_notes(kind="task", open_only=True) == []
    assert m.update_note(n2, text="и напоминаний", append=True)
    assert m.get_note(n2).text == "Идея: бот для заметок\nи напоминаний"
    assert m.delete_note(n2) and m.get_note(n2) is None


def test_semantic_search_finds_by_meaning(tmp_path):
    m = mem(tmp_path)
    target = m.add_note("Хочу в мае съездить в Грузию, посмотреть Тбилиси")
    m.add_note("Купить молоко и хлеб")
    m.add_note("Созвон с Андреем по проекту")
    m.wait_embedded(5)
    hits = m.search("куда я хотел поехать в отпуск", kinds=("notes",))
    assert hits[0].id == target and hits[0].sim > 0.8  # ни одного общего слова, но найдено по смыслу


def test_search_covers_facts_and_conversations(tmp_path):
    m = mem(tmp_path)
    m.add_fact("Пользователь мечтает о путешествии в горы")
    m.log("user", "Надо бы в отпуск поехать куда-нибудь")
    m.wait_embedded(5)
    kinds = {h.kind for h in m.search("отпуск и путешествия")}
    assert {"fact", "user"} <= kinds


def test_keyword_fallback_without_embeddings(tmp_path):
    m = Memory(tmp_path / "m.db")
    m.add_note("Пароль от вайфая на даче: лежит в синей папке")
    assert "синей папке" in m.search("вайфай дача")[0].text


def test_relevant_threshold_and_session_exclusion(tmp_path):
    m = mem(tmp_path)
    m.add_note("Хочу в Грузию в мае")
    m.log("user", "Поехать бы в отпуск в горы")
    m.wait_embedded(5)
    import time
    hits = m.relevant("планирую отпуск", min_sim=0.8, exclude_after=time.time() - 1)
    assert hits and all(h.kind != "user" for h in hits)            # текущая сессия не дублируется
    assert m.relevant("погода на завтра", min_sim=0.8) == []        # не относящееся — не подмешиваем


def test_notes_tool_and_delete_confirmation(tmp_path):
    reg = load_all()
    asked = []
    ctx = Context(load(), memory=mem(tmp_path), confirm=lambda d: asked.append(d) or False)
    assert "задача" in reg.execute("notes", {"action": "add", "text": "Купить хлеб", "kind": "task"}, ctx)
    assert "Купить хлеб" in reg.execute("notes", {"action": "list", "kind": "task"}, ctx)
    assert "НЕ подтвердил" in reg.execute("notes", {"action": "delete", "id": 1}, ctx) and asked
    assert "Отметил" in reg.execute("notes", {"action": "done", "id": "1"}, ctx)
    assert "нужен id" in reg.execute("notes", {"action": "done"}, ctx)


def test_plan_tool(tmp_path):
    reg = load_all()
    progress = []
    ctx = Context(load(), memory=Memory(tmp_path / "m.db"), progress=progress.append)
    out = reg.execute("plan", {"action": "set", "steps": ["Открыть Стим", "Запустить Доту", "Сделать громче"]}, ctx)
    assert "Сейчас шаг 1: Открыть Стим" in out and progress[-1] == "шаг 1 из 3"
    out = reg.execute("plan", {"action": "done", "step": 1}, ctx)
    assert "Сейчас шаг 2" in out and progress[-1] == "шаг 2 из 3"
    reg.execute("plan", {"action": "done"}, ctx)
    out = reg.execute("plan", {"action": "done"}, ctx)
    assert "Все шаги выполнены" in out and progress[-1] == "готово 3 из 3"
