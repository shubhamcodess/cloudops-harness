import express from "express";

express().get("/health", (_req, res) => res.send("ok")).listen(Number(process.env.PORT ?? 3001));
