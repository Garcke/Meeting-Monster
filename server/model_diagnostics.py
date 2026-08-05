"""Safe, stable diagnostics for model connection checks."""

from __future__ import annotations

from dataclasses import dataclass

from fastapi import HTTPException


@dataclass(frozen=True)
class ModelDiagnostic:
    code: str
    message: str
    provider_status: int | None = None


_MESSAGES = {
    "authentication_failed": "认证失败：请检查 API Key 或账号区域",
    "model_not_found": "模型不存在：请检查 Model ID",
    "invalid_request": "请求无效：请检查模型连接配置",
    "rate_limited": "请求过于频繁：请稍后重试",
    "timeout": "连接超时：请稍后重试",
    "unreachable": "无法连接到模型服务：请检查网络或 Base URL",
    "upstream_error": "模型服务暂时不可用：请稍后重试",
    "vision_verification_failed": "图片能力验证未通过：请确认模型支持图片输入",
    "unknown": "模型连接失败：请稍后重试",
}


def _error_chain(error: BaseException | None):
    current = error
    seen: set[int] = set()
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        yield current
        current = current.__cause__


def _provider_status(error: BaseException | None) -> int | None:
    for current in _error_chain(error):
        status = getattr(current, "status_code", None)
        if not isinstance(status, int):
            response = getattr(current, "response", None)
            status = getattr(response, "status_code", None)
        if isinstance(status, int) and 100 <= status <= 599:
            return status
    return None


def _type_names(error: BaseException | None) -> set[str]:
    return {type(current).__name__.lower() for current in _error_chain(error)}


def _diagnostic(code: str, provider_status: int | None = None) -> ModelDiagnostic:
    return ModelDiagnostic(code=code, message=_MESSAGES[code], provider_status=provider_status)


def classify_model_error(
    error: BaseException | None,
    *,
    vision_failed: bool = False,
) -> ModelDiagnostic:
    """Classify provider failures without reading or returning their text."""

    if vision_failed:
        return _diagnostic("vision_verification_failed")

    status = _provider_status(error)
    if status in {401, 403}:
        return _diagnostic("authentication_failed", status)
    if status == 404:
        return _diagnostic("model_not_found", status)
    if status in {400, 422}:
        return _diagnostic("invalid_request", status)
    if status == 429:
        return _diagnostic("rate_limited", status)
    if status in {408, 504}:
        return _diagnostic("timeout", status)
    if status is not None and status >= 500:
        return _diagnostic("upstream_error", status)

    type_names = _type_names(error)
    if type_names.intersection({"authenticationerror", "autherror", "unauthorizederror"}):
        return _diagnostic("authentication_failed")
    if any("timeout" in name for name in type_names):
        return _diagnostic("timeout")
    if any(
        marker in name
        for name in type_names
        for marker in ("connection", "connect", "network", "dns", "socket")
    ):
        return _diagnostic("unreachable")
    return _diagnostic("unknown", status)


def model_diagnostic_http_exception(
    error: BaseException | None,
    *,
    vision_failed: bool = False,
) -> HTTPException:
    """Build the public FastAPI error with only safe, fixed fields."""

    diagnostic = classify_model_error(error, vision_failed=vision_failed)
    detail = {"code": diagnostic.code, "message": diagnostic.message}
    if diagnostic.provider_status is not None:
        detail["provider_status"] = diagnostic.provider_status
    return HTTPException(
        status_code=422 if vision_failed else diagnostic.provider_status or 503,
        detail=detail,
    )
