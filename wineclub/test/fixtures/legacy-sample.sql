-- Fictional legacy records shaped like the real extract (test only).
INSERT OR REPLACE INTO legacy_members (legacy_id,name,email,phone,club_key,next_shipment_number,stripe_status,plan_price,notes) VALUES
('3','Valeria Prueba','valeria@example.com','','diamante',2,'active','$5,600 MXN / month',''),
('19','Lucía Demo','LUCIA@example.com','','founders',3,'active','$3,170 MXN / quarter',''),
('40','Sin Stripe','nadie@example.com','','founders',1,'active','$3,170 MXN / quarter','');
INSERT OR IGNORE INTO legacy_shipments (legacy_id,legacy_member_id,shipment_number,status,source,requested_date,fulfilled_at,method,handled_by,zoho_po,tracking,notes,alloc_json) VALUES
('1','3',1,'delivered','historical','','2026-08-08T09:20','Winery Pickup','Eric Maycotte','','','','[{"wine":"Anaranjado","qty":1},{"wine":"Pet Nat","qty":2},{"wine":"Tempranillo GR","qty":2},{"wine":"Espumoso Rosado","qty":2},{"wine":"Tempranillo Reserva","qty":2},{"wine":"Mosaico Blanco","qty":2},{"wine":"Syrah Joven","qty":1}]'),
('2','19',1,'delivered','stripe','','2026-02-12T15:11','Took Home at Signup','cabosari','','','','[{"wine":"Anaranjado Espontáneo","qty":1},{"wine":"1524 Mosaico Tinto","qty":1},{"wine":"1524 Tempranillo","qty":1},{"wine":"Semillon-Sauvignon Blanc","qty":1},{"wine":"Rosado Cabernet Franc","qty":1},{"wine":"Sauvignon Blanc","qty":1}]'),
('31','19',2,'delivered','stripe','','2026-06-01T18:07','Courier / Delivery','cabosari','OV-02072','','','[{"wine":"Cabernet Franc Gran Reserva","qty":1},{"wine":"Selección Especial","qty":1},{"wine":"1524 Mosaico Tinto","qty":1},{"wine":"Grenache Gran Reserva","qty":1},{"wine":"1524 Espumoso Blanco","qty":1},{"wine":"Chenin Blanc","qty":1}]'),
('50','40',1,'delivered','historical','','2026-03-01T10:00','Took Home at Signup','cabosari','','','','[]');
