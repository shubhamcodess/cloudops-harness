import express from "express";
import { Pool } from "pg";

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const port = Number(process.env.PORT ?? 3000);

app.get("/health", (_req, res) => res.json({ ok: true }));
app.get("/items", async (_req, res) => res.json((await pool.query("select 1")).rows));

app.listen(port);
