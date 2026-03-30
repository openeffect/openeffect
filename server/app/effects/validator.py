from __future__ import annotations
from typing import Any, Literal
from pydantic import BaseModel, field_validator, model_validator

EffectType = Literal["single_image", "image_transition", "image_loop", "text_to_video"]


class SelectOption(BaseModel):
    value: str
    label: str


class InputFieldSchema(BaseModel):
    type: Literal["image", "text", "select", "slider", "number"]
    required: bool = False
    label: str
    hint: str | None = None
    placeholder: str | None = None
    accept: list[str] | None = None
    max_size_mb: int | None = None
    max_length: int | None = None
    multiline: bool | None = None
    default: Any = None
    options: list[SelectOption] | None = None
    min: float | None = None
    max: float | None = None
    step: float | None = None
    unit: str | None = None


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


class AssetExample(BaseModel):
    input_1: str | None = None
    input_2: str | None = None
    output: str | None = None


class Assets(BaseModel):
    thumbnail: str
    preview: str | None = None
    example: AssetExample | None = None


class OutputConfig(BaseModel):
    aspect_ratios: list[str]
    default_aspect_ratio: str
    durations: list[int]
    default_duration: int

    @model_validator(mode="after")
    def validate_defaults(self) -> OutputConfig:
        if self.default_aspect_ratio not in self.aspect_ratios:
            raise ValueError(f"default_aspect_ratio '{self.default_aspect_ratio}' not in aspect_ratios")
        if self.default_duration not in self.durations:
            raise ValueError(f"default_duration {self.default_duration} not in durations")
        return self


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
    effect_type: EffectType
    category: str
    tags: list[str] = []
    assets: Assets
    inputs: dict[str, InputFieldSchema]
    output: OutputConfig
    generation: GenerationConfig

    @model_validator(mode="after")
    def validate_type_specific(self) -> EffectManifest:
        if self.effect_type == "image_transition":
            input_keys = set(self.inputs.keys())
            if "image_start" not in input_keys or "image_end" not in input_keys:
                raise ValueError("image_transition effects must have 'image_start' and 'image_end' input fields")
        if self.effect_type == "text_to_video":
            if "prompt" not in self.inputs:
                raise ValueError("text_to_video effects must have a 'prompt' input field")
            if not self.inputs["prompt"].required:
                raise ValueError("text_to_video effects must have 'prompt' with required=true")
        return self
