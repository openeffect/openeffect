KNOWN_MODEL_PARAMS: dict[str, set[str]] = {
    "wan-2.2": {
        "cfg_scale", "num_inference_steps", "num_frames", "frames_per_second",
        "seed", "negative_prompt", "resolution",
    },
    "wan-2.6": {
        "seed", "negative_prompt", "resolution",
    },
    "kling-2.5": {
        "cfg_scale", "negative_prompt",
    },
    "kling-v3": {
        "cfg_scale", "negative_prompt", "generate_audio",
    },
    "kling-o3": {
        "cfg_scale", "generate_audio",
    },
    "pixverse-v6": {
        "seed", "negative_prompt", "style", "generate_audio_switch",
        "generate_multi_clip_switch", "thinking_type",
    },
}
