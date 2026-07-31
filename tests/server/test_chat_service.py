import asyncio
import unittest

from server.llm_providers import ProviderCache
from server.settings.model_profiles import ResolvedModelProfile


def test_profile() -> ResolvedModelProfile:
    return ResolvedModelProfile(
        profile_id="test-profile",
        label="Test Provider",
        protocol="openai",
        base_url="https://secret-endpoint.example/v1",
        model="test-model",
        api_key="top-secret",
        max_tokens=1024,
        temperature=0.2,
        top_p=None,
    )


class FakeProvider:
    def __init__(self, chunks=None, error=None):
        self.chunks = chunks or []
        self.error = error
        self.messages = None

    async def stream_text(self, messages):
        self.messages = list(messages)
        if self.error:
            raise self.error
        for chunk in self.chunks:
            await asyncio.sleep(0)
            yield chunk


class BlockingProvider:
    def __init__(self):
        self.started = asyncio.Event()
        self.release = asyncio.Event()
        self.closed = False

    async def stream_text(self, _messages):
        self.started.set()
        try:
            yield "first"
            await self.release.wait()
        finally:
            self.closed = True


class ChatServiceTests(unittest.IsolatedAsyncioTestCase):
    async def test_stream_saves_assistant_after_successful_stream(self):
        from server.chat_service import ChatService

        provider = FakeProvider(["first", " second"])
        service = ChatService(ProviderCache(lambda _profile: provider))

        events = [
            event
            async for event in service.stream_response("Question", test_profile(), provider)
        ]

        self.assertEqual(events, [("chunk", "first"), ("chunk", " second"), ("done", None)])
        self.assertEqual(
            service.get_history(),
            [
                {"role": "user", "content": "Question"},
                {"role": "assistant", "content": "first second"},
            ],
        )
        self.assertEqual(provider.messages, [{"role": "user", "content": "Question"}])

    async def test_stream_error_is_redacted_and_does_not_save_assistant(self):
        from server.chat_service import ChatService

        provider = FakeProvider(error=RuntimeError("top-secret rejected at https://secret-endpoint.example/v1"))
        service = ChatService(ProviderCache(lambda _profile: provider))

        events = [
            event
            async for event in service.stream_response("Question", test_profile(), provider)
        ]

        self.assertEqual(events[0][0], "error")
        self.assertNotIn("top-secret", events[0][1])
        self.assertNotIn("secret-endpoint", events[0][1])
        self.assertEqual(events[-1], ("done", None))
        self.assertEqual(service.get_history(), [{"role": "user", "content": "Question"}])

    async def test_prompt_and_reset_preserve_public_history_shape(self):
        from server.chat_service import ChatService

        provider = FakeProvider(["answer"])
        service = ChatService(ProviderCache(lambda _profile: provider))
        service.set_prompt("System prompt")

        _ = [
            event
            async for event in service.stream_response("Question", test_profile(), provider)
        ]

        self.assertEqual(
            service.get_history(),
            [
                {"role": "system", "content": "System prompt"},
                {"role": "user", "content": "Question"},
                {"role": "assistant", "content": "answer"},
            ],
        )
        service.reset_history()
        self.assertEqual(service.get_history(), [])

    async def test_cancelled_stream_releases_lock_and_closes_provider_iterator(self):
        from server.chat_service import ChatService

        provider = BlockingProvider()
        service = ChatService(ProviderCache(lambda _profile: provider))

        async def consume():
            return [
                event
                async for event in service.stream_response("Question", test_profile(), provider)
            ]

        task = asyncio.create_task(consume())
        await provider.started.wait()
        task.cancel()

        with self.assertRaises(asyncio.CancelledError):
            await task

        self.assertTrue(provider.closed)
        self.assertFalse(service._conversation_lock.locked())
