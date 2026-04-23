import asyncio
from collections.abc import AsyncIterator

from providers.base import BaseProvider, ProviderEvent, ProviderInput


class MockProvider(BaseProvider):
    """Dev/test emulation that streams synthetic progress without calling fal.

    Enabled by setting `OPENEFFECT_MOCK_PROVIDER=1` in the environment.
    Useful for iterating on the SSE + progress UI without burning API
    credits or waiting on real generation. For now it finishes with a
    `failed` event at 100%; when we're ready to return a real clip here,
    swap that for a bundled sample and emit `completed`."""

    # Progress checkpoints (percent). Each step sleeps briefly so the
    # client sees the bar tick, but the whole run finishes in a few
    # seconds — fast enough for rapid iteration.
    _STEPS: tuple[tuple[int, str], ...] = (
        (5,   "Queued..."),
        (20,  "Loading model..."),
        (40,  "Generating..."),
        (65,  "Generating..."),
        (85,  "Finalizing..."),
        (100, "Almost there..."),
    )
    _STEP_DELAY_SEC = 0.8

    async def generate(self, input: ProviderInput) -> AsyncIterator[ProviderEvent]:
        for progress, message in self._STEPS:
            await asyncio.sleep(self._STEP_DELAY_SEC)
            yield ProviderEvent(type="progress", progress=progress, message=message)

        yield ProviderEvent(
            type="failed",
            error="Mock provider: video generation not implemented yet.",
        )
