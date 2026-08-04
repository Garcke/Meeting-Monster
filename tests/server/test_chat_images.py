import base64
import unittest


PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


class ChatImageTests(unittest.TestCase):
    def test_accepts_png_base64_at_the_decoded_size_limit(self):
        from server.chat_images import parse_chat_image

        raw = PNG_SIGNATURE + b"x" * (8 * 1024 * 1024 - len(PNG_SIGNATURE))
        encoded = base64.b64encode(raw).decode("ascii")

        image = parse_chat_image("image/png", encoded)

        self.assertEqual(image.media_type, "image/png")
        self.assertEqual(image.data, encoded)

    def test_rejects_non_png_media_type(self):
        from server.chat_images import parse_chat_image

        encoded = base64.b64encode(PNG_SIGNATURE + b"payload").decode("ascii")

        with self.assertRaises(ValueError):
            parse_chat_image("image/jpeg", encoded)

    def test_rejects_malformed_base64(self):
        from server.chat_images import parse_chat_image

        with self.assertRaises(ValueError):
            parse_chat_image("image/png", "%%not-base64%%")

    def test_rejects_decoded_data_without_png_signature(self):
        from server.chat_images import parse_chat_image

        encoded = base64.b64encode(b"not-png").decode("ascii")

        with self.assertRaises(ValueError):
            parse_chat_image("image/png", encoded)

    def test_rejects_decoded_payload_above_eight_mebibytes(self):
        from server.chat_images import parse_chat_image

        raw = PNG_SIGNATURE + b"x" * (8 * 1024 * 1024 + 1 - len(PNG_SIGNATURE))
        encoded = base64.b64encode(raw).decode("ascii")

        with self.assertRaises(ValueError):
            parse_chat_image("image/png", encoded)


if __name__ == "__main__":
    unittest.main()
