-- Shipments on hold for an account because of unpaid invoices. The rep still owes the account a contact; the flag only
-- explains why there are no orders. pausa: '' | 'cobranza'.
ALTER TABLE cuentas ADD COLUMN pausa TEXT NOT NULL DEFAULT '';
ALTER TABLE cuentas ADD COLUMN pausa_desde TEXT NOT NULL DEFAULT '';
