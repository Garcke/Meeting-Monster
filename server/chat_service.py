"""Async chat orchestration and single-user conversation history."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator

from server.chat_images import ChatImage
from server.llm_providers import LLMProvider, ProviderCache
from server.settings.model_profiles import ResolvedModelProfile


HistoryMessage = dict[str, str]
ChatEvent = tuple[str, str | None]


def sanitize_provider_error(error: Exception, profile: ResolvedModelProfile) -> str:
    message = str(error).strip() or "Model request failed"
    for secret in (profile.api_key, profile.base_url, profile.model):
        if secret and secret != "not-needed":
            message = message.replace(secret, "[redacted]")
    return message


class ChatService:
    """Serialize one local conversation and stream provider output directly."""

    def __init__(
        self,
        provider_cache: ProviderCache,
        history: list[HistoryMessage] | None = None,
    ) -> None:
        self.provider_cache = provider_cache
        self._history = history if history is not None else []
        self._conversation_lock = asyncio.Lock()

    async def get_provider(self, profile: ResolvedModelProfile) -> LLMProvider:
        return await self.provider_cache.get(profile)

    def set_prompt(self, prompt: str) -> None:
        non_system_messages = [
            item for item in self._history if item.get("role") != "system"
        ]
        self._history[:] = [
            {"role": "system", "content": prompt},
            *non_system_messages,
        ]

    def get_history(self) -> list[HistoryMessage]:
        return [dict(item) for item in self._history]

    def reset_history(self) -> None:
        self._history.clear()

    async def stream_response(
        self,
        content: str,
        profile: ResolvedModelProfile,
        provider: LLMProvider,
        image: ChatImage | None = None,
    ) -> AsyncIterator[ChatEvent]:
        async with self._conversation_lock:
            self._history.append({"role": "user", "content": content.strip()})
            request_messages = [dict(item) for item in self._history]
            if image is not None:
                request_messages[-1]["image"] = image
            assistant_message = ""

            try:
                async for text in provider.stream_text(request_messages):
                    if text:
                        assistant_message += text
                        yield ("chunk", text)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                yield ("error", sanitize_provider_error(exc, profile))
            else:
                if assistant_message:
                    self._history.append(
                        {"role": "assistant", "content": assistant_message}
                    )

            yield ("done", None)
