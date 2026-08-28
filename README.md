# Global Aura — pedidos COD y recuperación por WhatsApp

Aplicación privada de Shopify para `globalaura-ec.myshopify.com`, diseñada primero para móvil y compatible con escritorio.

## Qué incluye

- Formulario rápido de pedido contra entrega como bloque instalable del tema.
- Campos: nombre, celular, provincia, ciudad, dirección, referencia y correo.
- Campo sector opcional, activable o desactivable desde el panel.
- Envío normal gratis y envío prioritario por USD 2,50.
- Opción de pagar con tarjeta mediante el checkout normal de Shopify.
- Precios e inventario validados nuevamente en el servidor; el navegador no decide el precio.
- Carritos pendientes guardados desde que el cliente introduce sus datos.
- Recuperación automática por WhatsApp 12 horas después de la última actividad, dentro de 08:00–21:00 de Ecuador.
- Cancelación del recordatorio si ya existe un pedido con el mismo carrito, teléfono o correo.
- Enlace individual para restaurar el carrito.
- Alertas por más de 5 unidades de una variante, total superior a USD 80 o ubicación riesgosa.
- Zonas riesgosas con entrega únicamente en agencia Servientrega.
- Panel administrativo para métricas, configuración y mantenimiento manual de zonas.
- Importación inicial de 435 destinos de cobertura y 370 reglas únicas de riesgo desde el archivo suministrado.

PosCake sigue siendo responsable de sincronizar los pedidos terminados de Shopify con Pancake. Esta aplicación no replica ese flujo: solo registra carritos, crea el pedido Shopify cuando el cliente confirma y solicita a Pancake el mensaje de recuperación.

## Estado seguro inicial

La integración se entrega en `mock`: procesa la cola y registra el intento, pero no envía WhatsApp. Para activar envíos reales hacen falta el endpoint y el token de Pancake, una plantilla aprobada y una prueba controlada.

La captura suministrada muestra WABA activa, pero el teléfono aparece **Limitado** y el Business Manager **No revisado**. Conviene resolver esos dos estados antes del encendido real.

## Instalación resumida

Requisitos: Node.js 20.19–21.x o 22.12+, pnpm, Shopify CLI, una app creada en Shopify Partners/Dev Dashboard y un servidor HTTPS con almacenamiento persistente.

```powershell
pnpm install
Copy-Item .env.example .env
pnpm prisma generate
pnpm prisma migrate deploy
shopify app config link
shopify app dev --store globalaura-ec.myshopify.com
```

Al vincular la app, Shopify CLI completa `client_id` y las URLs. No se deben escribir secretos en `shopify.app.toml` ni en el código del tema.

Después:

1. Instalar la app de desarrollo en `globalaura-ec.myshopify.com`.
2. Duplicar el tema `global-aura-luminos-shopify-v6-3-banner-movil` antes de modificarlo.
3. En el editor del tema, agregar el bloque **Global Aura — Pedido rápido** en la plantilla de producto.
4. Verificar un producto de prueba en móvil y escritorio.
5. Configurar un programador para hacer `POST /jobs/send-recoveries` cada 5 minutos con `Authorization: Bearer <CRON_SECRET>`.
6. Mantener `PANCAKE_MODE=mock` hasta completar la prueba de Pancake descrita abajo.

El despliegue inicial usa una sola instancia con SQLite montada en un volumen persistente. Si en el futuro se ejecutan varias instancias, se debe migrar a PostgreSQL.

## Variables privadas

Copiar `.env.example` a `.env` y completar:

- `SHOPIFY_API_KEY`: identificador público de la app.
- `SHOPIFY_API_SECRET`: secreto privado usado por el servidor para validar Shopify.
- `SHOPIFY_APP_URL`: URL HTTPS del servidor.
- `PANCAKE_SEND_URL`: endpoint exacto de envío entregado por Pancake.
- `PANCAKE_PAGE_ID`: identificador de la página/canal en Pancake.
- `PANCAKE_PAGE_ACCESS_TOKEN`: credencial privada que autoriza los mensajes.
- `PANCAKE_TEMPLATE_NAME`: nombre exacto de la plantilla aprobada.
- `PANCAKE_TEMPLATE_LANGUAGE`: idioma aprobado, inicialmente `es`.
- `CRON_SECRET`: contraseña larga y aleatoria para proteger el procesador de la cola.

El access token offline de Shopify se genera durante la instalación y queda protegido en el almacenamiento de sesiones del servidor. Ningún token debe llegar al JavaScript del tema, GitHub, capturas públicas o mensajes de soporte.

## Activación de Pancake

1. Crear y aprobar en WhatsApp la plantilla `carrito_pendiente_global_aura` con una variable URL.
2. Solicitar a Pancake el endpoint de envío de plantilla y confirmar el formato de su payload para esta WABA.
3. Configurar las variables privadas en el hosting.
4. Conservar `PANCAKE_MODE=mock` y ejecutar una recuperación de prueba.
5. Cambiar a `PANCAKE_MODE=api` y probar con un solo número autorizado.
6. Comprobar en Pancake que el mensaje salió por el canal correcto y que PosCake sigue recibiendo solamente los pedidos completados.

Mensaje configurado:

> 🛍️ *¡Tu compra quedó pendiente!*
>
> Vimos que dejaste algunos productos en tu carrito y queremos ayudarte a completar tu compra 💖
>
> ✨ Tus productos todavía están disponibles.  
> 🚚 *Envío GRATIS*  
> 💵 *Paga al recibir tu pedido*
>
> Puedes continuar tu compra exactamente donde la dejaste aquí 👇  
> 🔗 {{1}}
>
> ¡Finaliza tu compra antes de que se agote el stock! 🔥

## Comprobaciones

```powershell
pnpm typecheck
pnpm lint
pnpm test
```

La interfaz fue revisada visualmente a 390 × 844 y 1280 × 900. Las pruebas cubren normalización, horario ecuatoriano, reglas de riesgo y carga sin duplicados de las tablas suministradas.

## Límites intencionales del MVP

- No se activa mensajería real sin credenciales y prueba del endpoint de Pancake.
- El job necesita un programador externo; no depende de que alguien abra el panel.
- La disponibilidad final se vuelve a comprobar cuando se crea el pedido.
- Los límites de USD 80 y 5 unidades generan advertencia; se pueden ajustar desde el panel.
- Las zonas se pueden agregar, desactivar o reactivar manualmente desde **Zonas**.
