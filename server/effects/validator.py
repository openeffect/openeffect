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

    @field_validator("role")
    @classmethod
    def validate_role(cls, v: str) -> str:
        if v not in VALID_ROLES:
            raise ValueError(f"Invalid role '{v}'. Must be one of: {', '.join(VALID_ROLES)}")
        return v



class Assets(BaseModel):
    preview: str | None = None        # result video/gif in assets/
    inputs: dict[str, str] = {}       # keyed by input field name → filename in assets/


class ModelOverride(BaseModel):
    prompt: str | None = None
    defaults: dict[str, Any] | None = None


class GenerationConfig(BaseModel):
    prompt: str
    negative_prompt: str = ""
    models: list[str]
    default_model: str
    defaults: dict[str, Any] = {}
    model_overrides: dict[str, ModelOverride] = {}

    @model_validator(mode="after")
    def validate_default_model(self) -> GenerationConfig:
        if self.default_model not in self.models:
            raise ValueError(f"default_model '{self.default_model}' not in models")
        return self


class EffectManifest(BaseModel):
    id: str
    name: str
    description: str
    version: str = "1.0.0"
    author: str = "openeffect-team"
    type: str
    category: str
    tags: list[str] = []
    assets: Assets = Assets()
    inputs: dict[str, InputFieldSchema]
    generation: GenerationConfig

    @model_validator(mode="after")
    def validate_roles(self) -> EffectManifest:
        role_counts: dict[str, int] = {}
        for field in self.inputs.values():
            role_counts[field.role] = role_counts.get(field.role, 0) + 1
        if role_counts.get("start_frame", 0) > 1:
            raise ValueError("At most 1 input may have role 'start_frame'")
        if role_counts.get("end_frame", 0) > 1:
            raise ValueError("At most 1 input may have role 'end_frame'")
        return self
