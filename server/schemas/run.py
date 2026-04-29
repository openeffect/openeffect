from pydantic import BaseModel


class RunRequest(BaseModel):
    model_config = {"extra": "forbid"}
    effect_id: str
    model_id: str
    provider_id: str  # "fal" or "local"
    inputs: dict[str, str]
    # All model variant params, flat — main + advanced are a UI-rendering
    # split, not a wire-shape one. `bool` listed first so Pydantic's smart-
    # union picks it for true/false rather than coercing to int.
    params: dict[str, bool | float | int | str] = {}


class PlaygroundRunRequest(BaseModel):
    model_config = {"extra": "forbid"}
    model_id: str
    provider_id: str = "fal"
    prompt: str
    negative_prompt: str = ""
    image_inputs: dict[str, str] = {}  # role -> file id
    params: dict[str, bool | float | int | str] = {}
