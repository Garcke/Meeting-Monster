import unittest

from server.model_diagnostics import (
    classify_model_error,
    model_diagnostic_http_exception,
)


class ProviderStatusError(Exception):
    def __init__(self, status_code, secret="provider-secret"):
        self.status_code = status_code
        super().__init__(secret)


class ResponseStatusError(Exception):
    def __init__(self, status_code, secret="provider-secret"):
        self.response = type("Response", (), {"status_code": status_code})()
        super().__init__(secret)


class RequestTimeout(Exception):
    pass


class NetworkConnectionError(Exception):
    pass


class AuthenticationError(Exception):
    pass


class ModelDiagnosticsTests(unittest.TestCase):
    def assert_diagnostic(self, error, code, message, status):
        diagnostic = classify_model_error(error)

        self.assertEqual(diagnostic.code, code)
        self.assertEqual(diagnostic.message, message)
        self.assertEqual(diagnostic.provider_status, status)
        self.assertNotIn("provider-secret", repr(diagnostic))

    def test_classifies_provider_http_statuses_without_disclosing_error_text(self):
        cases = (
            (401, "authentication_failed", "认证失败：请检查 API Key 或账号区域"),
            (404, "model_not_found", "模型不存在：请检查 Model ID"),
            (429, "rate_limited", "请求过于频繁：请稍后重试"),
            (503, "upstream_error", "模型服务暂时不可用：请稍后重试"),
        )

        for status, code, message in cases:
            with self.subTest(status=status):
                self.assert_diagnostic(ProviderStatusError(status), code, message, status)

    def test_reads_provider_status_from_response_and_classifies_timeout_and_connection_types(self):
        self.assert_diagnostic(
            ResponseStatusError(504),
            "timeout",
            "连接超时：请稍后重试",
            504,
        )
        self.assert_diagnostic(
            RequestTimeout("provider-secret"),
            "timeout",
            "连接超时：请稍后重试",
            None,
        )
        self.assert_diagnostic(
            NetworkConnectionError("provider-secret"),
            "unreachable",
            "无法连接到模型服务：请检查网络或 Base URL",
            None,
        )

    def test_classifies_statusless_authentication_errors_in_the_cause_chain(self):
        wrapper = RuntimeError("provider-secret")
        wrapper.__cause__ = AuthenticationError("provider-secret")

        self.assert_diagnostic(
            wrapper,
            "authentication_failed",
            "认证失败：请检查 API Key 或账号区域",
            None,
        )
        exception = model_diagnostic_http_exception(wrapper)
        self.assertEqual(exception.status_code, 503)
        self.assertEqual(
            exception.detail,
            {
                "code": "authentication_failed",
                "message": "认证失败：请检查 API Key 或账号区域",
            },
        )
        self.assertNotIn("provider-secret", repr(exception.detail))

    def test_builds_safe_http_exception_with_provider_status_or_vision_failure(self):
        unauthorized = model_diagnostic_http_exception(ProviderStatusError(401))

        self.assertEqual(unauthorized.status_code, 401)
        self.assertEqual(
            unauthorized.detail,
            {
                "code": "authentication_failed",
                "message": "认证失败：请检查 API Key 或账号区域",
                "provider_status": 401,
            },
        )
        self.assertNotIn("provider-secret", repr(unauthorized.detail))

        vision_failed = model_diagnostic_http_exception(None, vision_failed=True)
        self.assertEqual(vision_failed.status_code, 422)
        self.assertEqual(
            vision_failed.detail,
            {
                "code": "vision_verification_failed",
                "message": "图片能力验证未通过：请确认模型支持图片输入",
            },
        )


if __name__ == "__main__":
    unittest.main()
