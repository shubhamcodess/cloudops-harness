import amqp from "amqplib";

const conn = await amqp.connect(process.env.AMQP_URL);
await conn.createChannel();
