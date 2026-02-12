"""LLM 连接测试工具（OpenAI 兼容接口）"""

from typing import Literal, Optional

import openai


def normalize_base_url(url: str) -> str:
    """规范化 Base URL：去除末尾斜杠，若无协议则补 https"""
    url = (url or "").strip().rstrip("/")
    if not url:
        return ""
    if not url.startswith(("http://", "https://")):
        url = "https://" + url
    return url


def check_llm_connection(
    base_url: str, api_key: str, model: str
) -> tuple[Literal[True], Optional[str]] | tuple[Literal[False], Optional[str]]:
    """测试 LLM API 连接"""
    try:
        base_url = normalize_base_url(base_url)
        api_key = (api_key or "").strip()
        if not base_url or not api_key or not (model or "").strip():
            return False, "请填写 Base URL、API Key 和模型名称。"

        client = openai.OpenAI(base_url=base_url, api_key=api_key, timeout=60)
        response = client.chat.completions.create(
            model=model.strip(),
            messages=[
                {"role": "system", "content": "You are a helpful assistant."},
                {"role": "user", "content": 'Just respond with "Hello"!'},
            ],
            timeout=30,
        )
        content = response.choices[0].message.content
        return True, content or "连接成功，未返回内容。"
    except openai.APIConnectionError:
        return False, "API 连接失败，请检查网络或 VPN。"
    except openai.RateLimitError as e:
        return False, "请求限流: " + str(e)
    except openai.AuthenticationError:
        return False, "认证失败，请检查 API Key。"
    except openai.NotFoundError:
        return False, "URL 未找到，请检查 Base URL。"
    except openai.APIStatusError as e:
        return False, f"API 错误 ({e.status_code}): {e.message}"
    except openai.APITimeoutError:
        return False, "请求超时，请检查网络或稍后重试。"
    except openai.OpenAIError as e:
        return False, "OpenAI 错误: " + str(e)
    except Exception as e:
        return False, str(e)


def get_available_models(base_url: str, api_key: str) -> list[str]:
    """获取可用的模型列表"""
    try:
        base_url = normalize_base_url(base_url)
        api_key = (api_key or "").strip()
        if not base_url or not api_key:
            return []

        client = openai.OpenAI(base_url=base_url, api_key=api_key, timeout=10)
        models = client.models.list()

        non_chat_keywords = (
            "tts",
            "transcribe",
            "realtime",
            "embedding",
            "vision",
            "audio",
            "search",
            "image",
            "whisper",
        )
        model_ids: list[str] = []
        for m in models:
            mid = getattr(m, "id", None) or str(m)
            if isinstance(mid, str) and not any(kw in mid.lower() for kw in non_chat_keywords):
                model_ids.append(mid)

        def get_model_weight(name: str) -> int:
            name = name.lower()
            if name.startswith(("gpt-5", "claude-4", "gemini-2", "gemini-3")):
                return 10
            if name.startswith(("gpt-4", "gpt-4o")):
                return 5
            if name.startswith(("deepseek", "glm", "qwen", "doubao")):
                return 3
            return 0

        return sorted(model_ids, key=lambda x: (-get_model_weight(x), x))
    except Exception:
        return []

