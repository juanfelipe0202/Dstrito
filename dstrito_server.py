#!/usr/bin/env python3
"""
Dstrito Server - version en Python
------------------------------------
Equivalente funcional de DstritoServer.java, usando UNICAMENTE la
libreria estandar de Python (no requiere instalar nada con pip).

Expone la misma API REST que la version en Java:
    POST   /api/login
    POST   /api/register
    GET    /api/admin/users
    POST   /api/orders
    GET    /api/admin/orders
    POST   /api/admin/orders/{id}/complete
    DELETE /api/admin/orders/{id}
    GET    /api/notifications?email=...
    DELETE /api/notifications/{id}
    GET    /...                       -> sirve archivos estaticos desde web/

Para ejecutarlo:
    python3 dstrito_server.py

El servidor queda escuchando en http://localhost:8080
(debe ejecutarse desde la carpeta raiz del proyecto, la misma
 donde esta la carpeta "web").
"""

import json
import os
import threading
import time
import urllib.parse
import urllib.request
import urllib.error
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import psycopg
from psycopg import Error as DBError
from psycopg.rows import dict_row

# ---------------------------------------------------------------------------
# Configuracion
# ---------------------------------------------------------------------------

HOST = "0.0.0.0"
PORT = 8080

# ID de cliente de OAuth de Google (Google Cloud Console -> APIs y servicios ->
# Credenciales -> Crear credenciales -> ID de cliente de OAuth -> Aplicacion
# web). Debe coincidir EXACTAMENTE con el que se configura en el frontend
# (buscar GOOGLE_CLIENT_ID en web/index.html). Agrega http://localhost:8080
# como "Origen de JavaScript autorizado" en Google Cloud Console.
GOOGLE_CLIENT_ID = os.getenv("DSTRITO_GOOGLE_CLIENT_ID", "676235421474-79kjje7i6cfdi8pr54c8guot867apgun.apps.googleusercontent.com")

# Cadena de conexion de Supabase (Project Settings -> Database -> Connection
# string -> "Session pooler"). Ejemplo:
#   postgresql://postgres.TUREF:TU_PASSWORD@aws-0-REGION.pooler.supabase.com:5432/postgres
# Si la contrasena tiene caracteres especiales (@ : / # ? %) hay que codificarlos
# en la URL (por ejemplo @ -> %40).
DATABASE_URL = os.getenv("DATABASE_URL", "")

PROJECT_ROOT = Path(".").resolve()
WEB_DIR = (PROJECT_ROOT / "web").resolve()

CONTENT_TYPES = {
    "css": "text/css; charset=utf-8",
    "js": "application/javascript; charset=utf-8",
    "html": "text/html; charset=utf-8",
    "png": "image/png",
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "webp": "image/webp",
    "svg": "image/svg+xml",
    "json": "application/json; charset=utf-8",
}

# ---------------------------------------------------------------------------
# "Base de datos" en memoria (equivalente a los Map/AtomicInteger estaticos
# del servidor en Java). Se protegen con locks porque el servidor Python
# atiende cada peticion en un hilo distinto (ThreadingHTTPServer).
# ---------------------------------------------------------------------------

users = {}          # email -> {"name", "email", "password", "role"}
orders = {}          # id -> {"id","name","email","items","total","status","createdAt"}
notifications = {}   # email -> [ {"id","message","createdAt"}, ... ]

users_lock = threading.Lock()
orders_lock = threading.Lock()
notifications_lock = threading.Lock()
counters_lock = threading.Lock()

_order_id_counter = 1
_notification_id_counter = 1


def next_order_id():
    global _order_id_counter
    with counters_lock:
        value = _order_id_counter
        _order_id_counter += 1
    return value


def next_notification_id():
    global _notification_id_counter
    with counters_lock:
        value = _notification_id_counter
        _notification_id_counter += 1
    return value


def now_millis():
    return int(time.time() * 1000)


def get_db_connection():
    if not DATABASE_URL:
        raise RuntimeError("Falta la variable de entorno DATABASE_URL (cadena de conexion de Supabase)")
    # prepare_threshold=None desactiva las prepared statements, necesario si
    # se usa el pooler en modo "transaction" (puerto 6543); en modo "session"
    # (puerto 5432) tambien funciona sin problema.
    return psycopg.connect(
        DATABASE_URL,
        sslmode="require",
        connect_timeout=10,
        prepare_threshold=None,
    )


def initialize_orders_database():
    """Las tablas ya existen en Supabase (se crearon con el SQL del esquema),
    por eso aqui ya no se hace CREATE TABLE ni ALTER TABLE. Solo se asegura
    el usuario administrador y se carga la cache de usuarios en memoria."""
    connection = get_db_connection()
    cursor = connection.cursor()
    try:
        cursor.execute(
            """
            INSERT INTO users (email, name, password_hash, role, provider)
            VALUES (%s, %s, %s, %s, %s)
            ON CONFLICT (email) DO NOTHING
            """,
            ("admin@dstrito.com", "Administrador", "admin123", "admin", "local"),
        )
        connection.commit()

        cursor.execute("SELECT email, name, password_hash, role, provider FROM users")
        with users_lock:
            users.clear()
            for email, name, password, role, provider in cursor.fetchall():
                users[email.lower()] = {
                    "name": name,
                    "email": email.lower(),
                    "password": password,
                    "role": role,
                    "provider": provider,
                }
    finally:
        cursor.close()
        connection.close()


def load_order_items(cursor, order_id):
    cursor.execute(
        """
        SELECT product_id AS id, product_name AS name, unit_price AS price,
               quantity
        FROM order_items WHERE order_id = %s ORDER BY id
        """,
        (order_id,),
    )
    items = cursor.fetchall()
    for item in items:
        item["price"] = float(item["price"])
    return items


# Usuario administrador por defecto (igual que en el codigo Java original)
users["admin@dstrito.com"] = {
    "name": "Administrador",
    "email": "admin@dstrito.com",
    "password": "admin123",
    "role": "admin",
    "provider": "local",
}


# ---------------------------------------------------------------------------
# Manejador HTTP
# ---------------------------------------------------------------------------

class DstritoHandler(BaseHTTPRequestHandler):
    server_version = "DstritoServer-Python/1.0"

    # ---------------- utilidades de respuesta ----------------

    def _set_common_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")

    def _send_json(self, status_code, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status_code)
        self._set_common_headers()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_error_json(self, status_code, message):
        self._send_json(status_code, {"error": message})

    def _send_raw_status(self, status_code):
        self.send_response(status_code)
        self._set_common_headers()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _read_json_body(self):
        """Lee y parsea el cuerpo de la peticion como JSON.
        Devuelve {} si esta vacio y None si el JSON es invalido."""
        try:
            length = int(self.headers.get("Content-Length", 0) or 0)
        except ValueError:
            length = 0
        if length == 0:
            return {}
        raw = self.rfile.read(length).decode("utf-8", errors="replace")
        if not raw.strip():
            return {}
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return None

    # ---------------- enrutador ----------------

    def do_OPTIONS(self):
        self._send_raw_status(204)

    def do_GET(self):
        self._route("GET")

    def do_POST(self):
        self._route("POST")

    def do_DELETE(self):
        self._route("DELETE")

    def _route(self, method):
        parsed = urllib.parse.urlparse(self.path)
        path = urllib.parse.unquote(parsed.path)

        try:
            if path == "/api/login":
                self._handle_login(method)
            elif path == "/api/register":
                self._handle_register(method)
            elif path == "/api/auth/google":
                self._handle_google_auth(method)
            elif path == "/api/admin/users":
                self._handle_admin_users(method)
            elif path == "/api/products":
                self._handle_products(method)
            elif path == "/api/orders":
                self._handle_orders(method)
            elif path.startswith("/api/admin/orders"):
                self._handle_admin_orders(method, path)
            elif path.startswith("/api/notifications"):
                self._handle_notifications(method, path, parsed.query)
            else:
                self._handle_static(path)
        except (BrokenPipeError, ConnectionResetError):
            # El cliente cerro la conexion antes de tiempo; no hay nada que hacer.
            pass

    # ---------------- /api/login ----------------

    def _handle_login(self, method):
        if method != "POST":
            self._send_error_json(405, "Metodo no permitido")
            return

        data = self._read_json_body()
        if not isinstance(data, dict):
            data = {}

        email = str(data.get("email") or "").strip()
        password = str(data.get("password") or "").strip()

        if not email or not password:
            self._send_error_json(400, "Correo y contrasena son obligatorios")
            return

        with users_lock:
            user = users.get(email.lower())

        if user is None or user.get("provider") == "google" or user["password"] != password:
            self._send_error_json(401, "Credenciales invalidas")
            return

        self._send_json(200, {
            "message": "Inicio de sesion exitoso",
            "name": user["name"],
            "email": user["email"],
            "role": user["role"],
        })

    # ---------------- /api/auth/google ----------------

    def _handle_google_auth(self, method):
        if method != "POST":
            self._send_error_json(405, "Metodo no permitido")
            return

        data = self._read_json_body()
        if not isinstance(data, dict):
            data = {}

        credential = str(data.get("credential") or "").strip()
        if not credential:
            self._send_error_json(400, "Falta el token de Google")
            return

        if GOOGLE_CLIENT_ID.startswith("PON_AQUI"):
            self._send_error_json(500, "El servidor todavia no tiene configurado GOOGLE_CLIENT_ID (ver dstrito_server.py)")
            return

        try:
            url = "https://oauth2.googleapis.com/tokeninfo?id_token=" + urllib.parse.quote(credential)
            with urllib.request.urlopen(url, timeout=8) as response:
                token_info = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError:
            self._send_error_json(401, "Token de Google invalido o expirado")
            return
        except Exception:
            self._send_error_json(502, "No se pudo verificar el token con Google. Revisa tu conexion a internet.")
            return

        if token_info.get("aud") != GOOGLE_CLIENT_ID:
            self._send_error_json(401, "El token de Google no corresponde a esta aplicacion")
            return
        if str(token_info.get("email_verified")).lower() != "true" or not token_info.get("email"):
            self._send_error_json(401, "Tu cuenta de Google no tiene un correo verificado")
            return

        email_key = str(token_info["email"]).lower()
        name = token_info.get("name") or email_key

        with users_lock:
            existing = users.get(email_key)

        if existing is None:
            connection = None
            cursor = None
            try:
                connection = get_db_connection()
                cursor = connection.cursor()
                cursor.execute(
                    """
                    INSERT INTO users (email, name, password_hash, role, provider)
                    VALUES (%s, %s, %s, %s, %s)
                    """,
                    (email_key, name, os.urandom(16).hex(), "user", "google"),
                )
                connection.commit()
            except DBError:
                if connection is not None:
                    connection.rollback()
                self._send_error_json(503, "No se pudo guardar el usuario")
                return
            finally:
                if cursor is not None:
                    cursor.close()
                if connection is not None:
                    connection.close()

            with users_lock:
                existing = {
                    "name": name,
                    "email": email_key,
                    "password": None,
                    "role": "user",
                    "provider": "google",
                }
                users[email_key] = existing

        self._send_json(200, {
            "message": "Inicio de sesion con Google exitoso",
            "name": existing["name"],
            "email": existing["email"],
            "role": existing["role"],
        })

    # ---------------- /api/register ----------------

    def _handle_register(self, method):
        if method != "POST":
            self._send_error_json(405, "Metodo no permitido")
            return

        data = self._read_json_body()
        if not isinstance(data, dict):
            data = {}

        name = str(data.get("name") or "").strip()
        email = str(data.get("email") or "").strip()
        password = str(data.get("password") or "").strip()

        if not name or not email or not password:
            self._send_error_json(400, "Todos los campos son obligatorios")
            return

        email_key = email.lower()
        connection = None
        cursor = None
        with users_lock:
            if email_key in users:
                self._send_error_json(409, "Ya existe una cuenta con este correo")
                return

        try:
            connection = get_db_connection()
            cursor = connection.cursor()
            cursor.execute(
                """
                INSERT INTO users (email, name, password_hash, role)
                VALUES (%s, %s, %s, %s)
                """,
                (email_key, name, password, "user"),
            )
            connection.commit()
        except DBError:
            if connection is not None:
                connection.rollback()
            self._send_error_json(503, "No se pudo guardar el usuario")
            return
        finally:
            if cursor is not None:
                cursor.close()
            if connection is not None:
                connection.close()

        with users_lock:
            users[email_key] = {
                "name": name,
                "email": email_key,
                "password": password,
                "role": "user",
                "provider": "local",
            }

        self._send_json(201, {"message": "Registro exitoso", "name": name})

    # ---------------- /api/admin/users ----------------

    def _handle_admin_users(self, method):
        if method != "GET":
            self._send_error_json(405, "Metodo no permitido")
            return

        with users_lock:
            result = [
                {"name": u["name"], "email": u["email"], "role": u["role"], "provider": u.get("provider", "local")}
                for u in users.values()
            ]
        self._send_json(200, result)

    # ---------------- /api/orders (crear pedido) ----------------

    def _handle_orders(self, method):
        if method != "POST":
            self._send_error_json(405, "Metodo no permitido")
            return

        data = self._read_json_body()
        if not isinstance(data, dict):
            self._send_error_json(400, "JSON invalido")
            return

        name = str(data.get("name", "") or "").strip()
        email = str(data.get("email", "") or "").strip().lower()
        items = data.get("items")
        total_raw = data.get("total")

        if (not name or name == "null" or not email or email == "null"
                or not isinstance(items, list) or len(items) == 0):
            self._send_error_json(400, "Datos de pedido incompletos")
            return

        if isinstance(total_raw, (int, float)) and not isinstance(total_raw, bool):
            total = float(total_raw)
        else:
            total = 0

        connection = None
        cursor = None
        try:
            connection = get_db_connection()
            cursor = connection.cursor()
            cursor.execute(
                """
                INSERT INTO orders (customer_name, customer_email, total, status)
                VALUES (%s, %s, %s, %s)
                RETURNING id
                """,
                (name, email, total, "pendiente"),
            )
            order_id = cursor.fetchone()[0]
            for item in items:
                item_id = str(item.get("id") or "")
                item_name = str(item.get("name") or "").strip()
                item_price = item.get("price", 0)
                item_quantity = item.get("quantity", 0)
                if not item_id or not item_name or not isinstance(item_price, (int, float)) \
                        or not isinstance(item_quantity, int) or item_quantity <= 0:
                    connection.rollback()
                    self._send_error_json(400, "Producto invalido en el pedido")
                    return
                cursor.execute(
                    """
                    INSERT INTO order_items
                        (order_id, product_id, product_name, unit_price, quantity, subtotal)
                    VALUES (%s, %s, %s, %s, %s, %s)
                    """,
                    (order_id, item_id, item_name, item_price, item_quantity,
                     item_price * item_quantity),
                )
            connection.commit()
        except DBError:
            if connection is not None:
                connection.rollback()
            self._send_error_json(503, "No se pudo guardar el pedido")
            return
        finally:
            if cursor is not None:
                cursor.close()
            if connection is not None:
                connection.close()

        self._send_json(201, {
            "message": "Pedido recibido. Un administrador lo revisara pronto.",
            "id": order_id,
        })

    # ---------------- /api/products ----------------

    def _handle_products(self, method):
        if method == "GET":
            connection = None
            cursor = None
            try:
                connection = get_db_connection()
                cursor = connection.cursor(row_factory=dict_row)
                cursor.execute(
                    """
                    SELECT id, name, category, price, image_path AS image,
                           description, badge
                    FROM products ORDER BY created_at DESC
                    """
                )
                result = cursor.fetchall()
                for product in result:
                    product["price"] = float(product["price"])
            except DBError:
                self._send_error_json(503, "No se pudieron consultar los productos")
                return
            finally:
                if cursor is not None:
                    cursor.close()
                if connection is not None:
                    connection.close()
            self._send_json(200, result)
            return

        if method == "POST":
            data = self._read_json_body()
            if not isinstance(data, dict):
                data = {}

            name = str(data.get("name") or "").strip()
            category = str(data.get("category") or "").strip()
            image = str(data.get("image") or "").strip()
            description = str(data.get("description") or "").strip()
            badge = str(data.get("badge") or "Drop / 01").strip()
            price_raw = data.get("price")

            if not name or not category or not image or price_raw in (None, ""):
                self._send_error_json(400, "Nombre, categoria, precio e imagen son obligatorios")
                return
            try:
                price = float(price_raw)
            except (TypeError, ValueError):
                self._send_error_json(400, "El precio debe ser un numero")
                return

            connection = None
            cursor = None
            try:
                connection = get_db_connection()
                cursor = connection.cursor()
                cursor.execute(
                    """
                    INSERT INTO products (name, category, price, image_path, description, badge)
                    VALUES (%s, %s, %s, %s, %s, %s)
                    """,
                    (name, category, price, image, description, badge),
                )
                connection.commit()
            except DBError:
                if connection is not None:
                    connection.rollback()
                self._send_error_json(503, "No se pudo guardar el producto")
                return
            finally:
                if cursor is not None:
                    cursor.close()
                if connection is not None:
                    connection.close()

            self._send_json(201, {"message": "Prenda agregada correctamente"})
            return

        self._send_error_json(405, "Metodo no permitido")

    # ---------------- /api/admin/orders[/{id}[/complete]] ----------------

    def _handle_admin_orders(self, method, path):
        context = "/api/admin/orders"
        suffix = path[len(context):]
        if suffix.startswith("/"):
            suffix = suffix[1:]

        if suffix == "":
            if method != "GET":
                self._send_error_json(405, "Metodo no permitido")
                return
            connection = None
            cursor = None
            try:
                connection = get_db_connection()
                cursor = connection.cursor(row_factory=dict_row)
                cursor.execute(
                    """
                    SELECT id, customer_name AS name, customer_email AS email,
                           total, status,
                           (EXTRACT(EPOCH FROM created_at) * 1000)::bigint AS "createdAt"
                    FROM orders ORDER BY id DESC
                    """
                )
                result = cursor.fetchall()
                for order in result:
                    order["total"] = float(order["total"])
                    order["items"] = load_order_items(cursor, order["id"])
            except DBError:
                self._send_error_json(503, "No se pudieron consultar los pedidos")
                return
            finally:
                if cursor is not None:
                    cursor.close()
                if connection is not None:
                    connection.close()
            self._send_json(200, result)
            return

        parts = suffix.split("/")
        try:
            order_id = int(parts[0])
        except ValueError:
            self._send_error_json(400, "ID de pedido invalido")
            return

        if len(parts) == 2 and parts[1] == "complete":
            if method != "POST":
                self._send_error_json(405, "Metodo no permitido")
                return
            connection = None
            cursor = None
            try:
                connection = get_db_connection()
                cursor = connection.cursor(row_factory=dict_row)
                cursor.execute(
                    "SELECT customer_email FROM orders WHERE id = %s",
                    (order_id,),
                )
                order = cursor.fetchone()
                if order is None:
                    self._send_error_json(404, "Pedido no encontrado")
                    return
                cursor.execute(
                    "UPDATE orders SET status = 'completado' WHERE id = %s",
                    (order_id,),
                )
                connection.commit()
            except DBError:
                if connection is not None:
                    connection.rollback()
                self._send_error_json(503, "No se pudo actualizar el pedido")
                return
            finally:
                if cursor is not None:
                    cursor.close()
                if connection is not None:
                    connection.close()

            notif_id = next_notification_id()
            notification = {
                "id": notif_id,
                "message": f"Tu pedido #{order_id} ha sido completado. ✅",
                "createdAt": now_millis(),
            }
            with notifications_lock:
                notifications.setdefault(order["customer_email"], []).append(notification)

            self._send_json(200, {"message": "Pedido marcado como completado"})
            return

        if len(parts) == 2 and parts[1] == "reject":
            if method != "POST":
                self._send_error_json(405, "Metodo no permitido")
                return
            connection = None
            cursor = None
            try:
                connection = get_db_connection()
                cursor = connection.cursor(row_factory=dict_row)
                cursor.execute(
                    "SELECT customer_email FROM orders WHERE id = %s",
                    (order_id,),
                )
                order = cursor.fetchone()
                if order is None:
                    self._send_error_json(404, "Pedido no encontrado")
                    return
                cursor.execute(
                    "UPDATE orders SET status = 'rechazado' WHERE id = %s",
                    (order_id,),
                )
                connection.commit()
            except DBError:
                if connection is not None:
                    connection.rollback()
                self._send_error_json(503, "No se pudo actualizar el pedido")
                return
            finally:
                if cursor is not None:
                    cursor.close()
                if connection is not None:
                    connection.close()

            notif_id = next_notification_id()
            notification = {
                "id": notif_id,
                "message": f"Tu pedido #{order_id} ha sido rechazado. ❌",
                "createdAt": now_millis(),
            }
            with notifications_lock:
                notifications.setdefault(order["customer_email"], []).append(notification)

            self._send_json(200, {"message": "Pedido marcado como rechazado"})
            return

        if len(parts) == 1:
            if method != "DELETE":
                self._send_error_json(405, "Metodo no permitido")
                return
            connection = None
            cursor = None
            try:
                connection = get_db_connection()
                cursor = connection.cursor(row_factory=dict_row)
                cursor.execute(
                    "SELECT customer_email FROM orders WHERE id = %s",
                    (order_id,),
                )
                order = cursor.fetchone()
                if order is None:
                    self._send_error_json(404, "Pedido no encontrado")
                    return
                cursor.execute("DELETE FROM orders WHERE id = %s", (order_id,))
                connection.commit()
            except DBError:
                if connection is not None:
                    connection.rollback()
                self._send_error_json(503, "No se pudo eliminar el pedido")
                return
            finally:
                if cursor is not None:
                    cursor.close()
                if connection is not None:
                    connection.close()

            notif_id = next_notification_id()
            notification = {
                "id": notif_id,
                "message": f"Tu pedido #{order_id} ha sido eliminado.",
                "createdAt": now_millis(),
            }
            with notifications_lock:
                notifications.setdefault(order["customer_email"], []).append(notification)

            self._send_json(200, {"message": "Pedido eliminado"})
            return

        self._send_error_json(404, "Ruta no encontrada")

    # ---------------- /api/notifications[/{id}] ----------------

    def _handle_notifications(self, method, path, query):
        context = "/api/notifications"
        suffix = path[len(context):]
        if suffix.startswith("/"):
            suffix = suffix[1:]

        if suffix == "":
            if method != "GET":
                self._send_error_json(405, "Metodo no permitido")
                return
            params = urllib.parse.parse_qs(query, keep_blank_values=True)
            email = (params.get("email", [""])[0] or "").lower()
            with notifications_lock:
                result = list(notifications.get(email, []))
            self._send_json(200, result)
            return

        try:
            notif_id = int(suffix.split("/")[0])
        except ValueError:
            self._send_error_json(400, "ID de notificacion invalido")
            return

        if method != "DELETE":
            self._send_error_json(405, "Metodo no permitido")
            return

        with notifications_lock:
            for lst in notifications.values():
                lst[:] = [n for n in lst if n["id"] != notif_id]

        self._send_json(200, {"message": "Notificacion eliminada"})

    # ---------------- archivos estaticos ----------------

    def _handle_static(self, path):
        if self.command != "GET":
            self._send_error_json(405, "Metodo no permitido")
            return

        if path == "/" or path == "/index.html":
            self._serve_file(WEB_DIR / "index.html", "text/html; charset=utf-8")
            return

        normalized = self._normalize_path(path)
        if normalized is None:
            self._send_raw_status(400)
            return

        # Intenta servir primero desde web/, si no existe cae a la raiz del proyecto
        candidate = (WEB_DIR / normalized).resolve()
        if not candidate.exists():
            candidate = (PROJECT_ROOT / normalized).resolve()

        if not self._is_allowed_path(candidate) or not candidate.exists() or candidate.is_dir():
            self._send_raw_status(404)
            return

        ext = candidate.suffix.lower().lstrip(".")
        content_type = CONTENT_TYPES.get(ext, "application/octet-stream")
        self._serve_file(candidate, content_type)

    def _serve_file(self, file_path, content_type):
        try:
            data = file_path.read_bytes()
        except OSError:
            self._send_raw_status(404)
            return
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    @staticmethod
    def _normalize_path(request_path):
        if not request_path:
            return None
        if request_path.startswith("/"):
            request_path = request_path[1:]
        return request_path

    @staticmethod
    def _is_allowed_path(file_path):
        try:
            file_path.relative_to(PROJECT_ROOT)
            return True
        except ValueError:
            return False

    # Log de peticiones (equivalente a la salida por consola del servidor Java)
    def log_message(self, fmt, *args):
        print(f"[{self.log_date_time_string()}] {fmt % args}")


def main():
    initialize_orders_database()
    server = ThreadingHTTPServer((HOST, PORT), DstritoHandler)
    print(f"Servidor iniciado en http://localhost:{PORT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServidor detenido.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
