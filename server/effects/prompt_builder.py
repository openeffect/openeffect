import re
from typing import Any

from effects.validator import EffectManifest, ModelParam
from services.model_service import canonical_key, get_provider_variant_params


class PromptBuilder:
    @staticmethod
    def build_prompt(
        manifest: EffectManifest,
        model_id: str,
        user_inputs: dict[str, str],
    ) -> str:
        # Select template: model override > manifest default
        template = manifest.generation.prompt
        override = manifest.generation.model_overrides.get(model_id)
        if override and override.prompt:
            template = override.prompt

        # Replace {field_id} for each input
        for field_key, field_schema in manifest.inputs.items():
            placeholder = "{" + field_key + "}"
            if placeholder not in template:
                continue

            value = user_inputs.get(field_key, "")

            # For select fields, use label not value
            if field_schema.type == "select" and field_schema.options and value:
                for opt in field_schema.options:
                    if opt.value == value:
                        value = opt.label
                        break

            template = template.replace(placeholder, value)

        # Replace any remaining unknown placeholders with empty string
        template = re.sub(r"\{[a-zA-Z_][a-zA-Z0-9_]*\}", "", template)

        # Collapse multiple spaces
        template = re.sub(r"  +", " ", template).strip()

        return template

    @staticmethod
    def build_provider_io(
        model_id: str,
        variant_key: str,
        provider_id: str,
        raw_params: dict[str, Any] | None = None,
        manifest: EffectManifest | None = None,
    ) -> dict[str, Any]:
        """Build the canonical-keyed parameters dict for a given (model,
        variant, provider) triple.

        Merges the manifest's model_params with caller-supplied raw_params,
        keyed by the canonical param keys declared by the provider-variant.
        Wire-format munging (value transforms, canonical→wire key renames)
        happens later in the provider layer.

        Precedence (lowest → highest):
          1. Manifest's non-locked model_params (top-level then model_overrides)
          2. Caller-supplied raw_params (user input from the form / API request)
          3. Manifest's locked model_params (always wins)

        Keys not declared by the provider-variant are silently dropped.
        """
        known = {canonical_key(p) for p in get_provider_variant_params(model_id, variant_key, provider_id)}
        result: dict[str, Any] = {}

        # Compute the effective manifest param map (top-level + model_override)
        effective: dict[str, ModelParam] = {}
        if manifest is not None:
            effective = dict(manifest.generation.model_params)
            override = manifest.generation.model_overrides.get(model_id)
            if override and override.model_params:
                effective.update(override.model_params)

        # Pass 1: manifest defaults (non-locked) — low priority
        for key, param in effective.items():
            if key in known and not param.is_locked:
                result[key] = param.effective_value

        # Pass 2: caller-supplied request values — overrides defaults
        for key, value in (raw_params or {}).items():
            if key in known:
                result[key] = value

        # Pass 3: manifest locks — always wins
        for key, param in effective.items():
            if key in known and param.is_locked:
                result[key] = param.effective_value

        return result
