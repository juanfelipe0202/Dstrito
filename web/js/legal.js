/* DSTRITO · Módulo 1: cookies, Términos y Condiciones, Política de Privacidad */
(() => {
  const CONSENT_KEY = 'dstrito-cookie-consent';

  // ⚠️ Reemplaza los [CORCHETES] con los datos reales de la empresa y haz revisar
  // estos textos por un abogado antes de publicar. Son una plantilla de partida.
  const COMPANY = {
    name: '[RAZÓN SOCIAL DE DSTRITO]',
    nit: '[NIT]',
    address: 'Medellín, Antioquia, Colombia',
    email: 'dstrito.shop@gmail.com',
  };
  const UPDATED = 'octubre de 2026';

  const DOCS = {
    terms: {
      label: 'Términos y Condiciones',
      html: `
        <p class="text-neutral-500">Última actualización: ${UPDATED}</p>
        <h3>1. Quiénes somos</h3>
        <p>Este sitio es operado por <strong>${COMPANY.name}</strong> (NIT ${COMPANY.nit}), marca DSTRITO, con domicilio en ${COMPANY.address}. Contacto: <a href="mailto:${COMPANY.email}">${COMPANY.email}</a>.</p>
        <h3>2. Aceptación</h3>
        <p>Al navegar, crear una cuenta o comprar en DSTRITO aceptas estos términos y la Política de Privacidad. Si no estás de acuerdo, no uses el sitio.</p>
        <h3>3. Tu cuenta</h3>
        <p>Debes ser mayor de edad (o contar con autorización de tu representante legal) y suministrar información veraz. Eres responsable de la confidencialidad de tu contraseña y de la actividad realizada con tu cuenta.</p>
        <h3>4. Productos y precios</h3>
        <p>Los precios se expresan en pesos colombianos (COP). Las imágenes son de referencia y los colores pueden variar levemente según la pantalla. Las prendas de edición limitada se venden hasta agotar existencias; podemos corregir errores evidentes de precio o inventario avisándote antes de confirmar el pedido.</p>
        <h3>5. Proceso de compra y pagos</h3>
        <ul>
          <li><strong>Efectivo / Contraentrega:</strong> pagas al recibir el pedido en la dirección indicada.</li>
          <li><strong>Tarjeta de crédito o débito:</strong> el cobro lo procesa una pasarela de pagos autorizada. DSTRITO no almacena el número completo de tu tarjeta ni el código de seguridad (CVV); solo guardamos la marca, los últimos cuatro dígitos, el vencimiento y el nombre del titular para identificar tu medio de pago.</li>
        </ul>
        <p>Un pedido queda confirmado cuando DSTRITO lo revisa y lo marca como completado; te avisaremos por las notificaciones del sitio. Podemos rechazar pedidos por falta de inventario, datos incompletos o sospecha de fraude.</p>
        <h3>6. Envíos y entregas</h3>
        <p>Enviamos a la dirección que registres en tu perfil. Los plazos y costos de envío son: <em>[DEFINIR PLAZOS, COBERTURA Y COSTO]</em>. Es tu responsabilidad mantener actualizada la dirección y un teléfono de contacto.</p>
        <h3>7. Retracto, cambios y garantía</h3>
        <p>De acuerdo con el Estatuto del Consumidor (Ley 1480 de 2011), en las ventas a distancia puedes ejercer el derecho de retracto dentro de los cinco (5) días hábiles siguientes a la entrega, devolviendo el producto sin uso y en su empaque original, salvo las excepciones previstas en la ley. Los productos gozan de la garantía legal por defectos de calidad o idoneidad. Política de cambios de DSTRITO: <em>[DEFINIR]</em>. Para solicitudes escribe a <a href="mailto:${COMPANY.email}">${COMPANY.email}</a>.</p>
        <h3>8. Propiedad intelectual</h3>
        <p>La marca DSTRITO, el logotipo, los diseños, fotografías y textos del sitio son de sus titulares y no pueden usarse sin autorización escrita.</p>
        <h3>9. Limitación de responsabilidad</h3>
        <p>DSTRITO no responde por interrupciones del sitio ajenas a su control, ni por daños indirectos derivados de su uso, sin perjuicio de los derechos irrenunciables del consumidor.</p>
        <h3>10. Cambios a estos términos</h3>
        <p>Podemos actualizar estos términos; la versión vigente es la publicada en el sitio con su fecha de actualización.</p>
        <h3>11. Ley aplicable</h3>
        <p>Estos términos se rigen por las leyes de la República de Colombia. Las quejas de consumo pueden presentarse ante DSTRITO y, de ser necesario, ante la Superintendencia de Industria y Comercio (SIC).</p>`,
    },
    privacy: {
      label: 'Política de Privacidad',
      html: `
        <p class="text-neutral-500">Última actualización: ${UPDATED}</p>
        <h3>1. Responsable del tratamiento</h3>
        <p><strong>${COMPANY.name}</strong> (NIT ${COMPANY.nit}) — ${COMPANY.address} — <a href="mailto:${COMPANY.email}">${COMPANY.email}</a>. Tratamos tus datos conforme a la Ley 1581 de 2012 y sus decretos reglamentarios (régimen de Habeas Data en Colombia).</p>
        <h3>2. Datos que recolectamos</h3>
        <ul>
          <li>Cuenta: nombre, correo y contraseña (almacenada cifrada). Si ingresas con Google, el nombre y correo que Google nos comparte.</li>
          <li>Envío: dirección, ciudad, barrio y teléfono de contacto.</li>
          <li>Pedidos: productos, valores, método de pago y estado.</li>
          <li>Medio de pago: marca, últimos 4 dígitos, vencimiento y titular de la tarjeta. <strong>Nunca</strong> guardamos el número completo ni el CVV.</li>
        </ul>
        <h3>3. Para qué los usamos</h3>
        <p>Crear y administrar tu cuenta, procesar y entregar pedidos, comunicarnos contigo sobre su estado, prevenir fraude, cumplir obligaciones legales y atender tus solicitudes.</p>
        <h3>4. Con quién los compartimos</h3>
        <p>Solo con proveedores necesarios para operar: alojamiento de base de datos, inicio de sesión con Google, pasarela de pagos y transportadoras. No vendemos tus datos personales.</p>
        <h3>5. Tus derechos</h3>
        <p>Como titular puedes conocer, actualizar y rectificar tus datos, solicitar prueba de la autorización, ser informado del uso que les damos, revocar la autorización o solicitar la supresión cuando proceda, y presentar quejas ante la Superintendencia de Industria y Comercio. Puedes editar tu dirección y eliminar tus tarjetas desde tu perfil, o escribir a <a href="mailto:${COMPANY.email}">${COMPANY.email}</a>.</p>
        <h3>6. Seguridad y conservación</h3>
        <p>Aplicamos medidas técnicas y organizativas razonables para proteger la información. La conservamos mientras tengas cuenta activa o sea necesaria para obligaciones legales y contables: <em>[DEFINIR PLAZOS]</em>.</p>
        <h3>7. Menores de edad</h3>
        <p>El sitio no está dirigido a menores de 18 años sin acompañamiento de su representante legal.</p>
        <h3>8. Cambios</h3>
        <p>Publicaremos aquí cualquier modificación de esta política.</p>`,
    },
    cookies: {
      label: 'Cookies',
      html: `
        <p class="text-neutral-500">Última actualización: ${UPDATED}</p>
        <h3>¿Qué usamos?</h3>
        <ul>
          <li><strong>Necesarias (siempre activas):</strong> almacenamiento local del navegador para mantener tu sesión, recordar tu elección de cookies y funciones básicas de la tienda.</li>
          <li><strong>Analíticas y de marketing (opcionales):</strong> solo se activarán si las aceptas. Hoy el sitio no las usa; esta opción queda registrada para cuando se incorporen.</li>
          <li><strong>De terceros:</strong> si inicias sesión con Google, Google carga sus propios scripts y se rige por su política.</li>
        </ul>
        <h3>Cómo cambiar tu elección</h3>
        <p>Pulsa «Preferencias de cookies» en el pie de página para modificarla cuando quieras, o borra los datos del sitio desde tu navegador.</p>`,
    },
  };

  // ---------- consentimiento ----------
  const readConsent = () => {
    try { return JSON.parse(localStorage.getItem(CONSENT_KEY)); } catch (_) { return null; }
  };
  const saveConsent = (analytics) => {
    try {
      localStorage.setItem(CONSENT_KEY, JSON.stringify({ necessary: true, analytics, ts: new Date().toISOString() }));
    } catch (_) { /* modo privado: se pregunta de nuevo la próxima visita */ }
    window.dispatchEvent(new CustomEvent('dstrito:consent', { detail: { analytics } }));
  };

  // ---------- banner ----------
  const banner = document.createElement('div');
  banner.id = 'cookie-banner';
  banner.setAttribute('role', 'dialog');
  banner.setAttribute('aria-label', 'Aviso de cookies');
  banner.className =
    'cookie-banner fixed inset-x-3 bottom-3 z-[70] hidden sm:inset-x-auto sm:bottom-5 sm:left-1/2 sm:w-[min(46rem,calc(100vw-2.5rem))] sm:-translate-x-1/2';
  banner.innerHTML = `
    <div class="flex flex-col gap-4 rounded-2xl border border-neutral-800 border-l-[3px] border-l-dstrito-red bg-neutral-950/95 p-4 shadow-[0_14px_50px_rgba(0,0,0,0.6)] backdrop-blur-md sm:flex-row sm:items-center sm:p-5">
      <p class="flex-1 text-[0.78rem] leading-relaxed text-neutral-300">
        Usamos almacenamiento necesario para que la tienda funcione y, si lo permites, cookies opcionales para mejorar tu experiencia.
        Conoce más en nuestra <button type="button" data-legal="cookies" class="underline decoration-dstrito-red underline-offset-2 hover:text-white">política de cookies</button>
        y <button type="button" data-legal="privacy" class="underline decoration-dstrito-red underline-offset-2 hover:text-white">privacidad</button>.
      </p>
      <div class="flex shrink-0 gap-2">
        <button type="button" data-cookie="necessary" class="rounded-full border border-neutral-700 bg-neutral-900 px-4 py-2 text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-neutral-200 transition hover:border-dstrito-red hover:text-dstrito-red">Solo necesarias</button>
        <button type="button" data-cookie="all" class="rounded-full bg-dstrito-red px-4 py-2 text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-black transition hover:bg-red-500">Aceptar todas</button>
      </div>
    </div>`;
  document.body.appendChild(banner);

  const showBanner = () => banner.classList.remove('hidden');
  const hideBanner = () => banner.classList.add('hidden');

  banner.addEventListener('click', (event) => {
    const choice = event.target.closest('[data-cookie]');
    if (!choice) return;
    saveConsent(choice.dataset.cookie === 'all');
    hideBanner();
  });

  // ---------- modal legal con pestañas ----------
  const modal = document.createElement('div');
  modal.id = 'legal-modal';
  modal.className = 'fixed inset-0 z-[65] hidden items-center justify-center bg-black/75 px-4 py-6 backdrop-blur-sm';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'legal-title');
  modal.innerHTML = `
    <div class="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-neutral-800 bg-neutral-950 shadow-[0_0_60px_rgba(0,0,0,0.75)]">
      <div class="flex items-center justify-between border-b border-neutral-800 px-6 py-4">
        <h2 id="legal-title" class="text-lg font-semibold uppercase tracking-[0.18em] text-white"></h2>
        <button type="button" data-legal-close class="rounded-full border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-200 transition hover:border-dstrito-red hover:text-dstrito-red" aria-label="Cerrar">✕</button>
      </div>
      <div id="legal-tabs" class="grid grid-cols-3 border-b border-neutral-800 text-center text-[0.68rem] uppercase tracking-[0.2em] text-neutral-400"></div>
      <div id="legal-body" class="legal-prose overflow-y-auto px-6 py-5 text-sm leading-relaxed text-neutral-300"></div>
    </div>`;
  document.body.appendChild(modal);

  const tabsEl = modal.querySelector('#legal-tabs');
  const bodyEl = modal.querySelector('#legal-body');
  const titleEl = modal.querySelector('#legal-title');

  tabsEl.innerHTML = Object.entries(DOCS)
    .map(([key, doc]) => `<button type="button" data-legal-tab="${key}" class="border-b-2 border-transparent px-3 py-3.5 transition hover:text-white">${doc.label}</button>`)
    .join('');

  const show = (key) => {
    const doc = DOCS[key] || DOCS.terms;
    titleEl.textContent = doc.label;
    bodyEl.innerHTML = doc.html;
    bodyEl.scrollTop = 0;
    tabsEl.querySelectorAll('[data-legal-tab]').forEach((tab) => {
      const active = tab.dataset.legalTab === key;
      tab.classList.toggle('text-white', active);
      tab.classList.toggle('border-dstrito-red', active);
      tab.classList.toggle('border-transparent', !active);
    });
  };

  const open = (key = 'terms') => {
    show(key);
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    modal.querySelector('[data-legal-close]').focus();
  };
  const close = () => {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  };

  modal.addEventListener('click', (event) => {
    if (event.target === modal || event.target.closest('[data-legal-close]')) return close();
    const tab = event.target.closest('[data-legal-tab]');
    if (tab) show(tab.dataset.legalTab);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !modal.classList.contains('hidden')) close();
  });

  // Cualquier elemento con data-legal="terms|privacy|cookies" abre el modal.
  document.addEventListener('click', (event) => {
    const trigger = event.target.closest('[data-legal]');
    if (trigger) {
      event.preventDefault();
      open(trigger.dataset.legal);
    }
    if (event.target.closest('[data-cookie-settings]')) {
      event.preventDefault();
      showBanner();
    }
  });

  // ---------- API pública ----------
  window.DstritoLegal = {
    open,
    close,
    getConsent: readConsent,
    // úsalo para activar scripts opcionales: if (DstritoLegal.hasConsent('analytics')) { ... }
    hasConsent: (kind) => (kind === 'necessary' ? true : Boolean(readConsent()?.[kind])),
  };

  if (!readConsent()) setTimeout(showBanner, 600);
})();
