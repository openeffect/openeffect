from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, field_validator, model_serializer, model_validator

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

    `default` is a visible seeded value — the field renders in the UI with
    this as the starting value; the user can still change it.
    `value` is a locked value — the UI hides the field entirely and user
    input (if any) is ignored.

    In YAML, the scalar shorthand `key: 4` is treated as the lock form
    (`value: 4`). To publish an overridable seed, use the explicit long
    form `key: {default: 4}`. See `_coerce_params` below.
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

    @model_serializer(mode="plain")
    def _serialize(self) -> dict[str, Any]:
        """Emit only the field that's set. The default `model_dump()` would
        include both fields with one as `null`, which on the client breaks
        discriminated-union checks like `'value' in entry` (the key exists
        even when null, so the entry gets mis-classified as locked)."""
        if self.value is not None:
            return {"value": self.value}
        return {"default": self.default}

    @property
    def is_locked(self) -> bool:
        return self.value is not None

    @property
    def effective_value(self) -> Any:
        return self.value if self.is_locked else self.default


def _coerce_params(v: Any) -> Any:
    """Scalar shorthand: `key: 5` coerces to `key: {value: 5}` — i.e. locked.
    The short form is what authors reach for to nail a canonical to a
    specific value (UI hides the field). For a *visible, seeded default*
    the author writes the explicit long form: `key: {default: 5}`.
    Pre-built ModelParam / dict entries are passed through unchanged.
    """
    if not isinstance(v, dict):
        return v
    return {
        k: (entry if isinstance(entry, (dict, ModelParam)) else {"value": entry})
        for k, entry in v.items()
    }


class ModelOverride(BaseModel):
    prompt: str | None = None
    params: dict[str, ModelParam] = {}

    @field_validator("params", mode="before")
    @classmethod
    def _coerce_scalars(cls, v: Any) -> Any:
        return _coerce_params(v)


class GenerationConfig(BaseModel):
    prompt: str
    negative_prompt: str = ""
    models: list[str] = []
    default_model: str = ""
    params: dict[str, ModelParam] = {}
    model_overrides: dict[str, ModelOverride] = {}
    reverse: bool = False

    @field_validator("params", mode="before")
    @classmethod
    def _coerce_scalars(cls, v: Any) -> Any:
        return _coerce_params(v)

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
        # Every effect must have a start_frame — the app is image-to-video
        # only for now, so there's no usable model without one.
        if role_counts.get("start_frame", 0) == 0:
            raise ValueError("Every effect must declare an input with role 'start_frame'")
        if role_counts.get("start_frame", 0) > 1:
            raise ValueError("At most 1 input may have role 'start_frame'")
        if role_counts.get("end_frame", 0) > 1:
            raise ValueError("At most 1 input may have role 'end_frame'")
        # start_frame must be required
        for field in self.inputs.values():
            if field.role == "start_frame" and not field.required:
                raise ValueError("Input with role 'start_frame' must have required: true")
        return self

    @model_validator(mode="after")
    def validate_override_params(self) -> EffectManifest:
        """Each per-model override's `params` must reference canonicals
        declared on the target model and must not touch `user_only` knobs."""
        # Local import: model_service loads its own modules at module-level
        # but never imports back from this file, so the cycle is fine.
        from services.model_service import MODELS_BY_ID

        for model_id, override in self.generation.model_overrides.items():
            model = MODELS_BY_ID.get(model_id)
            if not model:
                # Manifests may declare models not currently installed — leave
                # that to a separate check (or tolerate it as forward-compat).
                continue
            canonicals = {p["name"]: p for p in model.get("params", [])}
            for key in override.params:
                entry = canonicals.get(key)
                if entry is None:
                    raise ValueError(
                        f"Unknown canonical param '{key}' for model '{model_id}'"
                    )
                if entry.get("user_only"):
                    raise ValueError(
                        f"Param '{key}' on model '{model_id}' is a runtime "
                        f"user preference — cannot be set in manifest"
                    )
        return self


def validate_run_inputs(
    manifest: EffectManifest,
    inputs: dict[str, str],
) -> None:
    """Enforce manifest-declared input constraints at run-submission time.

    Raises ValueError with a user-facing message on the first violation.
    Image fields are skipped here: the value we receive is a ref_id
    (validated at /api/upload when the file lands), and start_frame
    required-ness is an author-time invariant enforced by `validate_roles`
    on the manifest itself."""
    for key, field in manifest.inputs.items():
        if field.type == "image":
            continue

        present = key in inputs and str(inputs[key]).strip() != ""
        if field.required and not present:
            raise ValueError(f"Required input '{field.label}' is missing")
        if not present:
            continue

        value = inputs[key]

        if field.type == "text":
            if field.max_length is not None and len(value) > field.max_length:
                raise ValueError(
                    f"'{field.label}' must be at most {field.max_length} characters"
                )

        elif field.type == "select":
            if field.options is not None:
                allowed = {opt.value for opt in field.options}
                if value not in allowed:
                    raise ValueError(
                        f"'{field.label}' must be one of: {', '.join(sorted(allowed))}"
                    )

        elif field.type in ("slider", "number"):
            try:
                num = float(value)
            except ValueError:
                raise ValueError(f"'{field.label}' must be a number") from None
            if field.min is not None and num < field.min:
                raise ValueError(
                    f"'{field.label}' must be at least {field.min:g}"
                )
            if field.max is not None and num > field.max:
                raise ValueError(
                    f"'{field.label}' must be at most {field.max:g}"
                )
