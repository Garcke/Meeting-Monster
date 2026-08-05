import base64
import struct
import unittest
from pathlib import Path
from unittest.mock import patch

from server.chat_images import PNG_SIGNATURE, ChatImage
import server.vision_challenge as vision_challenge
from server.vision_challenge import (
    VisionChallenge,
    VisionVerificationError,
    VISION_CODE_ALPHABET,
    create_vision_challenge,
    verify_provider_vision,
)


class FakeProvider:
    def __init__(self, chunks=None, error=None):
        self.chunks = [] if chunks is None else chunks
        self.error = error
        self.messages = None

    async def stream_text(self, messages):
        self.messages = list(messages)
        if self.error is not None:
            raise self.error
        for chunk in self.chunks:
            yield chunk


class VisionChallengeTests(unittest.IsolatedAsyncioTestCase):
    def challenge(self, code: str = "0123") -> VisionChallenge:
        return VisionChallenge(
            code=code,
            image=ChatImage(
                media_type="image/png",
                data=base64.b64encode(PNG_SIGNATURE + b"fixture").decode("ascii"),
            ),
        )

    def test_generated_code_is_four_numeric_characters_and_original_canvas(self):
        with patch("server.vision_challenge.secrets.choice", side_effect=list("0123")):
            challenge = create_vision_challenge()

        self.assertEqual(challenge.code, "0123")
        self.assertEqual(VISION_CODE_ALPHABET, "0123456789")
        self.assertRegex(challenge.code, r"^[0-9]{4}$")
        png = base64.b64decode(challenge.image.data)
        self.assertTrue(png.startswith(PNG_SIGNATURE))
        self.assertEqual(challenge.image.media_type, "image/png")
        self.assertEqual(struct.unpack(">II", png[16:24]), (360, 88))

    def test_vision_renderer_uses_a_bundled_font_and_pillow_dependency(self):
        font_path = Path(vision_challenge.__file__).parent / "assets" / "fonts" / "DejaVuSansMono-Bold.ttf"
        requirements_path = Path(vision_challenge.__file__).parent / "requirements.txt"

        self.assertTrue(font_path.is_file())
        self.assertIn("Pillow==11.1.0", requirements_path.read_text(encoding="utf-8"))

    def test_answer_parser_accepts_json_separators_and_full_width_digits(self):
        parser = getattr(vision_challenge, "_extract_code", None)
        self.assertTrue(callable(parser))
        self.assertEqual(parser('{"code":"0123"}'), "0123")
        self.assertEqual(parser("```json\n{\"code\":\"0123\"}\n```"), "0123")
        self.assertEqual(parser("The code is ０ １-２,３."), "0123")
        self.assertEqual(parser("验证码是0123"), "0123")

    def test_answer_parser_rejects_incomplete_and_overlong_codes(self):
        parser = getattr(vision_challenge, "_extract_code", None)
        self.assertTrue(callable(parser))
        self.assertIsNone(parser("012"))
        self.assertIsNone(parser("01234"))

    def test_generated_png_has_white_background_and_centered_dark_text(self):
        try:
            from PIL import Image
        except ImportError as exc:  # pragma: no cover - red phase before dependency install
            self.fail(f"Pillow is required for the renderer: {exc}")

        with patch("server.vision_challenge.secrets.choice", side_effect=list("0123")):
            challenge = create_vision_challenge()

        from io import BytesIO

        image = Image.open(BytesIO(base64.b64decode(challenge.image.data))).convert("RGB")
        self.assertEqual(image.size, (360, 88))
        self.assertEqual(image.getpixel((0, 0)), (255, 255, 255))
        dark_pixels = [
            (x, y)
            for y in range(image.height)
            for x in range(image.width)
            if max(image.getpixel((x, y))) < 80
        ]
        self.assertTrue(dark_pixels)
        min_x = min(x for x, _ in dark_pixels)
        max_x = max(x for x, _ in dark_pixels)
        min_y = min(y for _, y in dark_pixels)
        max_y = max(y for _, y in dark_pixels)
        self.assertGreater(min_x, 40)
        self.assertLess(max_x, 320)
        self.assertGreater(min_y, 8)
        self.assertLess(max_y, 80)

    async def test_prompt_requests_json_without_embedding_the_code(self):
        challenge = self.challenge()
        provider = FakeProvider(["{\"code\":\"0123\"}"])

        self.assertTrue(await verify_provider_vision(provider, challenge))
        prompt = provider.messages[0]["content"]
        self.assertIn('{"code":"1234"}', prompt)
        self.assertNotIn(challenge.code, prompt)

    async def test_verifier_matches_a_standalone_numeric_token(self):
        challenge = self.challenge()
        provider = FakeProvider(["**0123**"])

        self.assertTrue(await verify_provider_vision(provider, challenge))
        self.assertEqual(len(provider.messages), 1)
        self.assertEqual(provider.messages[0]["image"], challenge.image)
        self.assertNotIn(challenge.code, provider.messages[0]["content"])
        self.assertNotIn("0123", provider.messages[0]["content"])
        self.assertFalse(await verify_provider_vision(FakeProvider(["012"]), challenge))
        self.assertFalse(
            await verify_provider_vision(FakeProvider(["before0123after"]), challenge)
        )

    async def test_verifier_rejects_wrong_empty_and_overlong_answers(self):
        challenge = self.challenge()

        self.assertFalse(await verify_provider_vision(FakeProvider(["9876"]), challenge))
        self.assertFalse(await verify_provider_vision(FakeProvider([]), challenge))
        self.assertFalse(
            await verify_provider_vision(
                FakeProvider(["x" * 200, "0123"]),
                challenge,
            )
        )

    async def test_verifier_wraps_provider_exceptions_without_exposing_their_text(self):
        challenge = self.challenge()
        provider = FakeProvider(error=RuntimeError("private-provider-secret"))

        with self.assertRaises(VisionVerificationError) as raised:
            await verify_provider_vision(provider, challenge)

        self.assertNotIn("private-provider-secret", str(raised.exception))
        self.assertIsInstance(raised.exception.__cause__, RuntimeError)


if __name__ == "__main__":
    unittest.main()
