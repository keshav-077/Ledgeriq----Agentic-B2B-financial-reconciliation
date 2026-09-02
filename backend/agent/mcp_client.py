"""
MongoDB MCP Client
===================
Real MCP protocol over HTTP/SSE transport — connects to the MCP server
mounted at /mcp/sse on the same FastAPI process.

Falls back to in-process mode if the HTTP endpoint is not yet ready
(e.g., during startup or testing), so the system is always available.

HTTP requests are authenticated with Authorization: Bearer {SECRET_KEY}.
"""
import json
import logging
import os
from typing import Any

from core.config import settings

logger = logging.getLogger(__name__)

_MCP_BASE_URL = os.getenv("MCP_SERVER_URL", "http://localhost:8000/mcp")

# Cache probe result — only probe once per process lifetime
_http_probe_result: bool | None = None


class MCPMongoClient:
    """
    MCP client that speaks real MCP protocol over HTTP/SSE.
    Falls back to in-process tool calls if HTTP transport is unavailable.
    """

    def __init__(self):
        self.db_name = settings.MONGODB_DB_NAME
        self._use_http = False

    async def __aenter__(self):
        global _http_probe_result
        if _http_probe_result is None:
            await self._probe_http()
            _http_probe_result = self._use_http
        else:
            self._use_http = _http_probe_result
        return self

    async def __aexit__(self, *args):
        pass

    def _auth_headers(self) -> dict:
        return {"Authorization": f"Bearer {settings.SECRET_KEY}"}

    async def _probe_http(self):
        """Check if HTTP MCP endpoint is reachable (includes auth header)."""
        try:
            import httpx
            async with httpx.AsyncClient(timeout=3.0) as client:
                async with client.stream(
                    "GET", f"{_MCP_BASE_URL}/sse",
                    headers=self._auth_headers(),
                ) as resp:
                    if resp.status_code in (200, 307):
                        self._use_http = True
                        logger.info("[MCP] HTTP transport available — using real MCP protocol")
                        return
            self._use_http = False
        except Exception:
            self._use_http = False
            logger.info("[MCP] HTTP transport unavailable — using in-process fallback")

    async def _call_tool(self, tool_name: str, arguments: dict) -> Any:
        if self._use_http:
            return await self._call_tool_http(tool_name, arguments)
        return await self._call_tool_inprocess(tool_name, arguments)

    async def _call_tool_http(self, tool_name: str, arguments: dict) -> Any:
        """Real MCP protocol: POST tool call to HTTP endpoint."""
        try:
            import httpx
            payload = {
                "jsonrpc": "2.0",
                "method": "tools/call",
                "params": {"name": tool_name, "arguments": arguments},
                "id": 1,
            }
            headers = {"Content-Type": "application/json", **self._auth_headers()}
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.post(
                    f"{_MCP_BASE_URL}/messages",
                    json=payload,
                    headers=headers,
                )
                data = resp.json()
                content = data.get("result", {}).get("content", [])
                if content:
                    raw = content[0].get("text", "[]")
                    result = json.loads(raw)
                    if isinstance(result, dict) and "error" in result:
                        raise RuntimeError(f"MCP tool error: {result['error']}")
                    return result
        except Exception as e:
            logger.warning(f"[MCP] HTTP call failed for {tool_name}, falling back: {e}")
            return await self._call_tool_inprocess(tool_name, arguments)
        return []

    async def _call_tool_inprocess(self, tool_name: str, arguments: dict) -> Any:
        """In-process fallback — same MCP tool handler, no subprocess."""
        from agent import mcp_server
        logger.info(f"[MCP:inprocess] tool_call → {tool_name}  col={arguments.get('collection', '')}")
        content_list = await mcp_server.call_tool(tool_name, arguments)
        if content_list:
            raw = getattr(content_list[0], "text", "[]")
            try:
                result = json.loads(raw)
                if isinstance(result, dict) and "error" in result:
                    raise RuntimeError(f"MCP tool error: {result['error']}")
                return result
            except json.JSONDecodeError:
                return []
        return []

    async def get_ledgers_for_pair(self, company_a_id: str, company_b_id: str) -> dict:
        logger.info(f"[MCP] Fetching ledger pair: {company_a_id} ↔ {company_b_id}")

        a_ledgers = await self._call_tool("find", {
            "collection": "ledgers",
            "filter":     {"company_id": company_a_id, "counterparty_id": company_b_id},
            "limit":      500,
        })
        b_ledgers = await self._call_tool("find", {
            "collection": "ledgers",
            "filter":     {"company_id": company_b_id, "counterparty_id": company_a_id},
            "limit":      500,
        })

        if not isinstance(a_ledgers, list): a_ledgers = []
        if not isinstance(b_ledgers, list): b_ledgers = []

        logger.info(f"[MCP] ✓ A={len(a_ledgers)} B={len(b_ledgers)} records")
        return {"company_a_ledgers": a_ledgers, "company_b_ledgers": b_ledgers}

    async def aggregate(self, collection: str, pipeline: list) -> list:
        result = await self._call_tool("aggregate", {
            "collection": collection,
            "pipeline":   pipeline,
        })
        return result if isinstance(result, list) else []
