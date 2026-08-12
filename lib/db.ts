import { PrismaClient } from "@prisma/client";

// Next.js dev mode hot-reloads modules on every save, which would create
// a fresh PrismaClient (and a fresh DB connection pool) on every reload
// without this. Stashing the instance on `globalThis` in development
// means we reuse the same client across reloads. In production, each
// serverless function instance gets exactly one client, which is what we
// want.
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const db = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}
