"""
台股極短線與當沖分析引擎 (Short-Term Trading & Analytics Engine)
"""
from typing import List, Dict
from fee_calculator import StockFeeCalculator

class AnalyticsEngine:
    def __init__(self, broker_discount: float = 0.6):
        self.fee_calc = StockFeeCalculator(broker_discount=broker_discount)

    def analyze_stock(self, stock_code: str, name: str, current_price: float, prev_close: float,
                      volume: int, avg_volume_5d: int, vwap: float, outer_buy_ratio: float,
                      chips_net_buy_3d: int = 0) -> Dict:
        """
        對單一股票進行短線/當沖多空訊號診斷
        """
        change_amount = current_price - prev_close
        change_percent = (change_amount / prev_close) * 100 if prev_close > 0 else 0
        volume_ratio = volume / avg_volume_5d if avg_volume_5d > 0 else 1.0
        
        # 精算淨保本價格 (當沖)
        breakeven_price = self.fee_calc.calculate_breakeven_price(current_price, is_day_trade=True)
        
        # 信號診斷邏輯
        signal_type = "YELLOW_WATCH"  # 預設觀望
        signal_title = "觀望 / 整理中"
        target_price = current_price * 1.025
        stop_loss_price = current_price * 0.982
        
        # 🟢 買進信號條件：站在 VWAP 之上 + 內外盤外盤>55% + 放量 > 1.2倍
        if current_price >= vwap and outer_buy_ratio >= 0.55 and volume_ratio >= 1.2:
            signal_type = "GREEN_BUY"
            if volume_ratio >= 2.0 and outer_buy_ratio >= 0.65:
                signal_title = "當沖/極短線 爆量強攻買進"
                target_price = round(current_price * 1.03, 1)
                stop_loss_price = round(current_price * 0.982, 1)
            else:
                signal_title = "短線拉回VWAP支撐 建議買進"
                target_price = round(current_price * 1.022, 1)
                stop_loss_price = round(current_price * 0.985, 1)

        # 🔴 賣出信號條件：跌破 VWAP 或高檔爆量長黑 (外盤比 < 40%)
        elif current_price < vwap or (change_percent < -1.5 and outer_buy_ratio < 0.45):
            signal_type = "RED_SELL"
            signal_title = "轉弱/高檔拉回 建議賣出離場"
            target_price = round(current_price * 0.96, 1)
            stop_loss_price = round(current_price * 0.99, 1)

        # 計算目標價下的扣費純利
        net_target_pnl = self.fee_calc.calculate_net_pnl(current_price, target_price, shares=1000, is_day_trade=True)
        net_stop_pnl = self.fee_calc.calculate_net_pnl(current_price, stop_loss_price, shares=1000, is_day_trade=True)

        return {
            "stock_code": stock_code,
            "name": name,
            "current_price": current_price,
            "change_amount": round(change_amount, 2),
            "change_percent": round(change_percent, 2),
            "volume": volume,
            "volume_ratio": round(volume_ratio, 2),
            "vwap": vwap,
            "outer_buy_ratio_percent": round(outer_buy_ratio * 100, 1),
            "breakeven_price": breakeven_price,
            "signal_type": signal_type,
            "signal_title": signal_title,
            "entry_range": f"${round(current_price * 0.995, 1)} - ${round(current_price * 1.005, 1)}",
            "target_price": target_price,
            "net_target_roi_percent": net_target_pnl["net_roi_percent"],
            "stop_loss_price": stop_loss_price,
            "net_stop_roi_percent": net_stop_pnl["net_roi_percent"],
            "holding_period": "當沖 / 1~2 天"
        }

if __name__ == "__main__":
    engine = AnalyticsEngine(broker_discount=0.6)
    res = engine.analyze_stock(
        stock_code="2356", name="英業達", current_price=53.8, prev_close=52.5,
        volume=68000, avg_volume_5d=32000, vwap=53.1, outer_buy_ratio=0.68
    )
    import json
    print(json.dumps(res, indent=2, ensure_ascii=False))
