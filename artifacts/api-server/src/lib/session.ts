import session from "express-session";
import ConnectPgSimple from "connect-pg-simple";
import pg from "pg";

if (!process.env.SESSION_SECRET) {
  throw new Error("SESSION_SECRET must be set");
}

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set");
}

const PgSession = ConnectPgSimple(session);

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

export const sessionMiddleware = session({
  store: new PgSession({
    pool,
    tableName: "session",
    createTableIfMissing: true,
  }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 30 * 24 * 60 * 60 * 1000,
  },
});

declare module "express-session" {
  interface SessionData {
    userId: string;
    discordId: string;
    username: string;
    oauthState: string;
  }
}
