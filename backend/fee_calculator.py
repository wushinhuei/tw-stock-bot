"""
台股交易費用與淨純利精算模組 (Taiwan Stock Transaction Fee & Net ROI Calculator)
"""

class StockFeeCalculator:
    BASE_FEE_RATE = 0.001425  # 0.1425% 券商基本手續費
    TAX_RATE_REGULAR = 0.003  # 0.3% 一般交易證交稅
    TAX_RATE_DAY_TRADE = 0.0015  # 0.15% 現股當沖證交稅

    def __init__(self, broker_discount: float = 0.6, minimum_fee: float = 20.0):
        """
        :param broker_discount: 券商手續費折扣 (例如 0.6 代表 6 折, 0.28 代表 2.8 折)
        :param minimum_fee: 單筆最低手續費 (預設 20 元)
        """
        self.broker_discount = broker_discount
        self.minimum_fee = minimum_fee

    def calculate_buy_cost(self, price: float, shares: int = 1000) -> dict:
        """計算買進總成本"""
        raw_trade_val = price * shares
        raw_fee = raw_trade_val * self.BASE_FEE_RATE * self.broker_discount
        fee = max(raw_fee, self.minimum_fee) if raw_trade_val > 0 else 0
        total_cost = raw_trade_val + fee
        return {
            "trade_value": raw_trade_val,
            "fee": round(fee, 2),
            "total_cost": round(total_cost, 2)
        }

    def calculate_sell_revenue(self, price: float, shares: int = 1000, is_day_trade: bool = True) -> dict:
        """計算賣出扣除費用與稅後淨得"""
        raw_trade_val = price * shares
        raw_fee = raw_trade_val * self.BASE_FEE_RATE * self.broker_discount
        fee = max(raw_fee, self.minimum_fee) if raw_trade_val > 0 else 0
        
        tax_rate = self.TAX_RATE_DAY_TRADE if is_day_trade else self.TAX_RATE_REGULAR
        tax = raw_trade_val * tax_rate
        
        net_revenue = raw_trade_val - fee - tax
        return {
            "trade_value": raw_trade_val,
            "fee": round(fee, 2),
            "tax": round(tax, 2),
            "net_revenue": round(net_revenue, 2)
        }

    def calculate_breakeven_price(self, buy_price: float, is_day_trade: bool = True) -> float:
        """
        計算買進後的「淨保本價格 (Break-even Price)」
        保本價 = 賣出扣除手續費與稅後，剛好等於買進總成本的股價
        """
        buy_info = self.calculate_buy_cost(buy_price, shares=1000)
        total_buy_cost = buy_info["total_cost"]
        
        tax_rate = self.TAX_RATE_DAY_TRADE if is_day_trade else self.TAX_RATE_REGULAR
        effective_sell_factor = 1 - (self.BASE_FEE_RATE * self.broker_discount) - tax_rate
        
        breakeven = (total_buy_cost / 1000) / effective_sell_factor
        return round(breakeven, 2)

    def calculate_net_pnl(self, buy_price: float, sell_price: float, shares: int = 1000, is_day_trade: bool = True) -> dict:
        """計算完全扣除手續費與稅後的純利與純 ROI"""
        buy_info = self.calculate_buy_cost(buy_price, shares)
        sell_info = self.calculate_sell_revenue(sell_price, shares, is_day_trade)
        
        gross_pnl = sell_info["trade_value"] - buy_info["trade_value"]
        total_friction = buy_info["fee"] + sell_info["fee"] + sell_info["tax"]
        net_pnl = sell_info["net_revenue"] - buy_info["total_cost"]
        net_roi = (net_pnl / buy_info["total_cost"]) * 100
        
        return {
            "buy_price": buy_price,
            "sell_price": sell_price,
            "shares": shares,
            "gross_pnl": round(gross_pnl, 2),
            "total_friction": round(total_friction, 2),
            "net_pnl": round(net_pnl, 2),
            "net_roi_percent": round(net_roi, 2),
            "is_day_trade": is_day_trade
        }


if __name__ == "__main__":
    calc = StockFeeCalculator(broker_discount=0.6)
    print("=== 台股 2330 當沖費用測試 ===")
    buy_p = 975.0
    breakeven = calc.calculate_breakeven_price(buy_p, is_day_trade=True)
    print(f"買進價: ${buy_p} | 保本賣出價: ${breakeven}")
    
    pnl = calc.calculate_net_pnl(buy_price=975.0, sell_price=995.0, shares=1000, is_day_trade=True)
    print("獲利計算結果:", pnl)
