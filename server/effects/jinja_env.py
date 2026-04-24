"""Shared Jinja2 environment used for prompt/negative_prompt templating.

Lives in its own module so both `prompt_builder` (render-time) and
`validator` (parse-time) can import it without creating a cycle —
prompt_builder already imports EffectManifest from validator, so the
reverse direction has to come via something neutral."""
from jinja2 import StrictUndefined
from jinja2.sandbox import SandboxedEnvironment

# Sandboxed so author-supplied templates can't reach the Python object graph
# (`{{ ''.__class__.__mro__[1].__subclasses__() }}` style escapes).
# autoescape off — prompts are plain text, not HTML.
# trim_blocks / lstrip_blocks make `{% if %}` tags disappear cleanly (no stray
# newlines from the tag line itself).
# StrictUndefined turns author typos (`{{ sceene }}`) into explicit errors;
# callers seed the context with empty strings for every declared input so
# legitimate absent-value references stay silent.
env = SandboxedEnvironment(
    autoescape=False,
    trim_blocks=True,
    lstrip_blocks=True,
    undefined=StrictUndefined,
)
