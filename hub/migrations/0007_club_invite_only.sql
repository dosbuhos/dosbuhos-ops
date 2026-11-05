-- Club de beneficios: programs that only take personal invitations tied to an email. No group links; the person signs
-- up with the same email the invitation was made for, and each invitation is good for one card. Amigos y familia starts on.
ALTER TABLE club_programs ADD COLUMN personal_only INTEGER NOT NULL DEFAULT 0;
UPDATE club_programs SET personal_only = 1 WHERE id = 'amigos';
