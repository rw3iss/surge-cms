-- @feature mailing_lists
--
-- Add a 'sending' recipient status for the atomic claim step. The send
-- worker flips a batch of 'pending' rows to 'sending' under
-- FOR UPDATE SKIP LOCKED before delivering, so two overlapping runs (a
-- boot-time resume racing a still-running worker, or two processes) can
-- never grab the same recipient and double-send. Once delivered the row
-- goes to 'sent' (terminal — never re-pulled), guaranteeing no duplicate
-- email to an already-sent recipient.

ALTER TABLE mail_send_recipients DROP CONSTRAINT IF EXISTS mail_send_recipients_status_check;
ALTER TABLE mail_send_recipients ADD CONSTRAINT mail_send_recipients_status_check
    CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'skipped'));
