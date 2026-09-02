#!/usr/bin/env python
"""
Lumina MCP Server — MongoDB Atlas via MCP Protocol
=====================================================
This module implements a Model Context Protocol (MCP) server that exposes
MongoDB Atlas as a structured tool interface for Google ADK agents.

WHY CUSTOM vs. OFFICIAL:
The MongoDB official MCP package provides generic CRUD access. Lumina's
custom server adds domain-specific tools (Atlas Vector Search, reconciliation
aggregations, agent run tracking) that are critical for the financial
reconciliation workflow. Both implementations use the same MCP protocol
— the partner technology (MongoDB Atlas) remains the data superpowers provider.

This server is mounted at /mcp/sse inside the FastAPI process and communicates
via real HTTP/SSE transport, fulfilling the MongoDB partner track MCP requirement.
==========================================
Motor-backed MCP server. Runs as a stdio subprocess.
No Node.js required — pure Python.

Tools: find, aggregate, insert_one, update_one, vector_search

HTTP/SSE endpoint is protected by a shared Bearer token (SECRET_KEY).
All tool calls are restricted to an explicit collection allowlist.
"""
import asyncio
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
load_dotenv()

import motor.motor_asyncio
from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import Tool, TextContent

MONGODB_URI    = os.getenv("MONGODB_URI", "mongodb://localhost:27017")
MONGODB_DB_NAME = os.getenv("MONGODB_DB_NAME", "lumina_db")

# Only these collections may be accessed via MCP tools
_ALLOWED_COLLECTIONS = frozenset({
    "companies", "ledgers", "discrepancies", "agent_runs",
    "reconciliation_sessions", "master_balances", "file_objects",
    "erp_integrations", "company_settings", "users", "roles",
    "global_statements",
})

app = Server("ledgeriq-mongodb-mcp")
_mongo_client = None
_db = None


def get_db():
    try:
        from core.database import get_database
        db = get_database()
        if db is not None:
            return db
    except Exception:
        pass
    global _mongo_client, _db
    if _db is None:
        import certifi
        _mongo_client = motor.motor_asyncio.AsyncIOMotorClient(
            MONGODB_URI,
            tlsCAFile=certifi.where(),
        )
        _db = _mongo_client[MONGODB_DB_NAME]
    return _db


def _serialize(obj):
    if isinstance(obj, dict):
        return {k: _serialize(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_serialize(i) for i in obj]
    cls = type(obj).__name__
    if cls in ("ObjectId", "datetime", "Decimal128"):
        return str(obj)
    return obj


@app.list_tools()
async def list_tools() -> list[Tool]:
    return [
        Tool(
            name="find",
            description="Find documents in a MongoDB collection",
            inputSchema={
                "type": "object",
                "properties": {
                    "collection": {"type": "string"},
                    "filter":     {"type": "object"},
                    "limit":      {"type": "integer", "default": 500},
                },
                "required": ["collection", "filter"],
            },
        ),
        Tool(
            name="aggregate",
            description="Run an aggregation pipeline on a MongoDB collection",
            inputSchema={
                "type": "object",
                "properties": {
                    "collection": {"type": "string"},
                    "pipeline":   {"type": "array", "items": {"type": "object"}},
                },
                "required": ["collection", "pipeline"],
            },
        ),
        Tool(
            name="insert_one",
            description="Insert a document into a MongoDB collection",
            inputSchema={
                "type": "object",
                "properties": {
                    "collection": {"type": "string"},
                    "document":   {"type": "object"},
                },
                "required": ["collection", "document"],
            },
        ),
        Tool(
            name="vector_search",
            description="Semantic similarity search on discrepancies using MongoDB Atlas Vector Search",
            inputSchema={
                "type": "object",
                "properties": {
                    "query_text": {"type": "string", "description": "Natural language query to search for similar discrepancies"},
                    "limit":      {"type": "integer", "default": 5},
                    "min_score":  {"type": "number",  "default": 0.65},
                },
                "required": ["query_text"],
            },
        ),
        Tool(
            name="update_one",
            description="Update a document in a MongoDB collection",
            inputSchema={
                "type": "object",
                "properties": {
                    "collection": {"type": "string"},
                    "filter":     {"type": "object"},
                    "update":     {"type": "object"},
                    "upsert":     {"type": "boolean", "default": False},
                },
                "required": ["collection", "filter", "update"],
            },
        ),
    ]


@app.call_tool()
async def call_tool(name: str, arguments: dict) -> list[TextContent]:
    db       = get_db()
    col_name = arguments.get("collection", "")

    # Enforce collection allowlist for all collection-based tools
    if name in ("find", "aggregate", "insert_one", "update_one"):
        if col_name not in _ALLOWED_COLLECTIONS:
            return [TextContent(type="text", text=json.dumps(
                {"error": f"Collection '{col_name}' is not accessible via MCP"}
            ))]

    collection = db[col_name]

    try:
        if name == "find":
            query  = arguments.get("filter", {})
            limit  = min(int(arguments.get("limit", 500)), 1000)
            # Exclude password/key hashes from sensitive collections
            _EXCLUDED_FIELDS = {
                "users": {"password_hash": 0},
                "erp_integrations": {"key_hash": 0},
            }
            projection = _EXCLUDED_FIELDS.get(col_name)
            docs   = []
            async for doc in collection.find(query, projection).limit(limit):
                doc["_id"] = str(doc["_id"])
                docs.append(_serialize(doc))
            return [TextContent(type="text", text=json.dumps(docs))]

        elif name == "aggregate":
            pipeline = arguments.get("pipeline", [])
            results  = []
            async for doc in collection.aggregate(pipeline):
                if "_id" in doc:
                    doc["_id"] = str(doc["_id"])
                results.append(_serialize(doc))
            return [TextContent(type="text", text=json.dumps(results))]

        elif name == "insert_one":
            result = await collection.insert_one(arguments.get("document", {}))
            return [TextContent(type="text", text=json.dumps(
                {"inserted_id": str(result.inserted_id)}
            ))]

        elif name == "update_one":
            result = await collection.update_one(
                arguments.get("filter", {}),
                arguments.get("update", {}),
                upsert=arguments.get("upsert", False),
            )
            return [TextContent(type="text", text=json.dumps({
                "matched_count":  result.matched_count,
                "modified_count": result.modified_count,
                "upserted_id":    str(result.upserted_id) if result.upserted_id else None,
            }))]

        elif name == "vector_search":
            query_text = arguments.get("query_text", "")
            limit      = int(arguments.get("limit", 5))
            min_score  = float(arguments.get("min_score", 0.65))
            try:
                import google.generativeai as genai
                genai.configure(api_key=os.getenv("GEMINI_API_KEY", ""))
                result = genai.embed_content(
                    model="models/text-embedding-004",
                    content=query_text,
                    task_type="retrieval_query",
                )
                embedding = result["embedding"]
                pipeline = [
                    {
                        "$vectorSearch": {
                            "index":         "discrepancy_vector_index",
                            "path":          "embedding",
                            "queryVector":   embedding,
                            "numCandidates": limit * 10,
                            "limit":         limit,
                        }
                    },
                    {"$addFields": {"score": {"$meta": "vectorSearchScore"}}},
                    {"$match":     {"score": {"$gte": min_score}}},
                    {"$project":   {"embedding": 0}},
                ]
                results = []
                async for doc in db["discrepancies"].aggregate(pipeline):
                    if "_id" in doc:
                        doc["_id"] = str(doc["_id"])
                    results.append(_serialize(doc))
                return [TextContent(type="text", text=json.dumps(results))]
            except Exception as exc:
                return [TextContent(type="text", text=json.dumps({"error": str(exc)}))]

        else:
            return [TextContent(type="text", text=json.dumps({"error": f"Unknown tool: {name}"}))]

    except Exception as exc:
        return [TextContent(type="text", text=json.dumps({"error": str(exc)}))]


async def main():
    async with stdio_server() as (read_stream, write_stream):
        await app.run(
            read_stream,
            write_stream,
            app.create_initialization_options(),
        )


# ── HTTP/SSE Transport (FastAPI mount) ────────────────────────────────────────

def create_mcp_asgi_app():
    """
    Raw ASGI app — bypasses Starlette Route response wrapping entirely.
    Serves MCP over HTTP/SSE transport at /sse and /messages/.
    Protected by a shared Bearer token derived from SECRET_KEY.
    """
    from mcp.server.sse import SseServerTransport
    from starlette.requests import Request

    sse = SseServerTransport("/mcp/messages/")

    def _get_auth_header(scope: dict) -> str:
        for k, v in scope.get("headers", []):
            if k.lower() == b"authorization":
                return v.decode("latin-1")
        return ""

    async def _reject(send, status: int = 403, body: bytes = b"Forbidden") -> None:
        await send({"type": "http.response.start", "status": status,
                    "headers": [[b"content-type", b"text/plain"]]})
        await send({"type": "http.response.body", "body": body})

    async def handle_sse(request: Request):
        async with sse.connect_sse(
            request.scope, request.receive, request._send
        ) as streams:
            await app.run(
                streams[0], streams[1], app.create_initialization_options()
            )

    class _MCPApp:
        async def __call__(self, scope, receive, send):
            if scope["type"] != "http":
                return

            # Validate shared Bearer token (SECRET_KEY) on every HTTP request
            from core.config import settings
            auth = _get_auth_header(scope)
            if auth != f"Bearer {settings.SECRET_KEY}":
                await _reject(send, 403)
                return

            path   = scope.get("path", "")
            method = scope.get("method", "GET")

            if path.endswith("/sse") and method == "GET":
                request = Request(scope, receive, send)
                await handle_sse(request)

            elif path.rstrip("/").endswith("/messages") and method == "POST":
                await sse.handle_post_message(scope, receive, send)

            else:
                await _reject(send, 404, b"Not found")

    return _MCPApp()


if __name__ == "__main__":
    asyncio.run(main())
