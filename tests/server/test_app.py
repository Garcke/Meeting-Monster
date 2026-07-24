import unittest
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

from server.app import create_app


def create_fake_llm_app() -> FastAPI:
    app = FastAPI()

    @app.get("/health/")
    async def health():
        return {"status": "ok"}

    return app


class SourceLayoutTests(unittest.TestCase):
    def test_backend_python_sources_are_not_in_repository_root(self):
        root = Path(__file__).resolve().parents[2]

        self.assertFalse([path.name for path in root.glob("*.py")])
        self.assertTrue((root / "server" / "app.py").is_file())


class UnifiedServerTests(unittest.TestCase):
    def test_api_only_app_rejects_removed_web_client_and_asr_route(self):
        app = create_app(llm_app=create_fake_llm_app())

        with TestClient(app) as client:
            removed = client.get("/")
            self.assertEqual(removed.status_code, 410)
            self.assertIn("The web client has been removed", removed.json()["detail"])
            self.assertEqual(client.get("/ws/asr").status_code, 404)
            self.assertEqual(client.get("/api/health/").json(), {"status": "ok"})


if __name__ == "__main__":
    unittest.main()
