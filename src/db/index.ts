import * as dotenv from "dotenv";
import { neonConfig, Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import ws from "ws";
import * as schema from "./schema";

dotenv.config();

// Node.js does not have a native WebSocket — provide the ws package
// This enables the neon-serverless driver to hold a persistent connection,
// which is required for db.transaction() to work
neonConfig.webSocketConstructor = ws;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not defined in environment variables!");
}

// Pool = persistent TCP connection to Neon (supports transactions)
const pool = new Pool({ connectionString });

export const db = drizzle(pool, { schema });
export { pool };
