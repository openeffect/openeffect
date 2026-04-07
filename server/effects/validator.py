from __future__ import annotations
from typing import Any, Literal
from pydantic import BaseModel, field_validator, model_validator

VALID_ROLES = ("start_frame", "end_frame", "reference", "prompt_input")


class SelectOption(BaseModel):
    value: str
    label: str


class InputFieldSchema(BaseModel):
    type: Literal["image", "text", "select", "slider", "number"]
    role: str = "prompt_input"
    required: bool = False
    label: str
    # text fields
    placeholder: str | None = None
    max_length: int | None = None
    multiline: bool | None = None
    # select fields
    options: list[SelectOption] | None = None
    display: str | None = None        # "pills" | "dropdown" | None (auto)
    # slider / number fields
    min: float | None = None
    max: float | None = None
    step: float | None = None
    # common
    default: Any = None
    unit: str | None = None
    hint: str | None = None
    advanced: bool = False

    @field_validator("role")
    @classmethod
    def validate_role(cls, v: str) -> str:
        if v not in VALID_ROLES:
            raise ValueError(f"Invalid role '{v}'. Must be one of: {', '.join(VALID_ROLES)}")
        return v



class Assets(BaseModel):
    preview: str | None = None        # result video/gif in assets/
    inputs: dict[str, str] = {}       # keyed by input field name → filename in assets/


class ModelParam(BaseModel):
    """A single model parameter entry. Exactly one of `default` or `value` must be set.

    `default` is an overridable starting value (user can change it in the UI).
    `value` is a locked value — the UI hides the field and user input is ignored.
    """
    default: Any = None
    value: Any = None

    @model_validator(mode="after")
    def _exactly_one(self) -> ModelParam:
        has_default = self.default is not None
        has_value = self.value is not None
        if has_default and has_value:
            raise ValueError("model param entry cannot set both 'default' and 'value'")
        if not has_default and not has_value:
            raise ValueError("model param entry must set either 'default' or 'value'")
        return self

    @property
    def is_locked(self) -> bool:
        return self.value is not None

    @property
    def effective_value(self) -> Any:
        return self.value if self.is_locked else self.default


def _coerce_model_params(v: Any) -> Any:
    """Allow scalar shorthand: `key: 5` becomes `key: {default: 5}`.
    Pre-built ModelParam / dict entries are passed through unchanged.
    """
    if not isinstance(v, dict):
        return v
    return {
        k: (entry if isinstance(entry, (dict, ModelParam)) else {"default": entry})
        for k, entry in v.items()
    }


class ModelOverride(BaseModel):
    prompt: str | None = None
    model_params: dict[str, ModelParam] = {}

    @field_validator("model_params", mode="before")
    @classmethod
    def _coerce_scalars(cls, v: Any) -> Any:
        return _coerce_model_params(v)


class GenerationConfig(BaseModel):
    prompt: str
    negative_prompt: str = ""
    models: list[str] = []
    default_model: str = ""
    model_params: dict[str, ModelParam] = {}
    model_overrides: dict[str, ModelOverride] = {}
    reverse: bool = False

    @field_validator("model_params", mode="before")
    @classmethod
    def _coerce_scalars(cls, v: Any) -> Any:
        return _coerce_model_params(v)

    @model_validator(mode="after")
    def validate_default_model(self) -> GenerationConfig:
        if self.models and self.default_model and self.default_model not in self.models:
            raise ValueError(f"default_model '{self.default_model}' not in models")
        return self


class EffectManifest(BaseModel):
    id: str
    namespace: str = "openeffect"
    name: str
    description: str
    version: str = "1.0.0"
    author: str = "openeffect-team"
    url: str | None = None              # self-referencing URL for update checking
    type: str
    tags: list[str] = []
    assets: Assets = Assets()
    inputs: dict[str, InputFieldSchema]
    generation: GenerationConfig

    @property
    def full_id(self) -> str:
        return f"{self.namespace}/{self.id}"

    @model_validator(mode="after")
    def validate_roles(self) -> EffectManifest:
        role_counts: dict[str, int] = {}
        for field in self.inputs.values():
            role_counts[field.role] = role_counts.get(field.role, 0) + 1
        if role_counts.get("start_frame", 0) > 1:
            raise ValueError("At most 1 input may have role 'start_frame'")
        if role_counts.get("end_frame", 0) > 1:
            raise ValueError("At most 1 input may have role 'end_frame'")
        # end_frame requires start_frame to also exist
        if role_counts.get("end_frame", 0) > 0 and role_counts.get("start_frame", 0) == 0:
            raise ValueError("Effects with 'end_frame' must also have a 'start_frame' input")
        # start_frame must be required
        for field in self.inputs.values():
            if field.role == "start_frame" and not field.required:
                raise ValueError("Input with role 'start_frame' must have required: true")
        return self
