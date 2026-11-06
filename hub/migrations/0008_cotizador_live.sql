-- Cotizador de eventos is live on its own Worker
UPDATE apps SET status = 'live', url = 'https://cotizador.dos-buhos.workers.dev', description = 'Bodas y eventos: menús, barra, espacio, consumo mínimo y propuesta para el cliente' WHERE slug = 'cotizador';
