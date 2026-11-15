"""Spoken practice with the coach: the coach (Deepgram Voice Agent) asks questions out loud, the
wearer answers, and the answers are measured, scored and turned into goals for next time.

    browser --WS /ws/practice--> relay.py --wss--> Deepgram Voice Agent (questions, voice, turns)
                                         \\--wss--> Deepgram listen (word timings + fillers, words.py)
    timeline.py  questions and answers on one clock
    measure.py   pace, fillers, hedges, pauses, time to start (per answer and overall)
    score.py     measured sub-scores and the overall score
    judge.py     structure, strengths, summary (Gemini; rules when it is unavailable)
    goals.py     goals with measurable targets; last time's goals checked
    store.py     the practice_results table; GET /practice/* in routes.py
    gate.py      pauses the band's hearing while a practice runs

Wire shapes: contracts/events.ts ("spoken practice with the coach") and backend/contracts.py.
"""

from backend.voice_practice.routes import router

__all__ = ["router"]
