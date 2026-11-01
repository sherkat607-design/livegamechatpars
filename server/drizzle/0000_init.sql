CREATE TABLE "attachments" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "attachments_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"message_id" integer NOT NULL,
	"filename" text NOT NULL,
	"url" text NOT NULL,
	"content_type" text NOT NULL,
	"size" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_logs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"server_id" integer NOT NULL,
	"actor_id" integer,
	"action" text NOT NULL,
	"target_id" integer,
	"target_type" text,
	"reason" text DEFAULT '' NOT NULL,
	"details" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bans" (
	"server_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"moderator_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bans_server_id_user_id_pk" PRIMARY KEY("server_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "channel_recipients" (
	"channel_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	CONSTRAINT "channel_recipients_channel_id_user_id_pk" PRIMARY KEY("channel_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "channels" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "channels_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"server_id" integer,
	"type" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"topic" text DEFAULT '' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"parent_id" integer,
	"slowmode" integer DEFAULT 0 NOT NULL,
	"owner_id" integer,
	"icon" text,
	"last_message_id" integer,
	"archived" boolean DEFAULT false NOT NULL,
	"starter_message_id" integer,
	"dm_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "emojis" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "emojis_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"server_id" integer NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"animated" boolean DEFAULT false NOT NULL,
	"creator_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invites" (
	"code" text PRIMARY KEY NOT NULL,
	"server_id" integer NOT NULL,
	"channel_id" integer,
	"inviter_id" integer,
	"max_uses" integer DEFAULT 0 NOT NULL,
	"uses" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member_roles" (
	"server_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"role_id" integer NOT NULL,
	CONSTRAINT "member_roles_server_id_user_id_role_id_pk" PRIMARY KEY("server_id","user_id","role_id")
);
--> statement-breakpoint
CREATE TABLE "members" (
	"server_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"nickname" text,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"timeout_until" timestamp with time zone,
	"notify_level" text DEFAULT 'all' NOT NULL,
	"muted" boolean DEFAULT false NOT NULL,
	CONSTRAINT "members_server_id_user_id_pk" PRIMARY KEY("server_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "messages_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"channel_id" integer NOT NULL,
	"author_id" integer,
	"webhook_id" integer,
	"webhook_name" text,
	"webhook_avatar" text,
	"type" text DEFAULT 'default' NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"reply_to_id" integer,
	"thread_id" integer,
	"edited_at" timestamp with time zone,
	"pinned" boolean DEFAULT false NOT NULL,
	"mention_everyone" boolean DEFAULT false NOT NULL,
	"mentions" integer[] DEFAULT '{}'::integer[] NOT NULL,
	"mention_roles" integer[] DEFAULT '{}'::integer[] NOT NULL,
	"poll" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "permission_overwrites" (
	"channel_id" integer NOT NULL,
	"target_type" text NOT NULL,
	"target_id" integer NOT NULL,
	"allow" integer DEFAULT 0 NOT NULL,
	"deny" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "permission_overwrites_channel_id_target_type_target_id_pk" PRIMARY KEY("channel_id","target_type","target_id")
);
--> statement-breakpoint
CREATE TABLE "poll_votes" (
	"message_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"option" integer NOT NULL,
	CONSTRAINT "poll_votes_message_id_user_id_option_pk" PRIMARY KEY("message_id","user_id","option")
);
--> statement-breakpoint
CREATE TABLE "reactions" (
	"message_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"emoji" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reactions_message_id_user_id_emoji_pk" PRIMARY KEY("message_id","user_id","emoji")
);
--> statement-breakpoint
CREATE TABLE "read_states" (
	"user_id" integer NOT NULL,
	"channel_id" integer NOT NULL,
	"last_read_id" integer DEFAULT 0 NOT NULL,
	"mention_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "read_states_user_id_channel_id_pk" PRIMARY KEY("user_id","channel_id")
);
--> statement-breakpoint
CREATE TABLE "relationships" (
	"user_id" integer NOT NULL,
	"target_id" integer NOT NULL,
	"type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "relationships_user_id_target_id_pk" PRIMARY KEY("user_id","target_id")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "roles_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"server_id" integer NOT NULL,
	"name" text NOT NULL,
	"color" text,
	"position" integer DEFAULT 0 NOT NULL,
	"permissions" integer DEFAULT 0 NOT NULL,
	"hoist" boolean DEFAULT false NOT NULL,
	"mentionable" boolean DEFAULT false NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "servers" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "servers_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"icon" text,
	"description" text DEFAULT '' NOT NULL,
	"owner_id" integer NOT NULL,
	"is_public" boolean DEFAULT false NOT NULL,
	"system_channel_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "users_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"username" text NOT NULL,
	"display_name" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"token_version" integer DEFAULT 0 NOT NULL,
	"avatar" text,
	"banner_color" text,
	"bio" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'online' NOT NULL,
	"custom_status" text DEFAULT '' NOT NULL,
	"activity" text DEFAULT '' NOT NULL,
	"locale" text DEFAULT 'fa' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhooks" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "webhooks_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"server_id" integer NOT NULL,
	"channel_id" integer NOT NULL,
	"name" text NOT NULL,
	"avatar" text,
	"token" text NOT NULL,
	"creator_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bans" ADD CONSTRAINT "bans_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bans" ADD CONSTRAINT "bans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bans" ADD CONSTRAINT "bans_moderator_id_users_id_fk" FOREIGN KEY ("moderator_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_recipients" ADD CONSTRAINT "channel_recipients_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_recipients" ADD CONSTRAINT "channel_recipients_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emojis" ADD CONSTRAINT "emojis_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emojis" ADD CONSTRAINT "emojis_creator_id_users_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_inviter_id_users_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_roles" ADD CONSTRAINT "member_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_roles" ADD CONSTRAINT "member_roles_server_id_user_id_members_server_id_user_id_fk" FOREIGN KEY ("server_id","user_id") REFERENCES "public"."members"("server_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_webhook_id_webhooks_id_fk" FOREIGN KEY ("webhook_id") REFERENCES "public"."webhooks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permission_overwrites" ADD CONSTRAINT "permission_overwrites_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "poll_votes" ADD CONSTRAINT "poll_votes_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "poll_votes" ADD CONSTRAINT "poll_votes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reactions" ADD CONSTRAINT "reactions_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reactions" ADD CONSTRAINT "reactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "read_states" ADD CONSTRAINT "read_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "read_states" ADD CONSTRAINT "read_states_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationships" ADD CONSTRAINT "relationships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationships" ADD CONSTRAINT "relationships_target_id_users_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "servers" ADD CONSTRAINT "servers_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_creator_id_users_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attachments_message_idx" ON "attachments" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "audit_server_idx" ON "audit_logs" USING btree ("server_id","id");--> statement-breakpoint
CREATE INDEX "recipients_user_idx" ON "channel_recipients" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "channels_server_idx" ON "channels" USING btree ("server_id");--> statement-breakpoint
CREATE UNIQUE INDEX "channels_dm_key_uq" ON "channels" USING btree ("dm_key");--> statement-breakpoint
CREATE UNIQUE INDEX "emojis_server_name_uq" ON "emojis" USING btree ("server_id","name");--> statement-breakpoint
CREATE INDEX "invites_server_idx" ON "invites" USING btree ("server_id");--> statement-breakpoint
CREATE INDEX "members_user_idx" ON "members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "messages_channel_idx" ON "messages" USING btree ("channel_id","id");--> statement-breakpoint
CREATE INDEX "messages_author_idx" ON "messages" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "relationships_target_idx" ON "relationships" USING btree ("target_id");--> statement-breakpoint
CREATE INDEX "roles_server_idx" ON "roles" USING btree ("server_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_uq" ON "users" USING btree ("username");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "webhooks_server_idx" ON "webhooks" USING btree ("server_id");