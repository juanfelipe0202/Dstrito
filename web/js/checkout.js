/* DSTRITO · Módulo 2: pasarela de pago en el carrito
 *
 * Seguridad: el número completo de la tarjeta y el CVV se validan SOLO en el
 * navegador y nunca se envían a nuestro servidor. Al backend solo viajan
 * marca, últimos 4, vencimiento y titular. Para cobrar de verdad hay que
 * integrar una pasarela (Wompi, PayU, ePayco, Mercado Pago…) cuyo SDK
 * tokenice la tarjeta en el navegador; ese token iría en `gateway_token`.
 */
(() => {
  const BRAND_NAMES = { visa: 'Visa', mastercard: 'Mastercard', amex: 'Amex', diners: 'Diners', otra: 'Tarjeta' };

  const state = {
    method: 'contraentrega', // 'contraentrega' | 'tarjeta'
    address: null,
    cards: [],
    cardsLoaded: false,
    addingNew: false,
    busy: false,
  };

  // ---------- validaciones de tarjeta ----------
  const detectBrand = (digits) => {
    if (/^4/.test(digits)) return 'visa';
    if (/^(5[1-5]|2(2[2-9]|[3-6]\d|7[01]|720))/.test(digits)) return 'mastercard';
    if (/^3[47]/.test(digits)) return 'amex';
    if (/^(36|30[0-5]|38|39)/.test(digits)) return 'diners';
    return 'otra';
  };
  const luhnValid = (digits) => {
    let sum = 0;
    let alt = false;
    for (let i = digits.length - 1; i >= 0; i--) {
      let n = Number(digits[i]);
      if (alt) { n *= 2; if (n > 9) n -= 9; }
      sum += n;
      alt = !alt;
    }
    return digits.length >= 13 && sum % 10 === 0;
  };
  const parseExpiry = (text) => {
    const m = /^(\d{2})\s*\/\s*(\d{2})$/.exec(text.trim());
    if (!m) return null;
    const month = Number(m[1]);
    const year = 2000 + Number(m[2]);
    if (month < 1 || month > 12) return null;
    const now = new Date();
    if (year < now.getFullYear() || (year === now.getFullYear() && month < now.getMonth() + 1)) return null;
    return { month, year };
  };
  const groupDigits = (digits, brand) =>
    (brand === 'amex' ? digits.replace(/^(\d{0,4})(\d{0,6})(\d{0,5}).*/, '$1 $2 $3') : digits.replace(/(\d{4})(?=\d)/g, '$1 ')).trim();

  // ---------- estructura del DOM ----------
  const checkoutButton = document.getElementById('checkout-button');
  const extra = document.createElement('div');
  extra.id = 'checkout-extra';
  extra.className = 'mt-5 space-y-4';
  extra.innerHTML = `
    <section class="rounded-3xl border border-neutral-800 bg-neutral-900 p-4">
      <div class="mb-2 flex items-center justify-between">
        <h3 class="text-[0.7rem] font-semibold uppercase tracking-[0.2em] text-neutral-400">Envío</h3>
        <button type="button" id="co-edit-address" class="text-[0.65rem] uppercase tracking-[0.16em] text-dstrito-red hover:underline">Editar</button>
      </div>
      <div id="co-address" class="text-xs text-neutral-300"></div>
    </section>
    <section class="rounded-3xl border border-neutral-800 bg-neutral-900 p-4">
      <h3 class="mb-3 text-[0.7rem] font-semibold uppercase tracking-[0.2em] text-neutral-400">Método de pago</h3>
      <div class="grid grid-cols-2 gap-3" role="radiogroup" aria-label="Método de pago">
        <label class="cursor-pointer">
          <input type="radio" name="co-method" value="contraentrega" class="peer sr-only" checked />
          <div class="rounded-2xl border border-neutral-700 bg-neutral-950 px-3 py-3 text-center text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-neutral-300 transition peer-checked:border-dstrito-red peer-checked:text-white peer-focus-visible:ring-2 peer-focus-visible:ring-dstrito-red">
            <span class="block text-lg">💵</span>Efectivo / Contraentrega
          </div>
        </label>
        <label class="cursor-pointer">
          <input type="radio" name="co-method" value="tarjeta" class="peer sr-only" />
          <div class="rounded-2xl border border-neutral-700 bg-neutral-950 px-3 py-3 text-center text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-neutral-300 transition peer-checked:border-dstrito-red peer-checked:text-white peer-focus-visible:ring-2 peer-focus-visible:ring-dstrito-red">
            <span class="block text-lg">💳</span>Tarjeta crédito / débito
          </div>
        </label>
      </div>
      <p id="co-cod-note" class="mt-3 text-[0.7rem] text-neutral-500">Pagas en efectivo cuando recibas tu pedido.</p>
      <div id="co-card-area" class="mt-4 hidden"></div>
    </section>`;
  checkoutButton.parentNode.insertBefore(extra, checkoutButton);

  const $ = (sel) => extra.querySelector(sel);
  const addressBox = $('#co-address');
  const cardArea = $('#co-card-area');
  const codNote = $('#co-cod-note');

  // ---------- dirección ----------
  const renderAddress = () => {
    if (typeof currentSession === 'undefined' || !currentSession) {
      addressBox.innerHTML = '<p class="text-neutral-500">Inicia sesión para ver tu dirección de envío.</p>';
    } else if (!state.address) {
      addressBox.innerHTML = `<p class="text-amber-300">Aún no tienes dirección de envío. Agrégala en tu perfil para poder pagar.</p>`;
    } else {
      const a = state.address;
      addressBox.innerHTML = `
        <p class="font-semibold text-white">${esc(a.address)}</p>
        <p>${esc(a.neighborhood)} · ${esc(a.city)}</p>
        <p class="text-neutral-500">Tel. ${esc(a.phone)}</p>`;
    }
  };

  // ---------- tarjetas ----------
  const cardLabel = (c) => `${BRAND_NAMES[c.brand] || 'Tarjeta'} •••• ${c.last4} · ${String(c.exp_month).padStart(2, '0')}/${String(c.exp_year).slice(-2)}`;

  const cardFormHtml = () => `
    <div class="space-y-3" id="co-card-form">
      <div>
        <label class="${DS_LABEL}" for="co-holder">Nombre del titular</label>
        <input id="co-holder" class="${DS_INPUT}" autocomplete="cc-name" placeholder="Como aparece en la tarjeta" maxlength="80" />
      </div>
      <div>
        <label class="${DS_LABEL}" for="co-number">Número de tarjeta <span id="co-brand" class="ml-1 normal-case tracking-normal text-dstrito-red"></span></label>
        <input id="co-number" class="${DS_INPUT}" inputmode="numeric" autocomplete="cc-number" placeholder="0000 0000 0000 0000" maxlength="23" />
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="${DS_LABEL}" for="co-exp">Vencimiento</label>
          <input id="co-exp" class="${DS_INPUT}" inputmode="numeric" autocomplete="cc-exp" placeholder="MM/AA" maxlength="5" />
        </div>
        <div>
          <label class="${DS_LABEL}" for="co-cvv">CVV</label>
          <input id="co-cvv" type="password" class="${DS_INPUT}" inputmode="numeric" autocomplete="cc-csc" placeholder="•••" maxlength="4" />
        </div>
      </div>
      <p id="co-card-error" class="hidden text-[0.7rem] text-red-400" role="alert"></p>
      <p class="text-[0.65rem] leading-relaxed text-neutral-500">🔒 Tu número completo y el CVV no se guardan en nuestros servidores. Solo conservamos marca, últimos 4 dígitos, vencimiento y titular.</p>
    </div>`;

  const renderCardArea = () => {
    if (state.method !== 'tarjeta') { cardArea.classList.add('hidden'); return; }
    cardArea.classList.remove('hidden');

    if (typeof currentSession === 'undefined' || !currentSession) {
      cardArea.innerHTML = '<p class="text-xs text-neutral-400">Inicia sesión para pagar con tarjeta.</p>';
      return;
    }
    if (!state.cardsLoaded) {
      cardArea.innerHTML = '<p class="text-xs text-neutral-500">Cargando tus tarjetas…</p>';
      return;
    }

    // Sin tarjetas guardadas → formulario directo.
    if (state.cards.length === 0) {
      state.addingNew = true;
      cardArea.innerHTML = cardFormHtml();
      return;
    }

    const options = state.cards
      .map((c) => `<option value="${c.id}"${c.is_default ? ' selected' : ''}>${esc(cardLabel(c))}${c.is_default ? ' (predeterminada)' : ''}</option>`)
      .join('');
    cardArea.innerHTML = `
      <div class="space-y-3">
        <div class="${state.addingNew ? 'opacity-50' : ''}">
          <label class="${DS_LABEL}" for="co-card-select">Tarjeta guardada</label>
          <select id="co-card-select" class="${DS_INPUT}" ${state.addingNew ? 'disabled' : ''}>${options}</select>
        </div>
        <button type="button" id="co-toggle-new" class="w-full rounded-full border border-dashed border-neutral-600 px-4 py-2 text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-neutral-300 transition hover:border-dstrito-red hover:text-dstrito-red">
          ${state.addingNew ? '← Usar una tarjeta guardada' : '+ Agregar nueva tarjeta'}
        </button>
        ${state.addingNew ? cardFormHtml() : ''}
      </div>`;
  };

  const showCardError = (message) => {
    const box = $('#co-card-error');
    if (!box) return showToast(message);
    box.textContent = message;
    box.classList.remove('hidden');
  };

  // Lee y valida el formulario → { holder_name, brand, last4, exp_month, exp_year } o null.
  const readCardForm = () => {
    const holder = $('#co-holder').value.trim();
    const digits = $('#co-number').value.replace(/\D/g, '');
    const brand = detectBrand(digits);
    const expiry = parseExpiry($('#co-exp').value);
    const cvv = $('#co-cvv').value.trim();

    if (holder.length < 2) return showCardError('Escribe el nombre del titular.'), null;
    if (!luhnValid(digits)) return showCardError('El número de tarjeta no es válido.'), null;
    if (!expiry) return showCardError('Revisa el vencimiento (MM/AA) — la tarjeta no puede estar vencida.'), null;
    if (!new RegExp(`^\\d{${brand === 'amex' ? 4 : 3}}$`).test(cvv)) {
      return showCardError(`El CVV debe tener ${brand === 'amex' ? 4 : 3} dígitos.`), null;
    }
    return { holder_name: holder, brand, last4: digits.slice(-4), exp_month: expiry.month, exp_year: expiry.year };
  };

  // ---------- carga de datos ----------
  const loadCheckoutData = async () => {
    if (typeof currentSession === 'undefined' || !currentSession) {
      state.address = null; state.cards = []; state.cardsLoaded = false;
      renderAddress(); renderCardArea();
      return;
    }
    renderAddress();
    try { state.address = await apiFetch('/api/me/address'); } catch (_) { state.address = null; }
    renderAddress();
    try {
      state.cards = await apiFetch('/api/me/cards');
      state.cardsLoaded = true;
      state.addingNew = state.cards.length === 0;
    } catch (_) {
      state.cards = []; state.cardsLoaded = true;
    }
    renderCardArea();
  };

  // ---------- eventos ----------
  extra.addEventListener('change', (event) => {
    if (event.target.name === 'co-method') {
      state.method = event.target.value;
      codNote.classList.toggle('hidden', state.method !== 'contraentrega');
      renderCardArea();
      if (state.method === 'tarjeta' && !state.cardsLoaded) loadCheckoutData();
    }
  });

  extra.addEventListener('click', (event) => {
    if (event.target.closest('#co-edit-address')) {
      if (typeof currentSession === 'undefined' || !currentSession) return openAuthModal();
      cartModal.classList.add('hidden');
      DstritoProfile.open();
    }
    if (event.target.closest('#co-toggle-new')) {
      state.addingNew = !state.addingNew;
      renderCardArea();
    }
  });

  // Formato en vivo del formulario de tarjeta.
  extra.addEventListener('input', (event) => {
    const el = event.target;
    if (el.id === 'co-number') {
      const digits = el.value.replace(/\D/g, '').slice(0, 19);
      const brand = detectBrand(digits);
      el.value = groupDigits(digits, brand);
      $('#co-brand').textContent = digits.length >= 1 && brand !== 'otra' ? BRAND_NAMES[brand] : '';
    } else if (el.id === 'co-exp') {
      const digits = el.value.replace(/\D/g, '').slice(0, 4);
      el.value = digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits;
    } else if (el.id === 'co-cvv') {
      el.value = el.value.replace(/\D/g, '').slice(0, 4);
    }
    $('#co-card-error')?.classList.add('hidden');
  });

  document.getElementById('cart-button')?.addEventListener('click', loadCheckoutData);
  window.addEventListener('dstrito:address-updated', loadCheckoutData);
  window.addEventListener('dstrito:cards-updated', loadCheckoutData);

  // ---------- pagar ----------
  const setBusy = (busy) => {
    state.busy = busy;
    checkoutButton.disabled = busy;
    checkoutButton.classList.toggle('opacity-60', busy);
    checkoutButton.textContent = busy ? 'Procesando…' : 'Pagar ahora';
  };

  checkoutButton.addEventListener('click', async () => {
    if (state.busy) return;
    if (cart.size === 0) return showToast('Añade productos al carrito antes de pagar.');
    if (!currentSession) {
      showToast('Inicia sesión para completar tu pedido.');
      cartModal.classList.add('hidden');
      return openAuthModal();
    }
    if (!state.address) {
      showToast('Agrega tu dirección de envío para continuar.');
      cartModal.classList.add('hidden');
      return DstritoProfile.open();
    }

    setBusy(true);
    try {
      let cardId = null;
      if (state.method === 'tarjeta') {
        if (state.addingNew) {
          const card = readCardForm();
          if (!card) return;
          const saved = await apiFetch('/api/me/cards', { method: 'POST', body: card });
          cardId = saved.id;
          state.cards.unshift(saved);
          state.addingNew = false;
        } else {
          cardId = Number($('#co-card-select')?.value) || null;
        }
        if (!cardId) return showToast('Selecciona o agrega una tarjeta.');
      }

      const items = Array.from(cart.values()).map(({ id, name, price, quantity }) => ({ id, name, price, quantity }));
      const data = await apiFetch('/api/orders', {
        method: 'POST',
        body: { items, payment_method: state.method, card_id: cardId },
      });
      showToast(data.message || 'Pedido recibido.', 'success');
      cart.clear();
      updateCartDisplay();
      cartModal.classList.add('hidden');
      window.dispatchEvent(new CustomEvent('dstrito:cards-updated'));
    } catch (error) {
      if (error.status !== 401) showToast(error.message);
    } finally {
      setBusy(false);
    }
  });

  renderAddress();
  window.DstritoCheckout = { refresh: loadCheckoutData, luhnValid, detectBrand };
})();
