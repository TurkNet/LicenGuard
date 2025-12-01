import uvicorn
import logging
import logging.config
import copy
from uvicorn.config import LOGGING_CONFIG
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .views.library_view import router as library_router
from .views.repository_scan_view import router as repository_scan_router
from dotenv import load_dotenv
import os
from pathlib import Path


# .env'yi api klasöründen yükle
BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")

def create_app() -> FastAPI:
    log_config = copy.deepcopy(LOGGING_CONFIG)
    log_fmt = '%(asctime)s %(levelname)s %(message)s'
    log_config['formatters']['default']['fmt'] = log_fmt
    log_config['formatters']['access']['fmt'] = '%(asctime)s %(levelname)s %(client_addr)s - "%(request_line)s" %(status_code)s'
    logging.config.dictConfig(log_config)

    app = FastAPI(title='LicenGuard API', version='0.1.0')
    app.add_middleware(
        CORSMiddleware,
        allow_origins=['*'],
        allow_methods=['*'],
        allow_headers=['*']
    )

    @app.get('/health')
    async def health():
        return {'status': 'ok'}

    app.include_router(library_router)
    app.include_router(repository_scan_router)
    return app


app = create_app()


if __name__ == '__main__':
    uvicorn.run('app.main:app', reload=True)
