-- /reservaciones/ now opens the Reservaciones app (Worker reservaciones) through the Hub's proxy:
-- the week's reservations with guest details, and Parrot sales for editors and admins.
UPDATE apps SET name = 'Reservaciones', description = 'Reservaciones de la semana con huéspedes, y ventas de Parrot', status = 'live', mode = 'proxy', url = '', binding = 'RESERVACIONES' WHERE slug = 'reservaciones';
