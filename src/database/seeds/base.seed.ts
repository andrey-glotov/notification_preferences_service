import { eq, sql } from 'drizzle-orm';
import { NodePgDatabase, drizzle } from 'drizzle-orm/node-postgres';
import { Client } from 'pg';
import {
  channels,
  defaultPreferences,
  notificationTypes,
} from '../../drizzle/schema';

type SeedDb = NodePgDatabase<Record<string, unknown>>;

type NotificationTypeSeed = {
  code: string;
  name: string;
  description: string;
  respectsQuietHours: boolean;
};

type ChannelSeed = {
  code: string;
  name: string;
};

type DefaultPreferenceSeed = {
  notificationTypeCode: string;
  channelCode: string;
  allowed: boolean;
};

const notificationTypeSeeds: NotificationTypeSeed[] = [
  {
    code: 'marketing',
    name: 'Marketing',
    description: 'Marketing and promotional notifications.',
    respectsQuietHours: true,
  },
  {
    code: 'transactional',
    name: 'Transactional',
    description: 'Transactional notifications related to user actions.',
    respectsQuietHours: false,
  },
  {
    code: 'security',
    name: 'Security',
    description: 'Security and account protection notifications.',
    respectsQuietHours: false,
  },
  {
    code: 'order_status',
    name: 'Order status',
    description: 'Order status and delivery notifications.',
    respectsQuietHours: false,
  },
];

const channelSeeds: ChannelSeed[] = [
  { code: 'email', name: 'Email' },
  { code: 'sms', name: 'SMS' },
  { code: 'push', name: 'Push' },
  { code: 'messenger', name: 'Messenger' },
];

const defaultPreferenceSeeds: DefaultPreferenceSeed[] = [
  { notificationTypeCode: 'transactional', channelCode: 'email', allowed: true },
  { notificationTypeCode: 'security', channelCode: 'email', allowed: true },
  { notificationTypeCode: 'order_status', channelCode: 'push', allowed: true },
  { notificationTypeCode: 'marketing', channelCode: 'email', allowed: false },
  { notificationTypeCode: 'marketing', channelCode: 'sms', allowed: false },
  { notificationTypeCode: 'marketing', channelCode: 'push', allowed: false },
];

export async function seedBase(db: SeedDb): Promise<void> {
  await db.transaction(async (tx) => {
    for (const item of notificationTypeSeeds) {
      await tx
        .insert(notificationTypes)
        .values({
          code: item.code,
          name: item.name,
          description: item.description,
          respectsQuietHours: item.respectsQuietHours,
        })
        .onConflictDoUpdate({
          target: notificationTypes.code,
          set: {
            name: item.name,
            description: item.description,
            respectsQuietHours: item.respectsQuietHours,
            updatedAt: sql`now()`,
          },
        });
    }

    for (const item of channelSeeds) {
      await tx
        .insert(channels)
        .values({ code: item.code, name: item.name })
        .onConflictDoUpdate({
          target: channels.code,
          set: {
            name: item.name,
            updatedAt: sql`now()`,
          },
        });
    }

    for (const item of defaultPreferenceSeeds) {
      const [notificationType] = await tx
        .select({ id: notificationTypes.id })
        .from(notificationTypes)
        .where(eq(notificationTypes.code, item.notificationTypeCode))
        .limit(1);

      const [channel] = await tx
        .select({ id: channels.id })
        .from(channels)
        .where(eq(channels.code, item.channelCode))
        .limit(1);

      if (!notificationType || !channel) {
        throw new Error(
          `Missing seed dictionary value for ${item.notificationTypeCode}/${item.channelCode}`,
        );
      }

      await tx
        .insert(defaultPreferences)
        .values({
          notificationTypeId: notificationType.id,
          channelId: channel.id,
          allowed: item.allowed,
        })
        .onConflictDoUpdate({
          target: [defaultPreferences.notificationTypeId, defaultPreferences.channelId],
          set: {
            allowed: item.allowed,
            updatedAt: sql`now()`,
          },
        });
    }
  });
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error('DATABASE_URL is required to run database seed');
  }

  const client = new Client({ connectionString });
  await client.connect();

  try {
    await seedBase(drizzle(client));
  } finally {
    await client.end();
  }
}

if (process.argv[1]?.endsWith('base.seed.ts') || process.argv[1]?.endsWith('base.seed.js')) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
