const express = require("express");
const cookieParser = require("cookie-parser");
const { Analytics } = require("@segment/analytics-node");

const app = express();
app.use(cookieParser());
const analytics = new Analytics({ writeKey: "dummy-write-key" });

const AWS_KEY = "AKIAIOSFODNN7EXAMPLE";
const STRIPE = "sk_test_EXAMPLEEXAMPLEEXAMPLE00";

app.post("/signup", (req, res) => {
  const { email, phone } = req.body;
  const ip = req.headers["x-forwarded-for"] || req.ip;
  res.cookie("session_id", "abc", { httpOnly: true });
  analytics.identify({ userId: email, traits: { phone, ip } });
  res.sendStatus(201);
});

app.listen(process.env.PORT || 8080);
