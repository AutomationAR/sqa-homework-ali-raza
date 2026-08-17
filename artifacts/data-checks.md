# Data layer reasoning

Inferred from the two API contracts actually observed, not from a generic chat
schema.

## Observed contracts

```
POST /api/agent/ask-unauthenticated
  ->  {"message":"hi","utmData":null,"sessionId":""}
  <-  {"message":"Hello there…","session_id":"3b6be3a0-b043-4b66-87cb-a4de77ee0fb8"}

GET  /api/agent/suggestions-unauthenticated
  <-  [{"id":"33255586-…","title":"What is Permission","prompt":"What is Permission?",
       "for_authenticated":false,"order":1,"enabled":true,
       "created_at":"2025-11-14T09:55:37.605Z","updated_at":"…"}]

GET  /api/agent/suggestions        <- 401 when anonymous
```

Three things follow. `session_id` is server-minted and returned per request.
`utmData` means acquisition attribution is captured on the message itself.
Suggestions are a managed table with `order`/`enabled`/`for_authenticated` flags —
someone edits these rows.

## Inferred schema

```sql
CREATE TABLE agent_sessions (
  id           UUID PRIMARY KEY,
  user_id      UUID NULL REFERENCES users(id),   -- NULL while anonymous
  utm_data     JSONB NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE agent_messages (
  id           UUID PRIMARY KEY,
  session_id   UUID NOT NULL REFERENCES agent_sessions(id),
  role         TEXT NOT NULL CHECK (role IN ('user','agent')),
  content      TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  latency_ms   INTEGER NULL                      -- agent rows only
);

CREATE TABLE agent_suggestions (
  id                UUID PRIMARY KEY,
  title             TEXT NOT NULL,
  prompt            TEXT NOT NULL,
  for_authenticated BOOLEAN NOT NULL DEFAULT false,
  "order"           INTEGER NOT NULL,
  enabled           BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL,
  updated_at        TIMESTAMPTZ NOT NULL
);
```

## The check I would add first

**Sessions with exactly one user message.** The client sends `sessionId:""` on
every request (BUG-4), so the server should be minting a fresh session per
message. If true, this query returns nearly 100% of sessions — which both
confirms the defect server-side and quantifies how much conversation analytics is
being lost.

```sql
SELECT
  count(*) FILTER (WHERE user_turns = 1)                     AS single_turn_sessions,
  count(*)                                                   AS total_sessions,
  round(100.0 * count(*) FILTER (WHERE user_turns = 1) / nullif(count(*),0), 1)
                                                             AS pct_single_turn
FROM (
  SELECT s.id, count(*) FILTER (WHERE m.role = 'user') AS user_turns
  FROM agent_sessions s
  LEFT JOIN agent_messages m ON m.session_id = s.id
  WHERE s.created_at >= now() - interval '7 days'
  GROUP BY s.id
) t;
```

## Verification queries

**1. Every user message got exactly one agent reply, and timestamps are sane.**
Catches the 200-that-renders-nothing case from the UI side, plus clock skew.

```sql
SELECT m.id, m.session_id, m.created_at, m.latency_ms,
       CASE
         WHEN m.created_at > now()                        THEN 'FUTURE_TIMESTAMP'
         WHEN m.latency_ms IS NOT NULL AND m.latency_ms < 0 THEN 'NEGATIVE_LATENCY'
         WHEN replies = 0                                 THEN 'USER_MSG_NEVER_ANSWERED'
         WHEN replies > 1                                 THEN 'DUPLICATE_REPLY'
         ELSE 'OK'
       END AS data_quality
FROM (
  SELECT m.*, (
    SELECT count(*) FROM agent_messages r
    WHERE r.session_id = m.session_id
      AND r.role = 'agent' AND r.created_at > m.created_at
      AND r.created_at < m.created_at + interval '2 minutes'
  ) AS replies
  FROM agent_messages m
  WHERE m.role = 'user' AND m.created_at >= now() - interval '24 hours'
) m
WHERE replies <> 1 OR m.created_at > now() OR m.latency_ms < 0;
```

**2. Empty or whitespace-only content was never persisted.** The UI blocks this on
both submit paths (test 6); this proves the API enforces it too.

```sql
SELECT role, count(*) AS blank_rows
FROM agent_messages
WHERE btrim(coalesce(content,'')) = ''
  AND created_at >= now() - interval '7 days'
GROUP BY role;
```

**3. No orphaned messages, and no session whose messages predate it.**

```sql
SELECT 'orphan_message' AS issue, m.id::text
FROM agent_messages m LEFT JOIN agent_sessions s ON s.id = m.session_id
WHERE s.id IS NULL
UNION ALL
SELECT 'message_before_session', m.id::text
FROM agent_messages m JOIN agent_sessions s ON s.id = m.session_id
WHERE m.created_at < s.created_at;
```

**4. Are the suggestions anyone is maintaining actually reachable?** This is the
data-side view of BUG-1: rows enabled and updated, with zero UI exposure.

```sql
SELECT id, title, "order", enabled, for_authenticated, updated_at
FROM agent_suggestions
WHERE enabled AND NOT for_authenticated
ORDER BY "order";
```

## Pipeline integrity check I would add

**Attribution is captured but never resolvable to an outcome.** `utmData` arrives
on the anonymous message, yet `agent_sessions.user_id` stays NULL until signup,
and — because of BUG-4 — the session is never reused. There is no join path from
"anonymous visitor who arrived from campaign X and asked about earning" to "user
who signed up". I would add a check asserting that every session with non-null
`utm_data` either resolves to a `user_id` or is explicitly aged out, so silent
attribution loss surfaces as a number instead of a gap nobody notices.
