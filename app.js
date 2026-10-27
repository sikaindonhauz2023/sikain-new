(() => {
  "use strict";

  const CONFIG = window.SIKAIN_CONFIG || {};
  const $ = (id) => document.getElementById(id);

  const escapeHTML = (value) =>
    String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[char]));

  const money = (amount) =>
    "₱" + Number(amount || 0).toLocaleString("en-PH", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });

  const dateText = (value) =>
    value ? new Date(value).toLocaleString("en-PH") : "";

  const todayStart = () => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    return date.toISOString();
  };

  let db = null;
  let currentUser = null;
  let currentRole = null;
  let products = [];
  let sales = [];
  let cart = [];
  let settings = null;
  let editingProductId = null;

  function notify(message) {
    alert(message);
  }

  function setText(id, value) {
    if ($(id)) $(id).textContent = value ?? "";
  }

  function setValue(id, value) {
    if ($(id)) $(id).value = value ?? "";
  }

  function show(id, visible = true) {
    if ($(id)) $(id).hidden = !visible;
  }

  function getValue(id) {
    return $(id)?.value?.trim() ?? "";
  }

  function getFile(id) {
    return $(id)?.files?.[0] ?? null;
  }

  function admin() {
    return Boolean(currentUser && currentRole);
  }

  function owner() {
    return currentRole === "owner";
  }

  function showAdminTab(tabName) {
    document.querySelectorAll(".tab-content").forEach((tab) => {
      tab.hidden = tab.id !== tabName;
    });

    document.querySelectorAll(".tab").forEach((button) => {
      button.classList.toggle(
        "active",
        button.dataset.tab === tabName
      );
    });
  }

  async function init() {
    if (
      !CONFIG.SUPABASE_URL ||
      !CONFIG.SUPABASE_ANON_KEY ||
      CONFIG.SUPABASE_URL.includes("ILAGAY_DITO") ||
      CONFIG.SUPABASE_ANON_KEY.includes("ILAGAY_DITO")
    ) {
      notify(
        "Hindi pa naka-set ang Supabase. Buksan ang config.js at ilagay ang Project URL at publishable/anon key."
      );
      return;
    }

    if (!window.supabase?.createClient) {
      notify("Hindi na-load ang Supabase library. Tingnan ang internet connection.");
      return;
    }

    db = window.supabase.createClient(
      CONFIG.SUPABASE_URL,
      CONFIG.SUPABASE_ANON_KEY
    );

    bindEvents();
    await loadSettings();
    await loadProducts();

    const { data } = await db.auth.getSession();
    await checkSession(data?.session ?? null);

    db.auth.onAuthStateChange((_event, session) => {
      setTimeout(() => checkSession(session), 0);
    });
  }

  function bindEvents() {
    
$("login-open")?.addEventListener("click", () => {
  const dialog = $("login-dialog");

  if (!dialog) {
    alert("Hindi makita ang login-dialog. Suriin ang index.html.");
    return;
  }

  if (typeof dialog.showModal === "function") {
    dialog.showModal();
  } else {
    dialog.hidden = false;
    dialog.style.display = "block";
  }
});

$("login-cancel")?.addEventListener("click", () => {
  const dialog = $("login-dialog");
  if (!dialog) return;

  if (typeof dialog.close === "function") {
    dialog.close();
  } else {
    dialog.hidden = true;
    dialog.style.display = "none";
  }
});

    $("login-form")?.addEventListener("submit", login);
    $("logout-button")?.addEventListener("click", logout);
    $("menu-search")?.addEventListener("input", renderProducts);

    $("product-form")?.addEventListener("submit", saveProduct);
    $("product-cancel")?.addEventListener("click", resetProductForm);

    $("sale-form")?.addEventListener("submit", recordSale);
    $("settings-form")?.addEventListener("submit", saveSettings);

    $("print-receipt")?.addEventListener("click", () => window.print());

    document.querySelectorAll(".tab").forEach((button) => {
      button.addEventListener("click", () => {
        if (!admin()) return;
        showAdminTab(button.dataset.tab);
      });
    });

    $("admin-products")?.addEventListener("click", handleProductAction);
    $("deleted-products")?.addEventListener("click", handleProductAction);
    $("sales-history")?.addEventListener("click", handleSaleAction);
    $("admin-users-list")?.addEventListener("click", handleUserAction);

    $("export-sales")?.addEventListener("click", exportSalesCSV);

    $("receipt-dialog")?.addEventListener("click", (event) => {
      if (event.target === $("receipt-dialog")) {
        $("receipt-dialog").close?.();
      }
    });
  }

  async function checkSession(session) {
    currentUser = session?.user ?? null;
    currentRole = null;

    if (currentUser) {
      const { data, error } = await db
        .from("admin_users")
        .select("role")
        .eq("user_id", currentUser.id)
        .maybeSingle();

      if (!error && data) currentRole = data.role;

      if (!currentRole) {
        await db.auth.signOut();
        currentUser = null;
        notify("Walang admin access ang account na ito. I-check ang admin_users table.");
      }
    }

    show("login-open", !admin());
    show("logout-button", admin());
    show("admin-panel", admin());

    if ($("login-open")) $("login-open").hidden = admin();
    if ($("logout-button")) $("logout-button").hidden = !admin();
    if ($("admin-panel")) $("admin-panel").hidden = !admin();

    if (admin()) {
      setText("admin-account", currentUser.email || "");
      setText("admin-role", currentRole);
      await loadProducts();
      await loadSales();
      await loadSettings();

      if (owner()) {
        await loadAdminUsers();
      } else {
        show("admin-users-tab", false);
      }
    }
  }

  async function login(event) {
    event.preventDefault();

    const email = getValue("login-email");
    const password = $("login-password")?.value ?? "";

    if (!email || !password) {
      notify("Ilagay ang email at password.");
      return;
    }

    const button = $("login-submit");
    if (button) button.disabled = true;

    const { error } = await db.auth.signInWithPassword({
      email,
      password
    });

    if (button) button.disabled = false;

    if (error) {
      notify("Hindi makapag-login: " + error.message);
      return;
    }

    $("login-dialog")?.close?.();
    $("login-form")?.reset();
  }

  async function logout() {
    const { error } = await db.auth.signOut();
    if (error) notify("Hindi nakapag-logout: " + error.message);
  }

  async function loadSettings() {
    const { data, error } = await db
      .from("business_settings")
      .select("*")
      .eq("id", 1)
      .maybeSingle();

    if (error) {
      console.error(error);
      return;
    }

    settings = data || {
      business_name: "SIKAIN",
      tagline: "Masarap, sulit, at pang-araw-araw",
      business_address: "19 Manalili St., Central Signal Village, Taguig City",
      main_color: "#176b45",
      text_color: "#222222"
    };

    setText("business-name", settings.business_name);
    setText("hero-title", settings.business_name);
    setText("hero-description", settings.tagline);
    setText("business-address", settings.business_address);

    const logo = $("business-logo");
    if (logo) {
      if (settings.logo_url) {
        logo.src = settings.logo_url;
        logo.hidden = false;
      } else {
        logo.hidden = true;
      }
    }

    const banner = $("banner-image");
    if (banner) {
      if (settings.banner_url) {
        banner.src = settings.banner_url;
        banner.hidden = false;
      } else {
        banner.hidden = true;
      }
    }

    if (settings.main_color) {
      document.documentElement.style.setProperty(
        "--primary",
        settings.main_color
      );
    }

    if (settings.text_color) {
      document.documentElement.style.setProperty(
        "--text",
        settings.text_color
      );
    }

    setValue("settings-business-name", settings.business_name);
    setValue("settings-tagline", settings.tagline);
    setValue("settings-address", settings.business_address);
    setValue("settings-main-color", settings.main_color);
    setValue("settings-text-color", settings.text_color);
  }

  async function loadProducts() {
    const { data, error } = await db
      .from("products")
      .select("*")
      .is("deleted_at", null)
      .order("created_at", { ascending: false });

    if (error) {
      console.error(error);
      notify("Hindi ma-load ang menu: " + error.message);
      return;
    }

    products = data || [];
    renderProducts();

    if (admin()) {
      renderAdminProducts();
      renderSaleProductOptions();
    }
  }

  function renderProducts() {
    const grid = $("menu-grid");
    if (!grid) return;

    const query = getValue("menu-search").toLowerCase();

    const filtered = products.filter((product) => {
      const text = `${product.name} ${product.description || ""}`.toLowerCase();
      return text.includes(query) && product.available !== false;
    });

    if (!filtered.length) {
      grid.innerHTML = '<p class="empty-state">Wala pang menu na tumutugma sa iyong hinahanap.</p>';
      return;
    }

    grid.innerHTML = filtered.map((product) => `
      <article class="menu-card">
        ${product.image_url
          ? `<img src="${escapeHTML(product.image_url)}" alt="${escapeHTML(product.name)}" loading="lazy">`
          : ""}
        <div class="menu-card-body">
          <h3>${escapeHTML(product.name)}</h3>
          <p>${escapeHTML(product.description || "")}</p>
          <strong>${money(product.price)}</strong>
        </div>
      </article>
    `).join("");
  }

  function renderAdminProducts() {
    const list = $("admin-products");
    if (!list) return;

    if (!products.length) {
      list.innerHTML = "<p>Wala pang menu item.</p>";
      return;
    }

    list.innerHTML = products.map((product) => `
      <div class="admin-row">
        <div>
          <strong>${escapeHTML(product.name)}</strong>
          <div>${money(product.price)} · ${product.available ? "Available" : "Hidden"}</div>
        </div>
        <div class="row-actions">
          <button type="button" class="small-button" data-action="edit" data-id="${product.id}">Edit</button>
          <button type="button" class="small-button" data-action="toggle" data-id="${product.id}">
            ${product.available ? "Hide" : "Show"}
          </button>
          <button type="button" class="small-button" data-action="delete" data-id="${product.id}">Trash</button>
        </div>
      </div>
    `).join("");

    loadDeletedProducts();
  }

  async function loadDeletedProducts() {
    const list = $("deleted-products");
    if (!list || !admin()) return;

    const { data, error } = await db
      .from("products")
      .select("*")
      .not("deleted_at", "is", null)
      .order("deleted_at", { ascending: false });

    if (error) {
      console.error(error);
      return;
    }

    if (!data?.length) {
      list.innerHTML = "<p>Walang laman ang trash.</p>";
      return;
    }

    list.innerHTML = data.map((product) => `
      <div class="admin-row">
        <div>
          <strong>${escapeHTML(product.name)}</strong>
          <div>${money(product.price)}</div>
        </div>
        <button type="button" class="small-button" data-action="restore" data-id="${product.id}">Restore</button>
      </div>
    `).join("");
  }

  function resetProductForm() {
    editingProductId = null;
    $("product-form")?.reset();
    setText("product-form-title", "Magdagdag ng menu");
    setText("product-submit", "I-save ang menu");
  }

  async function saveProduct(event) {
    event.preventDefault();
    if (!admin()) return;

    const name = getValue("product-name");
    const description = getValue("product-description");
    const price = Number(getValue("product-price"));
    const available = $("product-available")?.checked ?? true;
    const file = getFile("product-image");

    if (!name || !Number.isFinite(price) || price < 0) {
      notify("Ilagay ang pangalan at wastong presyo.");
      return;
    }

    let imageUrl = null;
    if (file) {
      try {
        imageUrl = await uploadImage(file, "products");
      } catch (error) {
        notify("Hindi na-upload ang larawan: " + error.message);
        return;
      }
    }

    const payload = {
      name,
      description,
      price,
      available
    };

    if (imageUrl) payload.image_url = imageUrl;

    let result;
    if (editingProductId) {
      result = await db
        .from("products")
        .update(payload)
        .eq("id", editingProductId);
    } else {
      result = await db
        .from("products")
        .insert(payload);
    }

    if (result.error) {
      notify("Hindi na-save ang menu: " + result.error.message);
      return;
    }

    notify("Na-save ang menu.");
    resetProductForm();
    await loadProducts();
  }

  async function uploadImage(file, folder) {
    if (!file) return null;

    if (!file.type.startsWith("image/")) {
      throw new Error("Image file lamang ang puwedeng i-upload.");
    }

    if (file.size > 5 * 1024 * 1024) {
      throw new Error("Hanggang 5 MB lamang ang larawan.");
    }

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `${folder}/${Date.now()}-${safeName}`;

    const { error } = await db.storage
      .from("menu-images")
      .upload(path, file, {
        cacheControl: "3600",
        upsert: false
      });

    if (error) throw error;

    const { data } = db.storage
      .from("menu-images")
      .getPublicUrl(path);

    return data.publicUrl;
  }

  async function handleProductAction(event) {
    const button = event.target.closest("button[data-action]");
    if (!button || !admin()) return;

    const id = button.dataset.id;
    const action = button.dataset.action;

    if (action === "edit") {
      const product = products.find((item) => String(item.id) === String(id));
      if (!product) return;

      editingProductId = product.id;
      setValue("product-name", product.name);
      setValue("product-description", product.description);
      setValue("product-price", product.price);

      if ($("product-available")) {
        $("product-available").checked = product.available !== false;
      }

      setText("product-form-title", "I-edit ang menu");
      setText("product-submit", "I-save ang pagbabago");
      $("product-form")?.scrollIntoView({ behavior: "smooth" });
      return;
    }

    if (action === "toggle") {
      const product = products.find((item) => String(item.id) === String(id));
      if (!product) return;

      const { error } = await db
        .from("products")
        .update({ available: !product.available })
        .eq("id", id);

      if (error) return notify("Hindi na-update: " + error.message);
      await loadProducts();
      return;
    }

    if (action === "delete") {
      if (!confirm("Ilipat ang menu sa trash? Maaari pa itong i-restore.")) return;

      const { error } = await db
        .from("products")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", id);

      if (error) return notify("Hindi nailipat sa trash: " + error.message);
      await loadProducts();
      return;
    }

    if (action === "restore") {
      const { error } = await db
        .from("products")
        .update({ deleted_at: null })
        .eq("id", id);

      if (error) return notify("Hindi na-restore: " + error.message);
      await loadProducts();
    }
  }

  function renderSaleProductOptions() {
    const select = $("sale-product-id");
    if (!select) return;

    const available = products.filter((product) => product.available !== false);

    select.innerHTML = '<option value="">Pumili ng produkto</option>' +
      available.map((product) => `
        <option value="${product.id}" data-price="${product.price}">
          ${escapeHTML(product.name)} — ${money(product.price)}
        </option>
      `).join("");

    select.onchange = () => {
      const selected = select.selectedOptions[0];
      setValue("sale-unit-price", selected?.dataset.price || "");
    };
  }

  async function recordSale(event) {
    event.preventDefault();
    if (!admin()) return;

    const productId = getValue("sale-product-id");
    const quantity = Number(getValue("sale-quantity"));
    const method = getValue("sale-payment-method") || "Cash";

    const product = products.find((item) => String(item.id) === String(productId));

    if (!product || !Number.isInteger(quantity) || quantity < 1) {
      notify("Pumili ng produkto at maglagay ng quantity na hindi bababa sa 1.");
      return;
    }

    const payload = {
      product_id: product.id,
      product_name: product.name,
      unit_price: Number(product.price),
      quantity,
      payment_method: method,
      created_by: currentUser.id
    };

    const { data, error } = await db
      .from("sales")
      .insert(payload)
      .select()
      .single();

    if (error) {
      notify("Hindi naitala ang benta: " + error.message);
      return;
    }

    $("sale-form")?.reset();
    renderSaleProductOptions();
    await loadSales();
    showReceipt(data);
    notify("Matagumpay na naitala ang benta.");
  }

  async function loadSales() {
    if (!admin()) return;

    const { data, error } = await db
      .from("sales")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500);

    if (error) {
      console.error(error);
      notify("Hindi ma-load ang sales: " + error.message);
      return;
    }

    sales = data || [];
    renderSales();
  }

  function renderSales() {
    const list = $("sales-history");

    const todaysSales = sales.filter(
      (sale) => new Date(sale.created_at) >= new Date(todayStart())
    );

    const total = todaysSales.reduce(
      (sum, sale) => sum + Number(sale.total || sale.unit_price * sale.quantity || 0),
      0
    );

    setText("today-sales", money(total));
    setText("today-orders", String(todaysSales.length));

    if (!list) return;

    if (!sales.length) {
      list.innerHTML = "<p>Wala pang naitalang benta.</p>";
      return;
    }

    list.innerHTML = `
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Petsa</th>
              <th>Produkto</th>
              <th>Qty</th>
              <th>Total</th>
              <th>Bayad</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${sales.map((sale) => `
              <tr>
                <td>${escapeHTML(dateText(sale.created_at))}</td>
                <td>${escapeHTML(sale.product_name)}</td>
                <td>${Number(sale.quantity)}</td>
                <td>${money(sale.total || sale.unit_price * sale.quantity)}</td>
                <td>${escapeHTML(sale.payment_method || "Cash")}</td>
                <td>
                  <button type="button" class="small-button"
                    data-action="receipt" data-id="${sale.id}">Resibo</button>
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  function handleSaleAction(event) {
    const button = event.target.closest('button[data-action="receipt"]');
    if (!button) return;

    const sale = sales.find((item) => String(item.id) === String(button.dataset.id));
    if (sale) showReceipt(sale);
  }

  function showReceipt(sale) {
    const content = $("receipt-content");
    if (!content) return;

    const total = Number(sale.total || sale.unit_price * sale.quantity || 0);

    content.innerHTML = `
      <div class="receipt">
        <h2>${escapeHTML(settings?.business_name || "SIKAIN")}</h2>
        <p>${escapeHTML(settings?.business_address || "")}</p>
        <hr>
        <p>Resibo #: ${escapeHTML(sale.id)}</p>
        <p>${escapeHTML(dateText(sale.created_at || new Date().toISOString()))}</p>
        <hr>
        <p>${escapeHTML(sale.product_name)}</p>
        <p>${Number(sale.quantity)} × ${money(sale.unit_price)}</p>
        <h3>TOTAL: ${money(total)}</h3>
        <p>Bayad: ${escapeHTML(sale.payment_method || "Cash")}</p>
        <hr>
        <p>Salamat sa pagbili!</p>
      </div>
    `;

    const dialog = $("receipt-dialog");
    if (dialog?.showModal) dialog.showModal();
    else show("receipt-dialog");
  }

  async function saveSettings(event) {
    event.preventDefault();
    if (!owner()) {
      notify("Owner account lamang ang maaaring mag-edit ng business settings.");
      return;
    }

    const payload = {
      id: 1,
      business_name: getValue("settings-business-name"),
      tagline: getValue("settings-tagline"),
      business_address: getValue("settings-address"),
      main_color: getValue("settings-main-color") || "#176b45",
      text_color: getValue("settings-text-color") || "#222222"
    };

    try {
      const logoFile = getFile("settings-logo");
      const bannerFile = getFile("settings-banner");

      if (logoFile) payload.logo_url = await uploadImage(logoFile, "logos");
      if (bannerFile) payload.banner_url = await uploadImage(bannerFile, "banners");
    } catch (error) {
      notify("Hindi na-upload ang larawan: " + error.message);
      return;
    }

    const { error } = await db
      .from("business_settings")
      .upsert(payload, { onConflict: "id" });

    if (error) {
      notify("Hindi na-save ang settings: " + error.message);
      return;
    }

    notify("Na-save ang business settings.");
    await loadSettings();
  }

  async function loadAdminUsers() {
    if (!owner()) return;

    const list = $("admin-users-list");
    if (!list) return;

    const { data, error } = await db
      .from("admin_users")
      .select("user_id, role")
      .order("role");

    if (error) {
      list.innerHTML = "<p>Hindi ma-load ang admin users.</p>";
      console.error(error);
      return;
    }

    list.innerHTML = (data || []).map((user) => `
      <div class="admin-row">
        <div>
          <strong>${escapeHTML(user.user_id)}</strong>
          <div>Role: ${escapeHTML(user.role)}</div>
        </div>
        ${user.role !== "owner" ? `
          <button type="button" class="small-button"
            data-action="remove-admin" data-id="${escapeHTML(user.user_id)}">
            Alisin
          </button>
        ` : ""}
      </div>
    `).join("");

    if (!data?.length) list.innerHTML = "<p>Walang admin users.</p>";
  }

  async function handleUserAction(event) {
    const button = event.target.closest('button[data-action="remove-admin"]');
    if (!button || !owner()) return;

    const userId = button.dataset.id;
    if (!confirm("Alisin ang admin access ng user na ito?")) return;

    const { error } = await db
      .from("admin_users")
      .delete()
      .eq("user_id", userId);

    if (error) {
      notify("Hindi naalis ang admin access: " + error.message);
      return;
    }

    await loadAdminUsers();
  }

  function exportSalesCSV() {
    if (!admin()) return;

    const rows = [
      ["Date", "Product", "Quantity", "Unit Price", "Total", "Payment Method"],
      ...sales.map((sale) => [
        sale.created_at,
        sale.product_name,
        sale.quantity,
        sale.unit_price,
        sale.total || sale.unit_price * sale.quantity,
        sale.payment_method || "Cash"
      ])
    ];

    const csv = rows.map((row) =>
      row.map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`).join(",")
    ).join("\r\n");

    const blob = new Blob(["\uFEFF" + csv], {
      type: "text/csv;charset=utf-8;"
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "sikain-sales.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  document.addEventListener("DOMContentLoaded", init);
})();
