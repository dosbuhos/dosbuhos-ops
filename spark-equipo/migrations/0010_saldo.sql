-- What is still owed on each sales order, as Zoho reports it (balance). NULL until the order is read again after this change.
ALTER TABLE orders ADD COLUMN saldo REAL;
