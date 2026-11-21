-- Standing benefits: discounts and access a club gives every time, as opposed to benefits that are counted per use.
-- kind: 'uso' (counted or logged per use, the original behaviour) | 'fijo' (always applies; shown, never logged).
-- detail: what the member gets ("20% de descuento") and its conditions.
ALTER TABLE club_benefits ADD COLUMN kind TEXT NOT NULL DEFAULT 'uso';
ALTER TABLE club_benefits ADD COLUMN detail TEXT;

INSERT INTO club_benefits (club_id, name, detail, kind, quantity, unit, period, sort) VALUES
  (1, 'Vinos', '20% de descuento en Tienda, en línea y cajas del club', 'fijo', NULL, '', 'year', 101),
  (1, 'Restaurante', '10% en toda la cuenta', 'fijo', NULL, '', 'year', 102),
  (1, 'Eventos exclusivos', '30% de descuento (Vendimia de la Familia, Ensamblaje, cena maridaje)', 'fijo', NULL, '', 'year', 103),
  (1, 'Degustaciones', '1 vino adicional en cualquier degustación', 'fijo', NULL, '', 'year', 104),
  (1, 'Envío de la caja', 'Gratis', 'fijo', NULL, '', 'year', 105),
  (1, 'Áreas VIP', 'Acceso, con copas Riedel', 'fijo', NULL, '', 'year', 106),
  (1, 'Reserva de Don Higinio', 'Acceso al vino exclusivo para socios', 'fijo', NULL, '', 'year', 107),
  (1, 'Precio', 'Conservan su precio de por vida', 'fijo', NULL, '', 'year', 108),

  (2, 'Vinos', '15% de descuento en Tienda, en línea y cajas del club', 'fijo', NULL, '', 'year', 101),
  (2, 'Restaurante', 'Copa de bienvenida (sin descuento en la cuenta)', 'fijo', NULL, '', 'year', 102),
  (2, 'Eventos', '10% de descuento', 'fijo', NULL, '', 'year', 103),
  (2, 'Catas comparativas de los viernes', '20% de descuento', 'fijo', NULL, '', 'year', 104),
  (2, 'Envío de la caja', 'Gratis', 'fijo', NULL, '', 'year', 105),
  (2, 'Aglianico y Chenin Blanc', 'Compra sujeta a disponibilidad', 'fijo', NULL, '', 'year', 106),

  (3, 'Vinos', '20% de descuento en Tienda, en línea y cajas del club', 'fijo', NULL, '', 'year', 101),
  (3, 'Restaurante', '10% en toda la cuenta', 'fijo', NULL, '', 'year', 102),
  (3, 'Eventos', '20% de descuento', 'fijo', NULL, '', 'year', 103),
  (3, 'Catas comparativas de los viernes', '20% de descuento', 'fijo', NULL, '', 'year', 104),
  (3, 'Envío de la caja', 'Gratis', 'fijo', NULL, '', 'year', 105),
  (3, 'Aglianico y Chenin Blanc', 'Compra sujeta a disponibilidad', 'fijo', NULL, '', 'year', 106),

  (4, 'Vinos', '20% de descuento en Tienda, en línea y cajas del club', 'fijo', NULL, '', 'year', 101),
  (4, 'Restaurante', '10% en toda la cuenta', 'fijo', NULL, '', 'year', 102),
  (4, 'Eventos', '30% de descuento', 'fijo', NULL, '', 'year', 103),
  (4, 'Catas comparativas de los viernes', 'Gratis todo el año', 'fijo', NULL, '', 'year', 104),
  (4, 'Envío de la caja', 'Gratis', 'fijo', NULL, '', 'year', 105),
  (4, 'Sustituciones', '1 botella por caja', 'fijo', NULL, '', 'year', 106),

  (5, 'Vinos', '25% de descuento en la caja y en cualquier compra', 'fijo', NULL, '', 'year', 101),
  (5, 'Restaurante', '15% en toda la cuenta', 'fijo', NULL, '', 'year', 102),
  (5, 'Eventos', '30% de descuento', 'fijo', NULL, '', 'year', 103),
  (5, 'Catas comparativas de los viernes', 'Gratis todo el año', 'fijo', NULL, '', 'year', 104),
  (5, 'Envío de la caja', 'Gratis', 'fijo', NULL, '', 'year', 105),
  (5, 'Sustituciones', '3 botellas por caja', 'fijo', NULL, '', 'year', 106);
