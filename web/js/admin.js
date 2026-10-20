/* DSTRITO · Módulo 3: panel de administración con ventanas interactivas
 *
 * - Tres ventanas: Usuarios · Pedidos pendientes · Agregar prenda.
 * - Cada una se puede abrir, minimizar (barra de título), cerrar, arrastrar
 *   (escritorio) y redimensionar. El "dock" superior las reabre en un clic.
 * - Posición y estado se recuerdan en localStorage.
 */
(() => {
  const LAYOUT_KEY = 'dstrito-admin-layout-v1';
  const PAY_LABEL = { contraentrega: 'Contraentrega' };

  // ---------- definición de ventanas ----------
  const WINDOWS = [
    { id: 'users', icon: '👥', title: 'Usuarios', w: 380, h: 440, x: 20, y: 20, state: 'open' },
    { id: 'orders', icon: '📦', title: 'Pedidos pendientes', w: 460, h: 520, x: 420, y: 20, state: 'open' },
    { id: 'product', icon: '➕', title: 'Agregar prenda', w: 380, h: 500, x: 900, y: 20, state: 'min' },
    { id: 'inventory', icon: '🧥', title: 'Inventario', w: 640, h: 460, x: 20, y: 480, state: 'open' },
  ];
  const meta = Object.fromEntries(WINDOWS.map((w) => [w.id, w]));

  let layout;
  try { layout = JSON.parse(localStorage.getItem(LAYOUT_KEY)) || {}; } catch (_) { layout = {}; }
  const lay = (id) => (layout[id] = { x: meta[id].x, y: meta[id].y, w: meta[id].w, h: meta[id].h, state: meta[id].state, ...layout[id] });
  WINDOWS.forEach((w) => lay(w.id));
  const saveLayout = () => { try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout)); } catch (_) {} };

  const counts = { users: 0, orders: 0, inventory: 0 };
  let zTop = 10;
  let refreshTimer = null;
  let usersCache = [];

  // ---------- estructura ----------
  const root = document.createElement('div');
  root.id = 'admin-panel'; // el script principal espera este id (logout lo oculta)
  root.className = 'fixed inset-0 z-50 hidden flex-col bg-black/85 backdrop-blur-md';
  root.innerHTML = `
    <header class="flex flex-wrap items-center gap-3 border-b border-neutral-800 bg-neutral-950/90 px-4 py-3">
      <div class="mr-2">
        <p class="text-[0.6rem] uppercase tracking-[0.3em] text-dstrito-red">Dstrito</p>
        <h2 class="text-sm font-semibold uppercase tracking-[0.2em] text-white">Panel de administrador</h2>
      </div>
      <nav id="ad-dock" class="flex flex-1 flex-wrap items-center gap-2" aria-label="Ventanas"></nav>
      <button type="button" data-ad="reset" class="rounded-full border border-neutral-700 px-3 py-1.5 text-[0.65rem] uppercase tracking-[0.14em] text-neutral-400 hover:border-dstrito-red hover:text-dstrito-red">Reordenar</button>
      <button type="button" data-ad="logout" class="rounded-full border border-neutral-700 px-3 py-1.5 text-[0.65rem] uppercase tracking-[0.14em] text-neutral-200 hover:border-dstrito-red hover:text-dstrito-red">Cerrar sesión</button>
      <button type="button" data-ad="close" class="rounded-full bg-dstrito-red px-3.5 py-1.5 text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-black hover:bg-red-500" aria-label="Cerrar panel">✕ Cerrar panel</button>
    </header>
    <div id="ad-workspace" class="ad-workspace relative flex-1 overflow-auto p-3"></div>`;
  document.body.appendChild(root);

  const dock = root.querySelector('#ad-dock');
  const workspace = root.querySelector('#ad-workspace');

  const bodies = {
    users: `
      <input id="ad-user-search" type="search" placeholder="Buscar por nombre o correo…" class="${DS_INPUT} mb-3" />
      <div id="ad-user-list" class="space-y-2 text-xs"></div>`,
    orders: `<div id="ad-order-list" class="space-y-3 text-xs"></div>`,
    inventory: `
      <input id="ad-inv-search" type="search" placeholder="Buscar prenda…" class="${DS_INPUT} mb-3" />
      <div id="ad-inv-list" class="space-y-2 text-xs"></div>`,
    product: `
      <form id="ad-product-form" class="space-y-3">
        <div><label class="${DS_LABEL}" for="ad-p-name">Nombre</label>
          <input id="ad-p-name" required maxlength="120" class="${DS_INPUT}" placeholder="Nombre de la prenda" /></div>
        <div><label class="${DS_LABEL}" for="ad-p-cat">Categoría</label>
          <select id="ad-p-cat" class="${DS_INPUT}"><option>Hoodies</option><option>Camisetas</option><option>Pantalones</option><option>Pantalonetas</option><option>Accesorios</option></select></div>
        <div class="grid grid-cols-2 gap-3">
          <div><label class="${DS_LABEL}" for="ad-p-price">Precio (COP)</label>
            <input id="ad-p-price" type="number" min="0" step="1000" required class="${DS_INPUT}" placeholder="90000" /></div>
          <div><label class="${DS_LABEL}" for="ad-p-stock">Stock</label>
            <input id="ad-p-stock" type="number" min="0" max="100000" step="1" value="1" required class="${DS_INPUT}" placeholder="10" /></div>
        </div>
        <div>
          <label class="${DS_LABEL}" for="product-images">Imágenes (hasta 6 · JPG, PNG o WebP · máx. 5 MB c/u)</label>
          <input id="product-images" type="file" multiple accept="image/*"
            class="block w-full cursor-pointer rounded-xl border border-dashed border-neutral-600 bg-neutral-950 text-xs text-neutral-400 file:mr-3 file:cursor-pointer file:rounded-l-xl file:border-0 file:bg-neutral-800 file:px-3 file:py-2.5 file:text-[0.65rem] file:font-semibold file:uppercase file:tracking-[0.14em] file:text-neutral-200 hover:border-dstrito-red" />
          <p id="ad-p-hint" class="mt-1.5 text-[0.65rem] text-neutral-500">La primera es la imagen principal.</p>
          <div id="ad-p-previews" class="mt-2 grid grid-cols-3 gap-2"></div>
        </div>
        <div><label class="${DS_LABEL}" for="ad-p-desc">Descripción</label>
          <textarea id="ad-p-desc" rows="3" maxlength="600" class="${DS_INPUT}" placeholder="Descripción breve"></textarea></div>
        <button type="submit" class="w-full rounded-full bg-dstrito-red px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.18em] text-black transition hover:bg-red-500">Agregar prenda</button>
      </form>`,
  };

  WINDOWS.forEach((w) => {
    const el = document.createElement('section');
    el.className = 'ad-window';
    el.id = `ad-win-${w.id}`;
    el.dataset.win = w.id;
    el.setAttribute('aria-label', w.title);
    el.innerHTML = `
      <div class="ad-titlebar" data-drag>
        <div class="flex items-center gap-1.5">
          <button type="button" data-win-close class="ad-dot bg-red-500" aria-label="Cerrar ${w.title}" title="Cerrar"></button>
          <button type="button" data-win-min class="ad-dot bg-amber-400" aria-label="Minimizar ${w.title}" title="Minimizar / restaurar"></button>
        </div>
        <span class="flex-1 truncate text-center text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-neutral-200">${w.icon} ${w.title}<span data-badge class="ml-2 rounded-full bg-neutral-800 px-1.5 py-0.5 text-[0.6rem] text-neutral-400"></span></span>
        ${w.id === 'product' ? '<span class="w-10"></span>' : `<button type="button" data-win-refresh class="w-10 text-right text-xs text-neutral-500 hover:text-dstrito-red" aria-label="Actualizar" title="Actualizar">↻</button>`}
      </div>
      <div class="ad-body">${bodies[w.id]}</div>`;
    workspace.appendChild(el);
  });

  const winEl = (id) => workspace.querySelector(`#ad-win-${id}`);

  // ---------- estado de las ventanas ----------
  const applyWindow = (id) => {
    const s = lay(id);
    const el = winEl(id);
    el.dataset.state = s.state;
    el.style.setProperty('--x', `${s.x}px`);
    el.style.setProperty('--y', `${s.y}px`);
    el.style.setProperty('--w', `${s.w}px`);
    el.style.setProperty('--h', `${s.h}px`);
    renderDock();
  };

  const focusWindow = (id) => { winEl(id).style.setProperty('--z', String(++zTop)); };

  const setState = (id, state) => {
    lay(id).state = state;
    applyWindow(id);
    if (state === 'open') { focusWindow(id); refresh(id); }
    saveLayout();
  };

  const renderDock = () => {
    dock.innerHTML = WINDOWS.map((w) => {
      const s = lay(w.id).state;
      const dot = s === 'open' ? 'bg-green-400' : s === 'min' ? 'bg-amber-400' : 'bg-neutral-600';
      const badge = counts[w.id] != null && counts[w.id] > 0
        ? `<span class="rounded-full bg-dstrito-red px-1.5 text-[0.6rem] font-bold text-black">${counts[w.id]}</span>` : '';
      return `<button type="button" data-dock="${w.id}" class="flex items-center gap-2 rounded-full border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-[0.68rem] uppercase tracking-[0.12em] text-neutral-200 transition hover:border-dstrito-red" title="${s === 'open' ? 'Minimizar' : 'Abrir'} ${w.title}">
        <span class="h-2 w-2 rounded-full ${dot}"></span>${w.icon} ${w.title} ${badge}</button>`;
    }).join('');
    WINDOWS.forEach((w) => {
      const badge = winEl(w.id)?.querySelector('[data-badge]');
      if (badge) badge.textContent = counts[w.id] > 0 ? String(counts[w.id]) : '';
    });
  };

  // ---------- datos ----------
  const dateText = (ts) => { try { return new Date(ts).toLocaleString('es-CO'); } catch (_) { return ''; } };

  const renderUsers = () => {
    const q = (root.querySelector('#ad-user-search')?.value || '').trim().toLowerCase();
    const list = root.querySelector('#ad-user-list');
    const rows = usersCache.filter((u) => !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q));
    list.innerHTML = rows.length
      ? rows.map((u) => `
          <div class="flex items-center justify-between gap-3 rounded-xl bg-neutral-900 px-3 py-2">
            <div class="min-w-0"><strong class="block truncate text-white">${esc(u.name)}</strong>
              <span class="block truncate text-neutral-500">${esc(u.email)}</span></div>
            <div class="shrink-0 text-right text-[0.6rem] uppercase tracking-[0.12em]">
              <span class="${u.role === 'admin' ? 'text-dstrito-red' : 'text-neutral-400'}">${esc(u.role)}</span>
              <span class="block text-neutral-600">${esc(u.provider || 'local')}</span></div>
          </div>`).join('')
      : '<p class="text-neutral-500">Sin resultados.</p>';
  };

  const loadUsers = async () => {
    try {
      usersCache = await apiFetch('/api/admin/users');
      counts.users = usersCache.length;
      renderUsers();
    } catch (error) {
      root.querySelector('#ad-user-list').innerHTML = `<p class="text-red-400">${esc(error.message)}</p>`;
    }
    renderDock();
  };

  const paymentText = (o) =>
    o.payment_method === 'tarjeta' ? `💳 ${esc(o.payment_card_label || 'Tarjeta')}` : `💵 ${PAY_LABEL.contraentrega}`;

  const loadOrders = async () => {
    const list = root.querySelector('#ad-order-list');
    try {
      const all = await apiFetch('/api/admin/orders');
      const pending = all.filter((o) => o.status === 'pendiente');
      counts.orders = pending.length;
      list.innerHTML = pending.length
        ? pending.map((o) => `
            <article class="space-y-2 rounded-xl border border-neutral-800 bg-neutral-900 p-3">
              <div class="flex items-center justify-between"><strong class="text-white">${esc(o.name)}</strong><span class="text-neutral-500">#${o.id}</span></div>
              <p class="text-neutral-500">${esc(o.email)}</p>
              <p class="text-neutral-300">${(o.items || []).map((i) => `${esc(i.name)} ×${i.quantity}`).join(', ')}</p>
              <div class="flex items-center justify-between text-neutral-200"><strong>${formatPrice(o.total)}</strong>
                <span class="rounded-full border border-neutral-700 px-2 py-0.5 text-[0.62rem]">${paymentText(o)}</span></div>
              ${o.ship_address ? `<p class="rounded-lg bg-neutral-950 px-2.5 py-2 text-[0.68rem] leading-relaxed text-neutral-400">📍 ${esc(o.ship_address)}, ${esc(o.ship_neighborhood)}, ${esc(o.ship_city)} · Tel. ${esc(o.ship_phone)}</p>` : ''}
              <p class="text-[0.62rem] text-neutral-600">${dateText(o.createdAt)}</p>
              <div class="flex gap-2 pt-1">
                <button type="button" data-order="complete" data-id="${o.id}" class="flex-1 rounded-full border border-neutral-700 bg-neutral-950 px-3 py-2 text-[0.65rem] uppercase tracking-[0.14em] text-neutral-200 hover:border-dstrito-red hover:text-dstrito-red">Completar</button>
                <button type="button" data-order="reject" data-id="${o.id}" class="flex-1 rounded-full border border-dstrito-red bg-neutral-950 px-3 py-2 text-[0.65rem] uppercase tracking-[0.14em] text-dstrito-red hover:bg-dstrito-red hover:text-black">Rechazar</button>
              </div>
            </article>`).join('')
        : '<p class="text-neutral-500">No hay pedidos pendientes. 🎉</p>';
    } catch (error) {
      list.innerHTML = `<p class="text-red-400">${esc(error.message)}</p>`;
    }
    renderDock();
  };

  function refresh(id) {
    if (id === 'users') return loadUsers();
    if (id === 'orders') return loadOrders();
    if (id === 'inventory') return loadInventory();
  }
  const refreshVisible = () => WINDOWS.forEach((w) => lay(w.id).state === 'open' && refresh(w.id));
  const refreshAllCounts = () => { loadUsers(); loadOrders(); loadInventory(); }; // para los contadores del dock

  // ---------- panel ----------
  const open = () => {
    root.classList.remove('hidden');
    root.classList.add('flex');
    WINDOWS.forEach((w) => { applyWindow(w.id); });
    refreshAllCounts();
    clearInterval(refreshTimer);
    refreshTimer = setInterval(refreshAllCounts, 30000);
  };
  const close = () => {
    root.classList.add('hidden');
    root.classList.remove('flex');
    clearInterval(refreshTimer);
    refreshTimer = null;
  };
  const toggle = () => (root.classList.contains('hidden') ? open() : close());

  // ---------- interacciones ----------
  root.addEventListener('click', async (event) => {
    const t = event.target;
    const dockBtn = t.closest('[data-dock]');
    if (dockBtn) {
      const id = dockBtn.dataset.dock;
      return setState(id, lay(id).state === 'open' ? 'min' : 'open');
    }
    const act = t.closest('[data-ad]')?.dataset.ad;
    if (act === 'close') return close();
    if (act === 'logout') { close(); return logout(); }
    if (act === 'reset') {
      WINDOWS.forEach((w) => { layout[w.id] = { x: w.x, y: w.y, w: w.w, h: w.h, state: w.state }; applyWindow(w.id); });
      return saveLayout();
    }

    const win = t.closest('.ad-window');
    if (win) {
      const id = win.dataset.win;
      if (t.closest('[data-win-close]')) return setState(id, 'closed');
      if (t.closest('[data-win-min]')) return setState(id, lay(id).state === 'min' ? 'open' : 'min');
      if (t.closest('[data-win-refresh]')) return refresh(id);
      focusWindow(id);
    }

    const editBtn = t.closest('[data-inv-edit]');
    if (editBtn) return openEdit(Number(editBtn.dataset.invEdit));
    const delBtn = t.closest('[data-inv-delete]');
    if (delBtn) return deleteProduct(Number(delBtn.dataset.invDelete), delBtn);

    const moveBtn = t.closest('[data-inv-move]');
    if (moveBtn) return moveProduct(Number(moveBtn.dataset.id), moveBtn.dataset.invMove, moveBtn);

    const orderBtn = t.closest('[data-order]');
    if (orderBtn) {
      const { id } = orderBtn.dataset;
      const action = orderBtn.dataset.order;
      if (action === 'reject' && !confirm(`¿Rechazar el pedido #${id}?`)) return;
      orderBtn.disabled = true;
      try {
        await apiFetch(`/api/admin/orders/${id}/${action}`, { method: 'POST' });
        showToast(action === 'complete' ? 'Pedido completado.' : 'Pedido rechazado.', 'success');
      } catch (error) {
        showToast(error.message);
      }
      loadOrders();
    }
  });

  // doble clic en la barra de título = minimizar / restaurar
  workspace.addEventListener('dblclick', (event) => {
    const bar = event.target.closest('.ad-titlebar');
    if (!bar || event.target.closest('button')) return;
    const id = bar.parentElement.dataset.win;
    setState(id, lay(id).state === 'min' ? 'open' : 'min');
  });

  // arrastre (solo escritorio; en móvil las ventanas van apiladas)
  const desktop = window.matchMedia('(min-width: 768px)');
  workspace.addEventListener('pointerdown', (event) => {
    const bar = event.target.closest('[data-drag]');
    if (!bar || event.target.closest('button') || !desktop.matches) return;
    const el = bar.parentElement;
    const id = el.dataset.win;
    const s = lay(id);
    const startX = event.clientX - s.x;
    const startY = event.clientY - s.y;
    focusWindow(id);
    bar.setPointerCapture(event.pointerId);
    const move = (e) => {
      s.x = Math.max(0, Math.min(e.clientX - startX, workspace.scrollWidth - 120));
      s.y = Math.max(0, Math.min(e.clientY - startY, workspace.scrollHeight - 40));
      el.style.setProperty('--x', `${s.x}px`);
      el.style.setProperty('--y', `${s.y}px`);
    };
    const up = () => {
      bar.removeEventListener('pointermove', move);
      bar.removeEventListener('pointerup', up);
      bar.removeEventListener('pointercancel', up);
      saveLayout();
    };
    bar.addEventListener('pointermove', move);
    bar.addEventListener('pointerup', up);
    bar.addEventListener('pointercancel', up);
  });

  // tamaño (resize nativo del navegador) → se recuerda
  if ('ResizeObserver' in window) {
    const observer = new ResizeObserver((entries) => {
      entries.forEach(({ target }) => {
        const id = target.dataset.win;
        if (lay(id).state !== 'open' || !desktop.matches || !target.offsetWidth) return;
        lay(id).w = target.offsetWidth;
        lay(id).h = target.offsetHeight;
        target.style.setProperty('--w', `${lay(id).w}px`);
        target.style.setProperty('--h', `${lay(id).h}px`);
        saveLayout();
      });
    });
    WINDOWS.forEach((w) => observer.observe(winEl(w.id)));
  }

  root.querySelector('#ad-user-search').addEventListener('input', renderUsers);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !root.classList.contains('hidden') && editModal.classList.contains('hidden') && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) close();
  });

  // ---------- formulario de producto: varias imágenes como archivos ----------
  const MAX_IMAGES = 6;
  const MAX_BYTES = 5 * 1024 * 1024;
  const form = root.querySelector('#ad-product-form');
  const fileInput = root.querySelector('#product-images');
  const previews = root.querySelector('#ad-p-previews');
  const hint = root.querySelector('#ad-p-hint');
  let selected = []; // File[] — lista propia, para poder quitar fotos antes de enviar

  const renderPreviews = () => {
    previews.querySelectorAll('img').forEach((img) => URL.revokeObjectURL(img.src)); // libera memoria
    previews.innerHTML = '';
    selected.forEach((file, index) => {
      const cell = document.createElement('div');
      cell.className = 'relative';
      const img = document.createElement('img');
      img.src = URL.createObjectURL(file);
      img.alt = file.name;
      img.className = 'h-20 w-full rounded-lg border border-neutral-800 bg-neutral-900 object-cover';
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.dataset.removeImage = String(index);
      remove.setAttribute('aria-label', `Quitar ${file.name}`);
      remove.className = 'absolute right-1 top-1 h-5 w-5 rounded-full bg-black/80 text-[0.65rem] leading-5 text-white hover:bg-dstrito-red hover:text-black';
      remove.textContent = '✕';
      cell.append(img, remove);
      if (index === 0) {
        const tag = document.createElement('span');
        tag.className = 'absolute bottom-1 left-1 rounded bg-dstrito-red px-1.5 text-[0.55rem] font-bold uppercase text-black';
        tag.textContent = 'Principal';
        cell.append(tag);
      }
      previews.append(cell);
    });
    hint.textContent = selected.length ? `${selected.length} de ${MAX_IMAGES} imágenes seleccionadas.` : 'La primera es la imagen principal.';
  };

  // Cada vez que eligen archivos se SUMAN a los anteriores (validando tipo, tamaño y cantidad).
  fileInput.addEventListener('change', () => {
    const rejected = [];
    for (const file of fileInput.files) {
      if (selected.length >= MAX_IMAGES) { rejected.push(`máximo ${MAX_IMAGES} imágenes`); break; }
      if (!/^image\/(jpeg|png|webp)$/.test(file.type)) { rejected.push(`«${file.name}» no es JPG, PNG ni WebP`); continue; }
      if (file.size > MAX_BYTES) { rejected.push(`«${file.name}» pesa más de 5 MB`); continue; }
      selected.push(file);
    }
    fileInput.value = ''; // permite volver a elegir el mismo archivo
    if (rejected.length) showToast(`No se agregó: ${rejected.join('; ')}.`);
    renderPreviews();
  });

  previews.addEventListener('click', (event) => {
    const button = event.target.closest('[data-remove-image]');
    if (!button) return;
    selected.splice(Number(button.dataset.removeImage), 1);
    renderPreviews();
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (selected.length === 0) return showToast('Selecciona al menos una imagen.');

    // FormData → multipart/form-data. Los nombres de campo deben coincidir con los del endpoint.
    const data = new FormData();
    data.append('name', root.querySelector('#ad-p-name').value.trim());
    data.append('category', root.querySelector('#ad-p-cat').value);
    data.append('price', root.querySelector('#ad-p-price').value);
    data.append('stock', root.querySelector('#ad-p-stock').value || '0');
    data.append('description', root.querySelector('#ad-p-desc').value.trim());
    selected.forEach((file) => data.append('images', file)); // mismo nombre repetido = lista de archivos

    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    button.textContent = 'Subiendo imágenes…';
    try {
      await apiFetch('/api/products', { method: 'POST', body: data }); // sin tocar Content-Type
      form.reset();
      selected = [];
      renderPreviews();
      showToast('Prenda agregada al catálogo.', 'success');
      loadInventory();
      if (typeof renderDynamicProducts === 'function') renderDynamicProducts();
    } catch (error) {
      if (error.status !== 401) showToast(error.message);
    } finally {
      button.disabled = false;
      button.textContent = 'Agregar prenda';
    }
  });

  // =====================================================================
  // INVENTARIO: lista de prendas + editar (modal) + eliminar
  // =====================================================================
  let productsCache = [];

  const stockBadge = (stock) =>
    stock <= 0
      ? '<span class="rounded-full border border-red-500/60 px-2 py-0.5 text-[0.62rem] uppercase tracking-[0.1em] text-red-400">Agotado</span>'
      : `<span class="rounded-full border ${stock <= 5 ? 'border-amber-400/60 text-amber-300' : 'border-neutral-700 text-neutral-300'} px-2 py-0.5 text-[0.62rem] uppercase tracking-[0.1em]">${stock} uds.</span>`;

  const inventoryCategoryOrder = ['hoodies', 'camisetas', 'pantalones', 'pantalonetas'];
  const normalizeCategory = (category) => (category || '').trim().toLocaleLowerCase('es');
  const productsInCategory = (category) => productsCache
    .filter((product) => product.category === category)
    .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));

  const renderInventory = () => {
    const q = (root.querySelector('#ad-inv-search')?.value || '').trim().toLowerCase();
    const list = root.querySelector('#ad-inv-list');
    const groups = new Map();
    productsCache.forEach((product) => {
      const savedCategory = (product.category || '').trim();
      const category = !savedCategory || savedCategory.toLocaleLowerCase('es') === 'otros'
        ? 'Accesorios'
        : savedCategory;
      if (!groups.has(product.category)) groups.set(product.category, { label: category, products: [] });
      groups.get(product.category).products.push(product);
    });
    const orderedGroups = Array.from(groups).sort(([categoryA], [categoryB]) => {
      const normalizedA = normalizeCategory(categoryA);
      const normalizedB = normalizeCategory(categoryB);
      const rank = (category) => {
        if (category === 'accesorios') return inventoryCategoryOrder.length + 1;
        const index = inventoryCategoryOrder.indexOf(category);
        return index === -1 ? inventoryCategoryOrder.length : index;
      };
      return rank(normalizedA) - rank(normalizedB)
        || normalizedA.localeCompare(normalizedB, 'es');
    });
    list.innerHTML = orderedGroups.length
      ? orderedGroups.map(([category, group]) => {
          const products = productsInCategory(category);
          const visibleProducts = products.filter((product) =>
            !q || product.name.toLowerCase().includes(q) || group.label.toLowerCase().includes(q));
          if (!visibleProducts.length) return '';
          return `
          <section class="space-y-2">
            <h3 class="border-b border-neutral-800 pb-1 text-[0.65rem] font-semibold uppercase tracking-[0.18em] text-dstrito-red">${esc(group.label)}</h3>
            ${visibleProducts.map((p) => {
              const position = products.findIndex((product) => product.id === p.id);
              return `
          <div class="flex items-center gap-3 rounded-xl bg-neutral-900 p-2">
            <img src="${esc(p.image)}" alt="" loading="lazy" class="h-14 w-14 shrink-0 rounded-lg border border-neutral-800 bg-neutral-950 object-cover" onerror="this.style.opacity=.2" />
            <div class="min-w-0 flex-1">
              <strong class="block truncate text-white">${esc(p.name)}</strong>
              <span class="block truncate text-neutral-500">${esc(p.category)} · ${p.images.length} img</span>
              <span class="text-neutral-200">${formatPrice(p.price)}</span>
            </div>
            <div class="shrink-0">${stockBadge(p.stock)}</div>
            <div class="flex shrink-0 flex-col gap-1.5">
              <button type="button" data-inv-move="up" data-id="${p.id}" aria-label="Subir ${esc(p.name)}" title="Subir" ${position === 0 ? 'disabled' : ''} class="rounded-full border border-neutral-700 px-2 py-0.5 text-xs text-neutral-200 enabled:hover:border-dstrito-red enabled:hover:text-dstrito-red disabled:cursor-not-allowed disabled:opacity-30">↑</button>
              <button type="button" data-inv-move="down" data-id="${p.id}" aria-label="Bajar ${esc(p.name)}" title="Bajar" ${position === products.length - 1 ? 'disabled' : ''} class="rounded-full border border-neutral-700 px-2 py-0.5 text-xs text-neutral-200 enabled:hover:border-dstrito-red enabled:hover:text-dstrito-red disabled:cursor-not-allowed disabled:opacity-30">↓</button>
            </div>
            <div class="flex shrink-0 flex-col gap-1.5">
              <button type="button" data-inv-edit="${p.id}" class="rounded-full border border-neutral-700 px-3 py-1 text-[0.62rem] uppercase tracking-[0.12em] text-neutral-200 hover:border-dstrito-red hover:text-dstrito-red">Editar</button>
              <button type="button" data-inv-delete="${p.id}" class="rounded-full border border-dstrito-red px-3 py-1 text-[0.62rem] uppercase tracking-[0.12em] text-dstrito-red hover:bg-dstrito-red hover:text-black">Eliminar</button>
            </div>
          </div>`;
            }).join('')}
          </section>`;
        }).join('')
      : '<p class="text-neutral-500">No hay prendas que mostrar.</p>';
    if (!list.innerHTML.trim()) list.innerHTML = '<p class="text-neutral-500">No hay prendas que mostrar.</p>';
  };

  async function loadInventory() {
    try {
      productsCache = await apiFetch('/api/products', { auth: false });
      counts.inventory = productsCache.length;
      renderInventory();
    } catch (error) {
      root.querySelector('#ad-inv-list').innerHTML = `<p class="text-red-400">${esc(error.message)}</p>`;
    }
    renderDock();
  }
  root.querySelector('#ad-inv-search').addEventListener('input', renderInventory);

  const refreshStore = () => { if (typeof renderDynamicProducts === 'function') renderDynamicProducts(); };

  async function moveProduct(id, direction, button) {
    const product = productsCache.find((item) => item.id === id);
    if (!product) return;
    const orderedProducts = productsInCategory(product.category);
    const from = orderedProducts.findIndex((item) => item.id === id);
    const to = from + (direction === 'up' ? -1 : 1);
    if (from < 0 || to < 0 || to >= orderedProducts.length) return;

    [orderedProducts[from], orderedProducts[to]] = [orderedProducts[to], orderedProducts[from]];
    button.disabled = true;
    try {
      await apiFetch('/api/products/order', {
        method: 'PUT',
        body: { category: product.category, product_ids: orderedProducts.map((item) => item.id) },
      });
      await loadInventory();
      refreshStore();
      showToast('Orden de prendas actualizado.', 'success');
    } catch (error) {
      if (error.status !== 401) showToast(error.message);
      await loadInventory();
    }
  }

  // ---------- eliminar ----------
  async function deleteProduct(id, button) {
    const p = productsCache.find((x) => x.id === id);
    if (!p || !confirm(`¿Eliminar «${p.name}»?\n\nSe borrará de la tienda y también sus imágenes. Esta acción no se puede deshacer.`)) return;
    button.disabled = true;
    try {
      await apiFetch(`/api/products/${id}?delete_images=true`, { method: 'DELETE' });
      showToast('Prenda eliminada.', 'success');
      await loadInventory();
      refreshStore();
    } catch (error) {
      if (error.status !== 401) showToast(error.message);
      button.disabled = false;
    }
  }

  // ---------- modal de edición ----------
  const editModal = document.createElement('div');
  editModal.id = 'ad-edit-modal';
  editModal.className = 'fixed inset-0 z-[60] hidden items-center justify-center bg-black/80 p-4 backdrop-blur-sm';
  editModal.setAttribute('role', 'dialog');
  editModal.setAttribute('aria-modal', 'true');
  editModal.setAttribute('aria-label', 'Editar prenda');
  editModal.innerHTML = `
    <form id="ad-edit-form" class="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-3xl border border-neutral-800 bg-neutral-950 shadow-[0_0_60px_rgba(0,0,0,0.8)]">
      <div class="flex items-center justify-between border-b border-neutral-800 px-6 py-4">
        <h2 class="text-base font-semibold uppercase tracking-[0.18em] text-white">Editar prenda</h2>
        <button type="button" data-e-close class="rounded-full border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-200 hover:border-dstrito-red hover:text-dstrito-red" aria-label="Cerrar">✕</button>
      </div>
      <div class="flex-1 space-y-3 overflow-y-auto px-6 py-5">
        <div><label class="${DS_LABEL}" for="ad-e-name">Nombre</label>
          <input id="ad-e-name" required maxlength="120" class="${DS_INPUT}" /></div>
        <div><label class="${DS_LABEL}" for="ad-e-cat">Categoría</label>
          <select id="ad-e-cat" class="${DS_INPUT}"><option>Hoodies</option><option>Camisetas</option><option>Pantalones</option><option>Pantalonetas</option><option>Accesorios</option></select></div>
        <div class="grid grid-cols-2 gap-3">
          <div><label class="${DS_LABEL}" for="ad-e-price">Precio (COP)</label>
            <input id="ad-e-price" type="number" min="0" step="1000" required class="${DS_INPUT}" /></div>
          <div><label class="${DS_LABEL}" for="ad-e-stock">Stock (unidades)</label>
            <input id="ad-e-stock" type="number" min="0" max="100000" step="1" required class="${DS_INPUT}" /></div>
        </div>
        <div><label class="${DS_LABEL}" for="ad-e-desc">Descripción</label>
          <textarea id="ad-e-desc" rows="3" maxlength="600" class="${DS_INPUT}"></textarea></div>
        <div>
          <span class="${DS_LABEL}">Imágenes actuales</span>
          <div id="ad-e-current" class="grid grid-cols-3 gap-2"></div>
          <label class="${DS_LABEL} mt-3" for="ad-e-files">Agregar imágenes nuevas</label>
          <input id="ad-e-files" type="file" multiple accept="image/*"
            class="block w-full cursor-pointer rounded-xl border border-dashed border-neutral-600 bg-neutral-950 text-xs text-neutral-400 file:mr-3 file:cursor-pointer file:rounded-l-xl file:border-0 file:bg-neutral-800 file:px-3 file:py-2.5 file:text-[0.65rem] file:font-semibold file:uppercase file:tracking-[0.14em] file:text-neutral-200 hover:border-dstrito-red" />
          <div id="ad-e-new" class="mt-2 grid grid-cols-3 gap-2"></div>
          <p id="ad-e-hint" class="mt-1.5 text-[0.65rem] text-neutral-500"></p>
        </div>
      </div>
      <div class="flex gap-3 border-t border-neutral-800 px-6 py-4">
        <button type="button" data-e-close class="flex-1 rounded-full border border-neutral-700 bg-neutral-900 px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.16em] text-neutral-200 hover:border-dstrito-red hover:text-dstrito-red">Cancelar</button>
        <button type="submit" id="ad-e-save" class="flex-1 rounded-full bg-dstrito-red px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.16em] text-black hover:bg-red-500">Guardar cambios</button>
      </div>
    </form>`;
  document.body.appendChild(editModal);

  const E = (sel) => editModal.querySelector(sel);
  // Estado de la edición: URLs que se conservan (en orden) + archivos nuevos por subir.
  let edit = { id: null, keep: [], added: [] };

  const renderEditImages = () => {
    E('#ad-e-current').innerHTML = edit.keep.map((url, i) => `
      <div class="relative">
        <img src="${esc(url)}" alt="" class="h-20 w-full rounded-lg border border-neutral-800 bg-neutral-900 object-cover" />
        <button type="button" data-e-remove="${i}" aria-label="Quitar imagen" class="absolute right-1 top-1 h-5 w-5 rounded-full bg-black/80 text-[0.65rem] leading-5 text-white hover:bg-dstrito-red hover:text-black">✕</button>
        ${i === 0
          ? '<span class="absolute bottom-1 left-1 rounded bg-dstrito-red px-1.5 text-[0.55rem] font-bold uppercase text-black">Principal</span>'
          : `<button type="button" data-e-main="${i}" class="absolute bottom-1 left-1 rounded bg-black/80 px-1.5 text-[0.55rem] font-bold uppercase text-neutral-200 hover:bg-dstrito-red hover:text-black">★ Principal</button>`}
      </div>`).join('');

    E('#ad-e-new').querySelectorAll('img').forEach((img) => URL.revokeObjectURL(img.src));
    E('#ad-e-new').innerHTML = '';
    edit.added.forEach((file, i) => {
      const cell = document.createElement('div');
      cell.className = 'relative';
      const img = document.createElement('img');
      img.src = URL.createObjectURL(file);
      img.alt = file.name;
      img.className = 'h-20 w-full rounded-lg border border-dstrito-red/50 bg-neutral-900 object-cover';
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.dataset.eRemoveNew = String(i);
      remove.setAttribute('aria-label', `Quitar ${file.name}`);
      remove.className = 'absolute right-1 top-1 h-5 w-5 rounded-full bg-black/80 text-[0.65rem] leading-5 text-white hover:bg-dstrito-red hover:text-black';
      remove.textContent = '✕';
      cell.append(img, remove);
      E('#ad-e-new').append(cell);
    });
    const total = edit.keep.length + edit.added.length;
    E('#ad-e-hint').textContent = `${total} de ${MAX_IMAGES} imágenes${edit.added.length ? ` (${edit.added.length} nueva${edit.added.length > 1 ? 's' : ''} por subir)` : ''}. Debe quedar al menos una.`;
  };

  function openEdit(id) {
    const p = productsCache.find((x) => x.id === id);
    if (!p) return;
    edit = { id, keep: [...p.images], added: [] };
    E('#ad-e-name').value = p.name;
    const category = (p.category || '').trim();
    const supportedCategories = ['Hoodies', 'Camisetas', 'Pantalones', 'Pantalonetas', 'Accesorios'];
    E('#ad-e-cat').value = supportedCategories.includes(category) ? category : 'Accesorios';
    E('#ad-e-price').value = Math.round(p.price);
    E('#ad-e-stock').value = p.stock;
    E('#ad-e-desc').value = p.description || '';
    E('#ad-e-files').value = '';
    renderEditImages();
    editModal.classList.remove('hidden');
    editModal.classList.add('flex');
    E('#ad-e-name').focus();
  }
  const closeEdit = () => {
    editModal.classList.add('hidden');
    editModal.classList.remove('flex');
    E('#ad-e-new').querySelectorAll('img').forEach((img) => URL.revokeObjectURL(img.src));
  };

  editModal.addEventListener('click', (event) => {
    if (event.target === editModal || event.target.closest('[data-e-close]')) return closeEdit();
    const rm = event.target.closest('[data-e-remove]');
    const main = event.target.closest('[data-e-main]');
    const rmNew = event.target.closest('[data-e-remove-new]');
    if (rm) edit.keep.splice(Number(rm.dataset.eRemove), 1);
    else if (main) edit.keep.unshift(...edit.keep.splice(Number(main.dataset.eMain), 1)); // pasa al frente
    else if (rmNew) edit.added.splice(Number(rmNew.dataset.eRemoveNew), 1);
    else return;
    renderEditImages();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !editModal.classList.contains('hidden')) closeEdit();
  });

  E('#ad-e-files').addEventListener('change', (event) => {
    const rejected = [];
    for (const file of event.target.files) {
      if (edit.keep.length + edit.added.length >= MAX_IMAGES) { rejected.push(`máximo ${MAX_IMAGES} imágenes`); break; }
      if (!/^image\/(jpeg|png|webp)$/.test(file.type)) { rejected.push(`«${file.name}» no es JPG, PNG ni WebP`); continue; }
      if (file.size > MAX_BYTES) { rejected.push(`«${file.name}» pesa más de 5 MB`); continue; }
      edit.added.push(file);
    }
    event.target.value = '';
    if (rejected.length) showToast(`No se agregó: ${rejected.join('; ')}.`);
    renderEditImages();
  });

  E('#ad-edit-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (edit.keep.length + edit.added.length === 0) return showToast('La prenda debe tener al menos una imagen.');

    // PUT multipart: campos de texto + keep_images (JSON con las URLs que se quedan, en orden)
    // + los archivos nuevos bajo el nombre "new_images". Sin tocar Content-Type.
    const data = new FormData();
    data.append('name', E('#ad-e-name').value.trim());
    data.append('category', E('#ad-e-cat').value);
    data.append('price', E('#ad-e-price').value);
    data.append('stock', E('#ad-e-stock').value);
    data.append('description', E('#ad-e-desc').value.trim());
    data.append('keep_images', JSON.stringify(edit.keep));
    edit.added.forEach((file) => data.append('new_images', file));

    const save = E('#ad-e-save');
    save.disabled = true;
    save.textContent = 'Guardando…';
    try {
      await apiFetch(`/api/products/${edit.id}`, { method: 'PUT', body: data });
      closeEdit();
      showToast('Cambios guardados.', 'success');
      await loadInventory();
      refreshStore();
    } catch (error) {
      if (error.status !== 401) showToast(error.message);
    } finally {
      save.disabled = false;
      save.textContent = 'Guardar cambios';
    }
  });

  WINDOWS.forEach((w) => applyWindow(w.id));
  window.DstritoAdmin = { open, close, toggle, refresh: refreshVisible };
})();
