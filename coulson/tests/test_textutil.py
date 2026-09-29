from coulson.textutil import (detect_lang, find_wake, is_stop_command, lat_to_ru, parse_yes_no, pop_sentences,
                              prepare_ru)

WAKE = ["колсон", "коулсон", "колсан", "колсен", "колсона", "колсону", "coulson", "colson", "kolson"]


def test_wake_found_anywhere():
    assert find_wake("Колсон, открой Стим", WAKE) == (True, "открой Стим")
    assert find_wake("Открой телеграм, Колсон.", WAKE) == (True, "Открой телеграм")
    assert find_wake("Коулсон включи музыку", WAKE) == (True, "включи музыку")
    assert find_wake("Эй, Колсон!", WAKE) == (True, "")
    assert find_wake("Coulson, open Safari", WAKE) == (True, "open Safari")
    assert find_wake("Ёлки, Колсен, что на экране?", WAKE)[0]


def test_wake_not_found():
    for text in ["колесо от машины", "я пошёл в кино", "классное кольцо", "колонка играет", "Колыма"]:
        assert find_wake(text, WAKE)[0] is False, text


def test_yes_no():
    assert parse_yes_no("Да, выполняй") is True
    assert parse_yes_no("давай") is True
    assert parse_yes_no("нет, не надо") is False
    assert parse_yes_no("отмена") is False
    assert parse_yes_no("yes please") is True
    assert parse_yes_no("что там с погодой") is None


def test_stop():
    assert is_stop_command("Стоп!")
    assert is_stop_command("хватит")
    assert not is_stop_command("стоп игра")


def test_lang():
    assert detect_lang("Открываю Стим.") == "ru"
    assert detect_lang("Opening Steam for you right now.") == "en"
    assert detect_lang("Запустил Steam") == "ru"


def test_sentences_streaming():
    sents, rest = pop_sentences("Готово. Стим запущен! Что ещё")
    assert sents == ["Готово. Стим запущен!"]
    assert rest.strip() == "Что ещё"
    sents, rest = pop_sentences("Да. Конечно, сейчас сделаю.")
    assert sents == ["Да. Конечно, сейчас сделаю."]


def test_prepare_ru():
    out = prepare_ru("Запускаю **Steam**, температура 21°C, заряд 85%.")
    assert "Steam" not in out and "стим" in out
    assert "двадцать один градусов" in out
    assert "восемьдесят пять процентов" in out
    assert "*" not in out
    assert prepare_ru("VPN включён") .startswith("ви пи эн")
    assert lat_to_ru("NASA") == "эн эй эс эй"


def test_wake_edge_cases():
    for text in ["кулон на шее", "Карлсон прилетел", "Нельсон", "клоун"]:
        assert find_wake(text, WAKE)[0] is False, text
    assert find_wake("Колсона позови", WAKE)[0]


def test_time_speech():
    assert "четырнадцать ноль пять" in prepare_ru("Сейчас 14:05")
    assert "девять ровно" in prepare_ru("Встреча в 9:00")


def test_strip_honorifics():
    from coulson.textutil import strip_honorifics
    assert strip_honorifics("Готово, сэр.") == "Готово."
    assert strip_honorifics("Сэр, Стим запущен.") == "Стим запущен."
    assert strip_honorifics("Да, сэр, открываю.") == "Да, открываю."
    assert strip_honorifics("Right away, sir!") == "Right away!"
    assert strip_honorifics("Сергей звонил") == "Сергей звонил"
    assert strip_honorifics("Сэр.") == ""
