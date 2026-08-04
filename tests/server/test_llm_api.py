import asyncio
import base64
import json
import tempfile
import unittest
from pathlib import Path

from cryptography.fernet import Fernet
from fastapi.testclient import TestClient

from server.settings.model_profiles import ModelConfigurationError, ResolvedModelProfile


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
    def __init__(self, chunks=None, error=None) -> None:
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


class LLMAPITests(unittest.TestCase):
    def create_client(self, provider: FakeProvider, resolver=None):
        from server.llm_api import create_app

        app = create_app(
            profile_resolver=resolver or (lambda: test_profile()),
            provider_factory=lambda profile: provider,
        )
        return TestClient(app)

    def test_content_only_request_streams_chunks_and_saves_assistant_history(self):
        provider = FakeProvider(["first", " second"])
        with self.create_client(provider) as client:
            self.assertEqual(
                client.post("/set_prompt/", json={"prompt": "System prompt"}).status_code,
                200,
            )
            response = client.post("/chat/", json={"content": "Question"})

            self.assertEqual(response.status_code, 200)
            self.assertIn('event: chunk\ndata: {"response": "first"}', response.text)
            self.assertIn('event: chunk\ndata: {"response": " second"}', response.text)
            self.assertIn("event: done", response.text)
            self.assertEqual(
                provider.messages,
                [
                    {"role": "system", "content": "System prompt"},
                    {"role": "user", "content": "Question"},
                ],
            )
            self.assertEqual(
                client.get("/history/").json()["history"][-1],
                {"role": "assistant", "content": "first second"},
            )

    def test_chat_accepts_a_png_attachment_and_keeps_public_history_text_only(self):
        from server.chat_images import ChatImage

        encoded = base64.b64encode(b"\x89PNG\r\n\x1a\nfixture").decode("ascii")
        provider = FakeProvider(["answer"])

        with self.create_client(provider) as client:
            response = client.post(
                "/chat/",
                json={
                    "content": "Question",
                    "image": {"media_type": "image/png", "data": encoded},
                },
            )
            history = client.get("/history/").json()["history"]

        self.assertEqual(response.status_code, 200)
        self.assertEqual(provider.messages[-1]["image"], ChatImage("image/png", encoded))
        self.assertEqual(history[0], {"role": "user", "content": "Question"})
        self.assertNotIn(encoded, repr(history))

    def test_chat_rejects_invalid_screenshot_payloads_with_generic_detail(self):
        payloads = [
            {"media_type": "image/png", "data": "%%not-base64%%"},
            {
                "media_type": "image/png",
                "data": base64.b64encode(b"not-png").decode("ascii"),
            },
            {
                "media_type": "image/png",
                "data": base64.b64encode(
                    b"\x89PNG\r\n\x1a\n" + b"x" * (8 * 1024 * 1024 + 1 - 8)
                ).decode("ascii"),
            },
        ]

        with self.create_client(FakeProvider(["answer"])) as client:
            responses = [
                client.post("/chat/", json={"content": "Question", "image": payload})
                for payload in payloads
            ]

        for response in responses:
            self.assertEqual(response.status_code, 422)
            self.assertEqual(response.json(), {"detail": "Invalid screenshot image"})
            self.assertNotIn("not-base64", response.text)

    def test_chat_image_schema_rejects_unknown_fields(self):
        encoded = base64.b64encode(b"\x89PNG\r\n\x1a\nfixture").decode("ascii")

        with self.create_client(FakeProvider(["answer"])) as client:
            response = client.post(
                "/chat/",
                json={
                    "content": "Question",
                    "image": {
                        "media_type": "image/png",
                        "data": encoded,
                        "file_path": "C:/secret.png",
                    },
                },
            )

        self.assertEqual(response.status_code, 422)

    def test_request_rejects_browser_supplied_model_credentials(self):
        with self.create_client(FakeProvider(["answer"])) as client:
            response = client.post(
                "/chat/",
                json={"content": "Question", "api_key": "browser-secret"},
            )

        self.assertEqual(response.status_code, 422)

    def test_chat_uses_complete_temporary_connection_without_persisting_it(self):
        from server.llm_api import create_app

        provider = FakeProvider(["answer"])
        seen_profiles = []
        with tempfile.TemporaryDirectory() as directory:
            from server.settings.profile_store import ProfileStore, SecretCipher

            store = ProfileStore(Path(directory) / "profiles.json", SecretCipher(Fernet.generate_key()))
            before = store.path.read_bytes() if store.path.exists() else None

            def provider_factory(profile):
                seen_profiles.append(profile)
                return provider

            with TestClient(create_app(profile_store=store, provider_factory=provider_factory)) as client:
                response = client.post(
                    "/chat/",
                    json={
                        "content": "Question",
                        "profile_id": "generic_openai",
                        "protocol": "openai",
                        "base_url": "https://provider.example/v1",
                        "model": "custom-model",
                        "api_key": "provider-secret",
                        "max_tokens": 2048,
                        "temperature": 0.2,
                    },
                )

            self.assertEqual(response.status_code, 200)
            self.assertEqual(seen_profiles[-1].base_url, "https://provider.example/v1")
            self.assertEqual(seen_profiles[-1].model, "custom-model")
            self.assertEqual(seen_profiles[-1].api_key, "provider-secret")
            self.assertEqual(store.path.read_bytes() if store.path.exists() else None, before)
            self.assertNotIn("provider-secret", response.text)

    def test_chat_rejects_invalid_temporary_connection(self):
        with self.create_client(FakeProvider(["answer"])) as client:
            response = client.post(
                "/chat/",
                json={
                    "content": "Question",
                    "profile_id": "generic_openai",
                    "protocol": "anthropic",
                    "base_url": "file:///not-allowed",
                    "model": "custom-model",
                },
            )

        self.assertEqual(response.status_code, 422)

    def test_chat_sse_error_redacts_temporary_connection_values(self):
        provider = FakeProvider(error=RuntimeError("provider-secret rejected at https://provider.example/v1"))
        with self.create_client(provider) as client:
            response = client.post(
                "/chat/",
                json={
                    "content": "Question",
                    "profile_id": "generic_openai",
                    "protocol": "openai",
                    "base_url": "https://provider.example/v1",
                    "model": "custom-model",
                    "api_key": "provider-secret",
                },
            )

        self.assertEqual(response.status_code, 200)
        self.assertNotIn("provider-secret", response.text)
        self.assertNotIn("https://provider.example/v1", response.text)
        self.assertNotIn("custom-model", response.text)

    def test_chat_initialization_error_redacts_temporary_connection_values(self):
        from server.llm_api import create_app

        def provider_factory(_profile):
            raise RuntimeError(
                "invalid key provider-secret for https://provider.example/v1 model custom-model"
            )

        with TestClient(
            create_app(
                profile_resolver=lambda: test_profile(),
                provider_factory=provider_factory,
            )
        ) as client:
            response = client.post(
                "/chat/",
                json={
                    "content": "Question",
                    "profile_id": "generic_openai",
                    "protocol": "openai",
                    "base_url": "https://provider.example/v1",
                    "model": "custom-model",
                    "api_key": "provider-secret",
                },
            )

        self.assertEqual(response.status_code, 503)
        self.assertNotIn("provider-secret", response.text)
        self.assertNotIn("https://provider.example/v1", response.text)
        self.assertNotIn("custom-model", response.text)

    def test_chat_rejects_remote_plain_http_temporary_connection(self):
        with self.create_client(FakeProvider(["answer"])) as client:
            response = client.post(
                "/chat/",
                json={
                    "content": "Question",
                    "profile_id": "generic_openai",
                    "protocol": "openai",
                    "base_url": "http://provider.example/v1",
                    "model": "custom-model",
                },
            )

        self.assertEqual(response.status_code, 422)

    def test_public_model_config_omits_endpoint_key_and_environment_name(self):
        with self.create_client(FakeProvider()) as client:
            response = client.get("/model-config/")

        self.assertEqual(
            response.json(),
            {
                "active_profile": "test-profile",
                "label": "Test Provider",
                "protocol": "openai",
                "model": "test-model",
            },
        )
        rendered = json.dumps(response.json())
        self.assertNotIn("top-secret", rendered)
        self.assertNotIn("secret-endpoint", rendered)
        self.assertNotIn("api_key_env", rendered)

    def test_model_options_are_safe_and_chat_profile_selection_does_not_change_active_profile(self):
        from server.llm_api import create_app
        from server.settings.profile_store import ModelProfileInput, ProfileStore, SecretCipher

        with tempfile.TemporaryDirectory() as directory:
            store = ProfileStore(Path(directory) / "profiles.json", SecretCipher(Fernet.generate_key()))
            store.create_profile(
                ModelProfileInput(
                    id="alternate",
                    label="Alternate",
                    protocol="openai",
                    base_url="https://alternate.example/v1",
                    model="alternate-model",
                    api_key_required=False,
                    max_tokens=32,
                    temperature=0.2,
                )
            )
            provider = FakeProvider(["answer"])
            seen_profiles = []

            def provider_factory(profile):
                seen_profiles.append(profile)
                return provider

            with TestClient(create_app(profile_store=store, provider_factory=provider_factory)) as client:
                options = client.get("/model-options/")
                test_result = client.post("/model-test/", json={"profile_id": "alternate"})
                response = client.post("/chat/", json={"content": "Question", "profile_id": "alternate"})
                active = client.get("/model-config/")

        self.assertEqual(options.status_code, 200)
        self.assertEqual(test_result.status_code, 200)
        self.assertEqual(test_result.json()["model"], "alternate-model")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(seen_profiles[-1].profile_id, "alternate")
        self.assertEqual(active.json()["active_profile"], "generic_openai")
        self.assertEqual(options.json()["active_profile"], "generic_openai")
        self.assertTrue(all("base_url" not in profile for profile in options.json()["profiles"]))
        self.assertTrue(all("api_key" not in profile for profile in options.json()["profiles"]))
        self.assertTrue(all("api_key_env" not in profile for profile in options.json()["profiles"]))

    def test_model_test_uses_complete_temporary_connection_without_persisting_it(self):
        from server.llm_api import create_app

        provider = FakeProvider(["connected"])
        seen_profiles = []
        with tempfile.TemporaryDirectory() as directory:
            from server.settings.profile_store import ProfileStore, SecretCipher

            store = ProfileStore(Path(directory) / "profiles.json", SecretCipher(Fernet.generate_key()))

            def provider_factory(profile):
                seen_profiles.append(profile)
                return provider

            with TestClient(create_app(profile_store=store, provider_factory=provider_factory)) as client:
                response = client.post(
                    "/model-test/",
                    json={
                        "profile_id": "generic_anthropic",
                        "protocol": "anthropic",
                        "base_url": "https://provider.example/anthropic",
                        "model": "custom-anthropic",
                        "api_key": "provider-secret",
                        "max_tokens": 2048,
                        "temperature": 0.2,
                    },
                )

            self.assertEqual(response.status_code, 200)
            self.assertEqual(seen_profiles[-1].protocol, "anthropic")
            self.assertEqual(seen_profiles[-1].base_url, "https://provider.example/anthropic")
            self.assertEqual(seen_profiles[-1].model, "custom-anthropic")
            self.assertEqual(seen_profiles[-1].api_key, "provider-secret")
            self.assertNotIn("provider-secret", response.text)

    def test_provider_failure_emits_error_and_done_events_without_hanging(self):
        provider = FakeProvider(error=RuntimeError("provider unavailable"))
        with self.create_client(provider) as client:
            response = client.post("/chat/", json={"content": "Question"})

        self.assertEqual(response.status_code, 200)
        self.assertIn("event: error", response.text)
        self.assertIn("provider unavailable", response.text)
        self.assertIn("event: done", response.text)

    def test_invalid_server_configuration_returns_service_unavailable(self):
        def broken_resolver():
            raise ModelConfigurationError("missing MODEL_API_KEY")

        with self.create_client(FakeProvider(), resolver=broken_resolver) as client:
            response = client.post("/chat/", json={"content": "Question"})

        self.assertEqual(response.status_code, 503)
        self.assertIn("MODEL_API_KEY", response.json()["detail"])

    def test_chat_uses_the_profile_newly_activated_in_the_injected_store(self):
        from server.llm_api import create_app
        from server.settings.profile_store import ModelProfileInput, ProfileStore, SecretCipher

        with tempfile.TemporaryDirectory() as directory:
            store = ProfileStore(Path(directory) / "profiles.json", SecretCipher(Fernet.generate_key()))
            store.create_profile(
                ModelProfileInput(
                    id="alternate",
                    label="Alternate",
                    protocol="openai",
                    base_url="https://alternate.example/v1",
                    model="alternate-model",
                    api_key_required=False,
                    max_tokens=32,
                    temperature=0.2,
                )
            )
            provider = FakeProvider(["answer"])
            seen_profiles = []

            def provider_factory(profile):
                seen_profiles.append(profile)
                return provider

            with TestClient(
                create_app(
                    profile_store=store,
                    admin_token="admin-token",
                    provider_factory=provider_factory,
                )
            ) as client:
                activated = client.post(
                    "/models/alternate/activate",
                    headers={"Authorization": "Bearer admin-token"},
                )
                response = client.post("/chat/", json={"content": "Question"})
                configuration = client.get("/model-config/")

        self.assertEqual(activated.status_code, 200)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(seen_profiles[-1].profile_id, "alternate")
        self.assertEqual(configuration.json()["active_profile"], "alternate")

    def test_app_lifespan_closes_cached_provider_clients(self):
        from server.llm_api import create_app

        class ClosableProvider(FakeProvider):
            def __init__(self):
                super().__init__(["answer"])
                self.closed = False

            async def aclose(self):
                self.closed = True

        provider = ClosableProvider()
        app = create_app(
            profile_resolver=lambda: test_profile(),
            provider_factory=lambda _profile: provider,
        )

        with TestClient(app) as client:
            response = client.post("/chat/", json={"content": "Question"})
            self.assertEqual(response.status_code, 200)

        self.assertTrue(provider.closed)


if __name__ == "__main__":
    unittest.main()
