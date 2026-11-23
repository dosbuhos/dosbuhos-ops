-- Sales orders that may not be a sale (a sample, a stock transfer, a sale with no client on it). Whoever made the order says
-- what it is, with a note; Contabilidad has the last word. One row per Zoho order number.
CREATE TABLE revisiones (
  numero TEXT PRIMARY KEY,
  tipo TEXT NOT NULL,                 -- what the team says: venta | muestra | traspaso | no_venta
  nota TEXT NOT NULL DEFAULT '',
  anoto TEXT NOT NULL DEFAULT '', anotado TEXT NOT NULL DEFAULT '',
  veredicto TEXT NOT NULL DEFAULT '', -- what Contabilidad says, same values
  nota_conta TEXT NOT NULL DEFAULT '',
  verifico TEXT NOT NULL DEFAULT '', verificado TEXT NOT NULL DEFAULT ''
);
