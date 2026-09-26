import type { RepoProfile } from "@smc/contracts";
import { isCode, isLock, uniq, type Ctx } from "./fs.js";
import type { Manifest } from "./manifests.js";
import type { ComposeService } from "./infra.js";

type Store = RepoProfile["datastores"][number];

const DEPS: [Store, RegExp][] = [
  ["postgres", /^(pg|pg-promise|postgres|psycopg2?(-binary)?|psycopg|asyncpg|pgvector|postgresql|org\.postgresql)$/],
  ["mysql", /^(mysql2?|pymysql|mysqlclient|mysql-connector-j|mariadb)$/],
  ["mongodb", /^(mongodb|mongoose|pymongo|motor|mongodb-driver-sync)$/],
  ["redis", /^(redis|ioredis|aioredis|spring-boot-starter-data-redis|@redis\/client)$/],
  ["sqlite", /^(sqlite3|better-sqlite3|aiosqlite|sqlite-jdbc)$/],
  ["s3", /^(@aws-sdk\/client-s3|aws-sdk-s3|minio)$/],
  ["kafka", /^(kafkajs|confluent-kafka|kafka-python|spring-kafka|aiokafka)$/],
  ["rabbitmq", /^(amqplib|pika|aio-pika|spring-boot-starter-amqp)$/],
  ["elasticsearch", /^(@elastic\/elasticsearch|elasticsearch|elasticsearch-java)$/],
];
const ENV: [Store, RegExp][] = [
  ["postgres", /^(POSTGRES|PG(HOST|USER|DATABASE|PASSWORD))/],
  ["mysql", /^(MYSQL|MARIADB)/],
  ["mongodb", /^MONGO/],
  ["redis", /^REDIS/],
  ["kafka", /^KAFKA/],
  ["rabbitmq", /^(RABBIT|AMQP)/],
  ["elasticsearch", /^(ELASTIC|OPENSEARCH)/],
  ["s3", /^(S3_|AWS_S3)/],
];
const IMAGE: [Store, RegExp][] = [
  ["postgres", /postgres|pgvector/],
  ["mysql", /mysql|mariadb/],
  ["mongodb", /mongo/],
  ["redis", /redis|valkey/],
  ["kafka", /kafka|redpanda/],
  ["rabbitmq", /rabbitmq/],
  ["elasticsearch", /elasticsearch|opensearch/],
  ["s3", /minio|localstack/],
];

export function detectDatastores(ctx: Ctx, manifests: Manifest[], compose: ComposeService[], envNames: { name: string; file: string }[]): Store[] {
  const found = new Set<Store>();
  const hit = (s: Store, rule: string, file: string, detail: string) => {
    found.add(s);
    ctx.emit(rule, file, `${s}:${detail}`);
  };
  for (const m of manifests) for (const d of m.deps) for (const [s, re] of DEPS) if (re.test(d)) hit(s, "datastore-dep", m.files[0]!, d);
  for (const e of envNames) for (const [s, re] of ENV) if (re.test(e.name)) hit(s, "datastore-env", e.file, e.name);
  for (const c of compose) for (const [s, re] of IMAGE) if (c.image && re.test(c.image)) hit(s, "datastore-compose", c.file, c.image);
  for (const f of ctx.files) {
    if (!isCode(f) && !f.endsWith(".properties")) continue;
    const t = ctx.read(f);
    if (/^jdbc:postgresql|jdbc:postgresql:/m.test(t) || /postgres(ql)?:\/\//.test(t)) hit("postgres", "datastore-uri", f, "postgres");
    if (/redis:\/\//.test(t)) hit("redis", "datastore-uri", f, "redis");
    if (/mongodb(\+srv)?:\/\//.test(t)) hit("mongodb", "datastore-uri", f, "mongodb");
  }
  return uniq([...found]);
}

export { isLock };
