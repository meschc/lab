"""Быстрый путь: простые команды без нейросети (как «prefer handling commands locally» в Home Assistant).

Громкость, пауза, «открой Стим», таймер, время — распознаются по шаблонам и выполняются за ~0.1 с,
без ошибок модели. И работают, даже когда модель выгружена (игровой режим). Всё, что не совпало
уверенно, уходит в LLM.
"""
from __future__ import annotations

import re
import time
from dataclasses import dataclass

from .textutil import normalize

_UNITS = {"ноль": 0, "один": 1, "одна": 1, "два": 2, "две": 2, "три": 3, "четыре": 4, "пять": 5, "шесть": 6,
          "семь": 7, "восемь": 8, "девять": 9, "десять": 10, "одиннадцать": 11, "двенадцать": 12,
          "тринадцать": 13, "четырнадцать": 14, "пятнадцать": 15, "шестнадцать": 16, "семнадцать": 17,
          "восемнадцать": 18, "девятнадцать": 19}
_TENS = {"двадцать": 20, "тридцать": 30, "сорок": 40, "пятьдесят": 50, "шестьдесят": 60, "семьдесят": 70,
         "восемьдесят": 80, "девяносто": 90, "сто": 100}
_NUM = r"(\d{1,3}|(?:(?:" + "|".join(_TENS) + r")(?: (?:" + "|".join(_UNITS) + r"))?)|" + "|".join(_UNITS) + r"|полчаса|час)"


def words_to_int(text: str) -> int | None:
    """«30», «тридцать пять», «десять» → число."""
    text = text.strip()
    if text.isdigit():
        return int(text)
    total, found = 0, False
    for w in text.split():
        if w in _TENS:
            total += _TENS[w]
            found = True
        elif w in _UNITS:
            total += _UNITS[w]
            found = True
        else:
            return None
    return total if found else None


@dataclass
class Fast:
    reply: str
    mood: float = 0.0


def _say_time() -> str:
    t = time.localtime()
    return f"Сейчас {t.tm_hour}:{t.tm_min:02d}."


def _say_date() -> str:
    from .brain import _WEEKDAYS
    months = ("января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября",
              "ноября", "декабря")
    t = time.localtime()
    return f"Сегодня {_WEEKDAYS[t.tm_wday]}, {t.tm_mday} {months[t.tm_mon - 1]}."


_SIMPLE = [  # (шаблон целиком, инструмент, аргументы, ответ)
    (r"(сделай )?(погромче|громче|прибавь( звук| громкость)?)", "sound", {"action": "up"}, None),
    (r"(сделай )?(потише|тише|убавь( звук| громкость)?)", "sound", {"action": "down"}, None),
    (r"(выключи звук|без звука|убери звук|mute)", "sound", {"action": "mute"}, "Звук выключен."),
    (r"(включи звук|верни звук|unmute)", "sound", {"action": "unmute"}, "Звук включён."),
    (r"(пауза|поставь на паузу|останови музыку|продолжи (музыку|воспроизведение)|сними с паузы)",
     "sound", {"action": "play_pause"}, "Готово."),
    (r"(следующ(ий|ая|ую) (трек|песня|песню)|переключи (трек|песню)|next track)", "sound", {"action": "next"},
     "Следующий трек."),
    (r"(предыдущ(ий|ая|ую) (трек|песня|песню)|верни (трек|песню)|previous track)", "sound",
     {"action": "previous"}, "Предыдущий трек."),
    (r"заблокируй (экран|мак|компьютер|ноутбук)", "system_action", {"action": "lock_screen"}, "Блокирую."),
    (r"(выключи|погаси) (экран|монитор|дисплей)", "system_action", {"action": "display_off"}, "Готово."),
    (r"(включи )?(тёмн|темн)(ую|ая) тем(у|а)", "system_action", {"action": "dark_mode_on"}, "Тёмная тема."),
    (r"(включи )?светл(ую|ая) тем(у|а)", "system_action", {"action": "dark_mode_off"}, "Светлая тема."),
]

_BLOCK_OPEN = re.compile(r"(сайт|страниц|вкладк|http|www|\.(com|ru|net|org|рф)\b| и | потом | затем |,)")


def try_fast(command: str, tools, ctx) -> Fast | None:
    """Вернёт готовый ответ, если команда простая и выполнена; иначе None (пусть думает модель)."""
    t = normalize(command)
    if not t or len(t) > 60:
        return None

    if re.fullmatch(r"(который час|сколько (сейчас )?времени|сколько время|what time is it)", t):
        return Fast(_say_time())
    if re.fullmatch(r"(какое сегодня число|какой сегодня день|какое число|какая сегодня дата)", t):
        return Fast(_say_date())

    m = re.fullmatch(r"(сделай |поставь |установи )?громкость (на )?" + _NUM + r"( процент\w*)?", t)
    if m and (level := words_to_int(m.group(3))) is not None and 0 <= level <= 100:
        return _run(tools, ctx, "sound", {"action": "set", "level": level}, f"Громкость {level}.")

    m = re.fullmatch(r"(поставь |заведи |запусти )?таймер на " + _NUM + r" ?(минут\w*|мин|секунд\w*|сек|час\w*)?", t)
    if m:
        raw, unit = m.group(2), m.group(3) or "минут"
        if raw in ("полчаса", "час"):
            minutes = 30 if raw == "полчаса" else 60
        else:
            n = words_to_int(raw) or 0
            minutes = n / 60 if unit.startswith("сек") else (n * 60 if unit.startswith("час") else n)
        if minutes > 0:
            return _run(tools, ctx, "set_timer", {"minutes": minutes}, None)

    for pattern, tool, args, reply in _SIMPLE:
        if re.fullmatch(pattern, t):
            return _run(tools, ctx, tool, args, reply)

    m = re.fullmatch(r"(включи|поставь|запусти|играй|сыграй) (песню|трек|музыку|альбом|группу|исполнителя) (.+)", t)
    if m:
        return _run(tools, ctx, "music", {"action": "play", "query": m.group(3)}, None)
    if re.fullmatch(r"(включи |запусти |поставь )?(мою волну|моя волна)", t):
        return _run(tools, ctx, "music", {"action": "my_wave"}, None)
    if re.fullmatch(r"(включи |поставь )?(любимые|мои любимые|любимые треки|мне нравится)( треки| песни)?", t):
        return _run(tools, ctx, "music", {"action": "liked"}, None)
    if re.fullmatch(r"(что (сейчас )?играет|что это за (песня|трек)|как называется (песня|трек))", t):
        return _run(tools, ctx, "music", {"action": "now_playing"}, None)
    if re.fullmatch(r"(лайк|лайкни|нравится|мне нравится эта (песня|трек)|добавь в (любимые|мне нравится))", t):
        return _run(tools, ctx, "music", {"action": "like"}, None)
    if re.fullmatch(r"(дизлайк|не нравится|убери эту песню|не предлагай (её|ее|это))", t):
        return _run(tools, ctx, "music", {"action": "dislike"}, None)
    if re.fullmatch(r"подключи (яндекс )?музыку|войди в (яндекс )?музыку", t):
        return _run(tools, ctx, "music", {"action": "connect"}, None)

    vpn = r"(впн|vpn|ви пи эн|вэпээн)"
    if re.fullmatch(rf"(включи|подключи|запусти|врубай|вруби) {vpn}", t):
        return _run(tools, ctx, "vpn", {"action": "on"}, None)
    if re.fullmatch(rf"(выключи|отключи|вырубай|выруби) {vpn}", t):
        return _run(tools, ctx, "vpn", {"action": "off"}, "VPN выключен.")
    if re.fullmatch(rf"((проверь|какой|где|статус) {vpn}|{vpn} работает|{vpn} включен|через какую страну .*)", t):
        return _run(tools, ctx, "vpn", {"action": "status"}, None)
    if re.fullmatch(r"(открой|запусти) (клод|клоуд|claude)( код| code| кот)?", t):
        return _run(tools, ctx, "claude", {"action": "open"}, None)

    m = re.fullmatch(r"(открой|запусти|включи|open|launch) (.+)", t)
    if m and not _BLOCK_OPEN.search(" " + m.group(2) + " "):
        return _open_app(tools, ctx, m.group(2))
    m = re.fullmatch(r"(закрой|выйди из|close|quit) (.+)", t)
    if m and not _BLOCK_OPEN.search(" " + m.group(2) + " "):
        from .tools.apps import index
        hit = index.resolve(m.group(2), ctx.cfg.apps.get("aliases", {}), threshold=85)
        if hit:
            return _run(tools, ctx, "quit_app", {"name": hit[0]}, None)
    return None


def _open_app(tools, ctx, name: str) -> Fast | None:
    from .tools.apps import index

    hit = index.resolve(name, ctx.cfg.apps.get("aliases", {}), threshold=85, rebuild=False)
    if not hit:
        return None  # не уверены — пусть модель разберётся (найдёт похожее, спросит)
    res = tools.execute("open_app", {"name": hit[0]}, ctx)
    if not res.startswith("Запущено"):
        return None
    return Fast(f"Открываю {hit[0]}.")


def _run(tools, ctx, tool: str, args: dict, reply: str | None) -> Fast | None:
    res = tools.execute(tool, args, ctx)
    trouble = res.startswith(("Ошибка", "[код", "Пользователь НЕ"))
    if trouble:
        return Fast(f"Не получилось: {res}", mood=0.5)
    return Fast(reply or res.rstrip(".") + ".")
