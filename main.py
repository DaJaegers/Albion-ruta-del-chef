import os
import time
import math
import statistics
from datetime import datetime, timezone
from typing import Dict, Optional
from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import requests
import urllib.parse

# ==========================================
# CONFIGURACIÓN Y CONSTANTES
# ==========================================
DEFAULT_REGION = "west"

ITEM_NAMES = {
    "T6_MEAL_SALAD_FISH@3": "Ensalada de kraken T6.3",
    "T6_MEAL_SALAD_FISH@2": "Ensalada de kraken T6.2",
    "T6_MEAL_SALAD_FISH@1": "Ensalada de kraken T6.1",
    "T6_MEAL_SALAD_FISH": "Ensalada de kraken T6",
    "T7_MEAL_ROAST_FISH": "Pargo asado T7",
    "T7_MEAL_ROAST_FISH@1": "Pargo asado T7.1",
    "T5_MEAL_ROAST_FISH": "Pargo asado T5",
    "T7_MEAL_OMELETTE@2": "Tortilla de cerdo T7.2",
    "T7_MEAL_OMELETTE_FISH": "Tortilla de cangrejo T7",
    "T8_MEAL_STEW@3": "Guiso de ternera T8.3",
    "T8_MEAL_STEW@2": "Guiso de ternera T8.2",
    "T8_MEAL_STEW_FISH@1": "Guiso de anguila T8.1",
    "T8_MEAL_STEW_FISH": "Guiso de anguila T8",
    "T6_MEAL_STEW_FISH": "Guiso de anguila T6",
    "T8_MEAL_SANDWICH_FISH": "Bocadillo de locha T8",
    "T1_FISHSAUCE_LEVEL1":	"Salsa de pescado básica",
    "T1_FISHSAUCE_LEVEL2":	"Salsa de pescado extravagante",
    "T1_FISHSAUCE_LEVEL3":	"Salsa de pescado especial",
}

CITIES = ["Thetford", "Fort Sterling", "Lymhurst", "Bridgewatch", "Martlock", "Brecilien"]
DEFAULT_ITEMS = list(ITEM_NAMES.keys())

# Cache en Memoria
market_cache = {}
history_cache = {}
last_fetch_time = 0
current_region = DEFAULT_REGION

# Definimos el esquema para recibir el inventario en JSON
class RouteRequest(BaseModel):
    inventory: Dict[str, int]  # Ejemplo: {"T8_MEAL_STEW@3": 300, "T6_MEAL_SALAD_FISH@3": 150}
    premium: Optional[bool] = True

def parse_date_age(date_str):
    if not date_str or date_str.startswith("0001"):
        return 9999, "Sin información"
    try:
        clean_str = date_str.split(".")[0].replace("Z", "")
        dt = datetime.strptime(clean_str, "%Y-%m-%dT%H:%M:%S").replace(tzinfo=timezone.utc)
        now = datetime.now(timezone.utc)
        diff_seconds = (now - dt).total_seconds()
        
        if diff_seconds < 0:
            return 0, "Hace un momento"
        
        hours = diff_seconds / 3600.0
        if hours < 1:
            return hours, f"Hace {int(diff_seconds / 60)}m"
        elif hours < 24:
            return hours, f"Hace {int(hours)}h {int((diff_seconds % 3600) / 60)}m"
        else:
            return hours, f"Hace {int(hours / 24)}d"
    except Exception:
        return 9999, "Sin información"

def fetch_market_data(region=DEFAULT_REGION):
    items_str = ",".join(DEFAULT_ITEMS)
    locations_str = ",".join([urllib.parse.quote(loc) for loc in CITIES])
    
    if region == "europe":
        domain = "europe.albion-online-data.com"
    elif region == "east":
        domain = "east.albion-online-data.com"
    else:
        domain = "west.albion-online-data.com"

    url_prices = f"https://{domain}/api/v2/stats/prices/{items_str}.json?locations={locations_str}&qualities=1,2,3"
    url_history = f"https://{domain}/api/v2/stats/history/{items_str}.json?locations={locations_str}&time-scale=24&qualities=1,2,3"

    results = {item: {city: {} for city in CITIES} for item in DEFAULT_ITEMS}
    headers = {'User-Agent': 'Mozilla/5.0'}

    # 1. Obtener Precios Mínimos
    try:
        resp = requests.get(url_prices, headers=headers, timeout=12)
        raw_data = resp.json()
        for entry in raw_data:
            item_id, city = entry.get("item_id"), entry.get("city")
            if item_id in results and city in results[item_id]:
                sell_min = entry.get("sell_price_min", 0)
                date_str = entry.get("sell_price_min_date", "")
                age_hours, time_ago = parse_date_age(date_str)
                
                existing_sell = results[item_id][city].get("sell_order")
                if existing_sell is None or (sell_min > 0 and sell_min < existing_sell):
                    results[item_id][city] = {
                        "sell_order": sell_min if sell_min > 0 else None,
                        "time_ago": time_ago,
                        "age_hours": age_hours,
                        # Alerta si pasaron más de 8 horas o si no hay fecha válida
                        "is_suspicious": age_hours > 8,
                        "daily_demand": 0
                    }
    except Exception as e:
        print(f"[!] Error consultando Precios: {e}")

    # 2. Obtener Historial de Demanda Real
    try:
        # Nota: Asegúrate de que la URL apunte al endpoint de /history/ con time-scale=24
        # Ejemplo: f"https://west.albion-online-data.com/api/v2/stats/history/{item_id}?time-scale=24"
        resp_hist = requests.get(url_history, headers=headers, timeout=12)
        hist_data = resp_hist.json()
        
        for entry in hist_data:
            item_id = entry.get("item_id")
            city = entry.get("location")
            data_points = entry.get("data", [])
            
            if item_id in results and city in results[item_id] and data_points:
                # Agrupamos el volumen total vendido por fecha (YYYY-MM-DD)
                daily_totals = {}
                
                for point in data_points:
                    timestamp = point.get("timestamp", "")
                    count = point.get("item_count", 0)
                    
                    if timestamp and count > 0:
                        # Extraemos solo la fecha (los primeros 10 caracteres: "2026-07-22")
                        date_str = timestamp.split("T")[0]
                        daily_totals[date_str] = daily_totals.get(date_str, 0) + count
                
                # Convertimos las fechas a una lista ordenada
                sorted_dates = sorted(daily_totals.keys())
                
                # Descartamos el último día si es el día de HOY (para no agarrar un día a medias)
                if len(sorted_dates) > 1:
                    completed_dates = sorted_dates[:-1]
                else:
                    completed_dates = sorted_dates
                
                # Tomamos los últimos 7 días con ventas reales completas
                recent_dates = completed_dates[-7:]
                
                if recent_dates:
                    total_sold = sum(daily_totals[d] for d in recent_dates)
                    avg_daily = int(total_sold / len(recent_dates))
                    
                    # Asignamos el promedio real de 24h
                    results[item_id][city]["daily_demand"] = avg_daily

    except Exception as e:
        print(f"[!] Error procesando demanda: {e}")

    return results

# ==========================================
# APLICACIÓN FASTAPI
# ==========================================
app = FastAPI(title="La Ruta del Chef API")

# 1. API - Datos del mercado
@app.get("/api/data")
def get_data(region: str = DEFAULT_REGION):
    global last_fetch_time, current_region, market_cache
    now = time.time()
    
    if now - last_fetch_time > 30 or region != current_region:
        market_cache = fetch_market_data(region)
        last_fetch_time = now
        current_region = region
        
    return {
        "market": market_cache,
        "item_names": ITEM_NAMES
    }

# 2. API - Cálculo de Ruta Óptima
@app.post("/api/route")
def get_route(data: RouteRequest):
    """
    Calcula la distribución óptima del inventario hacia las ciudades 
    basado en un balance de Precio y Demanda Diaria (incluyendo Brecilien).
    """
    global market_cache
    if not market_cache:
        market_cache = fetch_market_data(current_region)

    user_inventory = data.inventory
    distribution_plan = []

    for item_id, total_qty in user_inventory.items():
        if total_qty <= 0 or item_id not in market_cache:
            continue

        item_name = ITEM_NAMES.get(item_id, item_id)
        city_data = market_cache[item_id]

        # 1. Filtrar ciudades válidas con precio
        valid_cities = []
        for city, info in city_data.items():
            price = info.get("sell_order")
            demand = info.get("daily_demand", 0)
            
            if price and price > 0:
                effective_demand = max(demand, 1)
                
                # CÁLCULO DEL SCORE: Precio * Raíz(Demanda)
                score = price * math.sqrt(effective_demand)
                
                valid_cities.append({
                    "city": city,
                    "price": price,
                    "demand": demand,
                    "score": score
                })

        if not valid_cities:
            continue

        # 2. Sumar el Score Total
        total_score = sum(c["score"] for c in valid_cities)

        # 3. Asignar cantidades por ciudad
        item_distribution = []
        allocated_qty = 0

        valid_cities.sort(key=lambda x: x["score"], reverse=True)

        for i, c in enumerate(valid_cities):
            weight = c["score"] / total_score
            
            if i == len(valid_cities) - 1:
                qty_to_send = total_qty - allocated_qty
            else:
                qty_to_send = int(round(total_qty * weight))
                allocated_qty += qty_to_send

            if qty_to_send > 0:
                estimated_revenue = qty_to_send * c["price"]
                item_distribution.append({
                    "city": c["city"],
                    "quantity": qty_to_send,
                    "unit_price": c["price"],
                    "daily_demand": c["demand"],
                    "estimated_revenue": estimated_revenue,
                    "percentage": round(weight * 100, 1)
                })

        distribution_plan.append({
            "item_id": item_id,
            "item_name": item_name,
            "total_quantity": total_qty,
            "destinations": item_distribution
        })

    return {"plan": distribution_plan}

# --- SERVIR ARCHIVOS ESTÁTICOS Y HTML ---

# Servir index.html en la raíz
@app.get("/")
def serve_index():
    return FileResponse("frontend/index.html", headers={"Cache-Control": "no-cache"})

# Montar carpeta frontend (Servirá automáticamente app.js, style.css, imágenes, etc.)
app.mount("/", StaticFiles(directory="frontend", html=True), name="frontend")