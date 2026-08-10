"""
台股極短線自動分析系統 主 API 服務 (FastAPI Backend Server)
"""
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fee_calculator import StockFeeCalculator
from analytics_engine import AnalyticsEngine
from line_bot_handler import LineFlexMessageBuilder

app = FastAPI(title="Taiwan Stock Auto-Analysis API", version="1.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

analytics = AnalyticsEngine(broker_discount=0.6)

def get_demo_stocks():
    """
    動態擴大掃描至 10 檔符合當沖與短線爆量突破策略之標的
    """
    return [
        analytics.analyze_stock("2356", "英業達", 53.8, 52.5, 68000, 32000, 53.1, 0.68),
        analytics.analyze_stock("2317", "鴻海", 261.5, 257.0, 85000, 45000, 259.0, 0.62),
        analytics.analyze_stock("3231", "緯創", 114.5, 112.0, 55000, 30000, 113.2, 0.59),
        analytics.analyze_stock("2330", "台積電", 2380.0, 2360.0, 42000, 38000, 2370.0, 0.58),
        analytics.analyze_stock("2382", "廣達", 282.0, 278.0, 31000, 18000, 280.5, 0.61),
        analytics.analyze_stock("2603", "長榮", 188.5, 184.0, 45000, 22000, 186.0, 0.65),
        analytics.analyze_stock("3017", "奇鋐", 635.0, 620.0, 18000, 9500, 628.0, 0.63),
        analytics.analyze_stock("2376", "技嘉", 265.0, 258.0, 24000, 12000, 261.0, 0.60),
        analytics.analyze_stock("6669", "緯穎", 2150.0, 2100.0, 5200, 2800, 2125.0, 0.57),
        analytics.analyze_stock("2454", "聯發科", 3970.0, 3980.0, 15000, 18000, 3990.0, 0.42)
    ]

@app.get("/api/stocks/recommendations")
def get_recommendations():
    stocks = get_demo_stocks()
    return {
        "status": "success",
        "market_status": "盤中即時診斷 (擴大 10 檔選股池)",
        "capital_limit": 1000000,
        "broker_discount": 0.6,
        "data_count": len(stocks),
        "data": stocks
    }

@app.get("/api/line/flex-preview")
def get_flex_preview():
    stocks = get_demo_stocks()
    flex_json = LineFlexMessageBuilder.build_stock_recommendations_carousel(stocks)
    return flex_json

@app.post("/api/line/webhook")
async def line_webhook(request: Request):
    return JSONResponse(content={"status": "ok"})

@app.get("/api/calc/pnl")
def calc_pnl(buy_price: float, sell_price: float, shares: int = 1000, is_day_trade: bool = True):
    calc = StockFeeCalculator(broker_discount=0.6)
    return calc.calculate_net_pnl(buy_price, sell_price, shares, is_day_trade)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)
