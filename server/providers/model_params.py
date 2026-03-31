KNOWN_MODEL_PARAMS: dict[str, set[str]] = {
    "wan-2.2": {
        "guidance_scale",
        "num_inference_steps",
        "num_frames",
        "fps",
        "seed",
        "negative_prompt",
    },
    "kling-v3": {
        "guidance_scale",
        "num_inference_steps",
        "seed",
        "negative_prompt",
        "motion_bucket_id",
    },
}
