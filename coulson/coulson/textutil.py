"""Работа с текстом: слово-активатор, транслитерация, подготовка текста к озвучке."""
from __future__ import annotations

import re

from rapidfuzz import fuzz

_WORD_RE = re.compile(r"[A-Za-zА-Яа-яЁё0-9'’-]+")
_CYR_RE = re.compile(r"[А-Яа-яЁё]")
_LAT_RE = re.compile(r"[A-Za-z]")


def normalize(text: str) -> str:
    text = text.lower().replace("ё", "е")
    return re.sub(r"[^\w\s-]", " ", text).strip()


# ---------------------------------------------------------------- слово-активатор

def _skeleton(word: str) -> str:
    """Согласный «скелет» слова в латинице: колсон / coulson -> klsn."""
    w = ru_to_lat(normalize(word)).replace("c", "k")
    w = re.sub(r"[aeiouyh'’-]", "", w)
    return re.sub(r"(.)\1+", r"\1", w)


def find_wake(text: str, wake_words: list[str], threshold: int = 85) -> tuple[bool, str]:
    """Ищет слово-активатор в любом месте фразы. Возвращает (найдено, фраза без него)."""
    words = [normalize(w) for w in wake_words]
    skeletons = {_skeleton(w) for w in words}
    for m in _WORD_RE.finditer(text):
        token = normalize(m.group())
        if len(token) < 4:
            continue
        sk = _skeleton(token)
        if (max(fuzz.ratio(token, w) for w in words) >= threshold
                and "ls" in sk and max(fuzz.ratio(sk, s) for s in skeletons) >= 80):
            rest = text[: m.start()] + text[m.end():]
            rest = re.sub(r"^\s*(эй|хей|hey|ok|окей|слушай)\b", "", rest.strip(" ,.!?;:—-"), flags=re.I)
            rest = re.sub(r"\s{2,}", " ", rest).strip(" ,.!?;:—-")
            return True, rest
    return False, text.strip()


_YES = ("да", "ага", "угу", "давай", "выполняй", "выполни", "подтверждаю", "конечно", "можно", "делай",
        "yes", "yeah", "yep", "sure", "go", "confirm", "ok", "окей", "хорошо", "согласен")
_NO = ("нет", "не надо", "не нужно", "не стоит", "отмена", "отмени", "стоп", "no", "nope", "cancel", "stop")


def parse_yes_no(text: str) -> bool | None:
    t = f" {normalize(text)} "
    if any(f" {w} " in t for w in _NO):
        return False
    if any(f" {w} " in t for w in _YES):
        return True
    return None


_STOP_RE = re.compile(r"^(стоп|хватит|замолчи|тихо|отмена|отмени|stop|cancel|shut up|enough)$")


def is_stop_command(text: str) -> bool:
    return bool(_STOP_RE.match(normalize(text)))


# ---------------------------------------------------------------- транслитерация

_RU2LAT = {"а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "e", "ж": "zh", "з": "z", "и": "i",
           "й": "y", "к": "k", "л": "l", "м": "m", "н": "n", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t",
           "у": "u", "ф": "f", "х": "h", "ц": "ts", "ч": "ch", "ш": "sh", "щ": "sch", "ъ": "", "ы": "y", "ь": "",
           "э": "e", "ю": "yu", "я": "ya"}


def ru_to_lat(text: str) -> str:
    return "".join(_RU2LAT.get(ch, ch) for ch in text.lower())


# Частые слова, которые модель может оставить латиницей в русском ответе
_SPOKEN = {"vpn": "ви пи эн", "steam": "стим", "youtube": "ютуб", "google": "гугл", "telegram": "телеграм",
           "safari": "сафари", "macos": "мак о эс", "mac": "мак", "wi-fi": "вай фай", "wifi": "вай фай",
           "yandex": "яндекс", "chrome": "хром", "discord": "дискорд", "spotify": "спотифай", "ok": "окей",
           "iphone": "айфон", "apple": "эппл", "ai": "эй ай", "epic": "эпик", "games": "геймс", "finder": "файндер",
           "terminal": "терминал", "whatsapp": "вотсап", "zoom": "зум", "notion": "ноушен", "email": "имейл",
           "online": "онлайн", "usb": "ю эс би", "gpu": "джи пи ю", "cpu": "си пи ю", "ram": "рам"}

_LAT_DIGRAPHS = [("sch", "ш"), ("tion", "шн"), ("sh", "ш"), ("ch", "ч"), ("th", "т"), ("ph", "ф"), ("oo", "у"),
                 ("ee", "и"), ("ea", "и"), ("ck", "к"), ("qu", "кв"), ("kh", "х"), ("zh", "ж"), ("ya", "я"),
                 ("yu", "ю"), ("ts", "ц"), ("ou", "ау"), ("ow", "оу"), ("ay", "эй"), ("ey", "эй"), ("oa", "оу")]
_LAT_SINGLE = {"a": "а", "b": "б", "c": "к", "d": "д", "e": "е", "f": "ф", "g": "г", "h": "х", "i": "и",
               "j": "дж", "k": "к", "l": "л", "m": "м", "n": "н", "o": "о", "p": "п", "q": "к", "r": "р",
               "s": "с", "t": "т", "u": "у", "v": "в", "w": "в", "x": "кс", "y": "и", "z": "з"}


_LETTER_NAMES = {"a": "эй", "b": "би", "c": "си", "d": "ди", "e": "и", "f": "эф", "g": "джи", "h": "эйч", "i": "ай",
                 "j": "джей", "k": "кей", "l": "эл", "m": "эм", "n": "эн", "o": "оу", "p": "пи", "q": "кью",
                 "r": "ар", "s": "эс", "t": "ти", "u": "ю", "v": "ви", "w": "дабл ю", "x": "экс", "y": "уай", "z": "зед"}


def lat_to_ru(word: str) -> str:
    w = word.lower()
    if w in _SPOKEN:
        return _SPOKEN[w]
    if word.isupper() and len(word) <= 5:  # аббревиатура: читаем по буквам
        return " ".join(_LETTER_NAMES.get(ch, ch) for ch in w)
    out, i = [], 0
    while i < len(w):
        for src, dst in _LAT_DIGRAPHS:
            if w.startswith(src, i):
                out.append(dst)
                i += len(src)
                break
        else:
            ch = w[i]
            if ch == "c" and i + 1 < len(w) and w[i + 1] in "eiy":
                out.append("с")
            elif ch == "e" and i == len(w) - 1 and len(w) > 3:
                pass  # немая e на конце
            else:
                out.append(_LAT_SINGLE.get(ch, ch))
            i += 1
    return "".join(out)


# ---------------------------------------------------------------- язык и предложения

def detect_lang(text: str) -> str:
    cyr, lat = len(_CYR_RE.findall(text)), len(_LAT_RE.findall(text))
    return "en" if lat > cyr * 2 and lat > 3 else "ru"


_SENT_END = re.compile(r"(.+?(?:[.!?…]+|\n+|:\s*\n))(?=\s|$)", re.S)


def pop_sentences(buffer: str, min_len: int = 12) -> tuple[list[str], str]:
    """Отрезает готовые предложения из потокового буфера. Возвращает (предложения, остаток)."""
    out, pos = [], 0
    pending = ""
    for m in _SENT_END.finditer(buffer):
        piece = pending + m.group(1)
        pos = m.end()
        if len(piece.strip()) < min_len:
            pending = piece
            continue
        out.append(piece.strip())
        pending = ""
    rest = pending + buffer[pos:]
    return out, rest


_HONORIFIC_RE = re.compile(r"(,\s*|\s+)?\b(сэр|сер|господин|хозяин|sir)\b(?=[\s,.!?…]|$)", re.I)


def strip_honorifics(text: str) -> str:
    """«Готово, сэр. Да, сэр, открываю» -> «Готово. Да, открываю»."""
    text = _HONORIFIC_RE.sub("", text)
    text = re.sub(r"^\s*[,.!]\s*", "", text)
    text = re.sub(r"\s+([,.!?…])", r"\1", text)
    text = re.sub(r"([,.!?…])\s*,", r"\1", text)
    text = re.sub(r"\s{2,}", " ", text).strip()
    return text[:1].upper() + text[1:] if text else text


def clean_for_speech(text: str) -> str:
    """Убирает markdown, ссылки, эмодзи — то, что нельзя произнести."""
    text = re.sub(r"```.*?```", " ", text, flags=re.S)
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)
    text = re.sub(r"https?://\S+", " ссылка ", text)
    text = re.sub(r"[*_#`>|~]+", " ", text)
    text = re.sub(r"^\s*[-•]\s+", "", text, flags=re.M)
    text = re.sub(r"[^\w\s.,!?;:()%°+\-—–'\"«»№/]", " ", text)
    return re.sub(r"\s{2,}", " ", text).strip()


def numbers_to_words_ru(text: str) -> str:
    from num2words import num2words

    def repl_pct(m):
        return f"{_num_ru(m.group(1))} процентов"

    def repl_deg(m):
        return f"{_num_ru(m.group(1))} градусов"

    def _num_ru(s: str) -> str:
        s = s.replace(",", ".").replace(" ", "")
        try:
            val = float(s) if "." in s else int(s)
            return num2words(val, lang="ru")
        except Exception:
            return s

    text = re.sub(r"(\d+(?:[.,]\d+)?)\s?%", repl_pct, text)
    text = re.sub(r"([+-]?\d+(?:[.,]\d+)?)\s?°\s?[CС]?", repl_deg, text)
    def repl_time(m):
        mins = m.group(2)
        mins_words = "ровно" if mins == "00" else ("ноль " if mins[0] == "0" else "") + _num_ru(mins.lstrip("0") or "0")
        return f"{_num_ru(m.group(1))} {mins_words}"

    text = re.sub(r"\b(\d{1,2}):(\d{2})\b", repl_time, text)
    return re.sub(r"\d+(?:[.,]\d+)?", lambda m: _num_ru(m.group()), text)


def prepare_ru(text: str) -> str:
    """Текст для Silero: без латиницы и цифр."""
    text = clean_for_speech(text)
    text = numbers_to_words_ru(text)
    text = re.sub(r"[A-Za-z][A-Za-z'-]*", lambda m: lat_to_ru(m.group()), text)
    return re.sub(r"\s{2,}", " ", text).strip()
