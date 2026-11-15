"""End-of-day recap (GET /reports/day, POST /reports/day/refresh): what went well, what to work on,
simple goals for tomorrow, and yesterday's goals judged on today. The day is the wearer's LOCAL day.

    _day.py       local zone and day bounds, the day's conversations
    _facts.py     per-person groups and plain good/ok/bad verdicts per measure
    _findings.py  went-well / work-on picks, the supported contrast, goals, rule wording
    _goals.py     yesterday's goals judged honestly (met true/false/None)
    _llm.py       Gemini wording from a numbers-only fact sheet, checked by backend/wording.py
    _store.py     the day_recaps cache table
    _build.py     assembly
"""
