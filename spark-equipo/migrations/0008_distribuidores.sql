-- Distributor scouting, copied from the "Distribuidores" tab of the CRM sheet on every sync (the tab is where it is kept).
CREATE TABLE distribuidores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL, plaza TEXT NOT NULL DEFAULT '', zona TEXT NOT NULL DEFAULT '', tipo TEXT NOT NULL DEFAULT '',
  estado TEXT NOT NULL DEFAULT '',     -- Por contactar | En proceso | Catalogado | Rechazado | Rechazado por Dos Búhos
  contacto TEXT NOT NULL DEFAULT '', telefono TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT '', avance TEXT NOT NULL DEFAULT '', siguiente TEXT NOT NULL DEFAULT '',
  ultimo TEXT NOT NULL DEFAULT '', proximo TEXT NOT NULL DEFAULT '', motivo TEXT NOT NULL DEFAULT '',
  linea TEXT NOT NULL DEFAULT '', responsable TEXT NOT NULL DEFAULT '', notas TEXT NOT NULL DEFAULT ''
);
