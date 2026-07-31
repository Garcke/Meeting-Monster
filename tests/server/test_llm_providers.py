from types import SimpleNamespace
import unittest

from server.settings.model_profiles import ResolvedModelProfile


def make_profile(protocol: str) -> ResolvedModelProfile:
    return ResolvedModelProfile(
        profile_id=f"test-{protocol}",
        label="Test provider",
        protocol=protocol,
        base_url="https://example.com/v1" if protocol == "openai" else "https://example.com",
        model="test-model",
        api_key="secret",
        max_tokens=1234,
        temperature=0.2,
        top_p=0.8,
        extra_headers={"X-Test": "yes"},
        extra_body={"enable_search": True},
    )


class AsyncTextStream:
    def __init__(self, values):
        self._values = iter(values)

    def __aiter__(self):
        return self

    async def __anext__(self):
        try:
            return next(self._values)
        except StopIteration as exc:
            raise StopAsyncIteration from exc


class FakeOpenAICompletions:
    def __init__(self) -> None:
        self.kwargs = None

    async def create(self, **kwargs):
        self.kwargs = kwargs
        return AsyncTextStream(
            [
                SimpleNamespace(
                    choices=[SimpleNamespace(delta=SimpleNamespace(content="first"))]
                ),
                SimpleNamespace(
                    choices=[SimpleNamespace(delta=SimpleNamespace(content=None))]
                ),
                SimpleNamespace(
                    choices=[SimpleNamespace(delta=SimpleNamespace(content=" second"))]
                ),
            ]
        )


class FakeOpenAIClient:
    def __init__(self) -> None:
        self.completions = FakeOpenAICompletions()
        self.chat = SimpleNamespace(completions=self.completions)


class FakeAnthropicStream:
    def __init__(self) -> None:
        self.text_stream = AsyncTextStream(["first", " second"])

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, traceback):
        return False


class FakeAnthropicMessages:
    def __init__(self) -> None:
        self.kwargs = None

    def stream(self, **kwargs):
        self.kwargs = kwargs
        return FakeAnthropicStream()


class FakeAnthropicClient:
    def __init__(self) -> None:
        self.messages = FakeAnthropicMessages()


MESSAGES = [
    {"role": "system", "content": "You are helpful."},
    {"role": "system", "content": "Answer concisely."},
    {"role": "user", "content": "Question"},
    {"role": "assistant", "content": "Earlier answer"},
]


class LLMProviderTests(unittest.IsolatedAsyncioTestCase):
    async def test_openai_adapter_streams_delta_text_and_preserves_messages(self):
        from server.llm_providers import OpenAIProvider

        client = FakeOpenAIClient()
        provider = OpenAIProvider(make_profile("openai"), client=client)

        self.assertEqual(
            [text async for text in provider.stream_text(MESSAGES)],
            ["first", " second"],
        )
        self.assertEqual(client.completions.kwargs["messages"], MESSAGES)
        self.assertEqual(client.completions.kwargs["model"], "test-model")
        self.assertTrue(client.completions.kwargs["stream"])
        self.assertEqual(client.completions.kwargs["max_tokens"], 1234)
        self.assertEqual(client.completions.kwargs["temperature"], 0.2)
        self.assertEqual(client.completions.kwargs["top_p"], 0.8)
        self.assertEqual(client.completions.kwargs["extra_headers"], {"X-Test": "yes"})
        self.assertEqual(client.completions.kwargs["extra_body"], {"enable_search": True})

    async def test_anthropic_adapter_moves_system_messages_to_top_level(self):
        from server.llm_providers import AnthropicProvider

        client = FakeAnthropicClient()
        provider = AnthropicProvider(make_profile("anthropic"), client=client)

        self.assertEqual(
            [text async for text in provider.stream_text(MESSAGES)],
            ["first", " second"],
        )
        kwargs = client.messages.kwargs
        self.assertEqual(kwargs["system"], "You are helpful.\n\nAnswer concisely.")
        self.assertEqual(
            kwargs["messages"],
            [
                {"role": "user", "content": "Question"},
                {"role": "assistant", "content": "Earlier answer"},
            ],
        )
        self.assertEqual(kwargs["model"], "test-model")
        self.assertEqual(kwargs["max_tokens"], 1234)
        self.assertEqual(kwargs["temperature"], 0.2)
        self.assertEqual(kwargs["top_p"], 0.8)
        self.assertEqual(kwargs["extra_headers"], {"X-Test": "yes"})
        self.assertNotIn("extra_body", kwargs)

    async def test_factory_dispatches_by_explicit_protocol(self):
        from server.llm_providers import AnthropicProvider, OpenAIProvider, create_provider

        self.assertIsInstance(
            create_provider(make_profile("openai"), client=FakeOpenAIClient()),
            OpenAIProvider,
        )
        self.assertIsInstance(
            create_provider(make_profile("anthropic"), client=FakeAnthropicClient()),
            AnthropicProvider,
        )

    async def test_provider_cache_reuses_provider_for_same_connection(self):
        from server.llm_providers import ProviderCache

        created = []

        def factory(profile):
            provider = object()
            created.append((profile, provider))
            return provider

        cache = ProviderCache(factory)
        first = await cache.get(make_profile("openai"))
        second = await cache.get(make_profile("openai"))

        self.assertIs(first, second)
        self.assertEqual(len(created), 1)
        await cache.aclose()

    async def test_provider_cache_evicts_oldest_entry_and_closes_it(self):
        from dataclasses import replace

        from server.llm_providers import ProviderCache

        class ClosableProvider:
            def __init__(self):
                self.closed = False

            async def aclose(self):
                self.closed = True

        created = []

        def factory(profile):
            provider = ClosableProvider()
            created.append(provider)
            return provider

        cache = ProviderCache(factory, max_entries=2)
        first_profile = make_profile("openai")
        await cache.get(first_profile)
        await cache.get(replace(first_profile, model="second-model"))
        await cache.get(replace(first_profile, model="third-model"))

        self.assertTrue(created[0].closed)
        self.assertFalse(created[1].closed)
        self.assertFalse(created[2].closed)
        await cache.aclose()
        self.assertTrue(created[1].closed)
        self.assertTrue(created[2].closed)


if __name__ == "__main__":
    unittest.main()
