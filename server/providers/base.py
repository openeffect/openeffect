from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import AsyncIterator, Any, Literal


@dataclass
class ProviderInput:
    prompt: str
    negative_prompt: str
    image_inputs: dict[str, str]
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
    async def generate(self, input: ProviderInput) -> AsyncIterator[ProviderEvent]:
        ...
