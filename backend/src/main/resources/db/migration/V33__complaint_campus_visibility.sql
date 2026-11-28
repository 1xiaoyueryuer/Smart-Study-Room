ALTER TABLE complaints
    ADD COLUMN visibility VARCHAR(10) NOT NULL DEFAULT 'private',
    ADD COLUMN public_summary VARCHAR(300),
    ADD CONSTRAINT complaints_publication_check CHECK (
        (visibility = 'private' AND public_summary IS NULL)
        OR (visibility = 'campus' AND public_summary IS NOT NULL AND char_length(btrim(public_summary)) >= 1)
    );

CREATE INDEX idx_complaints_campus_time ON complaints(submitted_at DESC, id DESC)
    WHERE visibility = 'campus' AND status <> 'withdrawn';
