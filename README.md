# Dstrito

E-commerce de streetwear (Medellín). Backend **FastAPI** + **Supabase/Postgres**,
frontend en HTML + Tailwind (CDN) + JavaScript sin build.

## Puesta en marcha

```bash
pip install -r requirements.txt

# 1) Supabase → SQL Editor → ejecuta, en orden, UNA vez cada una:
#      migrations/001_modulos_dstrito.sql
#      migrations/002_imagenes_productos.sql   (columna images TEXT[] + bucket product-images)
#      migrations/003_stock_productos.sql      (columna stock)
#      migrations/004_orden_productos.sql      (orden manual por categoría)

# 2) Variables de entorno (PowerShell)
$env:DATABASE_URL   = "postgresql://postgres.REF:PASSWORD@aws-0-REGION.pooler.supabase.com:5432/postgres"
$env:DSTRITO_SECRET = "una-cadena-larga-y-aleatoria"   # firma las sesiones; obligatoria en producción
$env:SUPABASE_URL = "https://TUREF.supabase.co"
$env:SUPABASE_SERVICE_KEY = "clave-de-servicio"   # solo en el servidor, nunca en el navegador
# (alternativa: copia .env.example a .env y complétalo; .env está en .gitignore)

# 3) Arrancar
uvicorn main:app --host 0.0.0.0 --port 8080 --reload
```

Abre <http://localhost:8080>. Documentación interactiva de la API: <http://localhost:8080/docs>.

> `dstrito_server.py` (servidor anterior con `http.server`) queda como referencia;
> ya no es necesario y no incluye los módulos nuevos.

Login con Google (opcional): `DSTRITO_GOOGLE_CLIENT_ID` y la constante `GOOGLE_CLIENT_ID`
de `web/index.html` deben coincidir.

## Admin por defecto

`admin@dstrito.com` / `admin123` — **cámbialo** antes de publicar el sitio.

## Módulos

| # | Módulo | Frontend | Backend |
|---|--------|----------|---------|
| 1 | Cookies, Términos, Privacidad | `web/js/legal.js` | `accepted_terms` en `/api/register` |
| 2 | Pago en el carrito | `web/js/checkout.js` | `/api/me/cards`, `/api/orders` |
| 3 | Admin con ventanas | `web/js/admin.js` | `/api/admin/*`, `/api/products` |
| 4 | Perfil de usuario | `web/js/profile.js` | `/api/me/address`, `/api/me/cards` |

Los textos legales están en `web/js/legal.js` (objeto `COMPANY` y `DOCS`): completa los
`[CORCHETES]` y haz que un abogado los revise antes de publicar.

## API

Las rutas marcadas 🔒 exigen `Authorization: Bearer <token>` (el token lo devuelve el login);
👑 además exigen rol admin.

| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/login` | Iniciar sesión (devuelve `token`) |
| POST | `/api/register` | Registro (requiere `accepted_terms: true`) |
| POST | `/api/auth/google` | Login / registro con Google |
| GET · PUT | `/api/me/address` 🔒 | Dirección de envío predeterminada |
| GET · POST | `/api/me/cards` 🔒 | Listar / guardar tarjeta (solo marca, últimos 4, vencimiento, titular) |
| DELETE | `/api/me/cards/{id}` 🔒 | Eliminar tarjeta |
| POST | `/api/me/cards/{id}/default` 🔒 | Marcar tarjeta predeterminada |
| GET | `/api/products` | Catálogo dinámico |
| POST | `/api/products` 👑 | Agregar prenda: `multipart/form-data` con `name`, `category`, `price`, `description` e `images` (1–6 archivos JPG/PNG/WebP, máx. 5 MB c/u) |
| PUT | `/api/products/{id}` 👑 | Editar prenda (`multipart`): `name`, `category`, `price`, `stock`, `description`, `keep_images` (JSON con URLs que se conservan) y `new_images` (archivos nuevos) |
| PUT | `/api/products/order` 👑 | Guardar el orden de los IDs de prendas de una categoría (`{"category":"Hoodies","product_ids":[3,1,2]}`) |
| DELETE | `/api/products/{id}` 👑 | Eliminar prenda y, por defecto, sus imágenes del bucket (`?delete_images=false` para conservarlas) |
| POST | `/api/orders` 🔒 | Crear pedido (`items`, `payment_method`, `card_id`); toma la dirección guardada |
| GET | `/api/admin/users` 👑 | Listar usuarios |
| GET | `/api/admin/orders` 👑 | Listar pedidos (con pago y dirección) |
| POST | `/api/admin/orders/{id}/complete` · `/reject` 👑 | Cambiar estado y notificar |
| DELETE | `/api/admin/orders/{id}` 👑 | Eliminar pedido |
| GET | `/api/notifications` 🔒 | Notificaciones del usuario autenticado |
| DELETE | `/api/notifications/{id}` 🔒 | Borrar notificación |

## Notas de seguridad

- **Tarjetas:** el número completo y el CVV nunca salen del navegador ni se guardan.
  Para cobrar de verdad integra una pasarela (Wompi, PayU, ePayco, Mercado Pago…) y guarda
  su token en `payment_cards.gateway_token`. Hoy un pedido con tarjeta queda con
  `payment_status = 'pendiente'` y **no se cobra nada**.
- Las contraseñas nuevas se guardan con scrypt; las antiguas (texto plano) se migran
  automáticamente en el siguiente login.
- Stock: al crear un pedido se descuenta el stock de las prendas de la tabla `products` (si no alcanza, el pedido se rechaza con 409); si el admin rechaza o elimina un pedido pendiente, las unidades vuelven al inventario. Las 3 prendas fijas del `index.html` no tienen stock.
- Orden del catálogo: en el inventario, usa las flechas ↑ y ↓ para organizar prendas dentro de cada categoría. Ejecuta `migrations/004_orden_productos.sql` en Supabase para guardar el orden en la base de datos.
- Las notificaciones siguen en memoria (se pierden al reiniciar).
- Los precios del carrito aún los envía el navegador (el servidor calcula el total, pero no
  los valida contra un catálogo). Conviene llevar también los productos fijos a la tabla `products`.
