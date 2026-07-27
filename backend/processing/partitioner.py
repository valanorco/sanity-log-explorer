from urllib.parse import urlparse


def extract_domain(url: str | None) -> str:
    if not url:
        return "unknown"
    try:
        host = urlparse(url).netloc
        return host or "unknown"
    except Exception:
        return "unknown"


def extract_endpoint(url: str | None) -> str:
    if not url:
        return "/unknown"
    try:
        path = urlparse(url).path
        return path or "/"
    except Exception:
        return "/unknown"


def normalize_request_label(method: str | None, explicit_request: str | None) -> str:
    if explicit_request:
        return explicit_request.strip()[:200]
    if method:
        return method.upper()
    return "UNKNOWN"
