from fastapi.security import APIKeyHeader

# Header extractor used by verify_erp_api_key in api/dependencies.py
API_KEY_HEADER = APIKeyHeader(name="X-API-Key", auto_error=False)
