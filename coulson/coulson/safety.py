"""Что считается опасным и требует голосового подтверждения."""
from __future__ import annotations

import re

_SHELL_RISKY = [
    (r"\bsudo\b|\bdoas\b", "команда с правами администратора"),
    (r"\brm\b|\brmdir\b|\bunlink\b|\bshred\b|\bsrm\b", "удаление файлов"),
    (r"\bmv\b", "перемещение/переименование файлов"),
    (r"\bdd\b|\bmkfs|\bdiskutil\s+(erase|partition|zero|secure|apfs\s+delete)", "операции с диском"),
    (r"\bchmod\b|\bchown\b|\bchflags\b|\bxattr\s+-[cd]", "изменение прав доступа"),
    (r"\bkill\b|\bkillall\b|\bpkill\b", "завершение процессов"),
    (r"\bshutdown\b|\breboot\b|\bhalt\b|pmset\s+(sleepnow|restoredefaults)", "выключение/перезагрузка"),
    (r"(curl|wget)[^|]*\|\s*(ba|z)?sh|\beval\b|base64\s+(-d|--decode)", "запуск кода из сети"),
    (r"\bgit\s+(push|reset\s+--hard|clean|checkout\s+--|branch\s+-D)", "необратимая git-операция"),
    (r"\blaunchctl\b|\bdefaults\s+(write|delete)\b|\bcsrutil\b|\bspctl\b|\bnvram\b", "системные настройки"),
    (r"\bnetworksetup\b|\bscutil\s+--set|\bsecurity\s+(delete|add|find-generic-password\s+-w)", "сеть/пароли"),
    (r"\b(brew|pip|pip3|npm|uv)\s+(uninstall|remove)\b", "удаление программ"),
    (r"(^|[^>])>\s*(?!/dev/null)[~/\w.]", "перезапись файла"),
    (r"\bcrontab\b|\bosascript\b", "автозапуск/скрипты"),
    (r"\bmail\b|\bsendmail\b", "отправка писем"),
    (r"\btruncate\b|:\s*>\s*\S", "очистка файла"),
]

_APPLESCRIPT_RISKY = [
    (r"\bdelete\b|\bempty\s+(the\s+)?trash\b|\berase\b", "удаление"),
    (r"do\s+shell\s+script", "выполнение shell-команды"),
    (r"\bsend\b|outgoing message|\bmessages?\b.*\bbuddy\b|\bparticipant\b", "отправка сообщений"),
    (r"\bshut\s*down\b|\brestart\b|\blog\s*out\b", "выключение/перезагрузка"),
    (r"with administrator privileges|\bpassword\b", "права администратора/пароль"),
    (r"\bmove\b.*\bto\s+trash\b|\bmove\b", "перемещение файлов"),
]


def _check(text: str, rules) -> str | None:
    reasons = [reason for pattern, reason in rules if re.search(pattern, text, re.I)]
    return ", ".join(dict.fromkeys(reasons)) or None


def shell_risk(cmd: str) -> str | None:
    return _check(cmd, _SHELL_RISKY)


def applescript_risk(script: str) -> str | None:
    return _check(script, _APPLESCRIPT_RISKY)
