"""Meeting-Monster text-model API with server-owned model configuration."""

from __future__ import annotations

import asyncio
import json
import os
from contextlib import asynccontextmanager
from dataclasses import replace
from collections.abc import Callable
from pathlib import Path
from typing import Mapping

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field

from server.chat_images import parse_chat_image
from server.settings.model_profiles import (
    DEFAULT_PROFILE_STORE_PATH,
    ModelConfigurationError,
    ResolvedModelProfile,
    TemporaryModelConnection,
    resolve_active_profile,
    resolve_temporary_profile,
)
from server.settings.profile_store import ProfileStore, SecretCipher
from server.chat_service import ChatService, sanitize_provider_error
from server.llm_providers import LLMProvider, ProviderCache, create_provider
from server.model_diagnostics import model_diagnostic_http_exception
from server.model_api import create_router as create_model_router
from server.vision_challenge import VisionVerifier, verify_provider_vision


PROMPT_FILE = Path(__file__).resolve().parents[1] / "cache" / "prompt.txt"


class UserMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    content: str = Field(min_length=1)
    profile_id: str | None = Field(default=None, min_length=1)
    protocol: str | None = None
    base_url: str | None = None
    model: str | None = None
    api_key: str | None = None
    max_tokens: int | None = Field(default=None, gt=0)
    temperature: float | None = Field(default=None, ge=0, le=2)
    image: object | None = None


class ChatImageRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    media_type: str
    data: str


class ModelTestRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    profile_id: str = Field(min_length=1)
    protocol: str | None = None
    base_url: str | None = None
    model: str | None = None
    api_key: str | None = None
    max_tokens: int | None = Field(default=None, gt=0)
    temperature: float | None = Field(default=None, ge=0, le=2)


class PromptMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    prompt: str


ProfileResolver = Callable[[], ResolvedModelProfile]
ProviderFactory = Callable[[ResolvedModelProfile], LLMProvider]

CONNECTION_REQUEST_FIELDS = ("profile_id", "protocol", "base_url", "model", "api_key", "max_tokens", "temperature")


def parse_temporary_connection(request: BaseModel) -> TemporaryModelConnection | None:
    values = {
        field: value
        for field in CONNECTION_REQUEST_FIELDS
        if (value := getattr(request, field, None)) is not None
    }
    supplied = {field for field, value in values.items() if value is not None}
    if not supplied or supplied == {"profile_id"}:
        return None
    required = {"profile_id", "protocol", "base_url", "model"}
    if not required.issubset(supplied):
        raise HTTPException(status_code=422, detail="Invalid temporary model connection")
    try:
        return TemporaryModelConnection.model_validate(values)
    except Exception as exc:
        raise HTTPException(status_code=422, detail="Invalid temporary model connection") from exc


def create_runtime_profile_store(environ: Mapping[str, str] | None = None) -> ProfileStore:
    """Build the encrypted profile store used by the local API process."""

    environment = os.environ if environ is None else environ
    store_path = Path(
        environment.get("MODEL_PROFILE_STORE_PATH", "").strip() or DEFAULT_PROFILE_STORE_PATH
    )
    master_key = environment.get("MODEL_CONFIG_MASTER_KEY", "").strip()
    return ProfileStore(store_path, SecretCipher(master_key) if master_key else None)


def create_app(
    profile_resolver: ProfileResolver | None = None,
    provider_factory: ProviderFactory = create_provider,
    profile_store: ProfileStore | None = None,
    admin_token: str | None = None,
    environ: Mapping[str, str] | None = None,
    vision_verifier: VisionVerifier = verify_provider_vision,
) -> FastAPI:
    environment = os.environ if environ is None else environ
    runtime_store = profile_store or create_runtime_profile_store(environment)
    if profile_resolver is None:
        profile_resolver = lambda: runtime_store.resolve_active_profile(environment)
    if admin_token is None:
        admin_token = environment.get("APP_ADMIN_TOKEN", "")

    provider_cache = ProviderCache(provider_factory)
    chat_service = ChatService(provider_cache)

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        try:
            yield
        finally:
            await provider_cache.aclose()

    app = FastAPI(title="Meeting-Monster LLM API", lifespan=lifespan)
    app.state.chat_service = chat_service
    app.state.provider_cache = provider_cache

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    def resolve_profile(
        profile_id: str | None = None,
        api_key: str | None = None,
        max_tokens: int | None = None,
        temperature: float | None = None,
        connection: TemporaryModelConnection | None = None,
    ) -> ResolvedModelProfile:
        try:
            if connection is not None:
                return resolve_temporary_profile(connection, runtime_store, environment)
            profile = (
                runtime_store.resolve_active_profile(environment, profile_id, api_key_override=api_key)
                if profile_id
                else profile_resolver()
            )
        except ModelConfigurationError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        if max_tokens is not None or temperature is not None:
            profile = replace(
                profile,
                **{
                    **({"max_tokens": max_tokens} if max_tokens is not None else {}),
                    **({"temperature": temperature} if temperature is not None else {}),
                },
            )
        return profile

    def require_local_client(request: Request) -> None:
        client_host = request.client.host if request.client else ""
        if client_host not in {"127.0.0.1", "::1", "localhost", "testclient"}:
            raise HTTPException(status_code=403, detail="Local model selection is required")

    @app.get("/prompt/")
    async def get_prompt():
        try:
            prompt = PROMPT_FILE.read_text(encoding="utf-8")
        except OSError as exc:
            raise HTTPException(status_code=500, detail="无法读取系统提示词") from exc
        return {"prompt": prompt}

    @app.post("/set_prompt/")
    async def set_prompt(prompt_message: PromptMessage):
        chat_service.set_prompt(prompt_message.prompt)
        return {"message": "Prompt has been set."}

    @app.post("/chat/")
    async def chat(user_message: UserMessage):
        image = None
        if user_message.image is not None:
            try:
                image_request = ChatImageRequest.model_validate(user_message.image)
                image = parse_chat_image(image_request.media_type, image_request.data)
            except (TypeError, ValueError) as exc:
                raise HTTPException(
                    status_code=422,
                    detail="Invalid screenshot image",
                ) from exc
        connection = parse_temporary_connection(user_message)
        profile = resolve_profile(
            user_message.profile_id if connection is None else None,
            user_message.api_key if connection is None else None,
            user_message.max_tokens,
            user_message.temperature,
            connection,
        )
        try:
            provider = await chat_service.get_provider(profile)
        except Exception as exc:
            safe_detail = sanitize_provider_error(exc, profile)
            raise HTTPException(status_code=503, detail=f"无法初始化模型客户端: {safe_detail}") from exc

        async def stream_response():
            yield ": stream start\n\n"
            async for kind, value in chat_service.stream_response(
                user_message.content,
                profile,
                provider,
                image=image,
            ):
                if kind == "chunk":
                    payload = json.dumps({"response": value}, ensure_ascii=False)
                    yield f"event: chunk\ndata: {payload}\n\n"
                elif kind == "error":
                    payload = json.dumps({"detail": value}, ensure_ascii=False)
                    yield f"event: error\ndata: {payload}\n\n"
                elif kind == "done":
                    break
            yield "event: done\ndata: {}\n\n"

        return StreamingResponse(
            stream_response(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )

    @app.get("/history/")
    async def get_history():
        return {"history": chat_service.get_history()}

    @app.post("/reset/")
    async def reset_history():
        chat_service.reset_history()
        return {"message": "Conversation history has been reset."}

    @app.get("/model-config/")
    async def get_model_config():
        return resolve_profile().public_summary()

    @app.get("/model-options/")
    async def get_model_options(request: Request):
        require_local_client(request)
        try:
            profiles = runtime_store.list_profiles()
        except ModelConfigurationError as exc:
            raise HTTPException(status_code=503, detail="Model options are unavailable") from exc
        active_profile = next(profile.id for profile in profiles if profile.active)
        return {
            "active_profile": active_profile,
            "profiles": [profile.model_dump(exclude={"base_url"}) for profile in profiles],
        }

    @app.post("/model-test/")
    async def test_model(http_request: Request, request: ModelTestRequest):
        require_local_client(http_request)
        connection = parse_temporary_connection(request)
        profile = resolve_profile(
            request.profile_id if connection is None else None,
            request.api_key if connection is None else None,
            request.max_tokens,
            request.temperature,
            connection,
        )
        short_profile = replace(profile, max_tokens=min(profile.max_tokens, 8))
        started = asyncio.get_running_loop().time()
        try:
            provider = await chat_service.get_provider(short_profile)
            supports_vision = await vision_verifier(provider)
        except Exception as exc:
            raise model_diagnostic_http_exception(exc) from exc
        if not supports_vision:
            raise model_diagnostic_http_exception(None, vision_failed=True)
        return {
            "ok": True,
            "vision": True,
            "latency_ms": int((asyncio.get_running_loop().time() - started) * 1000),
            "model": short_profile.model,
        }

    @app.get("/health/")
    async def health_check():
        return {"status": "ok"}

    app.include_router(
        create_model_router(
            profile_store=runtime_store,
            admin_token=admin_token,
            provider_factory=chat_service.get_provider,
            environ=environment,
            vision_verifier=vision_verifier,
        )
    )

    return app


app = create_app()
