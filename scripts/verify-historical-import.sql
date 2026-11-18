\set ON_ERROR_STOP on
BEGIN;

CREATE TEMP TABLE csv_source (
  ticket_id text, created_at text, channel text, client_id text, client_name text,
  client_tier text, category text, priority text, description text, assigned_agent text,
  first_response_at text, escalated_to_eng text, eng_ticket_id text, eng_handoffs text,
  eng_outcome text, status text, first_closed_at text, final_closed_at text,
  reopen_count text, csat_score text
) ON COMMIT DROP;

\copy csv_source FROM 'public/assets/aistudio/rideops_support_tickets_00617967.csv' WITH (FORMAT csv, HEADER true, NULL '\N')

SELECT 'csv_rows=' || count(*) FROM csv_source;
SELECT 'historical_ticket_rows=' || count(*) FROM public.historical_tickets;
SELECT 'csv_distinct_clients=' || count(DISTINCT client_id) FROM csv_source;
SELECT 'historical_distinct_clients=' || count(DISTINCT client_id) FROM public.historical_tickets;
SELECT 'csv_duplicate_ticket_ids=' || count(*) FROM (
  SELECT ticket_id FROM csv_source GROUP BY ticket_id HAVING count(*) > 1
) duplicates;
SELECT 'historical_duplicate_ticket_ids=' || count(*) FROM (
  SELECT ticket_id FROM public.historical_tickets GROUP BY ticket_id HAVING count(*) > 1
) duplicates;
SELECT 'csv_rows_missing_from_history=' || count(*)
FROM csv_source s LEFT JOIN public.historical_tickets h USING (ticket_id)
WHERE h.ticket_id IS NULL;
SELECT 'historical_rows_missing_from_csv=' || count(*)
FROM public.historical_tickets h LEFT JOIN csv_source s USING (ticket_id)
WHERE s.ticket_id IS NULL;
SELECT 'raw_source_field_mismatches=' || count(*)
FROM csv_source s FULL OUTER JOIN public.historical_tickets h USING (ticket_id)
WHERE s.ticket_id IS NULL OR h.ticket_id IS NULL
   OR h.source_fields IS DISTINCT FROM to_jsonb(s);
SELECT 'rows_with_exactly_20_source_fields=' || count(*)
FROM public.historical_tickets h
WHERE (SELECT count(*) FROM jsonb_object_keys(h.source_fields)) = 20
  AND h.source_fields ?& ARRAY[
    'ticket_id','created_at','channel','client_id','client_name','client_tier',
    'category','priority','description','assigned_agent','first_response_at',
    'escalated_to_eng','eng_ticket_id','eng_handoffs','eng_outcome','status',
    'first_closed_at','final_closed_at','reopen_count','csat_score'
  ];
SELECT 'orphaned_historical_client_refs=' || count(*)
FROM public.historical_tickets h LEFT JOIN public.clients c ON c.client_id = h.client_id
WHERE c.client_id IS NULL;
SELECT 'historical_client_fk_validated=' || count(*)
FROM pg_catalog.pg_constraint c
WHERE c.conname = 'historical_tickets_client_id_clients_client_id_fk'
  AND c.contype = 'f' AND c.convalidated;
SELECT 'public_foreign_keys=' || count(*) || ',validated=' || count(*) FILTER (WHERE convalidated)
FROM pg_catalog.pg_constraint
WHERE contype = 'f' AND connamespace = 'public'::regnamespace;
SELECT 'public_indexes=' || count(*) || ',valid=' || count(*) FILTER (WHERE i.indisvalid)
FROM pg_catalog.pg_index i
JOIN pg_catalog.pg_class idx ON idx.oid = i.indexrelid
JOIN pg_catalog.pg_namespace n ON n.oid = idx.relnamespace
WHERE n.nspname = 'public';
SELECT 'csv_monthly_arrivals=' || json_object_agg(month, arrivals ORDER BY month)::text
FROM (
  SELECT substring(created_at, 1, 7) AS month, count(*) AS arrivals
  FROM csv_source GROUP BY 1
) monthly;
SELECT 'stored_monthly_arrivals=' || json_object_agg(month, arrivals ORDER BY month)::text
FROM (
  SELECT substring(created_at_raw, 1, 7) AS month, count(*) AS arrivals
  FROM public.historical_tickets GROUP BY 1
) monthly;

WITH source_metrics AS (
  SELECT count(*) AS total,
         count(DISTINCT client_id) AS clients,
         count(*) FILTER (WHERE lower(escalated_to_eng) = 'yes') AS escalated,
         count(*) FILTER (WHERE status <> 'Closed') AS open_total,
         count(*) FILTER (WHERE status = 'Open - with L1') AS open_l1,
         count(*) FILTER (WHERE status = 'Open - with Engineering') AS open_engineering,
         count(*) FILTER (WHERE nullif(csat_score, '') IS NOT NULL) AS csat_rated,
         round(avg(nullif(csat_score, '')::numeric), 2) AS csat_mean,
         round(avg((extract(epoch FROM (
           to_timestamp(final_closed_at, 'YYYY-MM-DD HH24:MI') -
           to_timestamp(created_at, 'YYYY-MM-DD HH24:MI')
         )) / 3600)::numeric) FILTER (
           WHERE lower(escalated_to_eng) = 'yes' AND status = 'Closed' AND final_closed_at <> ''
         ), 2) AS escalated_mean_resolution_hours,
         round(avg((extract(epoch FROM (
           to_timestamp(final_closed_at, 'YYYY-MM-DD HH24:MI') -
           to_timestamp(created_at, 'YYYY-MM-DD HH24:MI')
         )) / 3600)::numeric) FILTER (
           WHERE lower(escalated_to_eng) <> 'yes' AND status = 'Closed' AND final_closed_at <> ''
         ), 2) AS non_escalated_mean_resolution_hours
  FROM csv_source
), stored_metrics AS (
  SELECT count(*) AS total,
         count(DISTINCT client_id) AS clients,
         count(*) FILTER (WHERE escalated_to_eng) AS escalated,
         count(*) FILTER (WHERE status <> 'Closed') AS open_total,
         count(*) FILTER (WHERE status = 'Open - with L1') AS open_l1,
         count(*) FILTER (WHERE status = 'Open - with Engineering') AS open_engineering,
         count(*) FILTER (WHERE csat_score IS NOT NULL) AS csat_rated,
         round(avg(csat_score::numeric), 2) AS csat_mean,
         round(avg(resolution_hours::numeric) FILTER (
           WHERE escalated_to_eng AND status = 'Closed' AND resolution_hours IS NOT NULL
         ), 2) AS escalated_mean_resolution_hours,
         round(avg(resolution_hours::numeric) FILTER (
           WHERE NOT escalated_to_eng AND status = 'Closed' AND resolution_hours IS NOT NULL
         ), 2) AS non_escalated_mean_resolution_hours
  FROM public.historical_tickets
)
SELECT 'csv_analytics_summary=' || row_to_json(source_metrics)::text FROM source_metrics
UNION ALL
SELECT 'stored_analytics_summary=' || row_to_json(stored_metrics)::text FROM stored_metrics;

WITH source_groups AS (
  SELECT 'month'::text AS dimension, substring(created_at, 1, 7) AS key,
         count(*)::bigint AS total,
         count(*) FILTER (WHERE lower(escalated_to_eng) = 'yes')::bigint AS escalated,
         count(*) FILTER (WHERE status <> 'Closed')::bigint AS open_count,
         count(*) FILTER (WHERE nullif(csat_score, '') IS NOT NULL)::bigint AS csat_rated,
         coalesce(sum(nullif(csat_score, '')::numeric), 0)::numeric AS csat_sum
  FROM csv_source GROUP BY 2
  UNION ALL
  SELECT 'client', client_id || '|' || client_name, count(*)::bigint,
         count(*) FILTER (WHERE lower(escalated_to_eng) = 'yes')::bigint,
         count(*) FILTER (WHERE status <> 'Closed')::bigint,
         count(*) FILTER (WHERE nullif(csat_score, '') IS NOT NULL)::bigint,
         coalesce(sum(nullif(csat_score, '')::numeric), 0)::numeric
  FROM csv_source GROUP BY 2
  UNION ALL
  SELECT 'category', category, count(*)::bigint,
         count(*) FILTER (WHERE lower(escalated_to_eng) = 'yes')::bigint,
         count(*) FILTER (WHERE status <> 'Closed')::bigint,
         count(*) FILTER (WHERE nullif(csat_score, '') IS NOT NULL)::bigint,
         coalesce(sum(nullif(csat_score, '')::numeric), 0)::numeric
  FROM csv_source GROUP BY 2
  UNION ALL
  SELECT 'priority', priority, count(*)::bigint,
         count(*) FILTER (WHERE lower(escalated_to_eng) = 'yes')::bigint,
         count(*) FILTER (WHERE status <> 'Closed')::bigint,
         count(*) FILTER (WHERE nullif(csat_score, '') IS NOT NULL)::bigint,
         coalesce(sum(nullif(csat_score, '')::numeric), 0)::numeric
  FROM csv_source GROUP BY 2
  UNION ALL
  SELECT 'channel', channel, count(*)::bigint,
         count(*) FILTER (WHERE lower(escalated_to_eng) = 'yes')::bigint,
         count(*) FILTER (WHERE status <> 'Closed')::bigint,
         count(*) FILTER (WHERE nullif(csat_score, '') IS NOT NULL)::bigint,
         coalesce(sum(nullif(csat_score, '')::numeric), 0)::numeric
  FROM csv_source GROUP BY 2
  UNION ALL
  SELECT 'client_tier', client_tier, count(*)::bigint,
         count(*) FILTER (WHERE lower(escalated_to_eng) = 'yes')::bigint,
         count(*) FILTER (WHERE status <> 'Closed')::bigint,
         count(*) FILTER (WHERE nullif(csat_score, '') IS NOT NULL)::bigint,
         coalesce(sum(nullif(csat_score, '')::numeric), 0)::numeric
  FROM csv_source GROUP BY 2
  UNION ALL
  SELECT 'agent', assigned_agent, count(*)::bigint,
         count(*) FILTER (WHERE lower(escalated_to_eng) = 'yes')::bigint,
         count(*) FILTER (WHERE status <> 'Closed')::bigint,
         count(*) FILTER (WHERE nullif(csat_score, '') IS NOT NULL)::bigint,
         coalesce(sum(nullif(csat_score, '')::numeric), 0)::numeric
  FROM csv_source GROUP BY 2
  UNION ALL
  SELECT 'status', status, count(*)::bigint,
         count(*) FILTER (WHERE lower(escalated_to_eng) = 'yes')::bigint,
         count(*) FILTER (WHERE status <> 'Closed')::bigint,
         count(*) FILTER (WHERE nullif(csat_score, '') IS NOT NULL)::bigint,
         coalesce(sum(nullif(csat_score, '')::numeric), 0)::numeric
  FROM csv_source GROUP BY 2
  UNION ALL
  SELECT 'eng_outcome', coalesce(nullif(eng_outcome, ''), 'Pending / Unspecified'), count(*)::bigint,
         count(*) FILTER (WHERE lower(escalated_to_eng) = 'yes')::bigint,
         count(*) FILTER (WHERE status <> 'Closed')::bigint,
         count(*) FILTER (WHERE nullif(csat_score, '') IS NOT NULL)::bigint,
         coalesce(sum(nullif(csat_score, '')::numeric), 0)::numeric
  FROM csv_source GROUP BY 2
), stored_groups AS (
  SELECT 'month'::text AS dimension, substring(created_at_raw, 1, 7) AS key,
         count(*)::bigint AS total,
         count(*) FILTER (WHERE escalated_to_eng)::bigint AS escalated,
         count(*) FILTER (WHERE status <> 'Closed')::bigint AS open_count,
         count(*) FILTER (WHERE csat_score IS NOT NULL)::bigint AS csat_rated,
         coalesce(sum(csat_score::numeric), 0)::numeric AS csat_sum
  FROM public.historical_tickets GROUP BY 2
  UNION ALL
  SELECT 'client', client_id || '|' || client_name, count(*)::bigint,
         count(*) FILTER (WHERE escalated_to_eng)::bigint,
         count(*) FILTER (WHERE status <> 'Closed')::bigint,
         count(*) FILTER (WHERE csat_score IS NOT NULL)::bigint,
         coalesce(sum(csat_score::numeric), 0)::numeric
  FROM public.historical_tickets GROUP BY 2
  UNION ALL
  SELECT 'category', category, count(*)::bigint,
         count(*) FILTER (WHERE escalated_to_eng)::bigint,
         count(*) FILTER (WHERE status <> 'Closed')::bigint,
         count(*) FILTER (WHERE csat_score IS NOT NULL)::bigint,
         coalesce(sum(csat_score::numeric), 0)::numeric
  FROM public.historical_tickets GROUP BY 2
  UNION ALL
  SELECT 'priority', priority, count(*)::bigint,
         count(*) FILTER (WHERE escalated_to_eng)::bigint,
         count(*) FILTER (WHERE status <> 'Closed')::bigint,
         count(*) FILTER (WHERE csat_score IS NOT NULL)::bigint,
         coalesce(sum(csat_score::numeric), 0)::numeric
  FROM public.historical_tickets GROUP BY 2
  UNION ALL
  SELECT 'channel', channel, count(*)::bigint,
         count(*) FILTER (WHERE escalated_to_eng)::bigint,
         count(*) FILTER (WHERE status <> 'Closed')::bigint,
         count(*) FILTER (WHERE csat_score IS NOT NULL)::bigint,
         coalesce(sum(csat_score::numeric), 0)::numeric
  FROM public.historical_tickets GROUP BY 2
  UNION ALL
  SELECT 'client_tier', client_tier, count(*)::bigint,
         count(*) FILTER (WHERE escalated_to_eng)::bigint,
         count(*) FILTER (WHERE status <> 'Closed')::bigint,
         count(*) FILTER (WHERE csat_score IS NOT NULL)::bigint,
         coalesce(sum(csat_score::numeric), 0)::numeric
  FROM public.historical_tickets GROUP BY 2
  UNION ALL
  SELECT 'agent', assigned_agent, count(*)::bigint,
         count(*) FILTER (WHERE escalated_to_eng)::bigint,
         count(*) FILTER (WHERE status <> 'Closed')::bigint,
         count(*) FILTER (WHERE csat_score IS NOT NULL)::bigint,
         coalesce(sum(csat_score::numeric), 0)::numeric
  FROM public.historical_tickets GROUP BY 2
  UNION ALL
  SELECT 'status', status, count(*)::bigint,
         count(*) FILTER (WHERE escalated_to_eng)::bigint,
         count(*) FILTER (WHERE status <> 'Closed')::bigint,
         count(*) FILTER (WHERE csat_score IS NOT NULL)::bigint,
         coalesce(sum(csat_score::numeric), 0)::numeric
  FROM public.historical_tickets GROUP BY 2
  UNION ALL
  SELECT 'eng_outcome', coalesce(eng_outcome, 'Pending / Unspecified'), count(*)::bigint,
         count(*) FILTER (WHERE escalated_to_eng)::bigint,
         count(*) FILTER (WHERE status <> 'Closed')::bigint,
         count(*) FILTER (WHERE csat_score IS NOT NULL)::bigint,
         coalesce(sum(csat_score::numeric), 0)::numeric
  FROM public.historical_tickets GROUP BY 2
), differences AS (
  (SELECT * FROM source_groups EXCEPT ALL SELECT * FROM stored_groups)
  UNION ALL
  (SELECT * FROM stored_groups EXCEPT ALL SELECT * FROM source_groups)
)
SELECT 'historical_analytics_dimension_mismatches=' || count(*) FROM differences;

SELECT 'derived_numeric_boolean_mismatches=' || count(*)
FROM csv_source s JOIN public.historical_tickets h USING (ticket_id)
WHERE h.escalated_to_eng IS DISTINCT FROM (lower(s.escalated_to_eng) = 'yes')
   OR h.eng_handoffs IS DISTINCT FROM coalesce(nullif(s.eng_handoffs, ''), '0')::integer
   OR h.reopen_count IS DISTINCT FROM coalesce(nullif(s.reopen_count, ''), '0')::integer
   OR h.csat_score IS DISTINCT FROM nullif(s.csat_score, '')::integer
   OR h.resolution_hours IS DISTINCT FROM CASE
        WHEN s.final_closed_at = '' THEN NULL
        ELSE greatest(0::numeric, round((extract(epoch FROM (
          to_timestamp(s.final_closed_at, 'YYYY-MM-DD HH24:MI') -
          to_timestamp(s.created_at, 'YYYY-MM-DD HH24:MI')
        )) / 3600)::numeric, 2))::double precision
      END
   OR h.first_response_minutes IS DISTINCT FROM CASE
        WHEN s.first_response_at = '' THEN NULL
        ELSE greatest(0::numeric, round((extract(epoch FROM (
          to_timestamp(s.first_response_at, 'YYYY-MM-DD HH24:MI') -
          to_timestamp(s.created_at, 'YYYY-MM-DD HH24:MI')
        )) / 60)::numeric, 1))::double precision
      END
   OR h.first_response_at_raw IS DISTINCT FROM nullif(s.first_response_at, '')
   OR h.eng_ticket_id IS DISTINCT FROM nullif(s.eng_ticket_id, '')
   OR h.eng_outcome IS DISTINCT FROM nullif(s.eng_outcome, '')
   OR h.first_closed_at_raw IS DISTINCT FROM nullif(s.first_closed_at, '')
   OR h.final_closed_at_raw IS DISTINCT FROM nullif(s.final_closed_at, '');

SELECT 'workflow_tickets=' || count(*) FROM public.workflow_tickets;
SELECT 'investigation_check_results=' || count(*) FROM public.investigation_check_results;
SELECT 'engineering_escalations=' || count(*) FROM public.engineering_escalations;
SELECT 'ai_analyses=' || count(*) FROM public.ai_analyses;
SELECT 'ticket_linked_audit_events=' || count(*) FROM public.audit_logs WHERE ticket_id IS NOT NULL;

COMMIT;
