const ecpay_payment = require("ecpay_aio_nodejs");

const options = {
  OperationMode: "Test", //Test or Production
  MercProfile: {
    MerchantID: process.env.MERCHANTID,
    HashKey: process.env.HASHKEY,
    HashIV: process.env.HASHIV,
  },
  IgnorePayment: [
    // "Credit",
    "WebATM",
    "ATM",
    "CVS",
    "BARCODE",
    "AndroidPay",
    "ApplePay",
    "BNPL",
    "TWQR",
  ],
  IsProjectContractor: false,
};

class EcPayService {
  generatePaymentHtml({
    orderId,
    data,
  }: {
    orderId: string;
    data: {
      totalAmount: number;
      tradeDesc: string;
      itemName: string;
    };
  }) {
    try {
      const { totalAmount, tradeDesc, itemName } = data;
      // SDK 提供的範例，參數設定
      // https://github.com/ECPay/ECPayAIO_Node.js/blob/master/ECPAY_Payment_node_js/conf/config-example.js
      const MerchantTradeDate = new Date().toLocaleString("zh-TW", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
        timeZone: "UTC",
      });
      const TradeNo = "test" + new Date().getTime();
      const HOST = process.env.HOST || "http://localhost:4000";
      let base_param = {
        MerchantTradeNo: TradeNo, //請帶20碼uid, ex: f0a0d7e9fae1bb72bc93
        MerchantTradeDate,
        TotalAmount: String(totalAmount),
        TradeDesc: tradeDesc,
        ItemName: itemName,
        ReturnURL: `${HOST}/api/ecpay/return`,
        ClientBackURL: `${HOST}/api/ecpay/clientReturn`,
        CustomField1: orderId,
      };
      const create = new ecpay_payment(options);

      // 注意：在此事直接提供 html + js 直接觸發的範例，直接從前端觸發付款行為
      const html = create.payment_client.aio_check_out_all(base_param);
      console.log(html);
      return html;
    } catch (error) {
      return `<p>建立訂單失敗，請稍後再試</p>`;
    }
  }

  getCheckValue(data: Record<string, any>) {
    try {
      console.log("req.body:", data);

      const { CheckMacValue, CustomField1 } = data;
      delete data.CheckMacValue; // 此段不驗證

      const create = new ecpay_payment(options);
      const checkValue = create.payment_client.helper.gen_chk_mac_value(data);

      return { CheckMacValue, checkValue, orderId: CustomField1 };
    } catch (error) {
      console.error(error);
      return { CheckMacValue: "", checkValue: "", orderId: "" };
    }
  }
}

export default new EcPayService();
