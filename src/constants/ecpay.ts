const env = process.env.NODE_ENV;

let checkOutUrl = "https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5";
let logisticBaseUrl = "https://logistics-stage.ecpay.com.tw";
let queryLogisticsTradeInfoUrl =
  "https://logistics-stage.ecpay.com.tw/Helper/QueryLogisticsTradeInfo/V5";

if (env === "stg" || env === "production") {
  checkOutUrl = "https://payment.ecpay.com.tw/Cashier/AioCheckOut/V5";
  logisticBaseUrl = "https://logistics.ecpay.com.tw";
  queryLogisticsTradeInfoUrl =
    "https://logistics.ecpay.com.tw/Helper/QueryLogisticsTradeInfo/V5";
}

export const ECPAY_CHECKOUT_URL = checkOutUrl;
export const ECPAY_LOGISTIC_BASE_URL = logisticBaseUrl;
export const ECPAY_QUERY_LOGISTICS_TRADE_INFO_URL = queryLogisticsTradeInfoUrl;

export class ECPAY_SHIPPING_FEE {
  static FAMI = Number(process.env.ECPAY_FAMI_SHIPPING_FEE);
  static UNIMART = Number(process.env.ECPAY_UNIMART_SHIPPING_FEE);
  static FAMIC2C = Number(process.env.ECPAY_FAMIC2C_SHIPPING_FEE);
  static UNIMARTC2C = Number(process.env.ECPAY_UNIMARTC2C_SHIPPING_FEE);
  static HILIFEC2C = Number(process.env.ECPAY_HILIFEC2C_SHIPPING_FEE);
  static OKMARTC2C = Number(process.env.ECPAY_OKMARTC2C_SHIPPING_FEE);
}
