import os
import tempfile

# A real file, not ":memory:", so background threads get their own connections as in production.
_DB = os.path.join(tempfile.mkdtemp(prefix="vdc-test-"), "test.db")
os.environ["VDC_DATABASE_URL"] = f"sqlite:///{_DB}"
os.environ.pop("VDC_API_KEY", None)

import pytest
from fastapi.testclient import TestClient

from app.db import Base, engine
from app.main import app


@pytest.fixture()
def client():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    with TestClient(app) as c:
        yield c
