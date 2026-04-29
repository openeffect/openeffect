from abc import ABC, abstractmethod
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any, Literal


@dataclass
class ImageRef:
    """A resolved image input handed to a provider. Carries both the
    on-disk path (for upload) and the file row's sniffed `mime` (set
    server-side from magic bytes at upload time). Providers consult the
    mime against their `accepted_image_mimes` whitelist to decide
    whether to pass-through or transcode via Pillow before sending."""
    path: str
    mime: str


@dataclass
class ProviderInput:
    prompt: str
    negative_prompt: str
    image_inputs: dict[str, ImageRef]
    parameters: dict[str, Any]


@dataclass
class ProviderEvent:
    type: Literal["progress", "completed", "failed", "submitted"]
    progress: int | None = None
    message: str | None = None
    video_url: str | None = None
    error: str | None = None
    request_id: str | None = None
    endpoint: str | None = None


class BaseProvider(ABC):
    @abstractmethod
    def generate(self, input: ProviderInput) -> AsyncIterator[ProviderEvent]:
        """Return an async iterator of provider events.

        Concrete subclasses implement this with `async def` + `yield` - that
        makes the function an async generator, which already returns an
        AsyncIterator directly. Declaring the abstract without `async` keeps
        the override signatures compatible (otherwise the base would be a
        coroutine returning an iterator, not an iterator itself).
        """
        ...
