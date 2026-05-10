import session from "express-session";
import connectPgSimple from "connect-pg-simple";

if (!process.env.SESSION_SECRET) {
  throw new Error("SESSION_SECRET must be set");
}

const dbUrl = process.env.NEON_DATABASE_URL ?? process.env.SUPABASE_DATABASE_URL ?? process.env.DATABASE_URL;

let store: session.Store | undefined;
if (dbUrl && process.env.NODE_ENV === "production") {
  const PgSession = connectPgSimple(session);
  store = new PgSession({
    conString: dbUrl,
    tableName: "user_sessions",
    pruneSessionInterval: 60 * 15,
  });
}

export const sessionMiddleware = session({
  store,
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  },
});

declare module "express-session" {
  interface SessionData {
    userId: string;
    discordId: string;
    username: string;
    isAdminVerified?: boolean;
    adminVerifiedAt?: number;
  }
}
