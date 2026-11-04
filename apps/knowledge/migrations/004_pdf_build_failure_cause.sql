-- F-550 (R10-T06-2): the durable PDF build record gains the diagnosis the parent
-- already computed. `failure_code` names the CLASS of failure every consumer
-- switches on; `failure_cause` carries the bounded, scrubbed summary the child
-- produced (`exit=N; stderr=…`), so an OOM kill and a missing model artifact stop
-- being byte-identical rows that the operator can only guess between.
--
-- The length bound is apps/knowledge/app/run_errors.py CHILD_DETAIL_LIMIT (512),
-- the same bound the child summary uses, so a cause that fits the message always
-- fits the row it lands in. tests/test_m12_t9_b5_run_error_cause.py asserts the
-- two numbers still agree; a drift here reddens that lane rather than silently
-- truncating a stored diagnosis.
ALTER TABLE knowledge.pdf_content_builds
  ADD COLUMN failure_cause text CHECK (
    failure_cause IS NULL OR char_length(failure_cause) <= 512
  );
