"""统一配置目录（ASR + LLM 工具）

- 仅保留一个 `DASHSCOPE_API_KEY`，用于实时语音（DashScope ASR）
- LLM（文本模型）默认使用 Qwen 的 OpenAI 兼容接口；也允许前端在请求体里覆盖 api_key/base_url/model
"""

from .settings import DASHSCOPE_API_KEY, config
from .llm_checker import check_llm_connection, get_available_models

__all__ = [
    "DASHSCOPE_API_KEY",
    "config",
    "check_llm_connection",
    "get_available_models",
]

