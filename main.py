#!/usr/bin/env python3
"""
Dstrito · API en FastAPI
------------------------
Reemplaza a dstrito_server.py (http.server) conservando las mismas rutas y
formatos de respuesta ({"error": "..."} en errores), y agrega:

  GET/PUT  /api/me/address            dirección de envío predeterminada
  GET/POST /api/me/cards              tarjetas guardadas (solo metadatos)
  DELETE   /api/me/cards/{id}
  POST     /api/me/cards/{id}/default
  POST     /api/orders                ahora con método de pago + dirección

Ejecutar (desde la raíz del proyecto):
    uvicorn main:app --host 0.0.0.0 --port 8080 --reload

Variables de entorno:
    DATABASE_URL            cadena de conexión de Supabase (Session pooler)
    DSTRITO_SECRET          clave para firmar tokens de sesión (obligatoria en producción)
    DSTRITO_GOOGLE_CLIENT_ID
"""

import base64
import hashlib
import hmac
import json
import logging
import os
import re
import secrets
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timezone
from uuid import uuid4
from pathlib import Path
from typing import List, Literal, Optional

from dotenv import load_dotenv

load_dotenv()  # lee el archivo .env (solo desarrollo local); en producción usa variables de entorno

import psycopg
from psycopg.rows import dict_row
from supabase import Client, create_client
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

log = logging.getLogger("dstrito")
logging.basicConfig(level=logging.INFO)

# ---------------------------------------------------------------------------
# Configuración
# ---------------------------------------------------------------------------

GOOGLE_CLIENT_ID = os.getenv(
    "DSTRITO_GOOGLE_CLIENT_ID")
DATABASE_URL = os.getenv("DATABASE_URL", "")
WEB_DIR = (Path(__file__).parent / "web").resolve()

SESSION_TTL_SECONDS = 7 * 24 * 3600
MAX_CARDS_PER_USER = 5

# --- Supabase Storage (imágenes de productos) ---
SUPABASE_URL = os.getenv("SUPABASE_URL", "")                  # https://TUREF.supabase.co
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")  # clave de servicio: SOLO en el servidor
STORAGE_BUCKET = os.getenv("SUPABASE_BUCKET", "product-images")
MAX_IMAGES_PER_PRODUCT = 6
MAX_IMAGE_BYTES = 5 * 1024 * 1024  # 5 MB por imagen (igual que el límite del bucket)

_secret_env = os.getenv("DSTRITO_SECRET")
if not _secret_env:
    log.warning(
        "DSTRITO_SECRET no está definida: se usa una clave aleatoria y las "
        "sesiones se invalidan al reiniciar. Define DSTRITO_SECRET en producción."
    )
SECRET = (_secret_env or secrets.token_hex(32)).encode()

# Notificaciones: siguen en memoria, igual que en la versión original.
notifications: dict = {}
notifications_lock = threading.Lock()
_notif_counter = 0


def _next_notification_id() -> int:
    global _notif_counter
    with notifications_lock:
        _notif_counter += 1
        return _notif_counter


def notify(email: str, message: str) -> None:
    item = {"id": _next_notification_id(), "message": message, "createdAt": int(time.time() * 1000)}
    with notifications_lock:
        notifications.setdefault(email.lower(), []).append(item)


# ---------------------------------------------------------------------------
# Base de datos (una conexión por petición, como en el servidor original)
# ---------------------------------------------------------------------------

def db():
    if not DATABASE_URL:
        raise HTTPException(503, "Falta la variable de entorno DATABASE_URL")
    conn = psycopg.connect(
        DATABASE_URL,
        sslmode="require",
        connect_timeout=10,
        prepare_threshold=None,  # necesario con el pooler en modo transaction (6543)
        row_factory=dict_row,
    )
    try:
        yield conn
    finally:
        conn.close()  # si no hubo commit, Postgres hace rollback


# ---------------------------------------------------------------------------
# Contraseñas y sesiones
# ---------------------------------------------------------------------------

def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1, dklen=32)
    return f"scrypt${salt.hex()}${digest.hex()}"


def verify_password(stored: str, password: str) -> bool:
    if stored and stored.startswith("scrypt$"):
        try:
            _, salt_hex, digest_hex = stored.split("$")
            digest = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt_hex),
                                    n=2**14, r=8, p=1, dklen=32)
            return hmac.compare_digest(digest.hex(), digest_hex)
        except ValueError:
            return False
    # Compatibilidad: contraseñas antiguas guardadas en texto plano.
    return bool(stored) and hmac.compare_digest(stored, password)


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def make_token(email: str) -> str:
    payload = _b64(json.dumps({"e": email, "x": int(time.time()) + SESSION_TTL_SECONDS}).encode())
    sig = _b64(hmac.new(SECRET, payload.encode(), hashlib.sha256).digest())
    return f"{payload}.{sig}"


def read_token(token: str) -> Optional[str]:
    try:
        payload, sig = token.split(".")
        expected = _b64(hmac.new(SECRET, payload.encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(sig, expected):
            return None
        data = json.loads(_unb64(payload))
        if data["x"] < time.time():
            return None
        return str(data["e"])
    except Exception:
        return None


def current_user(authorization: Optional[str] = Header(None), conn=Depends(db)) -> dict:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "Inicia sesión para continuar")
    email = read_token(authorization[7:].strip())
    if not email:
        raise HTTPException(401, "Tu sesión expiró. Inicia sesión de nuevo")
    row = conn.execute(
        "SELECT email, name, role FROM users WHERE email = %s", (email,)
    ).fetchone()
    if not row:
        raise HTTPException(401, "Usuario no encontrado")
    return row


def admin_user(user: dict = Depends(current_user)) -> dict:
    if user["role"] != "admin":
        raise HTTPException(403, "Solo para administradores")
    return user


def session_payload(user: dict, message: str) -> dict:
    return {
        "message": message,
        "name": user["name"],
        "email": user["email"],
        "role": user["role"],
        "token": make_token(user["email"]),
    }


# ---------------------------------------------------------------------------
# Aplicación
# ---------------------------------------------------------------------------

app = FastAPI(title="Dstrito API")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.exception_handler(HTTPException)
async def http_error(_: Request, exc: HTTPException):
    return JSONResponse({"error": exc.detail}, status_code=exc.status_code)


@app.exception_handler(RequestValidationError)
async def validation_error(_: Request, exc: RequestValidationError):
    first = exc.errors()[0] if exc.errors() else {}
    field = ".".join(str(p) for p in first.get("loc", []) if p != "body")
    msg = first.get("msg", "Datos inválidos").replace("Value error, ", "")
    return JSONResponse({"error": f"{field}: {msg}" if field else msg}, status_code=400)


@app.exception_handler(psycopg.Error)
async def database_error(_: Request, exc: psycopg.Error):
    log.exception("Error de base de datos: %s", exc)
    return JSONResponse({"error": "Error de base de datos. Intenta de nuevo."}, status_code=503)


@app.on_event("startup")
def ensure_admin():
    """Crea el administrador por defecto si no existe (cambia su clave en producción)."""
    if not DATABASE_URL:
        log.warning("DATABASE_URL vacía: la API no podrá conectarse a Supabase.")
        return
    with psycopg.connect(DATABASE_URL, sslmode="require", connect_timeout=10, prepare_threshold=None) as conn:
        conn.execute(
            """INSERT INTO users (email, name, password_hash, role, provider)
               VALUES (%s, %s, %s, 'admin', 'local') ON CONFLICT (email) DO NOTHING""",
            ("admin@dstrito.com", "Administrador", hash_password("admin123")),
        )


# ---------------------------------------------------------------------------
# Modelos
# ---------------------------------------------------------------------------

class LoginIn(BaseModel):
    email: str = Field(min_length=3, max_length=200)
    password: str = Field(min_length=1, max_length=200)


class RegisterIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    email: str = Field(min_length=3, max_length=200)
    password: str = Field(min_length=6, max_length=200)
    accepted_terms: bool = False


class GoogleIn(BaseModel):
    credential: str = Field(min_length=10)


PHONE_RE = re.compile(r"^\+?[0-9][0-9 \-]{6,18}$")


class AddressIn(BaseModel):
    address: str = Field(min_length=5, max_length=160)
    city: str = Field(min_length=2, max_length=80)
    neighborhood: str = Field(min_length=2, max_length=80)
    phone: str = Field(min_length=7, max_length=20, pattern=PHONE_RE.pattern)


class CardIn(BaseModel):
    """Solo metadatos. El número completo y el CVV NO viajan a este servidor."""
    holder_name: str = Field(min_length=2, max_length=80)
    brand: Literal["visa", "mastercard", "amex", "diners", "otra"]
    last4: str = Field(pattern=r"^[0-9]{4}$")
    exp_month: int = Field(ge=1, le=12)
    exp_year: int = Field(ge=2000, le=2100)
    gateway_token: Optional[str] = Field(default=None, max_length=200)  # token de la pasarela (futuro)


class OrderItemIn(BaseModel):
    id: str = Field(min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=160)
    price: float = Field(ge=0, le=100_000_000)
    quantity: int = Field(ge=1, le=99)


class OrderIn(BaseModel):
    items: List[OrderItemIn] = Field(min_length=1, max_length=50)
    payment_method: Literal["contraentrega", "tarjeta"] = "contraentrega"
    card_id: Optional[int] = None


class ProductOrderIn(BaseModel):
    category: str = Field(min_length=1, max_length=60)
    product_ids: List[int] = Field(min_length=1, max_length=500)


# ---------------------------------------------------------------------------
# Autenticación
# ---------------------------------------------------------------------------

@app.post("/api/login")
def login(data: LoginIn, conn=Depends(db)):
    email = data.email.strip().lower()
    user = conn.execute(
        "SELECT email, name, role, provider, password_hash FROM users WHERE email = %s", (email,)
    ).fetchone()
    if (not user or user["provider"] == "google"
            or not verify_password(user["password_hash"], data.password.strip())):
        raise HTTPException(401, "Credenciales inválidas")
    if not user["password_hash"].startswith("scrypt$"):  # migra claves antiguas a hash
        conn.execute("UPDATE users SET password_hash = %s WHERE email = %s",
                     (hash_password(data.password.strip()), email))
        conn.commit()
    return session_payload(user, "Inicio de sesión exitoso")


@app.post("/api/register", status_code=201)
def register(data: RegisterIn, conn=Depends(db)):
    if not data.accepted_terms:
        raise HTTPException(400, "Debes aceptar los Términos y Condiciones y la Política de Privacidad")
    email = data.email.strip().lower()
    if "@" not in email:
        raise HTTPException(400, "Correo inválido")
    try:
        conn.execute(
            """INSERT INTO users (email, name, password_hash, role, provider, terms_accepted_at)
               VALUES (%s, %s, %s, 'user', 'local', now())""",
            (email, data.name.strip(), hash_password(data.password.strip())),
        )
        conn.commit()
    except psycopg.errors.UniqueViolation:
        raise HTTPException(409, "Ya existe una cuenta con este correo")
    return {"message": "Registro exitoso", "name": data.name.strip()}


@app.post("/api/auth/google")
def google_auth(data: GoogleIn, conn=Depends(db)):
    try:
        url = "https://oauth2.googleapis.com/tokeninfo?id_token=" + urllib.parse.quote(data.credential)
        with urllib.request.urlopen(url, timeout=8) as response:
            info = json.loads(response.read().decode())
    except urllib.error.HTTPError:
        raise HTTPException(401, "Token de Google inválido o expirado")
    except Exception:
        raise HTTPException(502, "No se pudo verificar el token con Google")
    if info.get("aud") != GOOGLE_CLIENT_ID:
        raise HTTPException(401, "El token de Google no corresponde a esta aplicación")
    if str(info.get("email_verified")).lower() != "true" or not info.get("email"):
        raise HTTPException(401, "Tu cuenta de Google no tiene un correo verificado")

    email = str(info["email"]).lower()
    name = info.get("name") or email
    conn.execute(
        """INSERT INTO users (email, name, password_hash, role, provider, terms_accepted_at)
           VALUES (%s, %s, %s, 'user', 'google', NULL) ON CONFLICT (email) DO NOTHING""",
        (email, name, secrets.token_hex(16)),
    )
    conn.commit()
    user = conn.execute("SELECT email, name, role FROM users WHERE email = %s", (email,)).fetchone()
    return session_payload(user, "Inicio de sesión con Google exitoso")


# ---------------------------------------------------------------------------
# Perfil: dirección de envío
# ---------------------------------------------------------------------------

@app.get("/api/me/address")
def get_address(user=Depends(current_user), conn=Depends(db)):
    row = conn.execute(
        "SELECT address, city, neighborhood, phone FROM user_addresses WHERE user_email = %s",
        (user["email"],),
    ).fetchone()
    return row  # null si todavía no la ha guardado


@app.put("/api/me/address")
def put_address(data: AddressIn, user=Depends(current_user), conn=Depends(db)):
    conn.execute(
        """INSERT INTO user_addresses (user_email, address, city, neighborhood, phone, updated_at)
           VALUES (%s, %s, %s, %s, %s, now())
           ON CONFLICT (user_email) DO UPDATE SET
               address = EXCLUDED.address, city = EXCLUDED.city,
               neighborhood = EXCLUDED.neighborhood, phone = EXCLUDED.phone,
               updated_at = now()""",
        (user["email"], data.address.strip(), data.city.strip(),
         data.neighborhood.strip(), data.phone.strip()),
    )
    conn.commit()
    return {"message": "Dirección guardada", **data.model_dump()}


# ---------------------------------------------------------------------------
# Perfil: tarjetas guardadas (solo metadatos)
# ---------------------------------------------------------------------------

CARD_COLUMNS = "id, holder_name, brand, last4, exp_month, exp_year, is_default"


def _list_cards(conn, email):
    return conn.execute(
        f"SELECT {CARD_COLUMNS} FROM payment_cards WHERE user_email = %s "
        "ORDER BY is_default DESC, created_at DESC",
        (email,),
    ).fetchall()


@app.get("/api/me/cards")
def list_cards(user=Depends(current_user), conn=Depends(db)):
    return _list_cards(conn, user["email"])


@app.post("/api/me/cards", status_code=201)
def add_card(data: CardIn, user=Depends(current_user), conn=Depends(db)):
    today = date.today()
    if (data.exp_year, data.exp_month) < (today.year, today.month):
        raise HTTPException(400, "La tarjeta está vencida")

    count = conn.execute(
        "SELECT count(*) AS n FROM payment_cards WHERE user_email = %s", (user["email"],)
    ).fetchone()["n"]
    if count >= MAX_CARDS_PER_USER:
        raise HTTPException(400, f"Puedes guardar máximo {MAX_CARDS_PER_USER} tarjetas")

    row = conn.execute(
        f"""INSERT INTO payment_cards
              (user_email, holder_name, brand, last4, exp_month, exp_year, gateway_token, is_default)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING {CARD_COLUMNS}""",
        (user["email"], data.holder_name.strip(), data.brand, data.last4,
         data.exp_month, data.exp_year, data.gateway_token, count == 0),  # la primera queda como predeterminada
    ).fetchone()
    conn.commit()
    return row


@app.delete("/api/me/cards/{card_id}")
def delete_card(card_id: int, user=Depends(current_user), conn=Depends(db)):
    deleted = conn.execute(
        "DELETE FROM payment_cards WHERE id = %s AND user_email = %s RETURNING is_default",
        (card_id, user["email"]),
    ).fetchone()
    if not deleted:
        raise HTTPException(404, "Tarjeta no encontrada")
    if deleted["is_default"]:  # promueve la más reciente como predeterminada
        conn.execute(
            """UPDATE payment_cards SET is_default = true WHERE id = (
                 SELECT id FROM payment_cards WHERE user_email = %s
                 ORDER BY created_at DESC LIMIT 1)""",
            (user["email"],),
        )
    conn.commit()
    return {"message": "Tarjeta eliminada"}


@app.post("/api/me/cards/{card_id}/default")
def default_card(card_id: int, user=Depends(current_user), conn=Depends(db)):
    exists = conn.execute(
        "SELECT 1 FROM payment_cards WHERE id = %s AND user_email = %s", (card_id, user["email"])
    ).fetchone()
    if not exists:
        raise HTTPException(404, "Tarjeta no encontrada")
    conn.execute("UPDATE payment_cards SET is_default = false WHERE user_email = %s", (user["email"],))
    conn.execute("UPDATE payment_cards SET is_default = true WHERE id = %s", (card_id,))
    conn.commit()
    return {"message": "Tarjeta predeterminada actualizada"}


# ---------------------------------------------------------------------------
# Catálogo
# ---------------------------------------------------------------------------

def product_json(row: dict) -> dict:
    """Normaliza una fila de products para el frontend."""
    images = list(row.get("images") or ([row["image_path"]] if row.get("image_path") else []))
    return {
        "id": row["id"], "name": row["name"], "category": row["category"],
        "price": float(row["price"]), "stock": row["stock"],
        "sort_order": row["sort_order"],
        "description": row["description"], "badge": row["badge"],
        "images": images, "image": images[0] if images else "",  # image = principal (compatibilidad)
    }


PRODUCT_COLUMNS = "id, name, category, price, stock, sort_order, image_path, images, description, badge"


@app.get("/api/products")
def list_products(conn=Depends(db)):
    rows = conn.execute(
        f"SELECT {PRODUCT_COLUMNS} FROM products ORDER BY category, sort_order, created_at DESC, id DESC"
    ).fetchall()
    return [product_json(r) for r in rows]


@app.put("/api/products/order")
def reorder_products(data: ProductOrderIn, _=Depends(admin_user), conn=Depends(db)):
    """Guarda el orden completo de una categoría; omitir o repetir IDs no se permite."""
    if len(set(data.product_ids)) != len(data.product_ids):
        raise HTTPException(400, "La lista de prendas contiene IDs repetidos")

    rows = conn.execute(
        "SELECT id FROM products WHERE category = %s ORDER BY sort_order, created_at DESC, id DESC FOR UPDATE",
        (data.category,),
    ).fetchall()
    category_ids = {row["id"] for row in rows}
    if set(data.product_ids) != category_ids:
        raise HTTPException(409, "El inventario de esta categoría cambió. Actualiza la lista e inténtalo de nuevo.")

    for position, product_id in enumerate(data.product_ids):
        conn.execute(
            "UPDATE products SET sort_order = %s WHERE id = %s AND category = %s",
            (position, product_id, data.category),
        )
    conn.commit()
    return {"message": "Orden de prendas actualizado"}


# ---- Imágenes en Supabase Storage ------------------------------------------

_supabase: Optional[Client] = None


def storage_bucket():
    """Cliente del bucket de imágenes (se crea una sola vez, la primera vez que se necesita)."""
    global _supabase
    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        raise HTTPException(503, "Falta configurar SUPABASE_URL y SUPABASE_SERVICE_KEY en el servidor")
    if _supabase is None:
        _supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    return _supabase.storage.from_(STORAGE_BUCKET)


def sniff_image(data: bytes) -> Optional[tuple]:
    """Detecta el tipo REAL por los primeros bytes (no confiamos en el nombre ni en el
    Content-Type que manda el navegador, que se pueden falsificar). -> (mime, extensión)."""
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg", "jpg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png", "png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp", "webp"
    return None


def prepare_images(files: Optional[List[UploadFile]]) -> list:
    """Valida TODAS las imágenes (tamaño y tipo real) antes de subir ninguna."""
    prepared = []
    for upload in files or []:
        if not upload.filename:  # parte de archivo vacía
            continue
        data = upload.file.read(MAX_IMAGE_BYTES + 1)  # 1 byte de más para detectar el exceso
        if len(data) > MAX_IMAGE_BYTES:
            raise HTTPException(413, f"«{upload.filename}» supera los {MAX_IMAGE_BYTES // 1024 // 1024} MB")
        kind = sniff_image(data)
        if not kind:
            raise HTTPException(400, f"«{upload.filename}» no es una imagen JPG, PNG o WebP válida")
        prepared.append((data, *kind))
    return prepared


def upload_images(bucket, prepared: list) -> tuple:
    """Sube cada imagen con nombre único (UUID). Devuelve (rutas, urls_públicas).
    Si una falla, borra las que ya se habían subido."""
    paths: List[str] = []
    urls: List[str] = []
    try:
        for data, mime, ext in prepared:
            path = f"products/{datetime.now(timezone.utc):%Y/%m}/{uuid4().hex}.{ext}"
            bucket.upload(
                path=path,
                file=data,
                file_options={"content-type": mime, "cache-control": "31536000", "upsert": "false"},
            )
            paths.append(path)
            urls.append(bucket.get_public_url(path).rstrip("?"))
    except Exception:
        log.exception("Falló la subida a Supabase Storage")
        remove_from_bucket(bucket, paths)
        raise HTTPException(502, "No se pudieron subir las imágenes. Intenta de nuevo.")
    return paths, urls


def storage_path_from_url(url: str) -> Optional[str]:
    """URL pública → ruta dentro del bucket (None si la imagen no es de nuestro bucket)."""
    marker = f"/storage/v1/object/public/{STORAGE_BUCKET}/"
    return url.split(marker, 1)[1].split("?")[0] if marker in url else None


def remove_from_bucket(bucket, paths: List[str]) -> None:
    """Borra archivos del bucket. Es 'mejor esfuerzo': si falla solo se registra en el log."""
    if not paths:
        return
    try:
        bucket.remove(paths)
    except Exception:
        log.exception("No se pudieron borrar %s archivos del bucket", len(paths))


# ---- CRUD de productos -------------------------------------------------------

@app.post("/api/products", status_code=201)
def create_product(
    # Campos de texto (multipart/form-data)
    name: str = Form(..., min_length=1, max_length=120),
    category: str = Form(..., min_length=1, max_length=60),
    price: float = Form(..., ge=0, le=100_000_000),
    stock: int = Form(0, ge=0, le=100_000),
    description: str = Form("", max_length=600),
    badge: str = Form("Drop / 01", max_length=40),
    # Una o varias imágenes bajo el mismo nombre de campo: "images"
    images: List[UploadFile] = File(...),
    _=Depends(admin_user),
    conn=Depends(db),
):
    prepared = prepare_images(images)
    if not 1 <= len(prepared) <= MAX_IMAGES_PER_PRODUCT:
        raise HTTPException(400, f"Sube entre 1 y {MAX_IMAGES_PER_PRODUCT} imágenes")

    bucket = storage_bucket()
    paths, urls = upload_images(bucket, prepared)
    try:
        product_id = conn.execute(
            """INSERT INTO products
                 (name, category, price, stock, sort_order, image_path, images, description, badge)
               VALUES (%s, %s, %s, %s,
                 COALESCE((SELECT MAX(sort_order) + 1 FROM products WHERE category = %s), 0),
                 %s, %s::text[], %s, %s)
               RETURNING id""",
            (name.strip(), category.strip(), price, stock, category.strip(), urls[0], urls,
             description.strip(), badge.strip() or "Drop / 01"),
        ).fetchone()["id"]
        conn.commit()
    except Exception:
        remove_from_bucket(bucket, paths)  # no dejar archivos huérfanos si la BD falla
        raise
    return {"message": "Prenda agregada correctamente", "id": product_id, "images": urls}


@app.put("/api/products/{product_id}")
def update_product(
    product_id: int,
    # Todo es opcional: solo se cambia lo que se envíe.
    name: Optional[str] = Form(None, min_length=1, max_length=120),
    category: Optional[str] = Form(None, min_length=1, max_length=60),
    price: Optional[float] = Form(None, ge=0, le=100_000_000),
    stock: Optional[int] = Form(None, ge=0, le=100_000),
    description: Optional[str] = Form(None, max_length=600),
    # JSON con las URLs que se CONSERVAN, en el orden deseado (la primera = principal).
    # Si no se envía, las imágenes actuales no se tocan.
    keep_images: Optional[str] = Form(None),
    # Archivos nuevos que se agregan después de las conservadas.
    new_images: Optional[List[UploadFile]] = File(None),
    _=Depends(admin_user),
    conn=Depends(db),
):
    row = conn.execute(
        "SELECT images, image_path FROM products WHERE id = %s FOR UPDATE", (product_id,)
    ).fetchone()
    if not row:
        raise HTTPException(404, "Prenda no encontrada")
    current = list(row["images"] or ([row["image_path"]] if row["image_path"] else []))

    # --- Qué imágenes quedan ---
    if keep_images is None:
        keep = current
    else:
        try:
            keep = json.loads(keep_images)
            assert isinstance(keep, list) and all(isinstance(u, str) for u in keep)
        except Exception:
            raise HTTPException(400, "keep_images debe ser una lista JSON de URLs")
        if any(u not in current for u in keep):  # solo se pueden conservar imágenes que ya eran del producto
            raise HTTPException(400, "keep_images contiene imágenes que no pertenecen a esta prenda")
        keep = list(dict.fromkeys(keep))  # sin duplicados, conservando el orden

    prepared = prepare_images(new_images)
    if not 1 <= len(keep) + len(prepared) <= MAX_IMAGES_PER_PRODUCT:
        raise HTTPException(400, f"La prenda debe tener entre 1 y {MAX_IMAGES_PER_PRODUCT} imágenes")

    images_changed = keep_images is not None or bool(prepared)
    bucket = storage_bucket() if prepared else None
    paths, new_urls = upload_images(bucket, prepared) if prepared else ([], [])
    final = keep + new_urls

    try:
        conn.execute(
            """UPDATE products SET
                 name        = COALESCE(%s, name),
                 category    = COALESCE(%s, category),
                 price       = COALESCE(%s, price),
                 stock       = COALESCE(%s, stock),
                 sort_order  = CASE
                   WHEN %s::text IS NOT NULL AND %s::text <> category
                   THEN COALESCE((SELECT MAX(sort_order) + 1 FROM products WHERE category = %s), 0)
                   ELSE sort_order
                 END,
                 description = COALESCE(%s, description),
                 images      = COALESCE(%s::text[], images),
                 image_path  = COALESCE(%s, image_path)
               WHERE id = %s""",
            (name.strip() if name is not None else None,
             category.strip() if category is not None else None,
             price, stock,
             category.strip() if category is not None else None,
             category.strip() if category is not None else None,
             category.strip() if category is not None else None,
             description.strip() if description is not None else None,
             final if images_changed else None,
             final[0] if images_changed else None,
             product_id),
        )
        updated = conn.execute(f"SELECT {PRODUCT_COLUMNS} FROM products WHERE id = %s", (product_id,)).fetchone()
        conn.commit()
    except Exception:
        remove_from_bucket(bucket, paths)
        raise

    # Con la BD ya guardada, borra del bucket las imágenes que el admin quitó.
    removed = [storage_path_from_url(u) for u in current if u not in final]
    removed = [p for p in removed if p]
    if removed:
        try:
            remove_from_bucket(storage_bucket(), removed)
        except HTTPException:
            log.warning("Storage sin configurar: no se borraron %s imágenes viejas", len(removed))
    return product_json(updated)


@app.delete("/api/products/{product_id}")
def delete_product(product_id: int, delete_images: bool = True, _=Depends(admin_user), conn=Depends(db)):
    """Elimina la prenda. Con delete_images=true (por defecto) también borra sus archivos del bucket.
    Los pedidos antiguos no se afectan: guardan su propia copia del nombre y el precio."""
    row = conn.execute(
        "DELETE FROM products WHERE id = %s RETURNING images, image_path", (product_id,)
    ).fetchone()
    if not row:
        raise HTTPException(404, "Prenda no encontrada")
    conn.commit()

    if delete_images:
        urls = list(row["images"] or ([row["image_path"]] if row["image_path"] else []))
        paths = [p for p in (storage_path_from_url(u) for u in urls) if p]
        if paths:
            try:
                remove_from_bucket(storage_bucket(), paths)
            except HTTPException:
                log.warning("Storage sin configurar: no se borraron %s imágenes", len(paths))
    return {"message": "Prenda eliminada"}


# ---------------------------------------------------------------------------
# Pedidos
# ---------------------------------------------------------------------------

BRAND_LABEL = {"visa": "Visa", "mastercard": "Mastercard", "amex": "Amex", "diners": "Diners", "otra": "Tarjeta"}


PRODUCT_ID_RE = re.compile(r"^product-(\d+)$")  # los productos del catálogo dinámico llegan como "product-<id>"


def reserve_stock(conn, items) -> None:
    """Descuenta stock de los productos de la tabla. El UPDATE condicionado (stock >= cantidad)
    es atómico: dos clientes comprando la última unidad a la vez no pueden dejar el stock negativo.
    Si algo falla se lanza una excepción y la transacción completa se revierte."""
    need: dict = {}
    for item in items:
        m = PRODUCT_ID_RE.match(item.id)
        if m:
            need[int(m.group(1))] = need.get(int(m.group(1)), 0) + item.quantity
    for pid in sorted(need):  # orden fijo: evita bloqueos cruzados entre pedidos simultáneos
        ok = conn.execute(
            "UPDATE products SET stock = stock - %s WHERE id = %s AND stock >= %s RETURNING id",
            (need[pid], pid, need[pid]),
        ).fetchone()
        if not ok:
            prod = conn.execute("SELECT name, stock FROM products WHERE id = %s", (pid,)).fetchone()
            if not prod:
                raise HTTPException(409, "Una de las prendas de tu carrito ya no está disponible")
            raise HTTPException(409, f"Stock insuficiente de «{prod['name']}» (quedan {prod['stock']})")


def release_stock(conn, order_id: int) -> None:
    """Devuelve al inventario las unidades de un pedido (cuando se rechaza o se elimina estando pendiente)."""
    rows = conn.execute("SELECT product_id, quantity FROM order_items WHERE order_id = %s", (order_id,)).fetchall()
    for r in rows:
        m = PRODUCT_ID_RE.match(str(r["product_id"]))
        if m:
            conn.execute("UPDATE products SET stock = stock + %s WHERE id = %s", (r["quantity"], int(m.group(1))))


@app.post("/api/orders", status_code=201)
def create_order(data: OrderIn, user=Depends(current_user), conn=Depends(db)):
    addr = conn.execute(
        "SELECT address, city, neighborhood, phone FROM user_addresses WHERE user_email = %s",
        (user["email"],),
    ).fetchone()
    if not addr:
        raise HTTPException(400, "Agrega tu dirección de envío en tu perfil antes de pagar")

    card_id = card_label = None
    if data.payment_method == "tarjeta":
        card = conn.execute(
            "SELECT id, brand, last4, exp_month, exp_year FROM payment_cards "
            "WHERE id = %s AND user_email = %s",
            (data.card_id, user["email"]),
        ).fetchone() if data.card_id else None
        if not card:
            raise HTTPException(400, "Selecciona una tarjeta válida")
        today = date.today()
        if (card["exp_year"], card["exp_month"]) < (today.year, today.month):
            raise HTTPException(400, "La tarjeta seleccionada está vencida")
        card_id = card["id"]
        card_label = f"{BRAND_LABEL[card['brand']]} •••• {card['last4']}"

    reserve_stock(conn, data.items)  # descuenta stock (si falta, aborta todo el pedido)
    total = sum(i.price * i.quantity for i in data.items)  # el total lo calcula el servidor
    order_id = conn.execute(
        """INSERT INTO orders
             (customer_name, customer_email, total, status, payment_method, payment_status,
              payment_card_id, payment_card_label,
              ship_address, ship_city, ship_neighborhood, ship_phone)
           VALUES (%s, %s, %s, 'pendiente', %s, 'pendiente', %s, %s, %s, %s, %s, %s)
           RETURNING id""",
        (user["name"], user["email"], total, data.payment_method, card_id, card_label,
         addr["address"], addr["city"], addr["neighborhood"], addr["phone"]),
    ).fetchone()["id"]
    with conn.cursor() as cur:
        cur.executemany(
            """INSERT INTO order_items (order_id, product_id, product_name, unit_price, quantity, subtotal)
               VALUES (%s, %s, %s, %s, %s, %s)""",
            [(order_id, i.id, i.name, i.price, i.quantity, i.price * i.quantity) for i in data.items],
        )
    conn.commit()
    return {"message": "Pedido recibido. Un administrador lo revisará pronto.", "id": order_id}


@app.get("/api/admin/users")
def admin_users(_=Depends(admin_user), conn=Depends(db)):
    return conn.execute(
        "SELECT name, email, role, provider FROM users ORDER BY name"
    ).fetchall()


@app.get("/api/admin/orders")
def admin_orders(_=Depends(admin_user), conn=Depends(db)):
    orders = conn.execute(
        """SELECT id, customer_name AS name, customer_email AS email, total, status,
                  payment_method, payment_status, payment_card_label,
                  ship_address, ship_city, ship_neighborhood, ship_phone,
                  (EXTRACT(EPOCH FROM created_at) * 1000)::bigint AS "createdAt"
           FROM orders ORDER BY id DESC"""
    ).fetchall()
    items = conn.execute(
        """SELECT order_id, product_id AS id, product_name AS name, unit_price AS price, quantity
           FROM order_items WHERE order_id = ANY(%s) ORDER BY id""",
        ([o["id"] for o in orders],),
    ).fetchall()
    by_order: dict = {}
    for it in items:
        it["price"] = float(it["price"])
        by_order.setdefault(it.pop("order_id"), []).append(it)
    for o in orders:
        o["total"] = float(o["total"])
        o["items"] = by_order.get(o["id"], [])
    return orders


def _set_status(order_id: int, status: str, message: str, conn):
    row = conn.execute(
        "SELECT status, customer_email, customer_name FROM orders WHERE id = %s FOR UPDATE", (order_id,)
    ).fetchone()
    if not row:
        raise HTTPException(404, "Pedido no encontrado")
    if status == "rechazado" and row["status"] == "pendiente":
        release_stock(conn, order_id)  # un pedido rechazado devuelve sus unidades al inventario
    conn.execute("UPDATE orders SET status = %s WHERE id = %s", (status, order_id))
    conn.commit()
    notify(row["customer_email"], message.format(id=order_id, name=row["customer_name"]))


@app.post("/api/admin/orders/{order_id}/complete")
def complete_order(order_id: int, _=Depends(admin_user), conn=Depends(db)):
    _set_status(
        order_id,
        "completado",
        "¡Hola, {name}! 👋 Te escribimos para avisarte que tu pedido ya fue entregado. 📦\n"
        "Esperamos que la ropa te encante, te quede perfecta y la disfrutes muchísimo. "
        "¡Gracias por confiar en nosotros! Si necesitas hacer algún cambio o tienes dudas "
        "con la talla, escríbenos por dstrito.shop@gmail.com .",
        conn,
    )
    return {"message": "Pedido marcado como completado"}


@app.post("/api/admin/orders/{order_id}/reject")
def reject_order(order_id: int, _=Depends(admin_user), conn=Depends(db)):
    _set_status(order_id, "rechazado", "Tu pedido #{id} ha sido rechazado. ❌", conn)
    return {"message": "Pedido marcado como rechazado"}


@app.delete("/api/admin/orders/{order_id}")
def delete_order(order_id: int, _=Depends(admin_user), conn=Depends(db)):
    current = conn.execute(
        "SELECT status FROM orders WHERE id = %s FOR UPDATE", (order_id,)
    ).fetchone()
    if not current:
        raise HTTPException(404, "Pedido no encontrado")
    if current["status"] == "pendiente":
        release_stock(conn, order_id)  # (los items se leen antes de que el borrado los elimine)
    row = conn.execute(
        "DELETE FROM orders WHERE id = %s RETURNING customer_email", (order_id,)
    ).fetchone()
    conn.commit()
    notify(row["customer_email"], f"Tu pedido #{order_id} ha sido eliminado.")
    return {"message": "Pedido eliminado"}


# ---------------------------------------------------------------------------
# Notificaciones (ahora ligadas al usuario autenticado, no a un ?email=)
# ---------------------------------------------------------------------------

@app.get("/api/notifications")
def get_notifications(user=Depends(current_user)):
    with notifications_lock:
        return list(notifications.get(user["email"].lower(), []))


@app.delete("/api/notifications/{notif_id}")
def delete_notification(notif_id: int, user=Depends(current_user)):
    with notifications_lock:
        mine = notifications.get(user["email"].lower(), [])
        mine[:] = [n for n in mine if n["id"] != notif_id]
    return {"message": "Notificación eliminada"}


# ---------------------------------------------------------------------------
# Archivos estáticos (debe ir al final)
# ---------------------------------------------------------------------------

app.mount("/", StaticFiles(directory=WEB_DIR, html=True), name="web")
