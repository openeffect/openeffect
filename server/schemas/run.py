from pydantic import BaseModel


class RunRequest(BaseModel):
    effect_id: str
    model_id: str
    provider_id: str  # "fal" or "local"
    inputs: dict[str, str]
    # `bool` listed first so Pydantic's smart-union picks it for true/false
    # rather than coercing to int (bool is an int subclass in Python).
    output: dict[str, bool | str | int]
    user_params: dict[str, bool | float | int | str] | None = None


class PlaygroundRunRequest(BaseModel):
    model_id: str
    provider_id: str = "fal"
    prompt: str
    negative_prompt: str = ""
    image_inputs: dict[str, str] = {}  # role -> file hash
    output: dict[str, bool | str | int] = {}
    user_params: dict[str, bool | float | int | str] = {}
