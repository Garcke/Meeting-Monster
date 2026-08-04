"""Validation for protocol-neutral in-memory chat screenshots."""

from __future__ import annotations

import base64
import binascii
from dataclasses import dataclass
from typing import Literal


PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
MAX_IMAGE_BYTES = 8 * 1024 * 1024


@dataclass(frozen=True)
class ChatImage:
    media_type: Literal["image/png"]
    data: str


def parse_chat_image(media_type: str, data: str) -> ChatImage:
    """Return a validated PNG attachment without retaining decoded bytes."""

    if media_type != "image/png":
        raise ValueError("Only PNG screenshots are supported")
    try:
        raw = base64.b64decode(data, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ValueError("Invalid PNG screenshot") from exc
    if len(raw) > MAX_IMAGE_BYTES or not raw.startswith(PNG_SIGNATURE):
        raise ValueError("Invalid PNG screenshot")
    return ChatImage(media_type="image/png", data=data)
