"""In-memory image challenge used to verify model vision capability."""

from __future__ import annotations

import base64
import io
import json
import re
import secrets
import unicodedata
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from server.chat_images import ChatImage
from server.llm_providers import LLMProvider


_IMAGE_SIZE = (360, 88)
_FONT_PATH = Path(__file__).parent / "assets" / "fonts" / "DejaVuSansMono-Bold.ttf"
_FONT_SIZE = 52
_MAX_ANSWER_CHARS = 128
_ASCII_ALNUM = frozenset("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789")
VISION_CODE_ALPHABET = "0123456789"
_VISION_PROMPT = (
    "Read the four digits in the image. "
    'Return only JSON in this format: {"code":"1234"} '
    "Do not include explanations or other fields."
)


@dataclass(frozen=True)
class VisionChallenge:
    code: str
    image: ChatImage


VisionVerifier = Callable[[LLMProvider], Awaitable[bool]]


class VisionVerificationError(Exception):
    """A provider request failed while checking image input support."""


def _render_code(code: str) -> bytes:
    image = Image.new("RGB", _IMAGE_SIZE, (255, 255, 255))
    draw = ImageDraw.Draw(image)
    font = ImageFont.truetype(str(_FONT_PATH), _FONT_SIZE)
    left, top, right, bottom = draw.textbbox((0, 0), code, font=font)
    text_width = right - left
    text_height = bottom - top
    position = (
        (_IMAGE_SIZE[0] - text_width) // 2 - left,
        (_IMAGE_SIZE[1] - text_height) // 2 - top,
    )
    draw.text(position, code, fill=(24, 28, 36), font=font)

    encoded = io.BytesIO()
    image.save(encoded, format="PNG", optimize=True)
    return encoded.getvalue()


def _extract_code(answer: str) -> str | None:
    """Extract exactly four digits from a model answer without fuzzy matching."""

    normalized = unicodedata.normalize("NFKC", answer).strip()
    if not normalized:
        return None

    json_candidate = re.sub(r"^\s*```(?:json)?\s*|\s*```\s*$", "", normalized, flags=re.IGNORECASE)
    try:
        parsed = json.loads(json_candidate)
    except (TypeError, ValueError, json.JSONDecodeError):
        parsed = None
    if isinstance(parsed, dict):
        value = parsed.get("code")
        if isinstance(value, str) and re.fullmatch(r"[0-9]{4}", value):
            return value

    digits = [character for character in normalized if character in VISION_CODE_ALPHABET]
    if len(digits) != 4:
        return None

    first_digit = normalized.find(digits[0])
    last_digit = normalized.rfind(digits[-1])
    if first_digit > 0 and normalized[first_digit - 1] in _ASCII_ALNUM:
        return None
    if last_digit + 1 < len(normalized) and normalized[last_digit + 1] in _ASCII_ALNUM:
        return None
    return "".join(digits)


def create_vision_challenge() -> VisionChallenge:
    code = "".join(secrets.choice(VISION_CODE_ALPHABET) for _ in range(4))
    encoded = base64.b64encode(_render_code(code)).decode("ascii")
    return VisionChallenge(code=code, image=ChatImage(media_type="image/png", data=encoded))


async def verify_provider_vision(
    provider: LLMProvider,
    challenge: VisionChallenge | None = None,
) -> bool:
    current = challenge or create_vision_challenge()
    answer = ""
    try:
        stream = provider.stream_text(
            [
                {
                    "role": "user",
                    "content": _VISION_PROMPT,
                    "image": current.image,
                }
            ]
        )
        async for chunk in stream:
            if not chunk:
                continue
            remaining = _MAX_ANSWER_CHARS - len(answer)
            if remaining <= 0:
                break
            answer += str(chunk)[:remaining]
            if len(answer) >= _MAX_ANSWER_CHARS:
                break
    except Exception as exc:
        raise VisionVerificationError from exc

    extracted = _extract_code(answer)
    return extracted == current.code
