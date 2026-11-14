-- Staff-facing text is Spanish: reports default to Spanish. Rows still on the old 'en' default switch to 'es'.
UPDATE business_settings SET report_language = 'es' WHERE report_language = 'en';
