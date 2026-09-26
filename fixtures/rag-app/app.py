import os
import chromadb
from fastapi import FastAPI
from openai import OpenAI

app = FastAPI()
llm = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
store = chromadb.PersistentClient(path="./chroma").get_or_create_collection("docs")


@app.get("/ask")
def ask(q: str):
    hits = store.query(query_texts=[q], n_results=3)
    return {"context": hits["documents"]}
