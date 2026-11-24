-- Visit notes from Guest Center (occasions, requests, allergies) for the reservations imported from its export.
-- The Klaviyo feed has none; the importer fills it. Deleted with the guest, 90 days after the visit.
ALTER TABLE guests ADD COLUMN notes TEXT NOT NULL DEFAULT '';
