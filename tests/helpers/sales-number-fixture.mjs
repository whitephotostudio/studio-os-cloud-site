// The same isolated SQL runs in local PGlite and, when explicitly authorized,
// in a linked PostgreSQL session. Every object is temporary and rolled back.
export function buildSalesNumberFixture(baselineSql, migrationSql) {
  const temporary = sql => sql.replaceAll('public.', 'pg_temp.');
  const sql = `BEGIN;
CREATE TEMP TABLE sales_number_sequences(
  photographer_id uuid NOT NULL, kind text NOT NULL,
  next_sequence bigint NOT NULL CHECK(next_sequence>0),
  updated_at timestamptz DEFAULT now(), PRIMARY KEY(photographer_id,kind)
);
CREATE TEMP TABLE sales_documents(
  photographer_id uuid NOT NULL,kind text NOT NULL,document_number text NOT NULL,
  sequence_number bigint,status text DEFAULT 'draft',deleted_at timestamptz,
  UNIQUE(photographer_id,kind,document_number)
);
CREATE TEMP TABLE sales_fixture_results(name text PRIMARY KEY);
CREATE FUNCTION pg_temp.expect(name text, actual boolean) RETURNS void
LANGUAGE plpgsql AS $$ BEGIN
  IF actual IS DISTINCT FROM true THEN RAISE EXCEPTION 'Sales fixture failed: %', name; END IF;
  INSERT INTO pg_temp.sales_fixture_results VALUES(name);
END; $$;
${temporary(baselineSql)}
DO $$ DECLARE r record; owner_id uuid := '11111111-1111-1111-1111-111111111111'; BEGIN
  INSERT INTO pg_temp.sales_number_sequences VALUES(owner_id,'invoice',303,now());
  SELECT * INTO r FROM pg_temp._sales_allocate_number(owner_id,'invoice','',1);
  PERFORM pg_temp.expect('baseline reproduces 303 formatted as 3',r.sequence_number=303 AND r.document_number='3');
  UPDATE pg_temp.sales_number_sequences SET next_sequence=10;
  SELECT * INTO r FROM pg_temp._sales_allocate_number(owner_id,'invoice','',1);
  PERFORM pg_temp.expect('baseline reproduces 10 formatted as 1',r.sequence_number=10 AND r.document_number='1');
END; $$;
${temporary(migrationSql)}
DO $$
DECLARE
  owner_id uuid := '11111111-1111-1111-1111-111111111111';
  other_owner uuid := '22222222-2222-2222-2222-222222222222';
  r record; k text; n bigint; expected text; snapshot jsonb; rejected boolean;
BEGIN
  FOREACH k IN ARRAY ARRAY['invoice','quote'] LOOP
    FOREACH n IN ARRAY ARRAY[9,99]::bigint[] LOOP
      TRUNCATE pg_temp.sales_number_sequences,pg_temp.sales_documents;
      INSERT INTO pg_temp.sales_number_sequences VALUES(owner_id,k,n,now());
      SELECT * INTO r FROM pg_temp._sales_allocate_number(owner_id,k,'',1);
      IF r.sequence_number<>n OR r.document_number<>n::text THEN RAISE EXCEPTION 'Wrong initial number'; END IF;
      SELECT * INTO r FROM pg_temp._sales_allocate_number(owner_id,k,'',1);
      PERFORM pg_temp.expect(k||' rollover '||n||' to '||(n+1),r.sequence_number=n+1 AND r.document_number=(n+1)::text);
    END LOOP;
    TRUNCATE pg_temp.sales_number_sequences,pg_temp.sales_documents;
    INSERT INTO pg_temp.sales_number_sequences VALUES(owner_id,k,303,now());
    SELECT * INTO r FROM pg_temp._sales_allocate_number(owner_id,k,'',1);
    PERFORM pg_temp.expect(k||' preserves 303 digits',r.sequence_number=303 AND r.document_number='303');
    UPDATE pg_temp.sales_number_sequences SET next_sequence=303;
    SELECT * INTO r FROM pg_temp._sales_allocate_number(owner_id,k,'',4);
    PERFORM pg_temp.expect(k||' minimum width 4 yields 0303',r.sequence_number=303 AND r.document_number='0303');
  END LOOP;

  TRUNCATE pg_temp.sales_number_sequences,pg_temp.sales_documents;
  INSERT INTO pg_temp.sales_documents(photographer_id,kind,document_number,sequence_number,status) VALUES
    (owner_id,'invoice','INV-0300',300,'paid'),(owner_id,'invoice','INV-0301',301,'issued'),
    (owner_id,'invoice','INV-0302',302,'issued'),(owner_id,'invoice','3',303,'issued');
  SELECT jsonb_agg(to_jsonb(d) ORDER BY document_number) INTO snapshot FROM pg_temp.sales_documents d;
  SELECT * INTO r FROM pg_temp._sales_allocate_number(owner_id,'invoice','',4);
  PERFORM pg_temp.expect('absent counter resumes typed imported ledger at 0304',r.sequence_number=304 AND r.document_number='0304');
  PERFORM pg_temp.expect('issued and paid legal history remains byte-equivalent',snapshot=(SELECT jsonb_agg(to_jsonb(d) ORDER BY document_number) FROM pg_temp.sales_documents d));
  UPDATE pg_temp.sales_number_sequences SET next_sequence=2;
  SELECT * INTO r FROM pg_temp._sales_allocate_number(owner_id,'invoice','',1);
  PERFORM pg_temp.expect('restored low counter resumes typed ledger',r.sequence_number=304 AND r.document_number='304');
  UPDATE pg_temp.sales_number_sequences SET next_sequence=400;
  SELECT * INTO r FROM pg_temp._sales_allocate_number(owner_id,'invoice','INV-',4);
  PERFORM pg_temp.expect('ahead counter never decreases',r.sequence_number=400 AND r.document_number='INV-0400');

  TRUNCATE pg_temp.sales_number_sequences,pg_temp.sales_documents;
  INSERT INTO pg_temp.sales_documents(photographer_id,kind,document_number,sequence_number,deleted_at) VALUES
    (owner_id,'invoice','deleted old draft',60,now()),
    (owner_id,'quote','QTE-0900',900,NULL),(other_owner,'invoice','9999',9999,NULL);
  SELECT * INTO r FROM pg_temp._sales_allocate_number(owner_id,'invoice','',1);
  PERFORM pg_temp.expect('typed floor is owner and kind scoped and includes tombstones',r.sequence_number=61 AND r.document_number='61');
  SELECT * INTO r FROM pg_temp._sales_allocate_number(owner_id,'quote','QTE-',4);
  PERFORM pg_temp.expect('quote counter is independent of invoice counter',r.sequence_number=901 AND r.document_number='QTE-0901');

  TRUNCATE pg_temp.sales_number_sequences,pg_temp.sales_documents;
  INSERT INTO pg_temp.sales_number_sequences VALUES(owner_id,'invoice',304,now());
  INSERT INTO pg_temp.sales_documents(photographer_id,kind,document_number,deleted_at) VALUES
    (owner_id,'invoice','0304',NULL),(owner_id,'invoice','0305',now());
  SELECT * INTO r FROM pg_temp._sales_allocate_number(owner_id,'invoice','',4);
  PERFORM pg_temp.expect('skips existing and deleted untyped legal labels',r.sequence_number=306 AND r.document_number='0306' AND (SELECT next_sequence=307 FROM pg_temp.sales_number_sequences));

  TRUNCATE pg_temp.sales_number_sequences,pg_temp.sales_documents;
  INSERT INTO pg_temp.sales_number_sequences VALUES(owner_id,'invoice',20,now());
  BEGIN
    PERFORM * FROM pg_temp._sales_allocate_number(owner_id,'invoice','',1);
    RAISE EXCEPTION 'simulate failed surrounding document insert' USING ERRCODE='ZX001';
  EXCEPTION WHEN SQLSTATE 'ZX001' THEN NULL; END;
  PERFORM pg_temp.expect('surrounding failure rolls counter back', (SELECT next_sequence=20 FROM pg_temp.sales_number_sequences));

  TRUNCATE pg_temp.sales_number_sequences,pg_temp.sales_documents;
  INSERT INTO pg_temp.sales_number_sequences VALUES(owner_id,'invoice',1,now());
  INSERT INTO pg_temp.sales_documents(photographer_id,kind,document_number)
    SELECT owner_id,'invoice',i::text FROM generate_series(1,1000) i;
  rejected := false;
  BEGIN
    PERFORM * FROM pg_temp._sales_allocate_number(owner_id,'invoice','',1);
  EXCEPTION WHEN SQLSTATE '54000' THEN rejected := true; END;
  PERFORM pg_temp.expect('collision exhaustion is bounded and rolls back', rejected AND (SELECT next_sequence=1 FROM pg_temp.sales_number_sequences) AND (SELECT count(*)=1000 FROM pg_temp.sales_documents));

  TRUNCATE pg_temp.sales_number_sequences,pg_temp.sales_documents;
  rejected := false;
  BEGIN PERFORM * FROM pg_temp._sales_allocate_number(owner_id,'invalid','',4);
  EXCEPTION WHEN SQLSTATE '22023' THEN rejected := true; END;
  PERFORM pg_temp.expect('invalid kind cannot allocate',rejected AND NOT EXISTS(SELECT FROM pg_temp.sales_number_sequences));
  rejected := false;
  BEGIN PERFORM * FROM pg_temp._sales_allocate_number(owner_id,'invoice','',100000000);
  EXCEPTION WHEN SQLSTATE '22023' THEN rejected := true; END;
  PERFORM pg_temp.expect('invalid padding cannot allocate or exhaust memory',rejected AND NOT EXISTS(SELECT FROM pg_temp.sales_number_sequences));
  SELECT * INTO r FROM pg_temp._sales_allocate_number(owner_id,'invoice',NULL,12);
  PERFORM pg_temp.expect('supported maximum padding and null prefix remain valid',r.sequence_number=1 AND r.document_number='000000000001');
END; $$;
SELECT jsonb_build_object('passed',count(*),'cases',jsonb_agg(name ORDER BY name)) AS sales_number_fixture FROM pg_temp.sales_fixture_results;
ROLLBACK;
`;
  if (/\bpublic\./i.test(sql)) throw Error('Sales fixture must not reference persistent public objects');
  return sql;
}
