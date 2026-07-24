"""API-only LLM server for the Meeting-Monster Electron client."""

from __future__ import annotations

import asyncio
import importlib
import logging
import os
from typing import Any

import uvicorn
from fastapi import FastAPI


LOGGER = logging.getLogger("meeting-monster")


class LazyLLMApp:
    """Delay importing the OpenAI SDK until an /api request is received."""

    def __init__(self) -> None:
        self._app = None
        self._lock = asyncio.Lock()

    async def __call__(self, scope, receive, send) -> None:
        if self._app is None:
            async with self._lock:
                if self._app is None:
                    self._app = importlib.import_module("server.llm_api").app
        await self._app(scope, receive, send)


def create_app(llm_app: Any | None = None) -> FastAPI:
    """Build the API-only application."""

    application = FastAPI(title="Meeting-Monster")

    @application.get("/", status_code=410)
    async def removed_web_client() -> dict[str, str]:
        return {"detail": "The web client has been removed; use the Meeting-Monster Electron client."}

    application.mount("/api", llm_app or LazyLLMApp(), name="api")
    return application


app = create_app()


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    host = os.getenv("APP_HOST", "127.0.0.1")
    port = int(os.getenv("APP_PORT", "9000"))
    LOGGER.info("Starting Meeting-Monster at http://%s:%s", host, port)
    uvicorn.run(app, host=host, port=port, log_level="info")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        LOGGER.info("Server stopped")
    except (FileNotFoundError, ValueError, ModuleNotFoundError) as exc:
        LOGGER.error("%s", exc)
        raise SystemExit(1) from exc
