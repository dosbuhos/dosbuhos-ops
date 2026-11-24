# Contemplo Studio · Guía del equipo

## Todos los días

1. **Subir:** apps.dosbuhos.com/contemplo → Biblioteca → arrastra el MP4 (o varios). Si se corta el internet, vuelve a soltar el mismo archivo y sigue desde donde iba.
2. **Copiar al TV:** en el video, **Enviar al TV**. Espera **✓ Listo en el TV**: el archivo ya está completo y verificado en el Google TV.
3. **Proyectar:** **Reproducir**. Se repite sin fin. Si se cae el internet, sigue proyectando.
4. Controles en **Ahora**: Pausa / Continuar, Negro, Reiniciar, Siguiente, Repetir, Silencio.

Cada orden muestra su estado: *Enviado · esperando al TV* → *Confirmado por el TV*. Si dice *No se entregó* o *El TV no pudo*, aparece **Reintentar**. Nunca dice que funcionó sin que el TV lo confirme.

## Show en vivo (operador abajo)

1. Teléfono o laptop **en el mismo Wi-Fi** que el TV. Abre la dirección de *Pantallas* (por ejemplo `http://192.168.0.50:8320`) y escribe el PIN del show.
2. Elige el guion (Listas → tipo *Show*). Arriba hay dos monitores:
   - **PROGRAMA** (rojo): lo que el TV dice que está en los proyectores, con tiempo y estado.
   - **VISTA PREVIA** (verde): solo en tu pantalla. Toca cualquier escena para verla y recorrerla. No toca la proyección.
3. Botones:
   - **CUE** (`C`): carga la escena seleccionada en el TV, lista en su primer cuadro. Dice *EN ESPERA ✓* cuando está lista.
   - **GO** (`espacio`): lanza lo que está en espera, con el corte o el fundido de esa escena. Si no hay nada en espera, lanza la escena seleccionada.
   - **NEXT** (`N`): prepara la escena siguiente a la que está al aire, sin lanzarla.
   - **PAUSA / CONTINUAR** (`P`), **REINICIAR** (`R`), **NEGRO** (`B`): negro con fundido. El proyector sigue con señal y el video sigue corriendo debajo. Otra vez NEGRO lo destapa.
4. Monitor de confianza: el selector bajo PROGRAMA ofrece *Miniatura*, *Espejo (simulación)* (el mismo video en tu navegador, sincronizado, aproximado) y, en el dashboard por internet, *Capturadora HDMI (señal real)*. La señal real se ve con una salida libre del splitter a un monitor, o con una capturadora HDMI-USB en la laptop.

Ensayo mínimo antes de cada show: CUE + GO de cada escena, una vez NEGRO, y verificar que todas digan *✓ en el TV*.

## Si algo falla

| Qué ves | Qué hacer |
|---|---|
| Pantalla *sin conexión* en el dashboard | La proyección sigue si ya había video. Revisa que la app esté abierta en el TV. El control por Wi-Fi funciona aunque no haya internet. |
| El control por Wi-Fi no abre | ¿Tu teléfono está en el Wi-Fi del lugar (no en datos)? ¿La IP es la de *Pantallas*? Revisa la reserva DHCP en Omada. |
| *No está copiado y verificado* al dar CUE/GO | Biblioteca → **Enviar al TV** y espera ✓. Si dice *Falló*, casi siempre es espacio: Pantallas → quita videos viejos. |
| Al prender, el TV se quedó en el inicio de Google | Abre **Contemplo Studio** desde Apps. Retoma solo lo último que proyectaba. |
| Corte negro al hacer GO | Mira el pie de PROGRAMA: *GO con corte breve* significa que el TV usa un decodificador. Usa versiones 1080p de las escenas del show. |
| La imagen se ve recortada o con barras | **Encuadre** alterna *completo* (sin recortar, con barras si la proporción no es 16:9) y *llenar* (sin barras, recorta orillas). |
| Ver diagnóstico en el TV | Botón central o menú del control remoto: aparece 20 s abajo a la izquierda (proyectado; úsalo solo fuera de función). |
