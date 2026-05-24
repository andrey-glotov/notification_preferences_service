import { and, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Client } from 'pg';
import { channels, globalPolicies, notificationTypes } from '../../drizzle/schema';
import { seedBase } from './base.seed';

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error('DATABASE_URL is required to run database seed');
  }

  const client = new Client({ connectionString });
  await client.connect();

  const db = drizzle(client);

  try {
    await seedBase(db);

    await db.transaction(async (tx) => {
      const [marketingType] = await tx
        .select({ id: notificationTypes.id })
        .from(notificationTypes)
        .where(eq(notificationTypes.code, 'marketing'))
        .limit(1);

      const [smsChannel] = await tx
        .select({ id: channels.id })
        .from(channels)
        .where(eq(channels.code, 'sms'))
        .limit(1);

      if (!marketingType || !smsChannel) {
        throw new Error('Missing required base seed data for test global policy');
      }

      const [existingPolicy] = await tx
        .select({ id: globalPolicies.id })
        .from(globalPolicies)
        .where(
          and(
            eq(globalPolicies.notificationTypeId, marketingType.id),
            eq(globalPolicies.channelId, smsChannel.id),
            eq(globalPolicies.region, 'EU'),
            eq(globalPolicies.effect, 'deny'),
            eq(globalPolicies.reason, 'blocked_by_global_policy'),
            eq(globalPolicies.priority, 100),
          ),
        )
        .limit(1);

      if (existingPolicy) {
        await tx
          .update(globalPolicies)
          .set({ updatedAt: sql`now()` })
          .where(eq(globalPolicies.id, existingPolicy.id));

        return;
      }

      await tx.insert(globalPolicies).values({
        notificationTypeId: marketingType.id,
        channelId: smsChannel.id,
        region: 'EU',
        effect: 'deny',
        reason: 'blocked_by_global_policy',
        priority: 100,
      });
    });
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
