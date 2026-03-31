import re
from typing import Any
from effects.validator import EffectManifest
from providers.model_params import KNOWN_MODEL_PARAMS


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
    def build_params(
        manifest: EffectManifest,
        model_id: str,
        user_params: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        known = KNOWN_MODEL_PARAMS.get(model_id, set())

        # Layer 1: manifest defaults
        result = {k: v for k, v in manifest.generation.defaults.items() if k in known}

        # Layer 2: model overrides
        override = manifest.generation.model_overrides.get(model_id)
        if override and override.defaults:
            result.update({k: v for k, v in override.defaults.items() if k in known})

        # Layer 3: user params
        if user_params:
            result.update({k: v for k, v in user_params.items() if k in known})

        return result
