const env = process.env.NODE_ENV;

let checkOutUrl = "https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5";
let logisticBaseUrl = "https://logistics-stage.ecpay.com.tw";

if (env === "stg" || env === "production") {
  checkOutUrl = "https://payment.ecpay.com.tw/Cashier/AioCheckOut/V5";
  logisticBaseUrl = "https://logistics.ecpay.com.tw";
}

export const ECPAY_CHECKOUT_URL = checkOutUrl;
export const ECPAY_LOGISTIC_BASE_URL = logisticBaseUrl;
