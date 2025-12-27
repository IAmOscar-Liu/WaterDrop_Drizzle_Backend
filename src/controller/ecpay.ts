import { Request, Response } from "express";
import { validateToken } from "../lib/token";
import path from "path";
import {
  createDelivery,
  getOrderByMerchantTradeNo,
  updateOrderStatus,
} from "../repository/order";
import ecpayService from "../services/ecpay";
import { sendJsonResponse } from "../lib/general";

const TEST_ORDER_ID = "test_order_12345";

class EcPayController {
  async createTestPayment(req: Request, res: Response): Promise<any> {
    const base_param = {
      MerchantID: process.env.MERCHANTID,
      MerchantTradeNo: ecpayService.generateTradeNo(),
      MerchantTradeDate: ecpayService.generateMerchantTradeDate(),
      PaymentType: "aio",
      TotalAmount: "200",
      TradeDesc: "測試商品描述",
      ItemName: "測試商品",
      ReturnURL: `${process.env.HOST}/api/ecpay/return`,
      ClientBackURL: `${process.env.HOST}/api/ecpay/clientReturn`,
      // ChoosePayment: "Credit",
      ChoosePayment: "ALL",
      // IgnorePayment: "CVS#BARCODE#WebATM#AndroidPay#ApplePay",
      IgnorePayment: "CVS#BARCODE#WebATM#AndroidPay#ApplePay#TWQR#WeiXin",
      EncryptType: 1,
      CustomField1: TEST_ORDER_ID,
    };

    const formHtml = ecpayService.generateFormHtml({
      actionUrl: "https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5",
      parameters: base_param,
      checkMacValueOptions: {
        hashKey: process.env.HASHKEY!,
        hashIV: process.env.HASHIV!,
      },
    });

    return res.send(formHtml);
  }

  async createPayment(req: Request, res: Response): Promise<any> {
    const { token, orderId, totalAmount, tradeDesc, itemName } = req.query;

    if (!token || !orderId || !totalAmount || !tradeDesc || !itemName)
      return res.send("Missing required parameters");
    const payload = validateToken(String(token));
    if (!payload || typeof payload === "string" || !payload.data?.id)
      return res.send("Invalid token");

    const base_param = {
      MerchantID: process.env.MERCHANTID,
      MerchantTradeNo: ecpayService.generateTradeNo(),
      MerchantTradeDate: ecpayService.generateMerchantTradeDate(),
      PaymentType: "aio",
      IgnorePayment: "CVS#BARCODE#WebATM#ATM#AndroidPay#ApplePay",
      TotalAmount: Number(totalAmount),
      TradeDesc: String(tradeDesc),
      ItemName: String(itemName),
      ReturnURL: `${process.env.HOST}/api/ecpay/return`,
      ClientBackURL: `${process.env.HOST}/api/ecpay/clientReturn`,
      ChoosePayment: "Credit",
      EncryptType: 1,
      CustomField1: String(orderId),
    };

    const formHtml = ecpayService.generateFormHtml({
      actionUrl: "https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5",
      parameters: base_param,
      checkMacValueOptions: {
        hashKey: process.env.HASHKEY!,
        hashIV: process.env.HASHIV!,
      },
    });

    return res.send(formHtml);
  }

  async handleReturn(req: Request, res: Response): Promise<any> {
    const data = req.body;
    // const { CheckMacValue, checkValue, orderId } =
    //   ecpayService.getCheckValue(data);

    // console.log(
    //   "確認交易正確性：",
    //   CheckMacValue === checkValue,
    //   CheckMacValue,
    //   checkValue
    // );

    console.log("交易結果:", data);

    const orderId = data.CustomField1;

    if (orderId !== TEST_ORDER_ID)
      await updateOrderStatus(
        orderId,
        data.RtnCode == 1 ? "paid" : "failed",
        data
      )
        .then((result) => {
          if (!result) throw new Error("Order not found");
          console.log(`Successfully updated order:`, result.id);
        })
        .catch((error) => console.error("Error updating order:", error));

    // 交易成功後，需要回傳 1|OK 給綠界
    res.send("1|OK");
  }

  async handleClientReturn(req: Request, res: Response): Promise<any> {
    console.log("clientReturn:", req.body, req.query);
    res.sendFile(
      path.resolve(process.cwd(), "src/assets/html/clientReturn.html")
    );
  }

  async getLogisticsMap(req: Request, res: Response): Promise<any> {
    const mapParams = {
      MerchantID: process.env.LOGISTICS_MERCHANTID,
      LogisticsType: "CVS",
      LogisticsSubType: req.query.logisticsSubType ?? "FAMI", //. "FAMI", // 範例：7-ELEVEN
      IsCollection: "N", // 是否代收貨款
      ServerReplyURL: `${process.env.HOST}/api/ecpay/logistics/map-callback`, // 接收門市資訊的後端網址
    };

    const formHtml = ecpayService.generateFormHtml({
      actionUrl: "https://logistics-stage.ecpay.com.tw/Express/map",
      parameters: mapParams,
    });

    return res.send(formHtml);
  }

  async handleLogisticsMapCallback(req: Request, res: Response): Promise<any> {
    const data = req.body;
    res.send(`
      <!DOCTYPE html>
      <html lang="en">
        <body>
          <h1>Success</h1>

          <script>
            window.addEventListener(
              "flutterInAppWebViewPlatformReady",
              function (event) {
                window.flutter_inappwebview.callHandler("logistics-map-callback", ${JSON.stringify(
                  data,
                  null,
                  2
                )});
              }
            );
          </script>
        </body>
      </html>
      `);
  }

  async validateLogisticsParams(req: Request, res: Response): Promise<any> {
    const result = ecpayService.validateLogisticsParams(req.body);
    if (!result) {
      sendJsonResponse(res, { success: true, data: "OK" });
    } else {
      sendJsonResponse(res, { success: false, message: result });
    }
  }

  async createTestExpress(req: Request, res: Response): Promise<any> {
    const { ReceiverName, ReceiverCellPhone, ReceiverEmail } = req.query;

    if (!ReceiverName || !ReceiverCellPhone || !ReceiverEmail)
      return res.send("Missing required parameters");

    const base_param = {
      MerchantID: "2000132",
      MerchantTradeNo: ecpayService.generateTradeNo(),
      MerchantTradeDate: ecpayService.generateMerchantTradeDate(),
      LogisticsType: "CVS",
      LogisticsSubType: "UNIMART", // 範例：7-ELEVEN
      GoodsName: "測試商品",
      GoodsAmount: "300",
      SenderName: "水滴",
      IsCollection: "N", // 是否代收貨款
      ServerReplyURL: `${process.env.HOST}/api/ecpay/express/test/server-reply`, // 接收門市資訊的後端網址
      ClientReplyURL: `${process.env.HOST}/api/ecpay/express/test/client-reply`,
      ReceiverName, // "王小明",
      ReceiverCellPhone, // "0978443522",
      ReceiverEmail, // "safaf2@ddd.com",
      ReceiverStoreID: "131386",
    };

    const formHtml = ecpayService.generateFormHtml({
      actionUrl: "https://logistics-stage.ecpay.com.tw/Express/Create",
      parameters: base_param,
      checkMacValueOptions: {
        hashKey: "5294y06JbISpM5x9",
        hashIV: "v77hoKGq4kWxNNIS",
        algorithm: "md5",
      },
    });

    return res.send(formHtml);
  }

  async handleTestExpressServerReply(
    req: Request,
    res: Response
  ): Promise<any> {
    const data = req.body;
    console.log("測試運單結果:", data);
    res.send("1|OK");
  }

  async handleTestExpressClientReply(
    req: Request,
    res: Response
  ): Promise<any> {
    res.send(`
     <!DOCTYPE html>
      <html lang="en">
        <body>
          <h1>Success</h1>

          <script>
            window.addEventListener(
              "flutterInAppWebViewPlatformReady",
              function (event) {
                window.flutter_inappwebview.callHandler("express-test-reply", ${JSON.stringify(
                  req.body,
                  null,
                  2
                )});
              }
            );
          </script>
        </body>
      </html>
    `);
  }

  async createExpress(req: Request, res: Response): Promise<any> {
    const {
      token,
      MerchantTradeNo,
      LogisticsSubType,
      GoodsName,
      GoodsAmount,
      ReceiverName,
      ReceiverCellPhone,
      ReceiverEmail,
      ReceiverStoreID,
    } = req.query;

    if (
      !token ||
      !MerchantTradeNo ||
      !LogisticsSubType ||
      !GoodsName ||
      !GoodsAmount ||
      !ReceiverName ||
      !ReceiverCellPhone ||
      !ReceiverEmail ||
      !ReceiverStoreID
    )
      return res.send("Missing required parameters");
    const payload = validateToken(String(token));
    if (!payload || typeof payload === "string" || !payload.data?.id)
      return res.send("Invalid token");

    const maxGoodsAmount = Math.min(20000, Math.floor(Number(GoodsAmount)));

    const base_param = {
      MerchantID: process.env.LOGISTICS_MERCHANTID,
      MerchantTradeNo,
      MerchantTradeDate: ecpayService.generateMerchantTradeDate(),
      LogisticsType: "CVS",
      LogisticsSubType, // 範例：7-ELEVEN
      GoodsName: String(GoodsName),
      GoodsAmount: String(maxGoodsAmount),
      CollectionAmount: String(maxGoodsAmount),
      SenderName: "水滴",
      IsCollection: "N", // 是否代收貨款
      ServerReplyURL: `${process.env.HOST}/api/ecpay/express/server-reply`, // 接收門市資訊的後端網址
      ClientReplyURL: `${process.env.HOST}/api/ecpay/express/client-reply`, // 接收門市資訊的後端網址
      ReceiverName,
      ReceiverCellPhone,
      ReceiverEmail,
      ReceiverStoreID,
    };

    console.log("base_param: ", base_param);

    const formHtml = ecpayService.generateFormHtml({
      actionUrl: "https://logistics-stage.ecpay.com.tw/Express/Create",
      parameters: base_param,
      checkMacValueOptions: {
        hashKey: process.env.LOGISTICS_HASH_KEY!,
        hashIV: process.env.LOGISTICS_HASH_IV!,
        algorithm: "md5",
      },
    });

    return res.send(formHtml);
  }

  async handleExpressClientReply(req: Request, res: Response): Promise<any> {
    res.send(`
     <!DOCTYPE html>
      <html lang="en">
        <body>
          <h1>Success</h1>

          <script>
            window.addEventListener(
              "flutterInAppWebViewPlatformReady",
              function (event) {
                window.flutter_inappwebview.callHandler("express-reply", ${JSON.stringify(
                  req.body,
                  null,
                  2
                )});
              }
            );
          </script>
        </body>
      </html>
    `);
  }

  async handleExpressServerReply(req: Request, res: Response): Promise<any> {
    const data = req.body;
    console.log("運單結果:", data);

    try {
      const order = await getOrderByMerchantTradeNo(data.MerchantTradeNo);
      if (!order) throw new Error("Order not found");
      await createDelivery({
        orderId: order.id,
        merchantTradeNo: data.MerchantTradeNo,
        AllPayLogisticsID: data.AllPayLogisticsID,
        LogisticsType: data.LogisticsType,
        LogisticsSubType: data.LogisticsSubType,
        GoodsAmount: Number(data.GoodsAmount),
        ReceiverStoreId: data.ReceiverStoreID,
        RtnCode: data.RtnCode,
        RtnMsg: data.RtnMsg,
        metadata: data,
      });
    } catch (error) {
      console.log(error);
    }

    res.send(`1|OK`);
  }

  async printTradeDocument(req: Request, res: Response) {
    const { token, AllPayLogisticsID } = req.query;

    if (!token || !AllPayLogisticsID)
      return res.send("Missing required parameters");
    const payload = validateToken(String(token));
    if (!payload || typeof payload === "string" || !payload.data?.id)
      return res.send("Invalid token");

    const base_param = {
      MerchantID: process.env.LOGISTICS_MERCHANTID,
      AllPayLogisticsID,
      PrintMode: "1",
    };

    const formHtml = ecpayService.generateFormHtml({
      actionUrl:
        "https://logistics-stage.ecpay.com.tw/helper/printTradeDocument",
      parameters: base_param,
      checkMacValueOptions: {
        hashKey: process.env.LOGISTICS_HASH_KEY!,
        hashIV: process.env.LOGISTICS_HASH_IV!,
        algorithm: "md5",
      },
    });

    return res.send(formHtml);
  }
}

export default new EcPayController();
