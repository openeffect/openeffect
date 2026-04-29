"""Shared helpers for route-layer error responses.

Every `/api/*` error body has the shape `{"error": str, "code": str, ...}`.
The route handlers used to inline this dict everywhere, which let typos in
the `code` string reach the client silently and made the set of codes hard
to enumerate. The helpers below keep the shape in one place and gate the
`code` values through an enum so the frontend can treat them as a closed set.
"""
from enum import Enum
from typing import Any

from fastapi import HTTPException


class ErrorCode(str, Enum):
    # Generic
    BAD_REQUEST = "BAD_REQUEST"
    NOT_FOUND = "NOT_FOUND"
    CONFLICT = "CONFLICT"
    INTERNAL_ERROR = "INTERNAL_ERROR"
    INVALID_REQUEST = "INVALID_REQUEST"

    # Auth
    NO_API_KEY = "NO_API_KEY"

    # Uploads
    UNSUPPORTED_TYPE = "UNSUPPORTED_TYPE"
    FILE_TOO_LARGE = "FILE_TOO_LARGE"
    FILE_NOT_FOUND = "FILE_NOT_FOUND"

    # Effects / install
    EFFECT_NOT_FOUND = "EFFECT_NOT_FOUND"
    ASSET_NOT_FOUND = "ASSET_NOT_FOUND"
    INSTALL_CONFLICT = "INSTALL_CONFLICT"
    INSTALL_ERROR = "INSTALL_ERROR"
    UNINSTALL_ERROR = "UNINSTALL_ERROR"
    UPDATE_ERROR = "UPDATE_ERROR"
    SAVE_ERROR = "SAVE_ERROR"
    OFFICIAL_READONLY = "OFFICIAL_READONLY"

    # Runs / provider
    RUN_NOT_FOUND = "RUN_NOT_FOUND"
    RUN_FAILED = "RUN_FAILED"


def api_error(
    status: int, message: str, code: ErrorCode, **extra: Any
) -> HTTPException:
    detail: dict[str, Any] = {"error": message, "code": code.value}
    detail.update(extra)
    return HTTPException(status_code=status, detail=detail)


def bad_request(message: str, code: ErrorCode = ErrorCode.BAD_REQUEST, **extra: Any) -> HTTPException:
    return api_error(400, message, code, **extra)


def unauthorized(message: str, code: ErrorCode = ErrorCode.NO_API_KEY, **extra: Any) -> HTTPException:
    return api_error(401, message, code, **extra)


def not_found(message: str, code: ErrorCode = ErrorCode.NOT_FOUND, **extra: Any) -> HTTPException:
    return api_error(404, message, code, **extra)


def conflict(message: str, code: ErrorCode = ErrorCode.CONFLICT, **extra: Any) -> HTTPException:
    return api_error(409, message, code, **extra)


def payload_too_large(message: str, code: ErrorCode = ErrorCode.FILE_TOO_LARGE, **extra: Any) -> HTTPException:
    return api_error(413, message, code, **extra)


def unsupported_type(message: str, code: ErrorCode = ErrorCode.UNSUPPORTED_TYPE, **extra: Any) -> HTTPException:
    return api_error(415, message, code, **extra)


def unprocessable(message: str, code: ErrorCode = ErrorCode.INVALID_REQUEST, **extra: Any) -> HTTPException:
    return api_error(422, message, code, **extra)
