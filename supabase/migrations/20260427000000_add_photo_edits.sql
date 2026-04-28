-- 2026-04-27 — Cloud-side mirror of local Develop edits.
--
-- Each row stores the JSON-serialised PhotoAdjustments for one
-- photo, keyed on a canonical path so the same photo is recognised
-- across machines (e.g. SD card → laptop → desktop).  When a
-- photographer signs into a fresh Mac and pulls a school via Import
-- Hub, the Cloud-pull writes a sidecar JSON for every photo whose
-- edits exist here, so their work follows them.
--
-- Source of truth is still the local sidecar file.  This table is a
-- best-effort mirror — pushes are debounced + retried on the client.

CREATE TABLE IF NOT EXISTS public.photo_edits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  photographer_id UUID NOT NULL REFERENCES public.photographers(id) ON DELETE CASCADE,
  -- Canonical, photographer-scoped, slash-separated path.
  -- e.g. "maple/grade-3/smith_jane_12345/IMG_1234.CR3"
  canonical_path TEXT NOT NULL,
  -- The full PhotoAdjustments.toJson() blob.  Forwards-compatible —
  -- new fields just merge in, old fields stay around.
  adjustments_json JSONB NOT NULL,
  -- SHA256 of adjustments_json — lets the Flutter side skip a push
  -- when nothing actually changed since last sync.
  hash TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT photo_edits_unique
    UNIQUE (photographer_id, canonical_path)
);

CREATE INDEX IF NOT EXISTS idx_photo_edits_photographer
  ON public.photo_edits (photographer_id);
CREATE INDEX IF NOT EXISTS idx_photo_edits_updated
  ON public.photo_edits (photographer_id, updated_at DESC);

ALTER TABLE public.photo_edits ENABLE ROW LEVEL SECURITY;

-- Photographers can read + write only their own edits.
DROP POLICY IF EXISTS photographer_reads_own_photo_edits
  ON public.photo_edits;
CREATE POLICY photographer_reads_own_photo_edits
  ON public.photo_edits
  FOR SELECT
  USING (
    photographer_id IN (
      SELECT id FROM public.photographers WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS photographer_writes_own_photo_edits
  ON public.photo_edits;
CREATE POLICY photographer_writes_own_photo_edits
  ON public.photo_edits
  FOR INSERT
  WITH CHECK (
    photographer_id IN (
      SELECT id FROM public.photographers WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS photographer_updates_own_photo_edits
  ON public.photo_edits;
CREATE POLICY photographer_updates_own_photo_edits
  ON public.photo_edits
  FOR UPDATE
  USING (
    photographer_id IN (
      SELECT id FROM public.photographers WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    photographer_id IN (
      SELECT id FROM public.photographers WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS photographer_deletes_own_photo_edits
  ON public.photo_edits;
CREATE POLICY photographer_deletes_own_photo_edits
  ON public.photo_edits
  FOR DELETE
  USING (
    photographer_id IN (
      SELECT id FROM public.photographers WHERE user_id = auth.uid()
    )
  );

-- Updates always bump updated_at.
CREATE OR REPLACE FUNCTION public.touch_photo_edits_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_photo_edits_touch_updated
  ON public.photo_edits;
CREATE TRIGGER trg_photo_edits_touch_updated
  BEFORE UPDATE ON public.photo_edits
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_photo_edits_updated_at();

COMMENT ON TABLE public.photo_edits IS
  'Cloud mirror of Studio OS Develop adjustments. Source of truth '
  'is the local sidecar file; this table lets edits travel with the '
  'photographer to a fresh Mac via Import Hub Cloud pull.';
