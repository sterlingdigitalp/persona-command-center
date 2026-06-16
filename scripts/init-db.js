import { dbPath, initDb } from "../src/db.js";

await initDb();
console.log(`SQLite database initialized at ${dbPath}`);
