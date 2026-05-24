import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../drizzle/schema';

export type Database = NodePgDatabase<typeof schema>;
