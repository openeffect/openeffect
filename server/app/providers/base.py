from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import AsyncIterator, Any, Literal


@dataclass
class ProviderInput:
    prompt: str
    negative_prompt: str
    images: list[str]
    aspect_ratio: str
    duration: int
    parameters: dict[str, Any]
    effect_type: str


@dataclass
class ProviderEvent:
    type: Literal["progress", "completed", "failed"]
    progress: int | None = None
    message: str | None = None
    video_url: str | None = None
    error: str | None = None


class BaseProvider(ABC):
    @abstractmethod
    async def generate(self, input: ProviderInput) -> AsyncIterator[ProviderEvent]:
        ...
