"""
Line Bot Flex Message 產生器 (Line Flex Message Builder & Handler - 10 檔擴大池版)
"""
from typing import List, Dict

class LineFlexMessageBuilder:
    @staticmethod
    def build_stock_recommendations_carousel(stock_analyses: List[Dict]) -> Dict:
        """
        將最多 10 檔符合當沖/短線條件之個股分析轉化為 Line Flex Message 輪播卡片 JSON
        """
        bubbles = []
        for stock in stock_analyses[:10]:
            badge_color = "#00B894" if stock["signal_type"] == "GREEN_BUY" else ("#FF7675" if stock["signal_type"] == "RED_SELL" else "#FDCB6E")
            badge_text = "🟢 建議買進" if stock["signal_type"] == "GREEN_BUY" else ("🔴 建議賣出" if stock["signal_type"] == "RED_SELL" else "🟡 觀望觀察")
            
            bubble = {
                "type": "bubble",
                "size": "mega",
                "header": {
                    "type": "box",
                    "layout": "vertical",
                    "backgroundColor": badge_color,
                    "contents": [
                        {
                            "type": "text",
                            "text": f"{badge_text}｜{stock['holding_period']}",
                            "color": "#FFFFFF",
                            "weight": "bold",
                            "size": "sm"
                        }
                    ]
                },
                "body": {
                    "type": "box",
                    "layout": "vertical",
                    "contents": [
                        {
                            "type": "text",
                            "text": f"{stock['stock_code']} {stock['name']}",
                            "weight": "bold",
                            "size": "xl",
                            "color": "#2D3436"
                        },
                        {
                            "type": "box",
                            "layout": "horizontal",
                            "margin": "md",
                            "contents": [
                                {
                                    "type": "text",
                                    "text": f"${stock['current_price']}",
                                    "size": "xxl",
                                    "weight": "bold",
                                    "color": "#D63031" if stock["change_amount"] < 0 else "#00B894"
                                },
                                {
                                    "type": "text",
                                    "text": f"{'+' if stock['change_percent'] > 0 else ''}{stock['change_percent']}%",
                                    "size": "md",
                                    "align": "end",
                                    "gravity": "center",
                                    "color": "#D63031" if stock["change_amount"] < 0 else "#00B894",
                                    "weight": "bold"
                                }
                            ]
                        },
                        {"type": "separator", "margin": "lg"},
                        {
                            "type": "box",
                            "layout": "vertical",
                            "margin": "lg",
                            "spacing": "sm",
                            "contents": [
                                {
                                    "type": "box",
                                    "layout": "horizontal",
                                    "contents": [
                                        {"type": "text", "text": "淨保本價 (含稅費):", "size": "xs", "color": "#636E72"},
                                        {"type": "text", "text": f"${stock['breakeven_price']}", "size": "xs", "weight": "bold", "align": "end", "color": "#0984E3"}
                                    ]
                                },
                                {
                                    "type": "box",
                                    "layout": "horizontal",
                                    "contents": [
                                        {"type": "text", "text": "極短線目標價:", "size": "xs", "color": "#636E72"},
                                        {"type": "text", "text": f"${stock['target_price']} (純利+{stock['net_target_roi_percent']}%)", "size": "xs", "weight": "bold", "align": "end", "color": "#00B894"}
                                    ]
                                },
                                {
                                    "type": "box",
                                    "layout": "horizontal",
                                    "contents": [
                                        {"type": "text", "text": "嚴格停損價:", "size": "xs", "color": "#636E72"},
                                        {"type": "text", "text": f"${stock['stop_loss_price']} ({stock['net_stop_roi_percent']}%)", "size": "xs", "weight": "bold", "align": "end", "color": "#D63031"}
                                    ]
                                },
                                {
                                    "type": "box",
                                    "layout": "horizontal",
                                    "contents": [
                                        {"type": "text", "text": "當日均價 (VWAP):", "size": "xs", "color": "#636E72"},
                                        {"type": "text", "text": f"${stock['vwap']}", "size": "xs", "align": "end"}
                                    ]
                                },
                                {
                                    "type": "box",
                                    "layout": "horizontal",
                                    "contents": [
                                        {"type": "text", "text": "外盤成交比率:", "size": "xs", "color": "#636E72"},
                                        {"type": "text", "text": f"{stock['outer_buy_ratio_percent']}%", "size": "xs", "align": "end", "weight": "bold"}
                                    ]
                                }
                            ]
                        }
                    ]
                },
                "footer": {
                    "type": "box",
                    "layout": "horizontal",
                    "spacing": "sm",
                    "contents": [
                        {
                            "type": "button",
                            "style": "primary",
                            "color": "#0984E3",
                            "action": {
                                "type": "uri",
                                "label": "看 Web 詳細圖表",
                                "uri": f"http://localhost:8000/#/stock/{stock['stock_code']}"
                            }
                        }
                    ]
                }
            }
            bubbles.append(bubble)

        return {
            "type": "flex",
            "altText": f"🤖 每日精選 10 檔符合條件之當沖/短線股票診斷",
            "contents": {
                "type": "carousel",
                "contents": bubbles
            }
        }
