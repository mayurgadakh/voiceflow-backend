-- Supabase exposes public tables through its REST API. Enabling RLS with no policies
-- blocks that access. The app connects as the table owner, which bypasses RLS.
ALTER TABLE "user" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "session" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "account" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "verification" ENABLE ROW LEVEL SECURITY;
