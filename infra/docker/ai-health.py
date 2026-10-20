"""Probe private authentication and request validation without invoking a model."""

import os
import sys
import urllib.error
import urllib.request

token = os.getenv("PYTHON_AI_TOKEN", "")
if len(token) < 32:
    sys.exit(1)
request = urllib.request.Request(
    "http://127.0.0.1:8000/internal/v1/text-to-sql",
    data=b"{}",
    headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"},
)
try:
    urllib.request.urlopen(request, timeout=3).close()
except urllib.error.HTTPError as error:
    sys.exit(0 if error.code == 422 else 1)
except (urllib.error.URLError, TimeoutError):
    sys.exit(1)
sys.exit(1)
