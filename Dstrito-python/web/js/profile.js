/* DSTRITO · Módulo 4: panel de usuario (dirección de envío, tarjetas, cerrar sesión) */
(() => {
  const BRAND_NAMES = { visa: 'Visa', mastercard: 'Mastercard', amex: 'Amex', diners: 'Diners', otra: 'Tarjeta' };

  const backdrop = document.createElement('div');
  backdrop.id = 'profile-backdrop';
  backdrop.className = 'fixed inset-0 z-50 hidden bg-black/70 backdrop-blur-sm';

  const panel = document.createElement('aside');
  panel.id = 'profile-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', 'Mi perfil');
  panel.className =
    'profile-panel fixed inset-y-0 right-0 z-50 hidden w-full max-w-md flex-col overflow-hidden border-l border-neutral-800 bg-neutral-950 shadow-[0_0_60px_rgba(0,0,0,0.8)]';
  panel.innerHTML = `
    <div class="flex items-center gap-4 border-b border-neutral-800 px-6 py-5">
      <div id="pf-avatar" class="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-dstrito-red text-sm font-semibold uppercase tracking-widest text-dstrito-red"></div>
      <div class="min-w-0 flex-1">
        <p id="pf-name" class="truncate text-sm font-semibold uppercase tracking-[0.16em] text-white"></p>
        <p id="pf-email" class="truncate text-xs text-neutral-500"></p>
      </div>
      <button type="button" id="pf-close" class="rounded-full border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-200 transition hover:border-dstrito-red hover:text-dstrito-red" aria-label="Cerrar">✕</button>
    </div>

    <div class="flex-1 space-y-6 overflow-y-auto px-6 py-6">
      <form id="pf-address-form" class="space-y-4" novalidate>
        <div>
          <h3 class="text-xs font-semibold uppercase tracking-[0.2em] text-white">Dirección de envío predeterminada</h3>
          <p class="mt-1 text-xs text-neutral-500">La usaremos para tus pedidos nuevos.</p>
        </div>
        <div>
          <label class="${DS_LABEL}" for="pf-address">Dirección</label>
          <input id="pf-address" class="${DS_INPUT}" autocomplete="street-address" maxlength="160" placeholder="Calle 10 # 40-20, apto 301" required />
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="${DS_LABEL}" for="pf-city">Ciudad</label>
            <input id="pf-city" class="${DS_INPUT}" autocomplete="address-level2" maxlength="80" placeholder="Medellín" required />
          </div>
          <div>
            <label class="${DS_LABEL}" for="pf-neighborhood">Barrio</label>
            <input id="pf-neighborhood" class="${DS_INPUT}" maxlength="80" placeholder="El Poblado" required />
          </div>
        </div>
        <div>
          <label class="${DS_LABEL}" for="pf-phone">Teléfono de contacto</label>
          <input id="pf-phone" type="tel" class="${DS_INPUT}" autocomplete="tel" maxlength="20" placeholder="300 123 4567" required />
        </div>
        <p id="pf-address-error" class="hidden text-xs text-red-400" role="alert"></p>
        <button type="submit" id="pf-address-save" class="w-full rounded-full bg-dstrito-red px-5 py-3 text-sm font-semibold uppercase tracking-[0.18em] text-black transition hover:bg-red-500">Guardar dirección</button>
      </form>

      <section>
        <h3 class="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-white">Mis tarjetas</h3>
        <div id="pf-cards" class="space-y-2 text-xs text-neutral-300"></div>
      </section>
    </div>

    <div class="border-t border-neutral-800 px-6 py-4">
      <button type="button" id="pf-logout" class="w-full rounded-full border border-dstrito-red bg-neutral-900 px-5 py-3 text-sm font-semibold uppercase tracking-[0.18em] text-dstrito-red transition hover:bg-dstrito-red hover:text-black">Cerrar sesión</button>
    </div>`;
  document.body.append(backdrop, panel);

  const $ = (sel) => panel.querySelector(sel);
  const fields = { address: $('#pf-address'), city: $('#pf-city'), neighborhood: $('#pf-neighborhood'), phone: $('#pf-phone') };
  const errorBox = $('#pf-address-error');
  const cardsBox = $('#pf-cards');

  const setError = (message) => {
    errorBox.textContent = message || '';
    errorBox.classList.toggle('hidden', !message);
  };

  const renderCards = (cards) => {
    if (!cards.length) {
      cardsBox.innerHTML = '<p class="text-neutral-500">Aún no has guardado tarjetas. Podrás agregar una al pagar.</p>';
      return;
    }
    cardsBox.innerHTML = cards
      .map(
        (c) => `
        <div class="flex items-center justify-between gap-3 rounded-2xl border border-neutral-800 bg-neutral-900 px-4 py-3">
          <div class="min-w-0">
            <p class="font-semibold text-white">${esc(BRAND_NAMES[c.brand] || 'Tarjeta')} •••• ${esc(c.last4)}
              ${c.is_default ? '<span class="ml-1 rounded-full border border-dstrito-red px-2 py-0.5 text-[0.55rem] uppercase tracking-[0.14em] text-dstrito-red">Predeterminada</span>' : ''}</p>
            <p class="truncate text-neutral-500">${esc(c.holder_name)} · vence ${String(c.exp_month).padStart(2, '0')}/${String(c.exp_year).slice(-2)}</p>
          </div>
          <div class="flex shrink-0 gap-2">
            ${c.is_default ? '' : `<button type="button" data-card-default="${c.id}" class="rounded-full border border-neutral-700 px-2.5 py-1 text-[0.6rem] uppercase tracking-[0.12em] text-neutral-300 hover:border-dstrito-red hover:text-dstrito-red">Usar</button>`}
            <button type="button" data-card-delete="${c.id}" class="rounded-full border border-neutral-700 px-2.5 py-1 text-[0.6rem] uppercase tracking-[0.12em] text-neutral-400 hover:border-dstrito-red hover:text-dstrito-red" aria-label="Eliminar tarjeta">Eliminar</button>
          </div>
        </div>`
      )
      .join('');
  };

  const load = async () => {
    cardsBox.innerHTML = '<p class="text-neutral-500">Cargando…</p>';
    try {
      const [address, cards] = await Promise.all([apiFetch('/api/me/address'), apiFetch('/api/me/cards')]);
      Object.keys(fields).forEach((k) => { fields[k].value = address?.[k] ?? ''; });
      renderCards(cards);
    } catch (error) {
      if (error.status !== 401) {
        cardsBox.innerHTML = '<p class="text-red-400">No se pudieron cargar tus datos.</p>';
      }
    }
  };

  const open = () => {
    if (typeof currentSession === 'undefined' || !currentSession) return openAuthModal();
    $('#pf-avatar').textContent = getInitials(currentSession.name);
    $('#pf-name').textContent = currentSession.name;
    $('#pf-email').textContent = currentSession.email;
    setError('');
    backdrop.classList.remove('hidden');
    panel.classList.remove('hidden');
    panel.classList.add('flex');
    load();
    fields.address.focus();
  };

  const close = () => {
    backdrop.classList.add('hidden');
    panel.classList.add('hidden');
    panel.classList.remove('flex');
  };

  $('#pf-address-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    setError('');
    const body = Object.fromEntries(Object.entries(fields).map(([k, el]) => [k, el.value.trim()]));
    if (body.address.length < 5) return setError('Escribe una dirección completa.');
    if (body.city.length < 2) return setError('Escribe la ciudad.');
    if (body.neighborhood.length < 2) return setError('Escribe el barrio.');
    if (!/^\+?[0-9][0-9 \-]{6,18}$/.test(body.phone)) return setError('Escribe un teléfono válido (solo números).');

    const button = $('#pf-address-save');
    button.disabled = true;
    try {
      await apiFetch('/api/me/address', { method: 'PUT', body });
      showToast('Dirección guardada.', 'success');
      window.dispatchEvent(new CustomEvent('dstrito:address-updated'));
    } catch (error) {
      if (error.status !== 401) setError(error.message);
    } finally {
      button.disabled = false;
    }
  });

  cardsBox.addEventListener('click', async (event) => {
    const del = event.target.closest('[data-card-delete]');
    const def = event.target.closest('[data-card-default]');
    try {
      if (del && confirm('¿Eliminar esta tarjeta guardada?')) {
        await apiFetch(`/api/me/cards/${del.dataset.cardDelete}`, { method: 'DELETE' });
      } else if (def) {
        await apiFetch(`/api/me/cards/${def.dataset.cardDefault}/default`, { method: 'POST' });
      } else {
        return;
      }
      window.dispatchEvent(new CustomEvent('dstrito:cards-updated'));
      load();
    } catch (error) {
      if (error.status !== 401) showToast(error.message);
    }
  });

  $('#pf-close').addEventListener('click', close);
  backdrop.addEventListener('click', close);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !panel.classList.contains('hidden')) close();
  });
  $('#pf-logout').addEventListener('click', () => {
    close();
    logout();
    showToast('Sesión cerrada.', 'success');
  });

  window.DstritoProfile = { open, close };
})();
