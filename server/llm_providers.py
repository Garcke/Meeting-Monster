"""Streaming adapters for the two supported LLM wire protocols."""

from __future__ import annotations

import asyncio
import inspect
from collections import OrderedDict
from collections.abc import AsyncIterator, Callable, Mapping, Sequence
from typing import Any, Protocol

from server.chat_images import ChatImage
from server.settings.model_profiles import ResolvedModelProfile


ChatMessage = dict[str, Any]


def _serialize_openai_message(message: ChatMessage) -> ChatMessage:
    role = message["role"]
    content = message["content"]
    image = message.get("image")
    if role == "user" and isinstance(image, ChatImage):
        content = [
            {
                "type": "image_url",
                "image_url": {
                    "url": f"data:{image.media_type};base64,{image.data}",
                    "detail": "high",
                },
            },
            {"type": "text", "text": content},
        ]
    return {"role": role, "content": content}


def _serialize_anthropic_message(message: ChatMessage) -> ChatMessage:
    role = message["role"]
    content = message["content"]
    image = message.get("image")
    if role == "user" and isinstance(image, ChatImage):
        content = [
            {
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": image.media_type,
                    "data": image.data,
                },
            },
            {"type": "text", "text": content},
        ]
    return {"role": role, "content": content}


def _freeze(value: Any) -> Any:
    if isinstance(value, Mapping):
        return tuple(sorted((str(key), _freeze(item)) for key, item in value.items()))
    if isinstance(value, (list, tuple)):
        return tuple(_freeze(item) for item in value)
    if isinstance(value, (set, frozenset)):
        return tuple(sorted((_freeze(item) for item in value), key=repr))
    try:
        hash(value)
    except TypeError:
        return repr(value)
    return value


class LLMProvider(Protocol):
    def stream_text(self, messages: Sequence[ChatMessage]) -> AsyncIterator[str]: ...


async def _close_provider(provider: Any) -> None:
    close = getattr(provider, "aclose", None)
    if close is None:
        return
    result = close()
    if inspect.isawaitable(result):
        await result


class ProviderCache:
    """Bounded async-safe cache for providers and their HTTP connections."""

    def __init__(
        self,
        factory: Callable[[ResolvedModelProfile], LLMProvider] | None = None,
        *,
        max_entries: int = 8,
    ) -> None:
        if max_entries <= 0:
            raise ValueError("max_entries must be positive")
        self._factory = factory if factory is not None else create_provider
        self._max_entries = max_entries
        self._providers: OrderedDict[Any, LLMProvider] = OrderedDict()
        self._lock = asyncio.Lock()

    @staticmethod
    def _key(profile: ResolvedModelProfile) -> tuple[Any, ...]:
        return (
            profile.protocol,
            profile.base_url,
            profile.model,
            profile.api_key,
            _freeze(profile.extra_headers),
            _freeze(profile.extra_body),
        )

    async def get(self, profile: ResolvedModelProfile) -> LLMProvider:
        key = self._key(profile)
        async with self._lock:
            provider = self._providers.pop(key, None)
            if provider is not None:
                self._providers[key] = provider
                return provider

            provider = self._factory(profile)
            self._providers[key] = provider
            if len(self._providers) > self._max_entries:
                _, evicted = self._providers.popitem(last=False)
                await _close_provider(evicted)
            return provider

    async def aclose(self) -> None:
        async with self._lock:
            providers = list(self._providers.values())
            self._providers.clear()
            for provider in providers:
                await _close_provider(provider)


class OpenAIProvider:
    def __init__(self, profile: ResolvedModelProfile, client: Any | None = None) -> None:
        self.profile = profile
        if client is None:
            from openai import AsyncOpenAI

            client = AsyncOpenAI(
                api_key=profile.api_key,
                base_url=profile.base_url,
                default_headers=profile.extra_headers or None,
            )
        self.client = client

    async def stream_text(self, messages: Sequence[ChatMessage]) -> AsyncIterator[str]:
        request: dict[str, Any] = {
            "model": self.profile.model,
            "messages": [_serialize_openai_message(message) for message in messages],
            "stream": True,
            "max_tokens": self.profile.max_tokens,
        }
        if self.profile.temperature is not None:
            request["temperature"] = self.profile.temperature
        if self.profile.top_p is not None:
            request["top_p"] = self.profile.top_p
        if self.profile.extra_headers:
            request["extra_headers"] = self.profile.extra_headers
        if self.profile.extra_body:
            request["extra_body"] = self.profile.extra_body

        stream = await self.client.chat.completions.create(**request)
        async for chunk in stream:
            try:
                content = chunk.choices[0].delta.content
            except (AttributeError, IndexError, KeyError, TypeError):
                content = None
            if content:
                yield content

    async def aclose(self) -> None:
        close = getattr(self.client, "close", None)
        if close is None:
            return
        result = close()
        if inspect.isawaitable(result):
            await result


class AnthropicProvider:
    def __init__(self, profile: ResolvedModelProfile, client: Any | None = None) -> None:
        self.profile = profile
        if client is None:
            from anthropic import AsyncAnthropic

            client = AsyncAnthropic(
                api_key=profile.api_key,
                base_url=profile.base_url,
                default_headers=profile.extra_headers or None,
            )
        self.client = client

    async def stream_text(self, messages: Sequence[ChatMessage]) -> AsyncIterator[str]:
        system_parts = [
            message["content"]
            for message in messages
            if message.get("role") == "system" and message.get("content")
        ]
        conversation = [
            _serialize_anthropic_message(message)
            for message in messages
            if message.get("role") in {"user", "assistant"}
            and message.get("content")
        ]
        request: dict[str, Any] = {
            "model": self.profile.model,
            "messages": conversation,
            "max_tokens": self.profile.max_tokens,
        }
        if system_parts:
            request["system"] = "\n\n".join(system_parts)
        if self.profile.temperature is not None:
            request["temperature"] = self.profile.temperature
        if self.profile.top_p is not None:
            request["top_p"] = self.profile.top_p
        if self.profile.extra_headers:
            request["extra_headers"] = self.profile.extra_headers

        async with self.client.messages.stream(**request) as stream:
            async for text in stream.text_stream:
                if text:
                    yield text

    async def aclose(self) -> None:
        close = getattr(self.client, "close", None)
        if close is None:
            return
        result = close()
        if inspect.isawaitable(result):
            await result


def create_provider(
    profile: ResolvedModelProfile,
    client: Any | None = None,
) -> LLMProvider:
    if profile.protocol == "openai":
        return OpenAIProvider(profile, client=client)
    if profile.protocol == "anthropic":
        return AnthropicProvider(profile, client=client)
    raise ValueError(f"不支持的模型协议: {profile.protocol}")
