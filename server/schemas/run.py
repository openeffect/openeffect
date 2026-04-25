from pydantic import BaseModel


class RunRequest(BaseModel):
    effect_id: str
    model_id: str
    provider_id: str  # "fal" or "local"
    inputs: dict[str, str]
    output: dict[str, str | int]
    user_params: dict[str, float | int | str] | None = None


class PlaygroundRunRequest(BaseModel):
    model_id: str
    provider_id: str = "fal"
    prompt: str
    negative_prompt: str = ""
    image_inputs: dict[str, str] = {}  # role -> file hash
    output: dict[str, str | int] = {}
    user_params: dict[str, float | int | str | bool] = {}
