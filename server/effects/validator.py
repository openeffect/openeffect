from __future__ import annotations
from typing import Any, Literal
from pydantic import BaseModel, field_validator, model_validator

VALID_ROLES = ("start_frame", "end_frame", "reference", "prompt_input")


class SelectOption(BaseModel):
    value: str
    label: str


class InputFieldSchema(BaseModel):
    type: Literal["image", "text", "select", "slider", "number"]
    required: bool = False
    label: str
    role: str = "prompt_input"
    hint: str | None = None
    placeholder: str | None = None
    max_length: int | None = None
    multiline: bool | None = None
    default: Any = None
    options: list[SelectOption] | None = None
    min: float | None = None
    max: float | None = None
    step: float | None = None
    unit: str | None = None

    @field_validator("role")
    @classmethod
    def validate_role(cls, v: str) -> str:
        if v not in VALID_ROLES:
            raise ValueError(f"Invalid role '{v}'. Must be one of: {', '.join(VALID_ROLES)}")
        return v


class AdvancedParameter(BaseModel):
    key: str
    label: str
    type: Literal["slider", "text", "number"]
    min: float | None = None
    max: float | None = None
    step: float | None = None
    default: Any = None
    hint: str | None = None
    multiline: bool | None = None


class Assets(BaseModel):
    inputs: dict[str, str] = {}       # keyed by input field name → filename in assets/
    output: str | None = None         # result video filename in assets/


class OutputConfig(BaseModel):
    aspect_ratios: list[str] | None = None      # None = use model defaults
    default_aspect_ratio: str | None = None
    durations: list[int] | None = None           # None = use model defaults
    default_duration: int | None = None


class ModelOverride(BaseModel):
    prompt_template: str | None = None
    parameters: dict[str, Any] | None = None


class GenerationConfig(BaseModel):
    prompt_template: str
    negative_prompt: str = ""
    supported_models: list[str]
    default_model: str
    parameters: dict[str, Any] = {}
    model_overrides: dict[str, ModelOverride] = {}
    advanced_parameters: list[AdvancedParameter] = []

    @model_validator(mode="after")
    def validate_default_model(self) -> GenerationConfig:
        if self.default_model not in self.supported_models:
            raise ValueError(f"default_model '{self.default_model}' not in supported_models")
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
    assets: Assets
    inputs: dict[str, InputFieldSchema]
    output: OutputConfig
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
