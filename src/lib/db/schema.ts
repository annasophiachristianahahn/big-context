import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  real,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().default("Default User"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const chats = pgTable(
  "chats",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull().default("New Chat"),
    model: text("model").notNull().default("anthropic/claude-sonnet-4.6"),
    systemPrompt: text("system_prompt"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [index("chats_user_id_idx").on(table.userId)]
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chatId: uuid("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    role: text("role").notNull(), // "user" | "assistant" | "system"
    content: text("content").notNull(),
    summary: text("summary"), // condensed version of large outputs
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [index("messages_chat_id_idx").on(table.chatId)]
);

export const apiCalls = pgTable(
  "api_calls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chatId: uuid("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    messageId: uuid("message_id").references(() => messages.id, {
      onDelete: "set null",
    }),
    model: text("model").notNull(),
    promptTokens: integer("prompt_tokens").notNull().default(0),
    completionTokens: integer("completion_tokens").notNull().default(0),
    totalTokens: integer("total_tokens").notNull().default(0),
    cost: real("cost").notNull().default(0),
    costBreakdown: jsonb("cost_breakdown"), // { inputCost, cacheReadCost, cacheCreationCost, outputCost }
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("api_calls_chat_id_idx").on(table.chatId),
    index("api_calls_message_id_idx").on(table.messageId),
  ]
);

export const chunkJobs = pgTable(
  "chunk_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chatId: uuid("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("pending"), // pending | processing | completed | failed
    totalChunks: integer("total_chunks").notNull().default(0),
    completedChunks: integer("completed_chunks").notNull().default(0),
    instruction: text("instruction").notNull(),
    model: text("model").notNull(),
    stitchedOutput: text("stitched_output"),
    enableStitchPass: integer("enable_stitch_pass").notNull().default(0), // 0 or 1
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [index("chunk_jobs_chat_id_idx").on(table.chatId)]
);

export const chunks = pgTable(
  "chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chunkJobId: uuid("chunk_job_id")
      .notNull()
      .references(() => chunkJobs.id, { onDelete: "cascade" }),
    index: integer("index").notNull(),
    inputText: text("input_text").notNull(),
    outputText: text("output_text"),
    status: text("status").notNull().default("pending"), // pending | processing | completed | failed
    error: text("error"),
    tokens: integer("tokens").notNull().default(0),
    cost: real("cost").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [index("chunks_chunk_job_id_idx").on(table.chunkJobId)]
);

// Relations
export const usersRelations = relations(users, ({ many }) => ({
  chats: many(chats),
}));

export const chatsRelations = relations(chats, ({ one, many }) => ({
  user: one(users, { fields: [chats.userId], references: [users.id] }),
  messages: many(messages),
  apiCalls: many(apiCalls),
  chunkJobs: many(chunkJobs),
}));

export const messagesRelations = relations(messages, ({ one, many }) => ({
  chat: one(chats, { fields: [messages.chatId], references: [chats.id] }),
  apiCalls: many(apiCalls),
}));

export const apiCallsRelations = relations(apiCalls, ({ one }) => ({
  chat: one(chats, { fields: [apiCalls.chatId], references: [chats.id] }),
  message: one(messages, {
    fields: [apiCalls.messageId],
    references: [messages.id],
  }),
}));

export const chunkJobsRelations = relations(chunkJobs, ({ one, many }) => ({
  chat: one(chats, { fields: [chunkJobs.chatId], references: [chats.id] }),
  chunks: many(chunks),
}));

export const chunksRelations = relations(chunks, ({ one }) => ({
  chunkJob: one(chunkJobs, {
    fields: [chunks.chunkJobId],
    references: [chunkJobs.id],
  }),
}));
