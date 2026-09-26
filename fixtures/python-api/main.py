import os
import redis
from fastapi import FastAPI

app = FastAPI()
cache = redis.Redis.from_url(os.environ["REDIS_URL"])


@app.get("/health")
def health():
    return {"ok": True}
