-- Who a sale really belongs to when Zoho says otherwise. An order (clave = order number, e.g. OV-02348) or a whole account
-- (clave = Zoho client name) can be credited to a rep or to the house account ("Tito": sales Eric and Diane make themselves).
-- Zoho is not changed; the sync never touches this table.
CREATE TABLE asignaciones (
  tipo TEXT NOT NULL,               -- 'orden' | 'cuenta'
  clave TEXT NOT NULL,
  vendedor TEXT NOT NULL,           -- 'José Luis' | 'Carlos' | 'Tito'
  nota TEXT NOT NULL DEFAULT '',
  por TEXT NOT NULL DEFAULT '', creado TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (tipo, clave)
);
INSERT INTO asignaciones (tipo, clave, vendedor, nota, por, creado) VALUES
  ('orden', 'OV-02348', 'Tito', 'Venta de Diane a Coca-Cola (Femsa); José Luis solo entregó', 'Eric', '2026-11-21'),
  ('orden', 'OV-02157', 'Tito', 'Venta de Eric a Musa Capital', 'Eric', '2026-11-21');
