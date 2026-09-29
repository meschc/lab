"""Инициатива, как у Джарвиса: напоминания о днях рождения и событиях, утренняя сводка.

Источники: Календарь macOS через EventKit (в нём и календарь «Дни рождения», который macOS сама строит из
Контактов) и собственные записи Колсона (notes kind=event/birthday). Колсон говорит сам, только когда это
уместно: пользователь за Маком (был ввод за последние минуты, экран не заблокирован), не тихие часы,
не идёт игра и Колсон не занят — и не чаще раза в N минут. Каждое напоминание звучит один раз.
"""
from __future__ import annotations

import datetime as dt
import logging
import re
import threading
import time
from dataclasses import dataclass

log = logging.getLogger(__name__)

_MONTHS = {"январ": 1, "феврал": 2, "март": 3, "апрел": 4, "ма": 5, "июн": 6, "июл": 7, "август": 8,
           "сентябр": 9, "октябр": 10, "ноябр": 11, "декабр": 12}


def parse_date(text: str, yearly: bool = False) -> str:
    """«2026-10-12», «12.10», «12.10.1965», «12 октября» → ISO; для ежегодных год 0000."""
    t = (text or "").strip().lower()
    m = re.fullmatch(r"(\d{4})-(\d{1,2})-(\d{1,2})", t)
    if m:
        y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
    else:
        m = re.fullmatch(r"(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?", t)
        if m:
            d, mo = int(m.group(1)), int(m.group(2))
            y = int(m.group(3)) if m.group(3) else 0
            y = y + 2000 if 0 < y < 100 else y
        else:
            m = re.fullmatch(r"(\d{1,2})\s+([а-яё]+)(?:\s+(\d{4}))?", t)
            if not m:
                return ""
            d = int(m.group(1))
            mo = next((n for stem, n in sorted(_MONTHS.items(), key=lambda kv: -len(kv[0]))
                       if m.group(2).startswith(stem)), 0)
            y = int(m.group(3)) if m.group(3) else 0
    try:
        dt.date(2000, mo, d)  # високосный год — чтобы 29.02 проходил проверку
    except ValueError:
        return ""
    if yearly:
        y = 0
    elif y == 0:  # событие без года — ближайшее такое число
        today = dt.date.today()
        y = today.year if (mo, d) >= (today.month, today.day) else today.year + 1
    return f"{y:04d}-{mo:02d}-{d:02d}"


@dataclass
class Upcoming:
    kind: str                 # birthday | event
    title: str
    date: dt.date
    start: dt.datetime | None  # у событий со временем
    source: str               # calendar | notes

    @property
    def days(self) -> int:
        return (self.date - dt.date.today()).days

    def when_text(self) -> str:
        d = self.days
        day = "сегодня" if d == 0 else "завтра" if d == 1 else f"через {d} дн. ({self.date:%d.%m})"
        return f"{day} в {self.start:%H:%M}" if self.start else day


def _next_yearly(month: int, day: int) -> dt.date:
    today = dt.date.today()
    for year in (today.year, today.year + 1):
        try:
            d = dt.date(year, month, day)
        except ValueError:  # 29 февраля в невисокосный год — отмечаем 28-го
            d = dt.date(year, month, 28)
        if d >= today:
            return d
    return today


def from_notes(memory) -> list[Upcoming]:
    out = []
    for h in memory.dated_notes():
        y, mo, d = (int(x) for x in h.date.split("-"))
        date = _next_yearly(mo, d) if (y == 0 or h.kind == "birthday") else dt.date(y, mo, d)
        if date >= dt.date.today():
            out.append(Upcoming(h.kind, h.title or h.text, date, None, "notes"))
    return out


_cal_cache: tuple[float, list[Upcoming]] = (0.0, [])


def from_calendar(days: int = 8) -> list[Upcoming]:
    """События и дни рождения из Календаря macOS (EventKit). Нет доступа — пустой список."""
    global _cal_cache
    if time.monotonic() - _cal_cache[0] < 900:
        return _cal_cache[1]
    out: list[Upcoming] = []
    try:
        import EventKit
        import Foundation

        store = EventKit.EKEventStore.alloc().init()
        done, granted = threading.Event(), [False]

        def handler(ok, err):
            granted[0] = bool(ok)
            done.set()

        if hasattr(store, "requestFullAccessToEventsWithCompletion_"):  # macOS 14+
            store.requestFullAccessToEventsWithCompletion_(handler)
        else:
            store.requestAccessToEntityType_completion_(EventKit.EKEntityTypeEvent, handler)
        done.wait(30)
        if granted[0]:
            start = Foundation.NSDate.date()
            end = Foundation.NSDate.dateWithTimeIntervalSinceNow_(days * 86400)
            pred = store.predicateForEventsWithStartDate_endDate_calendars_(start, end, None)
            for e in store.eventsMatchingPredicate_(pred) or []:
                ts = e.startDate().timeIntervalSince1970()
                when = dt.datetime.fromtimestamp(ts)
                cal = (e.calendar().title() or "").lower() if e.calendar() else ""
                is_bday = "рожден" in cal or "birthday" in cal or (
                    hasattr(e, "birthdayContactIdentifier") and e.birthdayContactIdentifier() is not None)
                out.append(Upcoming("birthday" if is_bday else "event", str(e.title() or "Событие"), when.date(),
                                    None if (e.isAllDay() or is_bday) else when, "calendar"))
    except Exception as e:  # нет PyObjC EventKit (не macOS) или доступа
        log.debug("календарь недоступен: %s", e)
    _cal_cache = (time.monotonic(), out)
    return out


def upcoming(ctx, days: int = 8) -> list[Upcoming]:
    items = [u for u in from_notes(ctx.memory) + from_calendar(days) if 0 <= u.days <= days]
    seen, uniq = set(), []
    for u in sorted(items, key=lambda u: (u.date, u.start or dt.datetime.min)):
        key = (u.kind, u.title.lower()[:30], u.date)
        if key not in seen:
            seen.add(key)
            uniq.append(u)
    return uniq


def _who(title: str) -> str:
    """«День рождения мамы» → «мамы»."""
    return re.sub(r"^(день рождения|др)[:\s-]*", "", title, flags=re.I).strip() or title


def _days_word(n: int) -> str:
    return "день" if n % 10 == 1 and n % 100 != 11 else "дня" if 2 <= n % 10 <= 4 and not 12 <= n % 100 <= 14 \
        else "дней"


def nudges(ctx, now: dt.datetime | None = None) -> list[tuple[str, str]]:
    """Что пора сказать: [(ключ, текст)] — ключ, чтобы не повторять."""
    c = ctx.cfg.get("proactive") or {}
    remind_days = [int(x) for x in c.get("birthday_days", [7, 3, 1, 0])]
    remind_min = [int(x) for x in c.get("event_minutes", [60, 15])]
    now = now or dt.datetime.now()
    name = (ctx.cfg.assistant.get("user_name") or "").strip()
    hello = f"{name}, " if name else ""
    out = []
    for u in upcoming(ctx, days=max(remind_days + [1])):
        if u.kind == "birthday" and u.days in remind_days:
            who = _who(u.title)
            if u.days == 0:
                text = f"{hello}сегодня день рождения: {who}. Не забудьте поздравить."
            elif u.days == 1:
                text = f"{hello}завтра день рождения: {who}. Подарок уже есть? Могу подобрать варианты."
            else:
                text = f"{hello}через {u.days} {_days_word(u.days)} день рождения: {who}. Подобрать варианты подарка?"
            out.append((f"bday:{u.title}:{u.date}:{u.days}", text))
        elif u.kind == "event" and u.start:
            minutes = (u.start - now).total_seconds() / 60
            for m in sorted(remind_min):
                if 0 < minutes <= m:
                    out.append((f"ev:{u.title}:{u.start:%Y%m%d%H%M}:{m}",
                                f"{hello}через {int(round(minutes))} мин: {u.title}."))
                    break
        elif u.kind == "event" and u.days == 1 and now.hour >= 18:
            out.append((f"ev:{u.title}:{u.date}:eve", f"{hello}напоминаю: завтра {u.title}."))
    return [(k, t) for k, t in out if not ctx.memory.nudge_sent(k)]


def briefing(ctx, weather: str = "") -> str:
    """Утренняя сводка — без модели, мгновенно."""
    name = (ctx.cfg.assistant.get("user_name") or "").strip()
    hour = dt.datetime.now().hour
    greet = "Доброе утро" if 5 <= hour < 12 else "Добрый день" if hour < 18 else "Добрый вечер"
    parts = [f"{greet}{', ' + name if name else ''}."]
    if weather:
        parts.append(weather)
    items = upcoming(ctx, days=7)
    today = [u for u in items if u.days == 0 and u.kind == "event"]
    if today:
        parts.append("Сегодня: " + "; ".join(f"{u.start:%H:%M} {u.title}" if u.start else u.title
                                             for u in today[:4]) + ".")
    bdays = [u for u in items if u.kind == "birthday"]
    if bdays:
        parts.append("Скоро дни рождения: " + ", ".join(
            f"{_who(u.title)} — {u.when_text()}" for u in bdays[:3]) + ".")
    tasks = ctx.memory.list_notes(kind="task", open_only=True, limit=50)
    if tasks:
        parts.append(f"Открытых задач: {len(tasks)}.")
    return " ".join(parts)


# ---------------------------------------------------------------- присутствие пользователя

def user_idle_seconds() -> float:
    try:
        import Quartz
        return float(Quartz.CGEventSourceSecondsSinceLastEventType(
            Quartz.kCGEventSourceStateHIDSystemState, Quartz.kCGAnyInputEventType))
    except Exception:
        return 0.0


def screen_locked() -> bool:
    try:
        import Quartz
        d = Quartz.CGSessionCopyCurrentDictionary() or {}
        return bool(d.get("CGSSessionScreenIsLocked", 0))
    except Exception:
        return False


def frontmost_is_game() -> bool:
    try:
        from AppKit import NSWorkspace

        from .tools.apps import is_game
        app = NSWorkspace.sharedWorkspace().frontmostApplication()
        url = app.bundleURL() if app else None
        return bool(url and is_game(str(url.path())))
    except Exception:
        return False
