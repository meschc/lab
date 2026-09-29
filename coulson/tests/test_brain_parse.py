from coulson.brain import parse_text_tool_calls


def test_qwen_xml():
    text = "<tool_call>\n<function=open_app>\n<parameter=name>\nSteam\n</parameter>\n</function>\n</tool_call>"
    assert parse_text_tool_calls(text) == [{"name": "open_app", "arguments": {"name": "Steam"}}]


def test_qwen_xml_json_value():
    text = "<function=volume><parameter=action>set</parameter><parameter=level>40</parameter></function>"
    assert parse_text_tool_calls(text) == [{"name": "volume", "arguments": {"action": "set", "level": 40}}]


def test_hermes_json():
    text = 'Открываю.<tool_call>{"name": "open_url", "arguments": {"url": "youtube.com"}}</tool_call>'
    assert parse_text_tool_calls(text) == [{"name": "open_url", "arguments": {"url": "youtube.com"}}]


def test_plain_text():
    assert parse_text_tool_calls("Готово, сэр.") == []
