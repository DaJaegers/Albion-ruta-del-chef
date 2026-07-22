const SUPABASE_URL = "https://cioonjlynpvfixuflqgr.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_uB0iF7_f15iEIfQ5mPtUBQ_gIu28qzM";

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
let currentUser = null;

// --- AUTENTICACIÓN ---
async function loginWithGoogle() {
    try {
        console.log("Iniciando sesión con Google...");
        
        // Usamos supabaseClient.auth en lugar de solo supabase.auth
        const { data, error } = await supabaseClient.auth.signInWithOAuth({
            provider: 'google',
            options: {
                redirectTo: window.location.origin
            }
        });

        if (error) throw error;

    } catch (err) {
        console.error("Error al autenticar:", err.message);
        alert("Error al conectar con Google: " + err.message);
    }
}

async function logout() {
    await supabaseClient.auth.signOut();
    window.location.reload();
}

// --- MANEJO DE ESTADO DE SESIÓN ---
async function checkAuth() {
    supabaseClient.auth.onAuthStateChange(async (event, session) => {
        if (session && session.user) {
            currentUser = session.user;
            document.getElementById('btnLogin').style.display = 'none';
            document.getElementById('userInfo').style.display = 'flex';
            document.getElementById('userEmail').textContent = currentUser.email;
            
            document.getElementById('authPrompt').style.display = 'none';
            document.getElementById('inventoryControls').style.display = 'block';
            await loadUserInventoryDB();
        } else {
            currentUser = null;
            document.getElementById('btnLogin').style.display = 'block';
            document.getElementById('userInfo').style.display = 'none';
            
            document.getElementById('authPrompt').style.display = 'block';
            document.getElementById('inventoryControls').style.display = 'none';

            // Mensaje claro en la ruta si no hay sesión
            const routeContainer = document.getElementById('routeContainer');
            if (routeContainer) {
                routeContainer.innerHTML = '<p style="color: var(--text-muted);">Inicia sesión para calcular el reparto óptimo según tu inventario.</p>';
            }
        }
    });
}

// --- BASE DE DATOS (INVENTARIO SURABASE) ---
async function loadUserInventoryDB() {
    if (!currentUser) return;

    const { data, error } = await supabaseClient
        .from('inventory')
        .select('item_id, quantity');

    if (error) {
        console.error("Error al cargar inventario de la DB:", error);
        return;
    }

    globalInventory = {};
    data.forEach(row => {
        globalInventory[row.item_id] = row.quantity;
    });

    renderInventoryList();
    calculateRouteUI();
}

// Guardar o Actualizar comida en Supabase
async function saveFoodToDB(itemId, qty) {
    if (!currentUser) return;

    const { error } = await supabaseClient
        .from('inventory')
        .upsert({ 
            user_id: currentUser.id, 
            item_id: itemId, 
            quantity: qty 
        }, { onConflict: 'user_id, item_id' });

    if (error) {
        alert("Error al guardar en la base de datos: " + error.message);
    }
}

// Eliminar comida de Supabase
async function deleteFoodFromDB(itemId) {
    if (!currentUser) return;

    const { error } = await supabaseClient
        .from('inventory')
        .delete()
        .eq('user_id', currentUser.id)
        .eq('item_id', itemId);

    if (error) {
        console.error("Error al eliminar de la base de datos:", error);
    }
}

// --- LÓGICA DE APLICACIÓN GENERAL ---
let globalMarketData = {};
let globalInventory = {};
let itemNames = {};

function getItemIconUrl(itemId) {
    return `https://render.albiononline.com/v1/item/${itemId}?quality=0`;
}

async function loadAllData() {
    const region = document.getElementById('regionSelect').value;
    const tbody = document.getElementById('marketTableBody');
    tbody.innerHTML = '<tr><td colspan="4">Consultando API de Albion Online...</td></tr>';
    
    try {
        const response = await fetch(`/api/data?region=${region}`);
        const data = await response.json();
        
        globalMarketData = data.market;
        // Se remueve globalInventory = data.inventory para no sobreescribir con undefined
        itemNames = data.item_names;

        populateItemSelects();
        renderInventoryList();
        renderItemTable();
        calculateRouteUI();
    } catch (err) {
        tbody.innerHTML = '<tr><td colspan="4" style="color:red;">Error al obtener datos de la API.</td></tr>';
    }
}

function populateItemSelects() {
    const selectConsult = document.getElementById('itemSelect');
    const selectAdd = document.getElementById('addFoodSelect');
    
    if (selectConsult.children.length === 0) {
        selectConsult.innerHTML = '';
        selectAdd.innerHTML = '';
        
        for (const [id, name] of Object.entries(itemNames)) {
            const opt1 = document.createElement('option');
            opt1.value = id;
            opt1.textContent = name;
            selectConsult.appendChild(opt1);

            const opt2 = document.createElement('option');
            opt2.value = id;
            opt2.textContent = name;
            selectAdd.appendChild(opt2);
        }
    }
    updateAddPreviewImage();
}

function updateAddPreviewImage() {
    const id = document.getElementById('addFoodSelect').value;
    if (id) {
        document.getElementById('addPreviewImg').src = getItemIconUrl(id);
    }
}

function renderInventoryList() {
    const container = document.getElementById('inventoryCards');
    container.innerHTML = '';

    const keys = Object.keys(globalInventory);
    if (keys.length === 0) {
        container.innerHTML = '<p style="color: var(--text-muted); grid-column: 1/-1;">Tu inventario está vacío. Agrega comidas arriba.</p>';
        return;
    }

    for (const [id, qty] of Object.entries(globalInventory)) {
        if (qty <= 0) continue;
        const name = itemNames[id] || id;
        const div = document.createElement('div');
        div.className = 'inv-card';
        div.innerHTML = `
            <div class="flex-align">
                <img src="${getItemIconUrl(id)}" class="item-icon" alt="icon">
                <div>
                    <strong style="display:block; font-size:0.9rem;">${name}</strong>
                    <span style="font-size:0.85rem; color: var(--accent-gold);">Cant: ${qty}</span>
                </div>
            </div>
            <button class="btn btn-danger" style="color:white; width: 33%;" onclick="removeInventoryItem('${id}')">Eliminar ❌</button>
        `;
        container.appendChild(div);
    }
}

async function addOrUpdateFood() {
    const itemId = document.getElementById('addFoodSelect').value;
    const qty = parseInt(document.getElementById('addFoodQty').value, 10);
    
    if (!itemId || isNaN(qty) || qty <= 0) {
        alert("Por favor ingresa una cantidad válida.");
        return;
    }

    globalInventory[itemId] = qty;

    // Guardar en Supabase
    await saveFoodToDB(itemId, qty);

    renderInventoryList();
    calculateRouteUI();
}

async function removeInventoryItem(itemId) {
    delete globalInventory[itemId];
    
    // Eliminar en Supabase
    await deleteFoodFromDB(itemId);

    renderInventoryList();
    calculateRouteUI();
}

function formatSilver(amount) {
    if (!amount) return '-';
    return new Intl.NumberFormat('es-ES').format(amount) + ' 🪙';
}

function getTimeAgoWithOffset(dateString) {
    if (!dateString) return 'Sin datos';

    // Intenta parsear la fecha (sea string ISO, timestamp en ms o fecha estándar)
    let updatedTime = new Date(dateString).getTime();
    
    // Si sigue siendo inválida (NaN), retornamos 'Sin datos'
    if (isNaN(updatedTime)) return 'Sin datos';

    const currentTime = new Date().getTime();

    // Restamos 3 minutos (180,000 milisegundos)
    const THREE_MINUTES_MS = 3 * 60 * 1000;
    let diffInSeconds = Math.floor((currentTime - (updatedTime - THREE_MINUTES_MS)) / 1000);

    if (diffInSeconds < 0) diffInSeconds = 0;

    const minutes = Math.floor(diffInSeconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `Hace ${days}d ${hours % 24}h`;
    if (hours > 0) return `Hace ${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `Hace ${minutes}m`;
    return 'Hace unos segundos';
}

// --- RENDERIZADO DE TABLA DE PRECIOS Y DEMANDA ---
function renderItemTable() {
    const select = document.getElementById('itemSelect');
    const itemId = select ? select.value : null;
    const imgEl = document.getElementById('selectedItemImg');
    const tbody = document.getElementById('marketTableBody');

    // Manejo de la imagen para evitar que aparezca rota
    if (itemId && imgEl) {
        imgEl.src = getItemIconUrl(itemId);
        imgEl.style.display = 'inline-block';
    } else if (imgEl) {
        imgEl.style.display = 'none'; // Se oculta si no hay item cargado aún
    }

    if (!tbody) return;
    tbody.innerHTML = '';

    if (!itemId || !globalMarketData[itemId]) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--text-muted);">Selecciona un alimento para consultar precios.</td></tr>';
        return;
    }

    const citiesArray = Object.entries(globalMarketData[itemId]).map(([city, info]) => {
        return { city: city, ...info };
    });

    // Ordenar por mayor precio de venta
    citiesArray.sort((a, b) => (b.sell_order || 0) - (a.sell_order || 0));

    citiesArray.forEach(info => {
        const tr = document.createElement('tr');
        const priceVal = info.sell_order ? formatSilver(info.sell_order) : '<span class="text-no-data">Sin datos</span>';
        
        let badge = '';
        if (info.age_hours > 8) {
            badge = '<span class="badge-alert">⚠️ +8h Desactualizado</span>';
        }

        const demandVal = info.daily_demand 
            ? `<strong style="color: var(--accent-gold);">${info.daily_demand.toLocaleString()}</strong> /día` 
            : '<span style="color: var(--text-muted);">-</span>';

        // Evaluamos cuál propiedad contiene la fecha de actualización real
        const dateSource = info.last_updated || info.updated_at || info.timestamp || info.last_update;

        // Si fue editado manualmente usamos su texto, si no calculamos con el desfase
        const timeAgoText = info.is_edited 
            ? info.time_ago 
            : (dateSource ? getTimeAgoWithOffset(dateSource) : (info.time_ago || 'Sin datos'));

        tr.innerHTML = `
            <td><strong>${info.city}</strong></td>
            <td><strong class="price-green">${priceVal}</strong></td>
            <td>${demandVal}</td>
            <td>
                <div style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
                    <span>${timeAgoText}</span>
                    ${badge}
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
}
function renderRoutePlan(planData) {
    const container = document.getElementById('routeContainer');
    container.innerHTML = '';

    if (!planData.plan || planData.plan.length === 0) {
        container.innerHTML = '<p style="color: var(--accent-red);">No hay datos suficientes para calcular la ruta.</p>';
        return;
    }

    // LEER EL ESTADO DEL CHECKBOX EN TIEMPO REAL
    const premiumCheckbox = document.getElementById('premiumToggle');
    const isPremium = premiumCheckbox ? premiumCheckbox.checked : true;
    const MARKET_TAX_RATE = isPremium ? 0.04 : 0.08;

    // 1. Agrupar la información por Ciudad de Destino
    const cityMap = {};
    let grandTotalGross = 0;
    let grandTotalNet = 0;
    let grandTotalQty = 0;

    planData.plan.forEach(item => {
        item.destinations.forEach(dest => {
            const cityName = dest.city;
            
            if (!cityMap[cityName]) {
                cityMap[cityName] = {
                    items: [],
                    totalQty: 0,
                    totalGross: 0,
                    totalNet: 0
                };
            }

            const grossRevenue = dest.estimated_revenue;
            const netRevenue = grossRevenue * (1 - MARKET_TAX_RATE);

            cityMap[cityName].items.push({
                itemName: item.item_name,
                quantity: dest.quantity,
                percentage: dest.percentage,
                unitPrice: dest.unit_price,
                dailyDemand: dest.daily_demand,
                grossRevenue: grossRevenue,
                netRevenue: netRevenue
            });

            cityMap[cityName].totalQty += dest.quantity;
            cityMap[cityName].totalGross += grossRevenue;
            cityMap[cityName].totalNet += netRevenue;

            grandTotalGross += grossRevenue;
            grandTotalNet += netRevenue;
            grandTotalQty += dest.quantity;
        });
    });

    // 2. Dibujar la Tarjeta de Resumen Global (Ganancia Total Estimada)
    const summaryCard = document.createElement('div');
    summaryCard.className = 'card';
    summaryCard.style.cssText = `
        background: rgba(255, 215, 0, 0.05);
        border: 1px solid var(--accent-gold);
        padding: 15px 20px;
        margin-bottom: 20px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        flex-wrap: wrap;
        gap: 10px;
    `;
    summaryCard.innerHTML = `
        <div>
            <h3 style="color: var(--accent-gold); margin: 0;">💰 Ganancia Total Estimada (Neto)</h3>
            <small style="color: var(--text-muted);">
                Descontando ${(MARKET_TAX_RATE * 100).toFixed(0)}% de impuesto de venta (${isPremium ? '👑 Premium' : 'Sin Premium'})
            </small>
        </div>
        <div style="text-align: right;">
            <div style="font-size: 1.6rem; font-weight: bold; color: #4caf50;">
                ${formatSilver(Math.round(grandTotalNet))} 🪙
            </div>
            <small style="color: #aaa;">Total a repartir: <strong>${grandTotalQty}</strong> | Bruto: ${formatSilver(Math.round(grandTotalGross))}</small>
        </div>
    `;
    container.appendChild(summaryCard);

    // 3. Dibujar las tablas agrupadas por Parada / Ciudad
    Object.keys(cityMap).forEach(cityName => {
        const cityData = cityMap[cityName];

        let rowsHtml = cityData.items.map(item => `
            <tr>
                <td><strong>${item.itemName}</strong></td>
                <td><b style="color: var(--accent-gold);">${item.quantity}</b> (${item.percentage}%)</td>
                <td>${formatSilver(item.unitPrice)} 🪙</td>
                <td><strong>${item.dailyDemand.toLocaleString()}</strong> /día</td>
                <td><span class="price-green">${formatSilver(Math.round(item.netRevenue))} 🪙</span></td>
            </tr>
        `).join('');

        const cityCard = document.createElement('div');
        cityCard.className = 'card';
        cityCard.style.cssText = 'margin-top: 15px; border: 1px solid var(--border);';
        
        cityCard.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 8px;">
                <h3 style="color: var(--accent-gold); margin: 0;">📍 Parada: ${cityName}</h3>
                <span style="font-size: 0.95rem; color: #ccc;">
                    Bajar aquí: <strong>${cityData.totalQty}</strong> | Subtotal Neto: <strong style="color: #4caf50;">${formatSilver(Math.round(cityData.totalNet))} 🪙</strong>
                </span>
            </div>
            <div class="table-responsive">
                <table>
                    <thead>
                        <tr>
                            <th>Comida / Producto</th>
                            <th>Cantidad a Dejar</th>
                            <th>Precio Venta</th>
                            <th>Demanda Mercado</th>
                            <th>Ingreso Neto</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rowsHtml}
                    </tbody>
                </table>
            </div>
        `;
        container.appendChild(cityCard);
    });
}
                            
async function saveManualPrice(city) {
    const itemId = document.getElementById('itemSelect').value;
    const inputVal = document.getElementById(`input_${city}`).value;
    const newPrice = parseInt(inputVal, 10);

    if (isNaN(newPrice) || newPrice <= 0) {
        alert("Por favor ingresa un precio válido en silver.");
        return;
    }

    globalMarketData[itemId][city].sell_order = newPrice;
    globalMarketData[itemId][city].is_edited = true;
    globalMarketData[itemId][city].is_suspicious = false;
    globalMarketData[itemId][city].time_ago = "Editado manualmente";

    await fetch('/api/update-price', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_id: itemId, city: city, price: newPrice })
    });

    renderItemTable();
    calculateRouteUI();
}

async function calculateRouteUI() {
    const isPremium = document.getElementById('premiumToggle').checked;
    const container = document.getElementById('routeContainer');

    // Si el inventario está vacío o no hay sesión
    if (Object.keys(globalInventory).length === 0) {
        container.innerHTML = '<p style="color: var(--text-muted);">Agrega comidas a tu inventario para ver la recomendación de venta.</p>';
        return;
    }

    const payload = {
        inventory: globalInventory,
        premium: isPremium
    };

    try {
        const res = await fetch('/api/route', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await res.json();
        renderRoutePlan(data);
    } catch (error) {
        console.error("Error al calcular la ruta:", error);
        container.innerHTML = '<p style="color: var(--accent-red);">Error al calcular el reparto de mercado.</p>';
    }
}
async function calculateOptimizedRoute() {
    // Reemplaza 'userInventoryMap' con la variable donde tengas almacenado 
    // el inventario actual del usuario ej: { "T8_MEAL_STEW@3": 200 }
    const payload = {
        inventory: userInventoryMap,
        premium: true
    };

    try {
        const response = await fetch('/api/route', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json();
        renderRoutePlan(data); // Renderiza los resultados en la interfaz
    } catch (error) {
        console.error("Error al calcular la ruta:", error);
    }
}

// Inicialización global
window.onload = async () => {
    await loadAllData();
    await checkAuth();
};
