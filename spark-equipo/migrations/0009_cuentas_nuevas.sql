-- Accounts created in Spark (a prospect that is not a Zoho client yet): where it is, whose it is, and that it was created here.
ALTER TABLE cuentas ADD COLUMN zona TEXT NOT NULL DEFAULT '';
ALTER TABLE cuentas ADD COLUMN vendedor TEXT NOT NULL DEFAULT '';
ALTER TABLE cuentas ADD COLUMN origen TEXT NOT NULL DEFAULT '';      -- 'app' = created in Spark as a new account
ALTER TABLE cuentas ADD COLUMN creado TEXT NOT NULL DEFAULT '';
