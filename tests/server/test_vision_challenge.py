import base64
import unittest
from unittest.mock import patch

from server.chat_images import PNG_SIGNATURE, ChatImage
from server.vision_challenge import (
    VisionChallenge,
    VisionVerificationError,
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
    def challenge(self) -> VisionChallenge:
        return VisionChallenge(
            code="MM-5831",
            image=ChatImage(
                media_type="image/png",
                data=base64.b64encode(PNG_SIGNATURE + b"fixture").decode("ascii"),
            ),
        )

    def test_challenge_is_a_png_with_a_random_mm_code(self):
        with patch("server.vision_challenge.secrets.randbelow", side_effect=[5831, 42]):
            first = create_vision_challenge()
            second = create_vision_challenge()

        self.assertEqual(first.code, "MM-5831")
        self.assertEqual(second.code, "MM-0042")
        self.assertRegex(first.code, r"^MM-\d{4}$")
        self.assertNotEqual(first.code, second.code)
        self.assertTrue(base64.b64decode(first.image.data).startswith(PNG_SIGNATURE))
        self.assertEqual(first.image.media_type, "image/png")

    async def test_verifier_requires_the_code_visible_only_in_the_image(self):
        challenge = self.challenge()
        provider = FakeProvider(["The code is mm 5831."])

        self.assertTrue(await verify_provider_vision(provider, challenge))
        self.assertEqual(len(provider.messages), 1)
        self.assertEqual(provider.messages[0]["image"], challenge.image)
        self.assertNotIn(challenge.code, provider.messages[0]["content"])
        self.assertNotIn("MM5831", provider.messages[0]["content"].upper())

    async def test_verifier_rejects_wrong_empty_and_overlong_answers(self):
        challenge = self.challenge()

        self.assertFalse(await verify_provider_vision(FakeProvider(["MM-0000"]), challenge))
        self.assertFalse(await verify_provider_vision(FakeProvider([]), challenge))
        self.assertFalse(
            await verify_provider_vision(
                FakeProvider(["x" * 200, "MM-5831"]),
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
