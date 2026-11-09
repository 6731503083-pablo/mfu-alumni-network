export type Bindings = {
  DB: D1Database;
  TEAM_NAME: string;
  SERVICE_NAME: string;
  SERVICE_VERSION: string;
  PARTNER_API_URL: string;
  PARTNER_WEBHOOK_URL: string;
  WEBHOOK_SECRET: string;
  PARTNER_WEBHOOK_SECRET: string;
  JWT_SECRET: string;
  EVENTS_CLUBS_WEBHOOK_SECRET: string;
};

export type Role = 'student' | 'alumni' | 'admin';

export type User = { id: string; role: Role };

export type AppEnv = { Bindings: Bindings; Variables: { user: User } };
