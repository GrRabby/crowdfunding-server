import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as dotenv from "dotenv";
import * as schema from "./schema";

dotenv.config();

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("❌ DATABASE_URL is not defined in environment variables!");
}

// 1. Neon HTTP SQL query client
const sql = neon(connectionString);

// 2. Drizzle ORM instance with Schema registered
export const db = drizzle(sql, { schema });
export { sql };
