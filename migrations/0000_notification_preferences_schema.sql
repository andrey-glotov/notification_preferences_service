CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS "users" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "ecosystem_code" varchar(64) NOT NULL,
  "external_user_id" varchar(128) NOT NULL,
  "region" varchar(32),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "users_external_identity_uniq" UNIQUE ("ecosystem_code", "external_user_id")
);

CREATE TABLE IF NOT EXISTS "notification_types" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "code" varchar(64) NOT NULL,
  "name" varchar(128) NOT NULL,
  "description" text,
  "respects_quiet_hours" boolean NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "notification_types_code_uniq" UNIQUE ("code")
);

CREATE TABLE IF NOT EXISTS "channels" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "code" varchar(64) NOT NULL,
  "name" varchar(128) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "channels_code_uniq" UNIQUE ("code")
);

CREATE TABLE IF NOT EXISTS "default_preferences" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "notification_type_id" uuid NOT NULL,
  "channel_id" uuid NOT NULL,
  "allowed" boolean NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "default_preferences_type_channel_uniq" UNIQUE ("notification_type_id", "channel_id")
);

CREATE TABLE IF NOT EXISTS "user_preferences" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "notification_type_id" uuid NOT NULL,
  "channel_id" uuid NOT NULL,
  "allowed" boolean NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "user_preferences_user_type_channel_uniq" UNIQUE ("user_id", "notification_type_id", "channel_id")
);

CREATE TABLE IF NOT EXISTS "quiet_hours" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "start_time" time NOT NULL,
  "end_time" time NOT NULL,
  "timezone" varchar(64) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "quiet_hours_user_id_uniq" UNIQUE ("user_id"),
  CONSTRAINT "quiet_hours_start_end_not_equal_chk" CHECK ("start_time" <> "end_time")
);

CREATE TABLE IF NOT EXISTS "global_policies" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "notification_type_id" uuid,
  "channel_id" uuid,
  "region" varchar(32),
  "effect" varchar(16) NOT NULL,
  "reason" text NOT NULL,
  "priority" integer NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "global_policies_effect_chk" CHECK ("effect" in ('allow', 'deny')),
  CONSTRAINT "global_policies_priority_non_negative_chk" CHECK ("priority" >= 0),
  CONSTRAINT "global_policies_at_least_one_selector_chk" CHECK (
    "notification_type_id" is not null or "channel_id" is not null or "region" is not null
  )
);

DO $$ BEGIN
  ALTER TABLE "default_preferences"
    ADD CONSTRAINT "default_preferences_notification_type_id_notification_types_id_fk"
    FOREIGN KEY ("notification_type_id") REFERENCES "notification_types"("id");
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "default_preferences"
    ADD CONSTRAINT "default_preferences_channel_id_channels_id_fk"
    FOREIGN KEY ("channel_id") REFERENCES "channels"("id");
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "user_preferences"
    ADD CONSTRAINT "user_preferences_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id");
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "user_preferences"
    ADD CONSTRAINT "user_preferences_notification_type_id_notification_types_id_fk"
    FOREIGN KEY ("notification_type_id") REFERENCES "notification_types"("id");
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "user_preferences"
    ADD CONSTRAINT "user_preferences_channel_id_channels_id_fk"
    FOREIGN KEY ("channel_id") REFERENCES "channels"("id");
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "quiet_hours"
    ADD CONSTRAINT "quiet_hours_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id");
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "global_policies"
    ADD CONSTRAINT "global_policies_notification_type_id_notification_types_id_fk"
    FOREIGN KEY ("notification_type_id") REFERENCES "notification_types"("id");
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "global_policies"
    ADD CONSTRAINT "global_policies_channel_id_channels_id_fk"
    FOREIGN KEY ("channel_id") REFERENCES "channels"("id");
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "users_external_identity_idx" ON "users" ("ecosystem_code", "external_user_id");
CREATE INDEX IF NOT EXISTS "users_region_idx" ON "users" ("region");
CREATE INDEX IF NOT EXISTS "user_preferences_user_id_idx" ON "user_preferences" ("user_id");
CREATE INDEX IF NOT EXISTS "user_preferences_lookup_idx" ON "user_preferences" ("user_id", "notification_type_id", "channel_id");
CREATE INDEX IF NOT EXISTS "quiet_hours_user_id_idx" ON "quiet_hours" ("user_id");
CREATE INDEX IF NOT EXISTS "global_policies_lookup_idx" ON "global_policies" ("notification_type_id", "channel_id", "region");
CREATE INDEX IF NOT EXISTS "global_policies_priority_idx" ON "global_policies" ("priority" DESC);
