import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type * as schema from "./schema.ts";

/** Driver-agnostic database handle: node-postgres locally, Neon WebSocket Pool on Workers. */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
/** The handle inside db.transaction(); same query API. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbOrTx = Db | Tx;
