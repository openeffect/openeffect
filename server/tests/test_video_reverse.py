"""Test video reversal via ffmpeg."""
import asyncio
import re
import subprocess
from pathlib import Path

import imageio_ffmpeg

FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()


def _create_test_video(path: Path, duration: float = 1.0) -> None:
    """Create a tiny test mp4 using ffmpeg."""
    subprocess.run(
        [
            FFMPEG, "-y", "-f", "lavfi", "-i",
            f"color=c=red:size=64x64:duration={duration}:rate=10",
            "-c:v", "libx264", "-pix_fmt", "yuv420p",
            str(path),
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=True,
    )


def _probe_duration(path: Path) -> float:
    """Read duration from ffmpeg's stderr banner - avoids needing a separate
    ffprobe binary (imageio-ffmpeg bundles only ffmpeg)."""
    result = subprocess.run(
        [FFMPEG, "-i", str(path), "-f", "null", "-"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        text=True,
    )
    match = re.search(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)", result.stderr)
    if not match:
        raise RuntimeError(f"No Duration line in ffmpeg output for {path}")
    hours, minutes, seconds = match.groups()
    return int(hours) * 3600 + int(minutes) * 60 + float(seconds)


class TestVideoReverse:
    def test_ffmpeg_reverse_produces_valid_output(self, tmp_path):
        """Reversing a video with ffmpeg should produce a valid mp4."""
        input_path = tmp_path / "input.mp4"
        output_path = tmp_path / "reversed.mp4"

        _create_test_video(input_path)
        assert input_path.exists()
        assert input_path.stat().st_size > 0

        result = subprocess.run(
            [FFMPEG, "-y", "-i", str(input_path), "-vf", "reverse", "-af", "areverse", str(output_path)],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        assert result.returncode == 0
        assert output_path.exists()
        assert output_path.stat().st_size > 0

    def test_reversed_video_same_duration(self, tmp_path):
        """Reversed video should have the same duration as the original."""
        input_path = tmp_path / "input.mp4"
        output_path = tmp_path / "reversed.mp4"

        _create_test_video(input_path, duration=0.5)

        subprocess.run(
            [FFMPEG, "-y", "-i", str(input_path), "-vf", "reverse", "-af", "areverse", str(output_path)],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=True,
        )

        orig = _probe_duration(input_path)
        rev = _probe_duration(output_path)
        assert abs(orig - rev) < 0.2  # within 200ms tolerance

    async def test_async_ffmpeg_reverse(self, tmp_path):
        """Test the async subprocess pattern used in run_service."""
        input_path = tmp_path / "input.mp4"
        output_path = tmp_path / "reversed.mp4"

        _create_test_video(input_path)

        proc = await asyncio.create_subprocess_exec(
            FFMPEG, "-y", "-i", str(input_path),
            "-vf", "reverse", "-af", "areverse",
            str(output_path),
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )
        await proc.wait()

        assert proc.returncode == 0
        assert output_path.exists()
        assert output_path.stat().st_size > 0
