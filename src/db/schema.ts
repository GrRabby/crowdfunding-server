import { pgTable, serial, text, varchar, integer, timestamp, boolean, pgEnum, index } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";


// 1. ENUMS (PostgreSQL native enum types)

export const userRoleEnum = pgEnum("user_role", ["supporter", "creator", "admin"]);
export const campaignStatusEnum = pgEnum("campaign_status", ["pending", "approved", "rejected"]);
export const contributionStatusEnum = pgEnum("contribution_status", ["pending", "approved", "rejected"]);
export const withdrawalStatusEnum = pgEnum("withdrawal_status", ["pending", "approved", "rejected"]);
export const reportStatusEnum = pgEnum("report_status", ["pending", "reviewed", "dismissed"]);


// 2. USERS TABLE

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  passwordHash: text("password_hash"), // Nullable to support Google OAuth
  photoUrl: text("photo_url"),
  role: userRoleEnum("role").notNull().default("supporter"),
  credits: integer("credits").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});


// 3. CAMPAIGNS TABLE

export const campaigns = pgTable(
  "campaigns",
  {
    id: serial("id").primaryKey(),
    creatorId: integer("creator_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 255 }).notNull(),
    story: text("story").notNull(),
    category: varchar("category", { length: 100 }).notNull(),
    fundingGoal: integer("funding_goal").notNull(),
    minContribution: integer("min_contribution").notNull().default(1),
    deadline: timestamp("deadline").notNull(),
    rewardInfo: text("reward_info"),
    imageUrl: text("image_url").notNull(),
    amountRaised: integer("amount_raised").notNull().default(0),
    status: campaignStatusEnum("status").notNull().default("pending"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("campaigns_status_idx").on(table.status),
    index("campaigns_category_idx").on(table.category),
    index("campaigns_creator_idx").on(table.creatorId),
  ]
);


// 4. CONTRIBUTIONS TABLE

export const contributions = pgTable(
  "contributions",
  {
    id: serial("id").primaryKey(),
    campaignId: integer("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    supporterId: integer("supporter_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    amount: integer("amount").notNull(),
    status: contributionStatusEnum("status").notNull().default("pending"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("contributions_campaign_idx").on(table.campaignId),
    index("contributions_supporter_idx").on(table.supporterId),
  ]
);


// 5. WITHDRAWALS TABLE

export const withdrawals = pgTable(
  "withdrawals",
  {
    id: serial("id").primaryKey(),
    creatorId: integer("creator_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    credits: integer("credits").notNull(),
    amount: integer("amount").notNull(),
    paymentSystem: varchar("payment_system", { length: 50 }).notNull(),
    accountNumber: varchar("account_number", { length: 100 }).notNull(),
    status: withdrawalStatusEnum("status").notNull().default("pending"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("withdrawals_creator_idx").on(table.creatorId),
  ]
);


// 6. PAYMENTS TABLE (Stripe Credit Purchases)

export const payments = pgTable(
  "payments",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    creditsPurchased: integer("credits_purchased").notNull(),
    amountPaid: integer("amount_paid").notNull(),
    stripeRef: varchar("stripe_ref", { length: 255 }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("payments_user_idx").on(table.userId),
  ]
);


// 7. NOTIFICATIONS TABLE

export const notifications = pgTable(
  "notifications",
  {
    id: serial("id").primaryKey(),
    toUserId: integer("to_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    message: text("message").notNull(),
    actionRoute: varchar("action_route", { length: 255 }),
    isRead: boolean("is_read").notNull().default(false),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("notifications_user_read_idx").on(table.toUserId, table.isRead),
  ]
);


// 8. REPORTS TABLE
export const reports = pgTable(
  "reports",
  {
    id: serial("id").primaryKey(),
    campaignId: integer("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    reporterId: integer("reporter_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    reason: text("reason").notNull(),
    status: reportStatusEnum("status").notNull().default("pending"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("reports_campaign_idx").on(table.campaignId),
  ]
);

// 9. DRIZZLE RELATIONS (Two-Way Navigation)
export const usersRelations = relations(users, ({ many }) => ({
  campaigns: many(campaigns),
  contributions: many(contributions),
  withdrawals: many(withdrawals),
  payments: many(payments),
  notifications: many(notifications),
  reports: many(reports),
}));

export const campaignsRelations = relations(campaigns, ({ one, many }) => ({
  creator: one(users, {
    fields: [campaigns.creatorId],
    references: [users.id],
  }),
  contributions: many(contributions),
  reports: many(reports),
}));

export const contributionsRelations = relations(contributions, ({ one }) => ({
  campaign: one(campaigns, {
    fields: [contributions.campaignId],
    references: [campaigns.id],
  }),
  supporter: one(users, {
    fields: [contributions.supporterId],
    references: [users.id],
  }),
}));

export const withdrawalsRelations = relations(withdrawals, ({ one }) => ({
  creator: one(users, {
    fields: [withdrawals.creatorId],
    references: [users.id],
  }),
}));

export const paymentsRelations = relations(payments, ({ one }) => ({
  user: one(users, {
    fields: [payments.userId],
    references: [users.id],
  }),
}));

export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(users, {
    fields: [notifications.toUserId],
    references: [users.id],
  }),
}));

export const reportsRelations = relations(reports, ({ one }) => ({
  campaign: one(campaigns, {
    fields: [reports.campaignId],
    references: [campaigns.id],
  }),
  reporter: one(users, {
    fields: [reports.reporterId],
    references: [users.id],
  }),
}));

// 10. INFERRED TYPES
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export type Campaign = typeof campaigns.$inferSelect;
export type NewCampaign = typeof campaigns.$inferInsert;

export type Contribution = typeof contributions.$inferSelect;
export type NewContribution = typeof contributions.$inferInsert;

export type Withdrawal = typeof withdrawals.$inferSelect;
export type NewWithdrawal = typeof withdrawals.$inferInsert;

export type Payment = typeof payments.$inferSelect;
export type NewPayment = typeof payments.$inferInsert;

export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;

export type Report = typeof reports.$inferSelect;
export type NewReport = typeof reports.$inferInsert;
