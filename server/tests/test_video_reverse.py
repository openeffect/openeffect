"""Test video reversal via ffmpeg."""
import asyncio
import subprocess
from pathlib import Path


def _create_test_video(path: Path, duration: float = 1.0) -> None:
    """Create a tiny test mp4 using ffmpeg."""
    subprocess.run(
        [
            "ffmpeg", "-y", "-f", "lavfi", "-i",
            f"color=c=red:size=64x64:duration={duration}:rate=10",
            "-c:v", "libx264", "-pix_fmt", "yuv420p",
            str(path),
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=True,
    )


class TestVideoReverse:
    def test_ffmpeg_reverse_produces_valid_output(self, tmp_path):
        """Reversing a video with ffmpeg should produce a valid mp4."""
        input_path = tmp_path / "input.mp4"
        output_path = tmp_path / "reversed.mp4"

        _create_test_video(input_path)
        assert input_path.exists()
        assert input_path.stat().st_size > 0

        result = subprocess.run(
            ["ffmpeg", "-y", "-i", str(input_path), "-vf", "reverse", "-af", "areverse", str(output_path)],
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
            ["ffmpeg", "-y", "-i", str(input_path), "-vf", "reverse", "-af", "areverse", str(output_path)],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=True,
        )

        # Probe both durations
        def get_duration(path: Path) -> float:
            result = subprocess.run(
                ["ffprobe", "-v", "error", "-show_entries", "format=duration",
                 "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
                capture_output=True, text=True,
            )
            return float(result.stdout.strip())

        orig = get_duration(input_path)
        rev = get_duration(output_path)
        assert abs(orig - rev) < 0.2  # within 200ms tolerance

    async def test_async_ffmpeg_reverse(self, tmp_path):
        """Test the async subprocess pattern used in run_service."""
        input_path = tmp_path / "input.mp4"
        output_path = tmp_path / "reversed.mp4"

        _create_test_video(input_path)

        proc = await asyncio.create_subprocess_exec(
            "ffmpeg", "-y", "-i", str(input_path),
            "-vf", "reverse", "-af", "areverse",
            str(output_path),
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )
        await proc.wait()

        assert proc.returncode == 0
        assert output_path.exists()
        assert output_path.stat().st_size > 0
