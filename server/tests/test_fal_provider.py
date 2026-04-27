"""Unit tests for FalProvider — event stream, error paths, and recover()."""
import os

import fal_client
import pytest

from providers.base import ImageRef, ProviderInput
from providers.fal_provider import FalProvider


@pytest.fixture(autouse=True)
def _isolate_fal_key_env(monkeypatch):
    """Scrub FAL_KEY before each test so we can assert the provider does
    NOT mutate it. monkeypatch restores the shell value at teardown."""
    monkeypatch.delenv("FAL_KEY", raising=False)


def _mk_input(
    model_id: str = "wan-2.7",
    image_inputs: dict[str, str] | None = None,
    **params,
) -> ProviderInput:
    """Tests pass `{role: path}` for ergonomics; we wrap each into an
    ImageRef with `image/jpeg` so the upload path treats it as a fal-
    accepted format and skips the conversion branch by default."""
    paths = image_inputs or {"start_frame": "/tmp/fake.jpg"}
    return ProviderInput(
        prompt=params.pop("prompt", "test prompt"),
        negative_prompt=params.pop("negative_prompt", ""),
        image_inputs={
            role: ImageRef(path=path, mime="image/jpeg") for role, path in paths.items()
        },
        parameters={"_model_id": model_id, **params},
    )


# ─── generate() ──────────────────────────────────────────────────────────────


class TestGenerate:
    async def test_unknown_model_yields_failed(self):
        provider = FalProvider(api_key="test-key")
        inp = _mk_input(model_id="does-not-exist")
        events = [e async for e in provider.generate(inp)]
        assert len(events) == 1
        assert events[0].type == "failed"
        assert "No fal provider config" in (events[0].error or "")

    async def test_wan27_happy_path_emits_expected_events(self, monkeypatch):
        """End-to-end wire check: upload → submit → streamed events → completed,
        with the canonical→wire rename applied (`start_frame` → `image_url`).
        wan-2.7 takes duration natively — no transform, the value passes
        straight through."""
        uploaded: list[str] = []

        async def fake_upload(self, path, **_kwargs):
            uploaded.append(path)
            return f"https://fal.cdn/{os.path.basename(path)}"

        submitted: dict = {}

        async def fake_subscribe(
            self, endpoint, *, arguments,
            with_logs=True, on_enqueue=None, on_queue_update=None, **_kwargs,
        ):
            submitted["endpoint"] = endpoint
            submitted["arguments"] = arguments
            if on_enqueue:
                await on_enqueue("req-xyz")
            return {"video": {"url": "https://fal.cdn/result.mp4"}}

        monkeypatch.setattr("fal_client.AsyncClient.upload_file", fake_upload)
        monkeypatch.setattr("fal_client.AsyncClient.subscribe", fake_subscribe)

        provider = FalProvider(api_key="test-key")
        inp = _mk_input(
            model_id="wan-2.7",
            image_inputs={"start_frame": "/tmp/image.jpg"},
            duration=5,
        )
        events = [e async for e in provider.generate(inp)]

        # progress (uploading) → progress (submitting) → submitted → completed
        assert [e.type for e in events] == ["progress", "progress", "submitted", "completed"]
        assert events[2].request_id == "req-xyz"
        assert events[3].video_url == "https://fal.cdn/result.mp4"

        # Endpoint comes from the real registry
        assert submitted["endpoint"] == "fal-ai/wan/v2.7/image-to-video"
        # start_frame → image_url rename happened
        assert submitted["arguments"]["image_url"] == "https://fal.cdn/image.jpg"
        # duration passes through unchanged; no num_frames/fps derivation.
        assert submitted["arguments"]["duration"] == 5
        assert "num_frames" not in submitted["arguments"]
        assert "frames_per_second" not in submitted["arguments"]
        # Only the image that matches a canonical image role in the variant got uploaded
        # (provider wraps the path in Path(...) before handing to fal_client).
        assert [str(p) for p in uploaded] == ["/tmp/image.jpg"]

    async def test_kling_v3_renames_start_frame_to_wire_key(self, monkeypatch):
        """Kling v3's wire key for the start frame is `start_image_url`; the
        canonical `start_frame` role must be renamed before hitting fal.ai."""
        async def fake_upload(self, path, **_kwargs):
            return f"https://fal.cdn/{os.path.basename(path)}"

        submitted: dict = {}

        async def fake_subscribe(
            self, endpoint, *, arguments,
            with_logs=True, on_enqueue=None, on_queue_update=None, **_kwargs,
        ):
            submitted["arguments"] = arguments
            if on_enqueue:
                await on_enqueue("r")
            return {"video": {"url": "u"}}

        monkeypatch.setattr("fal_client.AsyncClient.upload_file", fake_upload)
        monkeypatch.setattr("fal_client.AsyncClient.subscribe", fake_subscribe)

        provider = FalProvider(api_key="k")
        inp = _mk_input(
            model_id="kling-3.0",
            image_inputs={"start_frame": "/tmp/k.jpg"},
        )
        _ = [e async for e in provider.generate(inp)]
        assert submitted["arguments"]["start_image_url"] == "https://fal.cdn/k.jpg"
        assert "start_frame" not in submitted["arguments"]

    async def test_kling_1080p_routes_to_pro_endpoint(self, monkeypatch):
        """Passing `resolution: 1080p` must hit fal's pro endpoint; 720p (or
        unset) falls back to standard. `resolution` itself is consumed by the
        endpoint resolver and must NOT appear in the outgoing payload."""
        async def fake_upload(self, path, **_kwargs):
            return f"https://fal.cdn/{os.path.basename(path)}"

        submitted: dict = {}

        async def fake_subscribe(
            self, endpoint, *, arguments,
            with_logs=True, on_enqueue=None, on_queue_update=None, **_kwargs,
        ):
            submitted["endpoint"] = endpoint
            submitted["arguments"] = arguments
            if on_enqueue:
                await on_enqueue("r")
            return {"video": {"url": "u"}}

        monkeypatch.setattr("fal_client.AsyncClient.upload_file", fake_upload)
        monkeypatch.setattr("fal_client.AsyncClient.subscribe", fake_subscribe)

        provider = FalProvider(api_key="k")
        inp = _mk_input(
            model_id="kling-3.0",
            image_inputs={"start_frame": "/tmp/k.jpg"},
            resolution="1080p",
        )
        _ = [e async for e in provider.generate(inp)]
        assert submitted["endpoint"] == "fal-ai/kling-video/v3/pro/image-to-video"
        assert "resolution" not in submitted["arguments"]

    async def test_kling_720p_routes_to_standard_endpoint(self, monkeypatch):
        async def fake_upload(self, path, **_kwargs):
            return f"https://fal.cdn/{os.path.basename(path)}"

        submitted: dict = {}

        async def fake_subscribe(
            self, endpoint, *, arguments,
            with_logs=True, on_enqueue=None, on_queue_update=None, **_kwargs,
        ):
            submitted["endpoint"] = endpoint
            if on_enqueue:
                await on_enqueue("r")
            return {"video": {"url": "u"}}

        monkeypatch.setattr("fal_client.AsyncClient.upload_file", fake_upload)
        monkeypatch.setattr("fal_client.AsyncClient.subscribe", fake_subscribe)

        provider = FalProvider(api_key="k")
        inp = _mk_input(
            model_id="kling-3.0",
            image_inputs={"start_frame": "/tmp/k.jpg"},
            resolution="720p",
        )
        _ = [e async for e in provider.generate(inp)]
        assert submitted["endpoint"] == "fal-ai/kling-video/v3/standard/image-to-video"

    async def test_subscribe_exception_yields_failed(self, monkeypatch):
        async def fake_upload(self, path, **_kwargs):
            return "https://fal.cdn/x"

        async def fake_subscribe(self, *args, **kwargs):
            raise RuntimeError("fal.ai unavailable")

        monkeypatch.setattr("fal_client.AsyncClient.upload_file", fake_upload)
        monkeypatch.setattr("fal_client.AsyncClient.subscribe", fake_subscribe)

        provider = FalProvider(api_key="k")
        inp = _mk_input(image_inputs={"start_frame": "/tmp/x.jpg"})
        events = [e async for e in provider.generate(inp)]

        failed = [e for e in events if e.type == "failed"]
        assert len(failed) == 1
        assert "fal.ai unavailable" in (failed[0].error or "")

    async def test_unexpected_result_shape_yields_failed(self, monkeypatch):
        async def fake_upload(self, path, **_kwargs):
            return "https://fal.cdn/x"

        async def fake_subscribe(
            self, endpoint, *, arguments,
            with_logs=True, on_enqueue=None, on_queue_update=None, **_kwargs,
        ):
            if on_enqueue:
                await on_enqueue("r")
            return {"unexpected": "shape"}

        monkeypatch.setattr("fal_client.AsyncClient.upload_file", fake_upload)
        monkeypatch.setattr("fal_client.AsyncClient.subscribe", fake_subscribe)

        provider = FalProvider(api_key="k")
        inp = _mk_input(image_inputs={"start_frame": "/tmp/x.jpg"})
        events = [e async for e in provider.generate(inp)]

        failed = [e for e in events if e.type == "failed"]
        assert len(failed) == 1
        assert "Unexpected response" in (failed[0].error or "")

    async def test_unsupported_mime_is_transcoded_before_upload(self, monkeypatch, tmp_path):
        """A BMP input (image/bmp not in fal's whitelist) should be
        decoded and re-encoded to PNG before fal_client sees it. The
        provider hands `upload_file` a temp file path, not the original
        BMP."""
        from PIL import Image

        bmp_path = tmp_path / "in.bmp"
        Image.new("RGB", (16, 16), color=(255, 0, 0)).save(bmp_path, format="BMP")

        uploaded: list[str] = []

        async def fake_upload(self, path, **_kwargs):
            uploaded.append(str(path))
            return "https://fal.cdn/converted.png"

        async def fake_subscribe(
            self, endpoint, *, arguments,
            with_logs=True, on_enqueue=None, on_queue_update=None, **_kwargs,
        ):
            if on_enqueue:
                await on_enqueue("r")
            return {"video": {"url": "u"}}

        monkeypatch.setattr("fal_client.AsyncClient.upload_file", fake_upload)
        monkeypatch.setattr("fal_client.AsyncClient.subscribe", fake_subscribe)

        provider = FalProvider(api_key="k")
        # ImageRef declares the source mime as image/bmp — outside fal's
        # accept list, so the provider must transcode before upload.
        inp = ProviderInput(
            prompt="x",
            negative_prompt="",
            image_inputs={"start_frame": ImageRef(path=str(bmp_path), mime="image/bmp")},
            parameters={"_model_id": "wan-2.7"},
        )
        async for _ in provider.generate(inp):
            pass

        assert len(uploaded) == 1
        uploaded_path = uploaded[0]
        # Provider must NOT have handed fal the BMP path verbatim.
        assert uploaded_path != str(bmp_path)
        # The converted file is a PNG sitting in a temp dir.
        assert uploaded_path.endswith(".png")
        # And it's been cleaned up after upload.
        from pathlib import Path as _Path
        assert not _Path(uploaded_path).exists()

    async def test_supported_mime_passes_through_without_transcode(self, monkeypatch, tmp_path):
        """An image/jpeg input (in fal's whitelist) should reach
        fal_client at the original path — no Pillow re-encode."""
        from PIL import Image

        jpg_path = tmp_path / "in.jpg"
        Image.new("RGB", (8, 8), color=(0, 255, 0)).save(jpg_path, format="JPEG")

        uploaded: list[str] = []

        async def fake_upload(self, path, **_kwargs):
            uploaded.append(str(path))
            return "https://fal.cdn/x"

        async def fake_subscribe(
            self, endpoint, *, arguments,
            with_logs=True, on_enqueue=None, on_queue_update=None, **_kwargs,
        ):
            if on_enqueue:
                await on_enqueue("r")
            return {"video": {"url": "u"}}

        monkeypatch.setattr("fal_client.AsyncClient.upload_file", fake_upload)
        monkeypatch.setattr("fal_client.AsyncClient.subscribe", fake_subscribe)

        provider = FalProvider(api_key="k")
        inp = ProviderInput(
            prompt="x",
            negative_prompt="",
            image_inputs={"start_frame": ImageRef(path=str(jpg_path), mime="image/jpeg")},
            parameters={"_model_id": "wan-2.7"},
        )
        async for _ in provider.generate(inp):
            pass

        assert uploaded == [str(jpg_path)]
        # Source still on disk — no transcode happened.
        assert jpg_path.exists()

    async def test_generate_does_not_leak_key_into_env(self, monkeypatch):
        """The provider must keep the key bound to its AsyncClient and
        never write it into `os.environ`, where it would leak into every
        subprocess we spawn (ffmpeg, etc.)."""
        async def fake_upload(self, path, **_kwargs):
            return "u"

        async def fake_subscribe(
            self, endpoint, *, arguments,
            with_logs=True, on_enqueue=None, on_queue_update=None, **_kwargs,
        ):
            if on_enqueue:
                await on_enqueue("r")
            return {"video": {"url": "u"}}

        monkeypatch.setattr("fal_client.AsyncClient.upload_file", fake_upload)
        monkeypatch.setattr("fal_client.AsyncClient.subscribe", fake_subscribe)

        provider = FalProvider(api_key="secret-key-42")
        inp = _mk_input(image_inputs={"start_frame": "/tmp/x.jpg"})
        async for _ in provider.generate(inp):
            pass
        assert "FAL_KEY" not in os.environ


# ─── recover() ───────────────────────────────────────────────────────────────


class TestRecover:
    async def test_completed_returns_completed_event(self, monkeypatch):
        async def fake_status(self, app, request_id, *, with_logs=False):
            return fal_client.Completed(logs=None, metrics={})

        async def fake_result(self, app, request_id):
            return {"video": {"url": "https://fal.cdn/done.mp4"}}

        monkeypatch.setattr("fal_client.AsyncClient.status", fake_status)
        monkeypatch.setattr("fal_client.AsyncClient.result", fake_result)

        event = await FalProvider.recover("key", "req-1", "fal-ai/x")
        assert event.type == "completed"
        assert event.video_url == "https://fal.cdn/done.mp4"

    async def test_queued_fetches_result_and_completes(self, monkeypatch):
        """If the job is still Queued when we check, result() blocks until
        it finishes — recover returns that completion rather than bailing."""
        async def fake_status(self, app, request_id, *, with_logs=False):
            return fal_client.Queued(position=3)

        async def fake_result(self, app, request_id):
            return {"video": {"url": "https://fal.cdn/late.mp4"}}

        monkeypatch.setattr("fal_client.AsyncClient.status", fake_status)
        monkeypatch.setattr("fal_client.AsyncClient.result", fake_result)

        event = await FalProvider.recover("key", "req-2", "fal-ai/y")
        assert event.type == "completed"
        assert event.video_url == "https://fal.cdn/late.mp4"

    async def test_in_progress_fetches_result_and_completes(self, monkeypatch):
        async def fake_status(self, app, request_id, *, with_logs=False):
            return fal_client.InProgress(logs=[])

        async def fake_result(self, app, request_id):
            return {"video": {"url": "https://fal.cdn/finished.mp4"}}

        monkeypatch.setattr("fal_client.AsyncClient.status", fake_status)
        monkeypatch.setattr("fal_client.AsyncClient.result", fake_result)

        event = await FalProvider.recover("key", "req-3", "fal-ai/z")
        assert event.type == "completed"
        assert event.video_url == "https://fal.cdn/finished.mp4"

    async def test_unexpected_result_returns_failed(self, monkeypatch):
        async def fake_status(self, app, request_id, *, with_logs=False):
            return fal_client.Completed(logs=None, metrics={})

        async def fake_result(self, app, request_id):
            return {"no_video": True}

        monkeypatch.setattr("fal_client.AsyncClient.status", fake_status)
        monkeypatch.setattr("fal_client.AsyncClient.result", fake_result)

        event = await FalProvider.recover("key", "req-4", "fal-ai/w")
        assert event.type == "failed"
        assert "Unexpected response" in (event.error or "")

    async def test_status_exception_returns_failed(self, monkeypatch):
        async def fake_status(self, app, request_id, *, with_logs=False):
            raise RuntimeError("network error")

        monkeypatch.setattr("fal_client.AsyncClient.status", fake_status)

        event = await FalProvider.recover("key", "req-5", "fal-ai/v")
        assert event.type == "failed"
        assert "network error" in (event.error or "")

    async def test_recover_does_not_leak_key_into_env(self, monkeypatch):
        """recover() must also keep the key scoped to its AsyncClient
        instance, not write into os.environ."""
        async def fake_status(self, app, request_id, *, with_logs=False):
            return fal_client.Completed(logs=None, metrics={})

        async def fake_result(self, app, request_id):
            return {"video": {"url": "u"}}

        monkeypatch.setattr("fal_client.AsyncClient.status", fake_status)
        monkeypatch.setattr("fal_client.AsyncClient.result", fake_result)

        await FalProvider.recover("recover-secret", "req-6", "fal-ai/q")
        assert "FAL_KEY" not in os.environ
