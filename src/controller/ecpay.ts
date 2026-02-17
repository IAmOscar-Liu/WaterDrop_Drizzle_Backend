import axios from "axios";
import { Request, Response } from "express";
import path from "path";
import querystring from "querystring";
import {
  ECPAY_CHECKOUT_URL,
  ECPAY_LOGISTIC_BASE_URL,
  ECPAY_QUERY_LOGISTICS_TRADE_INFO_URL,
} from "../constants/ecpay";
import { sendJsonResponse } from "../lib/general";
import { validateToken } from "../lib/token";
import { createDelivery } from "../repository/delivery";
import {
  createMerchantTrade,
  getMerchantTradeByMerchantTradeNo,
  updateOrderStatus,
} from "../repository/order";
import ecpayService from "../services/ecpay";

const TEST_ORDER_ID = "test_order_12345";

class EcPayController {
  async createTestPayment(req: Request, res: Response): Promise<any> {
    const realAccount = req.query.realAccount === "true";

    const base_param = {
      MerchantID: ecpayService.getTestMerchantID(realAccount),
      MerchantTradeNo: ecpayService.generateTradeNo(),
      MerchantTradeDate: ecpayService.generateMerchantTradeDate(),
      PaymentType: "aio",
      TotalAmount: "10",
      TradeDesc: "測試商品描述",
      ItemName: "測試商品",
      ReturnURL: `${process.env.HOST}/api/ecpay/return`,
      ClientBackURL: `${process.env.HOST}/api/ecpay/clientReturn`,
      ChoosePayment: "Credit",
      // IgnorePayment: "CVS#BARCODE#WebATM#AndroidPay#ApplePay",
      IgnorePayment: "CVS#BARCODE#WebATM#AndroidPay#ApplePay#TWQR#WeiXin",
      EncryptType: 1,
      CustomField1: TEST_ORDER_ID,
    };

    const formHtml = ecpayService.generateFormHtml({
      actionUrl: ecpayService.getTestCheckoutUrl(realAccount),
      parameters: base_param,
      checkMacValueOptions: {
        hashKey: ecpayService.getTestHashKey(realAccount),
        hashIV: ecpayService.getTestHashIV(realAccount),
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
      TotalAmount: Math.floor(Number(totalAmount)),
      TradeDesc: String(tradeDesc),
      ItemName: String(itemName),
      ReturnURL: `${process.env.HOST}/api/ecpay/return`,
      ClientBackURL: `${process.env.HOST}/api/ecpay/clientReturn`,
      ChoosePayment: "Credit",
      EncryptType: 1,
      CustomField1: String(orderId),
    };

    const formHtml = ecpayService.generateFormHtml({
      actionUrl: ECPAY_CHECKOUT_URL,
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
        data,
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
      path.resolve(process.cwd(), "src/assets/html/clientReturn.html"),
    );
  }

  async getLogisticsMap(req: Request, res: Response): Promise<any> {
    const mapParams = {
      MerchantID: process.env.LOGISTICS_MERCHANTID,
      LogisticsType: "CVS",
      LogisticsSubType: req.query.logisticsSubType ?? "FAMI", //. "FAMI", // 範例：7-ELEVEN
      IsCollection: "N", // 是否代收貨款
      ServerReplyURL: `${process.env.HOST}/api/ecpay/logistics/map-callback`, // 接收門市資訊的後端網址
      Device: 1,
    };

    const formHtml = ecpayService.generateFormHtml({
      actionUrl: `${ECPAY_LOGISTIC_BASE_URL}/Express/map`,
      parameters: mapParams,
    });

    return res.send(formHtml);
  }

  async handleLogisticsMapCallback(req: Request, res: Response): Promise<any> {
    const data = req.body;
    console.log("商店結果", data);
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
                  2,
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
    const {
      type = "B2C",
      LogisticsSubType,
      SenderName,
      SenderCellPhone,
      ReceiverStoreID,
      ReceiverName,
      ReceiverCellPhone,
      ReceiverEmail,
    } = req.query;

    if (!ReceiverName || !ReceiverCellPhone || !ReceiverEmail)
      return res.send("Missing required parameters");

    const realAccount = req.query.realAccount === "true";
    if (realAccount) {
      if (!LogisticsSubType)
        return res.send("LogisticsSubType is required for real account");
      if (!ReceiverStoreID)
        return res.send("ReceiverStoreID is required for real account");
      if (type !== "B2C" && !SenderCellPhone) {
        return res.send(
          "SenderCellPhone is required for real account when type is C2C",
        );
      }
    }

    const isB2C = type === "B2C";

    const base_param = {
      MerchantID: ecpayService.getTestLogisticMerchantID(realAccount, isB2C),
      MerchantTradeNo: ecpayService.generateTradeNo(),
      MerchantTradeDate: ecpayService.generateMerchantTradeDate(),
      LogisticsType: "CVS",
      LogisticsSubType: realAccount
        ? LogisticsSubType
        : isB2C
          ? "UNIMART"
          : "UNIMARTC2C", // 範例：7-ELEVEN
      GoodsName: "測試商品",
      GoodsAmount: "300",
      SenderName: SenderName || "水滴賣家",
      IsCollection: "N", // 是否代收貨款
      ServerReplyURL: `${process.env.HOST}/api/ecpay/express/test/server-reply`, // 接收門市資訊的後端網址
      ClientReplyURL: `${process.env.HOST}/api/ecpay/express/test/client-reply`,
      ReceiverName: String(ReceiverName), // "王小明",
      ReceiverCellPhone: String(ReceiverCellPhone), // "0978443522",
      ReceiverEmail: String(ReceiverEmail), // "safaf2@ddd.com",
      ReceiverStoreID: realAccount ? ReceiverStoreID : "131386",
      ...(isB2C
        ? {}
        : {
            SenderCellPhone: realAccount
              ? SenderCellPhone
              : process.env.LOGISTICS_SENDER_CELL_PHONE,
          }),
      CustomField1: "CustomField1",
    };
    console.log(base_param);

    const formHtml = ecpayService.generateFormHtml({
      actionUrl: ecpayService.getTestExpressUrl(realAccount),
      parameters: base_param,
      checkMacValueOptions: {
        hashKey: ecpayService.getTestLogisticHashKey(realAccount, isB2C),
        hashIV: ecpayService.getTestLogisticHashIV(realAccount, isB2C),
        algorithm: "md5",
      },
    });

    return res.send(formHtml);
  }

  async handleTestExpressServerReply(
    req: Request,
    res: Response,
  ): Promise<any> {
    const data = req.body;
    console.log("測試運單結果:", data);
    res.send("1|OK");
  }

  async handleTestExpressClientReply(
    req: Request,
    res: Response,
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
                  2,
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
      type = "B2C",
      orderId,
      productIds,
      LogisticsSubType,
      GoodsName,
      GoodsAmount,
      ReceiverName,
      ReceiverCellPhone,
      ReceiverEmail,
      ReceiverStoreID,
      ReceiverStoreName,
      ReceiverStoreAddress,
      ReceiverStoreTelephone,
      SenderName,
      SenderCellPhone,
      shippingCost,
    } = req.query;

    if (
      !token ||
      !orderId ||
      !LogisticsSubType ||
      !GoodsName ||
      !GoodsAmount ||
      !ReceiverName ||
      !ReceiverCellPhone ||
      !ReceiverEmail ||
      !ReceiverStoreID
    )
      return res.send("Missing required parameters");
    if (type !== "B2C" && !SenderCellPhone) {
      return res.send("SenderCellPhone is required when type is C2C");
    }

    const payload = validateToken(String(token));
    if (!payload || typeof payload === "string" || !payload.data?.id)
      return res.send("Invalid token");

    const merchantTradeNo = ecpayService.generateTradeNo();

    let pIds: string[] = [];
    if (Array.isArray(productIds)) {
      pIds = productIds.filter((p) => typeof p === "string") as string[];
    } else if (typeof productIds === "string") {
      pIds = [productIds];
    }

    if (pIds.length > 0) {
      const cvsStoreInfo: Record<string, string> = {};
      cvsStoreInfo["storeID"] = String(ReceiverStoreID);
      if (ReceiverStoreName)
        cvsStoreInfo["storeName"] = String(ReceiverStoreName);
      if (ReceiverStoreAddress)
        cvsStoreInfo["storeAddress"] = String(ReceiverStoreAddress);
      if (ReceiverStoreTelephone)
        cvsStoreInfo["storeTelephone"] = String(ReceiverStoreTelephone);

      await createMerchantTrade({
        merchantTradeNo,
        orderId: String(orderId),
        productIds: pIds,
        cvsStoreInfo,
        shippingCost: shippingCost ? Number(shippingCost) : 0,
      });
    }

    const maxGoodsAmount = Math.min(20000, Math.floor(Number(GoodsAmount)));

    const base_param = {
      MerchantID: process.env.LOGISTICS_MERCHANTID,
      MerchantTradeNo: merchantTradeNo,
      MerchantTradeDate: ecpayService.generateMerchantTradeDate(),
      LogisticsType: "CVS",
      LogisticsSubType, // 範例：7-ELEVEN
      GoodsName: String(GoodsName),
      GoodsAmount: String(maxGoodsAmount),
      CollectionAmount: String(maxGoodsAmount),
      SenderName: SenderName || "水滴賣家",
      IsCollection: "N", // 是否代收貨款
      ServerReplyURL: `${process.env.HOST}/api/ecpay/express/server-reply`, // 接收門市資訊的後端網址
      ClientReplyURL: `${process.env.HOST}/api/ecpay/express/client-reply`, // 接收門市資訊的後端網址
      ReceiverName: String(ReceiverName),
      ReceiverCellPhone: String(ReceiverCellPhone),
      ReceiverEmail: String(ReceiverEmail),
      ReceiverStoreID: String(ReceiverStoreID),
      ...(type === "B2C" ? {} : { SenderCellPhone: String(SenderCellPhone) }),
    };

    console.log("base_param: ", base_param);

    const formHtml = ecpayService.generateFormHtml({
      actionUrl: `${ECPAY_LOGISTIC_BASE_URL}/Express/Create`,
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
                  2,
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
      const merchantTrade = await getMerchantTradeByMerchantTradeNo(
        data.MerchantTradeNo,
      );
      if (!merchantTrade) throw new Error("Order not found");

      await createDelivery(
        {
          orderId: merchantTrade.orderId,
          merchantTradeNo: merchantTrade.merchantTradeNo,
          AllPayLogisticsID: data.AllPayLogisticsID,
          LogisticsType: data.LogisticsType ?? "CVS",
          LogisticsSubType: data.LogisticsSubType,
          CVSPaymentNo: data.CVSPaymentNo ?? null,
          CVSValidationNo: data.CVSValidationNo ?? null,
          GoodsAmount: Number(data.GoodsAmount),
          RtnCode: data.RtnCode,
          RtnMsg: data.RtnMsg,
          cvsStoreInfo: merchantTrade.cvsStoreInfo,
          metadata: data,
          fee: merchantTrade.shippingCost,
        },
        merchantTrade?.productIds,
      );
    } catch (error) {
      console.log(error);
    }

    res.send(`1|OK`);
  }

  async printTradeDocument(req: Request, res: Response) {
    const {
      token,
      LogisticsSubType,
      AllPayLogisticsID,
      CVSPaymentNo,
      CVSValidationNo,
    } = req.query;

    if (!token || !LogisticsSubType || !AllPayLogisticsID)
      return res.send("Missing required parameters");
    if (
      typeof LogisticsSubType === "string" &&
      LogisticsSubType.endsWith("C2C")
    ) {
      if (
        LogisticsSubType === "UNIMARTC2C" &&
        (!CVSPaymentNo || !CVSValidationNo)
      )
        return res.send(
          "CVSPaymentNo and CVSValidationNo are required if LogisticsSubType is UNIMARTC2C",
        );
      if (LogisticsSubType === "FAMIC2C" && !CVSPaymentNo)
        return res.send(
          "CVSPaymentNo is required if LogisticsSubType is FAMIC2C",
        );
      if (LogisticsSubType === "OKMARTC2C" && !CVSPaymentNo)
        return res.send(
          "CVSPaymentNo is required if LogisticsSubType is OKMARTC2C",
        );
    }
    const payload = validateToken(String(token));
    if (!payload || typeof payload === "string" || !payload.data?.id)
      return res.send("Invalid token");

    const formHtml = ecpayService.generateFormHtml({
      actionUrl: ecpayService.getPrintTradeDocumentActionUrl(LogisticsSubType),
      parameters: ecpayService.getPrintTradeDocumentParameters(
        process.env.LOGISTICS_MERCHANTID!,
        { LogisticsSubType, AllPayLogisticsID, CVSPaymentNo, CVSValidationNo },
      ),
      checkMacValueOptions: {
        hashKey: process.env.LOGISTICS_HASH_KEY!,
        hashIV: process.env.LOGISTICS_HASH_IV!,
        algorithm: "md5",
      },
    });

    return res.send(formHtml);
  }

  async queryLogisticsTradeInfo(req: Request, res: Response): Promise<any> {
    const { token, AllPayLogisticsID, MerchantTradeNo } = req.query;
    if (!token) return res.send("Missing required parameters");
    if (!AllPayLogisticsID && !MerchantTradeNo)
      return res.send("AllPayLogisticsID or MerchantTradeNo is required");

    const payload = validateToken(String(token));
    if (!payload || typeof payload === "string" || !payload.data?.id)
      return res.send("Invalid token");

    const parameters: Record<string, any> = {
      MerchantID: process.env.LOGISTICS_MERCHANTID,
      TimeStamp: Math.floor(Date.now() / 1000),
    };

    if (AllPayLogisticsID) {
      parameters["AllPayLogisticsID"] = String(AllPayLogisticsID);
    }
    if (MerchantTradeNo) {
      parameters["MerchantTradeNo"] = String(MerchantTradeNo);
    }

    const formHtml = ecpayService.generateFormHtml({
      actionUrl: ECPAY_QUERY_LOGISTICS_TRADE_INFO_URL,
      parameters,
      checkMacValueOptions: {
        hashKey: process.env.LOGISTICS_HASH_KEY!,
        hashIV: process.env.LOGISTICS_HASH_IV!,
        algorithm: "md5",
      },
    });

    return res.send(formHtml);
  }

  async queryLogisticsTradeInfoJSON(req: Request, res: Response): Promise<any> {
    const { AllPayLogisticsID, MerchantTradeNo } = req.query;

    if (!AllPayLogisticsID && !MerchantTradeNo)
      return res.status(400).json({
        success: false,
        error: "AllPayLogisticsID or MerchantTradeNo is required",
      });

    const parameters: Record<string, any> = {
      MerchantID: process.env.LOGISTICS_MERCHANTID,
      TimeStamp: Math.floor(Date.now() / 1000),
    };

    if (AllPayLogisticsID) {
      parameters["AllPayLogisticsID"] = String(AllPayLogisticsID);
    }
    if (MerchantTradeNo) {
      parameters["MerchantTradeNo"] = String(MerchantTradeNo);
    }

    const checkMacValue = ecpayService.generateCheckValue(
      parameters,
      process.env.LOGISTICS_HASH_KEY!,
      process.env.LOGISTICS_HASH_IV!,
      "md5",
    );

    parameters["CheckMacValue"] = checkMacValue;

    try {
      // 使用 axios 發送 POST 到綠界 (注意：不是 res.send(formHtml))
      const response = await axios.post(
        ECPAY_QUERY_LOGISTICS_TRADE_INFO_URL,
        querystring.stringify(parameters), // 轉成 key=value&key2=value2 格式
        { headers: { "Content-Type": "application/x-www-form-urlencoded" } },
      );

      // 解析綠界回傳的字串內容
      // 綠界會回傳像你提供的那串：ActualWeight=null&AllPayLogisticsID=...
      const resultData = querystring.parse(response.data);

      // 回傳 JSON 給 Client
      return res.json({
        success: true,
        data: resultData,
      });
    } catch (error) {
      console.error("Query ECPay Error:", error);
      return res.status(500).json({ success: false, message: "查詢失敗" });
    }
  }
}

export default new EcPayController();
