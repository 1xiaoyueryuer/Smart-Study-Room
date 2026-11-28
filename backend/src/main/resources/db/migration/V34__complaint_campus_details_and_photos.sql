ALTER TABLE complaints
    ADD COLUMN public_details VARCHAR(2000),
    ADD CONSTRAINT complaints_public_details_check CHECK (
        public_details IS NULL OR (visibility = 'campus' AND char_length(btrim(public_details)) >= 1)
    );

ALTER TABLE evidence_attachments
    ADD COLUMN campus_shared BOOLEAN NOT NULL DEFAULT FALSE,
    ADD CONSTRAINT evidence_campus_shared_check CHECK (
        NOT campus_shared OR (purpose = 'complaint' AND complaint_id IS NOT NULL)
    );

CREATE INDEX idx_evidence_attachments_campus ON evidence_attachments(complaint_id, position, id)
    WHERE campus_shared;
