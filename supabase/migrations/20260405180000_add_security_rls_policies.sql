-- Enable RLS on tables that were missing it
-- photography_keys: photographers can only see/manage their own keys
ALTER TABLE IF EXISTS photography_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Photographers can view own keys"
  ON photography_keys FOR SELECT
  USING (photographer_id IN (
    SELECT id FROM photographers WHERE user_id = auth.uid()
  ));

CREATE POLICY "Photographers can insert own keys"
  ON photography_keys FOR INSERT
  WITH CHECK (photographer_id IN (
    SELECT id FROM photographers WHERE user_id = auth.uid()
  ));

CREATE POLICY "Photographers can update own keys"
  ON photography_keys FOR UPDATE
  USING (photographer_id IN (
    SELECT id FROM photographers WHERE user_id = auth.uid()
  ));

CREATE POLICY "Photographers can delete own keys"
  ON photography_keys FOR DELETE
  USING (photographer_id IN (
    SELECT id FROM photographers WHERE user_id = auth.uid()
  ));

-- photography_key_activations: photographers can only see activations for their keys
ALTER TABLE IF EXISTS photography_key_activations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Photographers can view own key activations"
  ON photography_key_activations FOR SELECT
  USING (key_id IN (
    SELECT id FROM photography_keys WHERE photographer_id IN (
      SELECT id FROM photographers WHERE user_id = auth.uid()
    )
  ));

-- studio_app_releases: read-only for all authenticated users (public release info)
ALTER TABLE IF EXISTS studio_app_releases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view releases"
  ON studio_app_releases FOR SELECT
  USING (auth.role() = 'authenticated');

-- stripe_events: only platform admins should see these (service role handles inserts)
ALTER TABLE IF EXISTS stripe_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "No direct access to stripe events"
  ON stripe_events FOR SELECT
  USING (false);
-- Service role key (used by webhook route) bypasses RLS automatically
