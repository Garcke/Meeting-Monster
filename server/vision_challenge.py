"""In-memory image challenge used to verify model vision capability."""

from __future__ import annotations

import base64
import binascii
import secrets
import struct
import zlib
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

from server.chat_images import PNG_SIGNATURE, ChatImage
from server.llm_providers import LLMProvider


_GLYPHS: dict[str, tuple[str, ...]] = {
    "M": (
        "10001",
        "11011",
        "10101",
        "10101",
        "10001",
        "10001",
        "10001",
    ),
    "-": (
        "00000",
        "00000",
        "00000",
        "11111",
        "00000",
        "00000",
        "00000",
    ),
    "0": ("01110", "10001", "10011", "10101", "11001", "10001", "01110"),
    "1": ("00100", "01100", "00100", "00100", "00100", "00100", "01110"),
    "2": ("01110", "10001", "00001", "00010", "00100", "01000", "11111"),
    "3": ("11110", "00001", "00001", "01110", "00001", "00001", "11110"),
    "4": ("00010", "00110", "01010", "10010", "11111", "00010", "00010"),
    "5": ("11111", "10000", "10000", "11110", "00001", "00001", "11110"),
    "6": ("01110", "10000", "10000", "11110", "10001", "10001", "01110"),
    "7": ("11111", "00001", "00010", "00100", "01000", "01000", "01000"),
    "8": ("01110", "10001", "10001", "01110", "10001", "10001", "01110"),
    "9": ("01110", "10001", "10001", "01111", "00001", "00001", "01110"),
}

_GLYPH_WIDTH = 5
_GLYPH_HEIGHT = 7
_GLYPH_SCALE = 8
_GLYPH_GAP = 1
_MARGIN = 2
_MAX_ANSWER_CHARS = 128
_VISION_PROMPT = (
    "Read the verification code shown in the attached image. "
    "Reply with the code only."
)


@dataclass(frozen=True)
class VisionChallenge:
    code: str
    image: ChatImage


VisionVerifier = Callable[[LLMProvider], Awaitable[bool]]


def _png_chunk(kind: bytes, payload: bytes) -> bytes:
    checksum = binascii.crc32(kind + payload) & 0xFFFFFFFF
    return (
        struct.pack(">I", len(payload))
        + kind
        + payload
        + struct.pack(">I", checksum)
    )


def _encode_png(width: int, height: int, rgb: bytes) -> bytes:
    rows = b"".join(
        b"\x00" + rgb[y * width * 3 : (y + 1) * width * 3]
        for y in range(height)
    )
    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return (
        PNG_SIGNATURE
        + _png_chunk(b"IHDR", header)
        + _png_chunk(b"IDAT", zlib.compress(rows))
        + _png_chunk(b"IEND", b"")
    )


def _render_code(code: str) -> tuple[int, int, bytes]:
    width_cells = (
        _MARGIN * 2
        + len(code) * _GLYPH_WIDTH
        + (len(code) - 1) * _GLYPH_GAP
    )
    height_cells = _MARGIN * 2 + _GLYPH_HEIGHT
    width = width_cells * _GLYPH_SCALE
    height = height_cells * _GLYPH_SCALE
    rgb = bytearray(width * height * 3)

    for character_index, character in enumerate(code):
        glyph = _GLYPHS[character]
        left_cell = _MARGIN + character_index * (_GLYPH_WIDTH + _GLYPH_GAP)
        for glyph_y, row in enumerate(glyph):
            for glyph_x, cell in enumerate(row):
                if cell != "1":
                    continue
                left = (left_cell + glyph_x) * _GLYPH_SCALE
                top = (_MARGIN + glyph_y) * _GLYPH_SCALE
                for y in range(top, top + _GLYPH_SCALE):
                    row_start = y * width * 3
                    for x in range(left, left + _GLYPH_SCALE):
                        offset = row_start + x * 3
                        rgb[offset : offset + 3] = b"\xff\xff\xff"

    return width, height, bytes(rgb)


def create_vision_challenge() -> VisionChallenge:
    code = f"MM-{secrets.randbelow(10_000):04d}"
    width, height, rgb = _render_code(code)
    encoded = base64.b64encode(_encode_png(width, height, rgb)).decode("ascii")
    return VisionChallenge(code=code, image=ChatImage(media_type="image/png", data=encoded))


def _normalize_answer(value: str) -> str:
    return "".join(character for character in value.upper() if character.isalnum())


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
    except Exception:
        return False

    if not answer:
        return False
    return _normalize_answer(current.code) in _normalize_answer(answer)
